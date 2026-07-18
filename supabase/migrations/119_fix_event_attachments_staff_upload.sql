-- =====================================================
-- SmartLocal 119: แก้ policy อัปโหลดไฟล์แนบกิจกรรม — เดิมไม่ได้รวม staff/officer
-- เข้าไปจริงๆ ทั้งที่ comment บอกว่า "อัปโหลด: staff เท่านั้น" (033_events_attachment.sql)
-- ทำให้เจ้าหน้าที่ (staff/officer) แก้ไขกิจกรรมได้ปกติ แต่แนบไฟล์ไม่ได้เลย
-- =====================================================

DROP POLICY IF EXISTS "allow staff upload event attachments" ON storage.objects;
CREATE POLICY "allow staff upload event attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-attachments'
    AND get_my_role() IN ('superadmin', 'admin', 'viewer', 'staff', 'officer')
  );

DROP POLICY IF EXISTS "allow staff delete event attachments" ON storage.objects;
CREATE POLICY "allow staff delete event attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-attachments'
    AND get_my_role() IN ('superadmin', 'admin', 'viewer', 'staff', 'officer')
  );
