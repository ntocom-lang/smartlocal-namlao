-- =====================================================
-- SmartLocal: ตาราง staff (ผู้บริหารและทีมงาน)
-- =====================================================

create table if not exists staff (
  id               uuid primary key default gen_random_uuid(),
  municipality_id  uuid not null references municipalities(id) on delete cascade,
  name             text not null,
  title            text not null,          -- ชื่อตำแหน่งจริง เช่น "นายกเทศมนตรีตำบลน้ำเลา"
  role             text not null check (
    role in ('mayor', 'deputy_mayor', 'clerk', 'staff')
  ),
  photo_url        text,
  display_order    int not null default 99,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists staff_municipality_idx on staff(municipality_id);

alter table staff enable row level security;

drop policy if exists "public can read active staff" on staff;
create policy "public can read active staff"
  on staff for select
  using (is_active = true);

-- ตัวอย่างข้อมูล (ใส่ municipality_id จริงหลัง insert municipalities)
-- insert into staff (municipality_id, name, title, role, display_order) values
--   ('<uuid>', 'นายสมชาย ใจดี',    'นายกเทศมนตรีตำบลน้ำเลา', 'mayor',       1),
--   ('<uuid>', 'นางสาวสมหญิง ดีใจ', 'รองนายกเทศมนตรี',         'deputy_mayor', 2),
--   ('<uuid>', 'นายวิชัย มั่นคง',   'ปลัดเทศบาล',              'clerk',        3);
