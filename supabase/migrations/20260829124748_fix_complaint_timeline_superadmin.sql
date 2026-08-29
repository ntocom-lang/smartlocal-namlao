-- 20260829124748_fix_complaint_timeline_superadmin.sql
--
-- ปัญหา: superadmin เขียนและอ่าน complaint_timeline ไม่ได้เลยทุก อปท.
--
-- policy เดิมใส่ 'superadmin' ไว้ในลิสต์ role แล้ว แต่ยังบังคับ
--   c.municipality_id = get_my_municipality_id()
-- ซึ่ง superadmin มี profiles.municipality_id = NULL โดยการออกแบบ (ดูแลทุก อปท.)
-- เงื่อนไขจึงกลายเป็น `c.municipality_id = NULL` → NULL → ไม่ผ่าน policy ตลอด
-- ผลจริงที่เจอตอนทดสอบ: superadmin กดเปลี่ยนสถานะคำร้อง สถานะเปลี่ยนสำเร็จ แต่ INSERT
-- ลง complaint_timeline โดน 403 ทุกครั้ง หมายเหตุที่พิมพ์หายทั้งก้อนโดยไม่มีใครรู้
-- (ฝั่ง client เดิมใช้ .then() เปล่า ไม่ได้อ่าน error — แก้แล้วใน ComplaintsManager.jsx)
--
-- แก้ตามแพทเทิร์นเดียวกับ policy อื่นในระบบ (เช่น "department scoped insert posts"):
-- แยก superadmin เป็น OR branch แรก แล้วค่อยเป็น branch ที่ผูกกับ municipality ของตัวเอง
-- ขอบเขตสิทธิ์ของ role อื่นไม่เปลี่ยนแม้แต่ข้อเดียว

DROP POLICY IF EXISTS "scoped read complaint_timeline" ON public.complaint_timeline;

CREATE POLICY "scoped read complaint_timeline" ON public.complaint_timeline
FOR SELECT USING (
  -- เจ้าของคำร้องอ่านประวัติของตัวเองได้
  EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = complaint_timeline.complaint_id
      AND c.user_id = auth.uid()
  )
  -- superadmin ดูแลทุก อปท. municipality_id เป็น NULL จึงเทียบกับ c.municipality_id ไม่ได้
  OR get_my_role() = 'superadmin'
  -- เจ้าหน้าที่ภายในอ่านได้เฉพาะคำร้องของ อปท. ตัวเอง (คงขอบเขตเดิมทุกประการ)
  OR EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = complaint_timeline.complaint_id
      AND c.municipality_id = get_my_municipality_id()
      AND get_my_role() = ANY (ARRAY[
        'admin', 'officer', 'staff', 'technician', 'viewer', 'council'
      ])
  )
);

DROP POLICY IF EXISTS "staff insert own municipality timeline" ON public.complaint_timeline;

CREATE POLICY "staff insert own municipality timeline" ON public.complaint_timeline
FOR INSERT WITH CHECK (
  get_my_role() = 'superadmin'
  OR EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = complaint_timeline.complaint_id
      AND c.municipality_id = get_my_municipality_id()
      AND get_my_role() = ANY (ARRAY['admin', 'officer', 'staff', 'technician'])
  )
);

COMMENT ON TABLE public.complaint_timeline IS
  'ประวัติการเปลี่ยนสถานะคำร้องแบบต่อท้าย (append-only) พร้อมหมายเหตุและชื่อผู้ดำเนินการ '
  'เป็นที่เก็บหมายเหตุของทุกสถานะยกเว้นรายงานหน้างานของช่าง ซึ่งอยู่ที่ complaints.technician_note';
