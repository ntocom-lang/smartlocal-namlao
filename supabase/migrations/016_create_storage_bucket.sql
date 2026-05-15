-- =====================================================
-- SmartLocal: สร้าง Storage bucket สำหรับไฟล์แนบคำร้อง
-- =====================================================

-- 1. สร้าง bucket (public = ดูได้โดยไม่ต้อง auth)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'complaint-attachments',
  'complaint-attachments',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

-- 2. Policy: ทุกคน (รวม anonymous) อัปโหลดได้
DROP POLICY IF EXISTS "allow public upload complaint attachments" ON storage.objects;
CREATE POLICY "allow public upload complaint attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'complaint-attachments');

-- 3. Policy: ทุกคนอ่าน/ดูได้
DROP POLICY IF EXISTS "allow public read complaint attachments" ON storage.objects;
CREATE POLICY "allow public read complaint attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'complaint-attachments');

-- 4. Policy: admin ลบได้
DROP POLICY IF EXISTS "allow admin delete complaint attachments" ON storage.objects;
CREATE POLICY "allow admin delete complaint attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'complaint-attachments'
    AND get_my_role() IN ('admin', 'superadmin')
  );
