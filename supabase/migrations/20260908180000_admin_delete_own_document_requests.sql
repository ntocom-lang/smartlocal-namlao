-- เปิดให้ admin ของ อปท. ลบคำขอบริการ/เอกสารได้ เฉพาะของ อปท. ตัวเองเท่านั้น
--
-- ของเดิมมี policy DELETE ตัวเดียวคือ superadmin ซึ่งทั้งระบบมีบัญชีเดียว (municipality_id = null)
-- ผลคือแอดมินของแต่ละ อปท. ลบคำขอที่ยื่นผิด/ทดสอบ/สแปมเองไม่ได้เลย ต้องรอผู้ดูแลระบบส่วนกลาง
--
-- ⚠️ ขอบเขตที่ต้องไม่หลุด: admin ลบได้เฉพาะแถวที่ municipality_id ตรงกับของตัวเอง
-- ถ้าเขียนเป็น get_my_role() = 'admin' เฉยๆ จะกลายเป็นแอดมิน อปท. หนึ่งลบข้อมูลของอีก อปท. ได้
-- (ระบบนี้ใช้ฐานข้อมูลก้อนเดียวกันทุก อปท.)
--
-- ⚠️ ต้องกัน municipality_id ที่เป็น NULL ทั้งสองฝั่ง — ใน Postgres `NULL = NULL` ให้ NULL
-- ซึ่ง RLS ถือว่าไม่ผ่านอยู่แล้ว แต่เขียน IS NOT NULL กำกับไว้ให้อ่านแล้วเห็นเจตนาชัด
-- และกันเคสข้อมูลเก่าที่ municipality_id หลุดเป็น NULL
--
-- ไม่แตะ policy ของ superadmin, SELECT, INSERT, UPDATE ใดๆ — เพิ่ม policy ใหม่ตัวเดียว
-- (หลาย policy ของ cmd เดียวกันเป็น OR กัน ตามพฤติกรรมของ PostgreSQL RLS)
--
-- ร่องรอยการลบ: ฝั่งแอปเขียน audit_logs ก่อนลบทุกครั้ง (handleDelete ใน StaffDashboard.jsx)
-- ⚠️ audit_logs เป็นการบันทึกจากฝั่ง client จึงเป็น "ร่องรอยสำหรับตรวจสอบภายใน"
-- ไม่ใช่หลักประกันระดับฐานข้อมูล ถ้าต้องการให้ผู้ตรวจยึดถือได้จริงต้องทำเป็น trigger
-- ฝั่ง DB หรือ soft delete แยกต่างหาก ยังไม่ได้ทำในไฟล์นี้

BEGIN;

DROP POLICY IF EXISTS "admin delete own municipality document_requests" ON public.document_requests;

CREATE POLICY "admin delete own municipality document_requests" ON public.document_requests
  FOR DELETE
  TO authenticated
  USING (
    public.get_my_role() = 'admin'
    AND municipality_id IS NOT NULL
    AND municipality_id = public.get_my_municipality_id()
  );

COMMIT;
