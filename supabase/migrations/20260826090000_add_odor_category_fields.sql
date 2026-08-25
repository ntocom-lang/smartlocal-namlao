-- เพิ่มคอลัมน์ JSONB อเนกประสงค์สำหรับเก็บฟิลด์เสริมเฉพาะบางหมวดคำร้อง (เริ่มจากหมวด odor:
-- incident_source_suspected, incident_time, odor_intensity, wind_direction, health_effect)
-- แยกจาก issue_type (คอลัมน์เดี่ยว) เพราะ 5 ฟิลด์นี้ยังไม่มีความจำเป็นต้องกรอง/ออกรายงานแยกรายฟิลด์
-- ในเร็วๆ นี้ — ใช้ JSONB ก้อนเดียวรองรับหมวดอื่นในอนาคตได้โดยไม่ต้อง migrate คอลัมน์ใหม่ทุกครั้ง
alter table public.complaints
  add column if not exists extra_data jsonb;

-- ไม่ต้องแก้ RPC อ่านข้อมูล (list_complaints_for_staff, get_complaint_private_detail) เลย — ทั้งคู่ใช้
-- to_jsonb(row) ครอบทั้งแถว ไม่ใช่ allowlist คอลัมน์ คอลัมน์ใหม่ไหลผ่านอัตโนมัติทุก role (ยืนยันแล้วตอน
-- เพิ่ม issue_type ก่อนหน้านี้)

-- รายชื่อ "แหล่งที่มาที่คาดว่าเป็นต้นตอกลิ่น" ให้แต่ละเทศบาลกำหนดเอง (เช่น รายชื่อฟาร์มในพื้นที่)
-- ตัวเลือก "ไม่แน่ชัด" ไม่เก็บในนี้ — CitizenForm.jsx เติมเองเสมอ ไม่ให้แอดมินแก้/ลบได้
alter table public.municipalities
  add column if not exists odor_source_options jsonb not null default '[]'::jsonb;

-- municipalities ใช้ column-level GRANT ไม่ใช่ table-level SELECT (ตั้งแต่
-- 20260816191000_fix_municipalities_column_grants_properly.sql) — ADD COLUMN ไม่เพิ่มสิทธิ์อ่านให้อัตโนมัติ
grant select (odor_source_options) on public.municipalities to anon, authenticated;

-- จับ schema drift: is_active มีอยู่จริงใน complaint_categories (ยืนยันผ่าน REST — CitizenForm.jsx และ
-- ComplaintCategory.jsx ต่างก็ filter ด้วย .eq('is_active', true) มานานแล้ว) แต่ไม่เคยมี migration สร้าง
-- คอลัมน์นี้เลยตั้งแต่ 013_create_complaint_categories.sql — เพิ่มให้ถูกต้อง (no-op ถ้ามีอยู่แล้วจริง)
alter table public.complaint_categories
  add column if not exists is_active boolean not null default true;

-- เติมหมวดคำร้อง odor ให้ทุกเทศบาลที่มีอยู่แล้วทันที (ไม่รอแอดมินกดเพิ่มเอง เพราะปุ่ม "เพิ่มหมวด" ใน
-- AdminDashboard.jsx สร้าง value อัตโนมัติแบบ cat_<timestamp> ไม่มีทางตรงกับ 'odor' ที่โค้ดฝั่ง
-- CitizenForm.jsx ใช้ gate ฟิลด์เสริม — ต้อง insert ตรงๆ ด้วย value='odor' เท่านั้น)
insert into public.complaint_categories
  (municipality_id, value, label, emoji, color, text_color, sort_order, is_active)
select
  m.id, 'odor', 'กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)', '💨', '#ECFCCB', '#4D7C0F',
  coalesce((select max(sort_order) + 1 from public.complaint_categories c where c.municipality_id = m.id), 0),
  true
from public.municipalities m
on conflict (municipality_id, value) do nothing;
