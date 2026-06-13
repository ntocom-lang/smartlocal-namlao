-- 056_document_url.sql
-- เพิ่ม document_url ใน document_requests เพื่อเก็บ link เอกสารดิจิทัลที่ออกให้ประชาชน (LPA ๑.๗)

alter table document_requests
  add column if not exists document_url text,
  add column if not exists issued_at    timestamptz;

-- Storage bucket สำหรับเอกสารที่ออกให้ประชาชน (public read)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-certs',
  'document-certs',
  true,
  5242880,
  ARRAY['text/html', 'application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- allow authenticated staff to upload
drop policy if exists "staff upload document certs" on storage.objects;
create policy "staff upload document certs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'document-certs');

-- allow public to read (citizen downloads)
drop policy if exists "public read document certs" on storage.objects;
create policy "public read document certs"
  on storage.objects for select
  using (bucket_id = 'document-certs');

-- allow authenticated to delete/replace
drop policy if exists "staff delete document certs" on storage.objects;
create policy "staff delete document certs"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'document-certs');
