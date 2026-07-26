-- 130: เอกสารทางการของคำร้อง — Draft PDF ⇄ GDCC e-Office ⇄ PDF ฉบับสมบูรณ์
-- path convention: official-documents/{municipality_id}/{complaint_id}/draft_{timestamp}.pdf
--                                                                    /final_{timestamp}.pdf

alter table complaints
  add column if not exists draft_pdf_path       text,
  add column if not exists official_receipt_no  text,
  add column if not exists final_document_path  text,
  add column if not exists document_uploaded_at timestamptz,
  add column if not exists document_uploaded_by uuid references profiles(id),
  -- Phase B (Google Drive auto-sync) — ยังไม่ใช้งานตอนนี้ เตรียมคอลัมน์ไว้เฉยๆ
  add column if not exists gdrive_file_id       text,
  add column if not exists gdrive_synced_at     timestamptz;

comment on column complaints.draft_pdf_path      is 'path ใน bucket official-documents: PDF ฉบับร่างที่แอดมิน export ไปยื่น GDCC e-Office ด้วยตัวเอง';
comment on column complaints.official_receipt_no is 'เลขรับหนังสือจาก GDCC e-Office กรอกโดยแอดมินหลังได้รับ PDF ที่ลงนามแล้ว';
comment on column complaints.final_document_path is 'path ใน bucket official-documents: PDF ฉบับสมบูรณ์ (ลงนามแล้ว) ที่แอดมินอัปโหลดกลับเข้าระบบ';
comment on column complaints.gdrive_file_id       is 'Phase B (ยังไม่ทำ): จะใช้ตอนมี Google Drive auto-sync';
comment on column complaints.gdrive_synced_at     is 'Phase B (ยังไม่ทำ): จะใช้ตอนมี Google Drive auto-sync';

-- bucket ใหม่ แยกจาก complaint-attachments (public, รูปภาพ) เพราะเอกสารทางการต้อง private
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('official-documents', 'official-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update set
  public             = false,
  file_size_limit    = 20971520,
  allowed_mime_types = array['application/pdf'];

drop policy if exists "official documents insert staff" on storage.objects;
create policy "official documents insert staff"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'official-documents'
    and get_my_role() in ('admin', 'superadmin', 'officer')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

drop policy if exists "official documents select staff" on storage.objects;
create policy "official documents select staff"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'official-documents'
    and get_my_role() in ('admin', 'superadmin', 'officer', 'technician')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

-- ประชาชนเจ้าของคำร้องดูไฟล์ของตัวเองได้ (ใช้ตอนโหลดเอกสารฉบับสมบูรณ์ใน MyComplaints.jsx)
drop policy if exists "official documents select citizen" on storage.objects;
create policy "official documents select citizen"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'official-documents'
    and exists (
      select 1 from complaints c
      where c.id::text = (storage.foldername(name))[2]
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "official documents delete admin" on storage.objects;
create policy "official documents delete admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'official-documents'
    and get_my_role() in ('admin', 'superadmin')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );
