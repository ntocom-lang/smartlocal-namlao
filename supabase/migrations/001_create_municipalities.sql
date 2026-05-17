-- =====================================================
-- SmartLocal: ตาราง municipalities (Multi-tenant core)
-- =====================================================

create table if not exists municipalities (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  org_type    text not null check (
    org_type in ('เทศบาลนคร','เทศบาลเมือง','เทศบาลตำบล','อบต.')
  ),
  province    text not null,
  theme_color text not null default '#1d4ed8',
  logo_url    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists municipalities_slug_idx on municipalities(slug);

alter table municipalities enable row level security;

drop policy if exists "public can read active municipalities" on municipalities;
create policy "public can read active municipalities"
  on municipalities for select
  using (is_active = true);

-- =====================================================
-- ข้อมูลตัวอย่าง
-- =====================================================

insert into municipalities (slug, name, org_type, province, theme_color) values
  ('namlao',     'เทศบาลตำบลน้ำเลา',              'เทศบาลตำบล', 'แพร่', '#1c7cd6'),
  ('muangphrae', 'เทศบาลเมืองแพร่',               'เทศบาลเมือง', 'แพร่', '#7c3aed'),
  ('tamnaktham', 'องค์การบริหารส่วนตำบลตำหนักธรรม', 'อบต.',       'แพร่', '#bd3017')
on conflict (slug) do nothing;
