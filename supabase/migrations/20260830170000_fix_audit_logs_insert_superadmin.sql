-- audit_logs: superadmin เขียน log ไม่ได้ (403) — ทุก action ของบัญชีที่มีอำนาจสูงสุดไม่ถูกบันทึก
--
-- ปัญหา: policy INSERT ตั้งแต่ 068_audit_logs.sql ใช้เงื่อนไข
--   municipality_id IN (SELECT municipality_id FROM profiles WHERE id = auth.uid())
-- แต่ superadmin มี profiles.municipality_id = NULL โดยการออกแบบ (เข้าได้ทุก อปท.)
-- ผลคือ `municipality_id IN (NULL)` ให้ค่า NULL → RLS ตีเป็นไม่ผ่าน → 403 ทุกครั้ง
--
-- migration 118 แก้ปัญหานี้ไว้แล้วสำหรับ SELECT แต่ไม่ได้แตะ INSERT จึงค้างมาถึงตอนนี้
-- และ logAction() ฝั่ง client กลืน error ทิ้ง (ตั้งใจ ไม่ให้ audit log ไปบล็อก UI)
-- ความล้มเหลวจึงเงียบสนิท ไม่มีใครรู้ว่าร่องรอยหายไป
--
-- ตรวจพบตอนทดสอบระบบยานพาหนะจริงผ่านหน้าเว็บ: อนุมัติ/ปฏิเสธ/ลบ ครบทุก action
-- ขึ้น 403 ที่ /rest/v1/audit_logs ทั้งหมด
--
-- ผลกระทบเชิงการตรวจสอบ: บัญชีผู้ดูแลระบบส่วนกลาง (ผู้พัฒนา/ผู้รับจ้างดูแลระบบ)
-- คือบัญชีที่ควรถูกบันทึกละเอียดที่สุด แต่กลับเป็นบัญชีเดียวที่ไม่ถูกบันทึกเลย
--
-- ใช้รูปแบบเดียวกับ policy SELECT ที่ 20260802070000 วางไว้ (get_my_role / get_my_municipality_id)
-- เพื่อไม่ให้เงื่อนไขทั้งสองฝั่งหลุดจากกันอีก

DROP POLICY IF EXISTS "authenticated can insert audit logs" ON public.audit_logs;
CREATE POLICY "authenticated can insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    -- superadmin ทำงานข้าม อปท. ได้ จึงผูกกับ municipality_id ของตัวเองไม่ได้
    public.get_my_role() = 'superadmin'
    -- เจ้าหน้าที่/แอดมินของ อปท. บันทึกได้เฉพาะ log ของ อปท. ตัวเอง (ข้อจำกัดเดิม ไม่เปลี่ยน)
    OR municipality_id = public.get_my_municipality_id()
  );
