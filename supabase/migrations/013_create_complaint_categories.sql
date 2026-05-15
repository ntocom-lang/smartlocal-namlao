-- ตาราง ประเภทคำร้อง (จัดการโดย admin ของแต่ละ municipality)
create table if not exists complaint_categories (
  id               uuid primary key default gen_random_uuid(),
  municipality_id  uuid not null references municipalities(id) on delete cascade,
  value            text not null,
  label            text not null,
  emoji            text not null default '📝',
  color            text not null default '#F3F4F6',
  text_color       text not null default '#374151',
  sort_order       int  not null default 0,
  created_at       timestamptz not null default now(),
  constraint complaint_categories_unique_value unique (municipality_id, value)
);

create index if not exists complaint_categories_muni_idx
  on complaint_categories(municipality_id, sort_order);

alter table complaint_categories enable row level security;

drop policy if exists "admin can manage complaint_categories" on complaint_categories;

create policy "admin can manage complaint_categories"
  on complaint_categories for all
  using (true)
  with check (true);
