-- หมวดคำร้องมาตรฐาน "สอบถาม/ติดต่อเจ้าหน้าที่" (inquiry) ให้ทุก อปท. — ข้อ 1.3 แผนเทียบคู่แข่ง
--
-- ทำไม (เจ้าของระบบอนุมัติ 2569-11-17 "ตามแนะนำ"):
--   ประชาชนอยากถามเจ้าหน้าที่เป็นลายลักษณ์อักษรและรอคำตอบ แต่ /contact เป็นหน้าข้อมูลล้วน ไม่มีช่องส่งข้อความ
--   ใช้โครงคำร้องเดิม (รับเรื่องเอง → ส่งกอง → ตอบ → ลิงก์ติดตาม /t/) ไม่สร้างตารางหรือฟังก์ชันใหม่
--   ตรวจ origin/master 2569-11-17 แล้วไม่มีหมวดนี้ใน อปท. ใดเลย (DEFAULT_SEED ใน AdminDashboard.jsx มี 13 หมวด ไม่มี inquiry)
--
-- สิ่งที่ทำ (transaction เดียว) — สร้าง inquiry ให้ อปท. ที่ยังไม่มี (ไม่แตะ อปท. ที่มีอยู่แล้ว) แบบเดียวกับ flood (20261024120000):
--   • กองรับผิดชอบ: สำนักปลัด (general) ผ่าน resolve_work_department — เปลี่ยนกองเองได้ที่ Admin > ประเภทคำร้อง
--   • เปิดให้ใคร: "ตามนโยบายของ อปท. นั้นเองเรื่องร้องทุกข์" — คัดลอก is_active + submit_audience จากหมวด grievance ของ อปท. เดียวกัน
--     ไม่มีแถว grievance = ปิด + เฉพาะผู้มีตำแหน่ง (ค่าปลอดภัยไว้ก่อน) · ไม่มีกองสำนักปลัดเลย = สร้างแบบปิด
--     (trg_active_category_requires_department ห้ามหมวดที่เปิดอยู่ไม่มีกอง) · เปิด/ปิดเองได้ที่ Admin > ประเภทคำร้อง
--   • requires_resolved_location = false: คำถามไม่มีหน้างาน ไม่ต้องปักหมุดตอนตอบ (ค่าตั้งต้นของคอลัมน์คือ true)
--   • is_adhoc = false, requires_manual_intake = false: ไม่กันการรับเรื่องอัตโนมัติ · นับในสถิติร้องเรียนตามปกติ (เจ้าของเลือก "นับรวม")
--     ⚠️ ระบบจะรับเรื่องเองได้ก็ต่อเมื่อหมวดมีผู้รับผิดชอบใน category_assignments (route_complaint_auto_receive ออกทันทีถ้า assigned_to ว่าง)
--     ไฟล์นี้ไม่สร้างผู้รับผิดชอบให้ (การตั้งตัวบุคคลเป็นเรื่องของแอดมินแต่ละ อปท. เหมือน flood) —
--     จนกว่าแอดมินตั้งที่ Admin > ประเภทคำร้อง คำถามจะรออยู่ในคิวรับเรื่องของแอดมิน (reviewer ตรวจรอบแรก M1)
--   • form_type: หน้าเว็บส่ง 'legacy' เสมอ เพราะ CHECK ของ complaints.form_type (042) ไม่มีค่า 'inquiry' — ไม่แก้ constraint (reviewer C1)
--   • ลำดับปล่อย: deploy หน้าเว็บก่อน แล้วค่อยรันไฟล์นี้ (หน้าเว็บรุ่นเก่าจะแสดงหมวดนี้ด้วยฟอร์มร้องเรียนทันทีที่แถวขึ้น)
--
-- ⚠️ รหัส inquiry ต้องตรงกับ DEFAULT_SEED ใน src/pages/AdminDashboard.jsx และ src/lib/inquiry.js (เทสต์ tests/inquiry-category.test.mjs ตรวจให้)
-- ไม่แตะฟังก์ชัน/trigger ใดๆ — ไฟล์นี้แก้เฉพาะข้อมูล รันซ้ำได้ (ข้ามที่มี inquiry อยู่แล้ว)
-- ภาพข่าวผลงาน (exec_complaint_news_base) ต้องมีรูปงาน work_photos > 0 จึงไม่หยิบคำถามมาทำภาพข่าวเอง
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select m.slug, c.is_active, c.submit_audience, c.requires_resolved_location, d.name as department
--   from public.complaint_categories c
--   join public.municipalities m on m.id = c.municipality_id
--   left join public.departments d on d.id = c.department_id
--   where c.value = 'inquiry' order by m.slug;
--   → ทุก อปท. ต้องมี 1 แถว · requires_resolved_location ต้องเป็น false ทุกแถว

BEGIN;

INSERT INTO public.complaint_categories
  (municipality_id, value, label, emoji, color, text_color, sort_order,
   is_active, submit_audience, is_adhoc, requires_manual_intake, requires_resolved_location, department_id)
SELECT
  municipality.id,
  'inquiry',
  'สอบถาม/ติดต่อเจ้าหน้าที่',
  '💬',
  '#F1F5F9',
  '#334155',
  COALESCE((SELECT max(existing.sort_order) FROM public.complaint_categories AS existing
            WHERE existing.municipality_id = municipality.id), -1) + 1,
  routed.department_id IS NOT NULL AND COALESCE(policy.is_active, false),
  COALESCE(policy.submit_audience, 'officials'),
  false,
  false,
  false,
  routed.department_id
FROM public.municipalities AS municipality
CROSS JOIN LATERAL (
  SELECT public.resolve_work_department(municipality.id, 'general', 'สำนักปลัด') AS department_id
) AS routed
LEFT JOIN LATERAL (
  SELECT grievance.is_active, grievance.submit_audience
  FROM public.complaint_categories AS grievance
  WHERE grievance.municipality_id = municipality.id
    AND grievance.value = 'grievance'
  LIMIT 1
) AS policy ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.complaint_categories AS existing
  WHERE existing.municipality_id = municipality.id
    AND existing.value = 'inquiry'
);

COMMIT;
