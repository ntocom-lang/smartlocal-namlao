-- 140_gdcc_add_staff_role_official_documents.sql
-- ปัญหา: official-documents bucket (130) ตั้งชื่อ policy ว่า "...staff" แต่ role list
-- จริงไม่มี 'staff' เลย (มีแค่ admin/superadmin/officer สำหรับ insert,
-- +technician สำหรับ select) ทั้งที่ migration 131 อนุญาตให้ staff แก้ไฟล์เอกสาร
-- (draft_pdf_path, official_receipt_no, final_document_path ฯลฯ) ในตาราง complaints
-- ได้แล้ว — ทำให้ staff กด "Export Draft PDF" หรือ "อัปโหลดเอกสารฉบับสมบูรณ์" ใน
-- ComplaintsManager.jsx ไม่ได้เลย (RLS ปฏิเสธเงียบๆ ไม่มี error ชัดเจน)

drop policy if exists "official documents insert staff" on storage.objects;
create policy "official documents insert staff"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'official-documents'
    and get_my_role() in ('admin', 'superadmin', 'officer', 'staff')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

drop policy if exists "official documents select staff" on storage.objects;
create policy "official documents select staff"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'official-documents'
    and get_my_role() in ('admin', 'superadmin', 'officer', 'technician', 'staff')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );
