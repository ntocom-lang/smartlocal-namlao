-- Storage policies สำหรับ QR Code ของหน่วยงาน
-- path: complaint-attachments/municipality-qr/*

-- admin/superadmin อัปโหลดได้
create policy "admin can upload municipality qr"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'complaint-attachments'
  and name like 'municipality-qr/%'
);

-- admin/superadmin แทนที่ไฟล์เดิมได้ (upsert)
create policy "admin can update municipality qr"
on storage.objects for update
to authenticated
using (
  bucket_id = 'complaint-attachments'
  and name like 'municipality-qr/%'
);

-- ทุกคนอ่าน/ดู QR ได้ (public)
create policy "public can read municipality qr"
on storage.objects for select
using (
  bucket_id = 'complaint-attachments'
  and name like 'municipality-qr/%'
);
