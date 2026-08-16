-- ตารางติดตามไฟล์ที่อัปโหลดขึ้น Google Drive (ผ่าน Edge Function drive-upload) — Drive เองไม่มีแนวคิด
-- RLS/สิทธิ์แบบเทศบาล จึงต้องเก็บ mapping นี้ไว้ในฝั่งเราเอง ให้ drive-file ใช้ตรวจสิทธิ์ก่อนสตรีมไฟล์ส่งกลับ
create table drive_files (
  id text primary key,                    -- Google Drive file ID
  bucket text not null,                    -- เทียบเท่า Supabase Storage bucket เดิม (whitelist ตรวจใน Edge Function)
  municipality_id uuid not null references municipalities(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  is_public boolean not null default false, -- true = แชร์ "ทุกคนที่มีลิงก์ดูได้" แล้วตอนอัปโหลด, false = ต้องผ่าน drive-file เท่านั้น
  filename text not null,
  content_type text,
  web_view_link text,
  created_at timestamptz not null default now()
);

create index idx_drive_files_municipality on drive_files(municipality_id);
create index idx_drive_files_owner on drive_files(owner_user_id);

alter table drive_files enable row level security;

-- อ่านได้: เจ้าของไฟล์เอง หรือ staff เทศบาลเดียวกัน (สอดคล้องกับ pattern เดิมใน upload-photo function)
-- เขียน/ลบ: เฉพาะผ่าน Edge Function ที่ใช้ service role เท่านั้น (bypass RLS) — ฝั่ง client ไม่เขียนตารางนี้ตรงๆ
create policy drive_files_select on drive_files for select
  using (
    owner_user_id = auth.uid()
    or municipality_id = public.get_my_municipality_id()
    or public.get_my_role() = 'superadmin'
  );
