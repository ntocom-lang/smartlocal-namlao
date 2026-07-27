-- 134_lock_document_certs_bucket.sql
-- ปัญหา: document-certs (056) policy ชื่อบอกว่า "staff upload/delete" แต่เงื่อนไขจริง
-- คือ to authenticated with check (bucket_id = 'document-certs') เท่านั้น — ไม่เช็ค role
-- ไม่เช็ค municipality/path เลย ทำให้ citizen ที่สมัครสมาชิกทั่วไป upload/เขียนทับ/ลบ
-- ใบรับรองของเทศบาลไหนก็ได้ใน bucket ที่เป็น public-read
-- Path convention จริงจากโค้ด (StaffDashboard.jsx): `${municipality_id}/${request_id}.html`
-- แก้: ผูก role staff-ish + บังคับ path prefix ตรง municipality ของผู้เรียก
-- (เหมือน pattern ที่ใช้กับ bucket official-documents ใน 130)

DROP POLICY IF EXISTS "staff upload document certs" ON storage.objects;
CREATE POLICY "staff upload document certs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'document-certs'
    AND get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

DROP POLICY IF EXISTS "staff update document certs" ON storage.objects;
CREATE POLICY "staff update document certs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'document-certs'
    AND get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

DROP POLICY IF EXISTS "staff delete document certs" ON storage.objects;
CREATE POLICY "staff delete document certs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'document-certs'
    AND get_my_role() IN ('admin', 'superadmin', 'officer', 'staff')
    AND (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

-- SELECT คงเป็น public read ตามเดิม (ประชาชนต้องเปิดลิงก์เอกสารได้โดยไม่ login)
