-- 20260905130000_get_public_emergency_contacts.sql
--
-- ย้ายการอ่านสมุดเบอร์โทรฝั่งประชาชนจาก "SELECT ตรงบนตาราง" มาเป็น RPC ที่บังคับให้
-- ระบุ อปท. เสมอ
--
-- ต้นเหตุ: RLS ไม่มีทางรู้ว่าผู้เยี่ยมชมที่ไม่ล็อกอินกำลังเปิดเว็บของ อปท. ไหน — ไม่มี
-- JWT claim ให้อ่าน policy อ่านสาธารณะจึงกรองได้แค่ระดับ "แถวนี้เปิดใช้งานและ อปท.
-- ยังมีอยู่จริง" (20260905120000) คนที่ถือ anon key แล้วเขียนคำขอ PostgREST เอง
-- จึงยังดึงเบอร์ข้ามทุก อปท. ได้ในคำขอเดียว
--
-- ทำไมถึงสำคัญกว่าที่เห็น: สมุด book='directory' เก็บเบอร์ส่วนตัวของผู้นำท้องถิ่น
-- (ผู้ใหญ่บ้าน/กำนัน) และมีคอลัมน์ consent_at กำกับความยินยอมไว้ตั้งแต่ออกแบบ
-- แต่ละเบอร์เป็นข้อมูลที่ อปท. เจตนาเผยแพร่ก็จริง แต่การรวบยกชุดข้ามทุก อปท.
-- เป็นการประมวลผลคนละลักษณะกับที่เจ้าของข้อมูลให้ความยินยอมไว้
--
-- _municipality_id ไม่มีค่า default โดยตั้งใจ และเงื่อนไขเขียนเป็น
-- `ec.municipality_id = _municipality_id` ตรงๆ — ส่ง NULL มาจะได้ 0 แถว
-- ไม่ใช่ "เอาทั้งหมด" (กับดักแบบ data_center_unified_pins ที่เคยเขียน
-- `WHERE v_muni IS NULL OR ...` แล้วกลายเป็นช่องรั่วข้ามเทแนนต์)
--
-- คอลัมน์ที่จงใจไม่คืน: consent_at (ร่องรอย PDPA ภายใน) municipality_id, created_at,
-- is_active — ฝั่งหน้าเว็บไม่ได้ใช้ และไม่มีเหตุให้เผยแพร่
--
-- ไฟล์นี้ apply **ก่อน** deploy ได้ปลอดภัย เพราะเป็นการเพิ่มของใหม่ล้วน
-- ยังไม่ถอนสิทธิ์อ่านตรงของ anon — การถอนอยู่ใน 20260905140000 ซึ่งต้อง apply
-- หลัง deploy เท่านั้น (migration รันก่อน deploy เสมอ ถ้าถอนพร้อมกันหน้าเว็บที่ยัง
-- รันโค้ดเก่าอยู่จะเบอร์หายทันที — เคยเกิดจริงกับ set_document_signatory)

create or replace function public.get_public_emergency_contacts(
  _municipality_id uuid,
  _book            text default null
)
returns table (
  id            uuid,
  label         text,
  number        text,
  emoji         text,
  color         text,
  bg            text,
  display_order integer,
  category      text,
  book          text,
  note          text
)
language sql
stable
security definer
set search_path = public
as $$
  select ec.id, ec.label, ec.number, ec.emoji, ec.color, ec.bg,
         ec.display_order, ec.category, ec.book, ec.note
  from public.emergency_contacts ec
  join public.municipalities m
    on m.id = ec.municipality_id
   and m.is_active = true
  where ec.municipality_id = _municipality_id
    and ec.is_active = true
    and (_book is null or ec.book = _book)
  order by ec.display_order nulls last, ec.label;
$$;

-- Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ฟังก์ชันใหม่ทุกตัวมี anon=X ติดมาเอง
-- จึงต้อง REVOKE แล้ว GRANT กลับเฉพาะที่ตั้งใจ ไม่ใช่ปล่อยตามค่า default
revoke all on function public.get_public_emergency_contacts(uuid, text) from public;
grant execute on function public.get_public_emergency_contacts(uuid, text) to anon, authenticated;

comment on function public.get_public_emergency_contacts(uuid, text) is
  'สมุดเบอร์โทรฝั่งประชาชน — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ 0 แถว. _book: urgent | directory | NULL = ทั้งสองสมุด';
