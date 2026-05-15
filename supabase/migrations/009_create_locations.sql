-- เพิ่ม column subject, village, location_name, attachments ใน complaints (ถ้ายังไม่มี)
alter table complaints
  add column if not exists subject       text,
  add column if not exists village       text,
  add column if not exists location_name text,
  add column if not exists attachments   text[] default '{}';

-- ตาราง สถานที่เกิดเหตุ (จัดการโดย admin ของแต่ละ municipality)
create table if not exists locations (
  id               uuid primary key default gen_random_uuid(),
  municipality_id  uuid not null references municipalities(id) on delete cascade,
  name             text not null,
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists locations_municipality_idx on locations(municipality_id, sort_order);

alter table locations enable row level security;

drop policy if exists "admin can manage locations" on locations;

create policy "admin can manage locations"
  on locations for all
  using (true)
  with check (true);
