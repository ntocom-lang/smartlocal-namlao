-- 147_dev_journal.sql
-- ส่วนที่ 4 ของแอป: "ผู้พัฒนาระบบ" — บันทึกปัญหา/แก้ไข/เรื่องราว/แผนงานของทั้งระบบ
-- (ข้ามทุกเทศบาลที่ระบบนี้ให้บริการ ไม่ scope ตาม municipality_id เดียว) จำกัดสิทธิ์เฉพาะ
-- บัญชีผู้พัฒนา (ntocom@gmail.com) เท่านั้น ไม่ผูกกับ role เพราะ role ปัจจุบันในระบบ scope
-- ตาม tenant แต่ส่วนนี้ต้องข้ามทุก tenant

create table if not exists public.dev_journal (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bug','fix','story','plan')),
  title text not null,
  body text not null,
  status text not null default 'open' check (status in ('open','done','wontfix')),
  municipality_id uuid references public.municipalities(id), -- nullable = ทั้งระบบ ไม่เจาะจงเทศบาลเดียว
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dev_journal enable row level security;

drop policy if exists "developer only access dev_journal" on public.dev_journal;
create policy "developer only access dev_journal"
on public.dev_journal
for all
to authenticated
using (auth.uid() = 'b3e7c083-05ee-4664-ba42-e866729923ef'::uuid)
with check (auth.uid() = 'b3e7c083-05ee-4664-ba42-e866729923ef'::uuid);
-- uuid ด้านบน = ntocom@gmail.com (ตรวจสอบจาก auth.users แล้ว ณ วันที่สร้างไฟล์นี้)
-- ถ้าเปลี่ยนบัญชีผู้ดูแลในอนาคต ต้อง query auth.users ใหม่แล้วแก้ policy นี้
-- History version aligned with linked Supabase project.
