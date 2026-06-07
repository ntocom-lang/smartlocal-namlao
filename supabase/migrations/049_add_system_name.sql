-- เพิ่มคอลัมน์ system_name สำหรับให้แต่ละหน่วยงานตั้งชื่อระบบของตนเองได้
ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS system_name text DEFAULT 'One Data';

-- ตั้งค่าเริ่มต้นให้เทศบาลตำบลน้ำเลา
UPDATE municipalities SET system_name = 'One Data' WHERE slug = 'namlao';

-- เพิ่ม Policy ให้ admin หรือ superadmin สามารถแก้ไขข้อมูลหน่วยงานของตนเองได้
DROP POLICY IF EXISTS "admin can update municipalities" ON municipalities;
CREATE POLICY "admin can update municipalities" ON municipalities
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('admin', 'superadmin') 
      AND p.municipality_id = municipalities.id
    )
  );
