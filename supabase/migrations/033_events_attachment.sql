-- =====================================================
-- SmartLocal 033: เพิ่ม attachment_url ให้ events + storage bucket
-- =====================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- สร้าง bucket สำหรับไฟล์แนบกิจกรรม
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-attachments',
  'event-attachments',
  true,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 20971520,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- อ่าน: ทุกคน (public bucket)
DROP POLICY IF EXISTS "allow public read event attachments" ON storage.objects;
CREATE POLICY "allow public read event attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-attachments');

-- อัปโหลด: staff เท่านั้น
DROP POLICY IF EXISTS "allow staff upload event attachments" ON storage.objects;
CREATE POLICY "allow staff upload event attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-attachments'
    AND get_my_role() IN ('superadmin', 'admin', 'viewer')
  );

-- ลบ: staff เท่านั้น
DROP POLICY IF EXISTS "allow staff delete event attachments" ON storage.objects;
CREATE POLICY "allow staff delete event attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'event-attachments'
    AND get_my_role() IN ('superadmin', 'admin', 'viewer')
  );
