-- =====================================================
-- SmartLocal: ตาราง emergency_contacts (สายด่วนฉุกเฉิน)
-- =====================================================

create table if not exists emergency_contacts (
  id               uuid primary key default gen_random_uuid(),
  municipality_id  uuid not null references municipalities(id) on delete cascade,
  label            text not null,
  number           text not null,
  emoji            text not null default '📞',
  color            text not null default '#1d4ed8',
  bg               text not null default '#dbeafe',
  display_order    int not null default 99,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists emergency_contacts_municipality_idx on emergency_contacts(municipality_id);

alter table emergency_contacts enable row level security;

drop policy if exists "public can read active emergency contacts" on emergency_contacts;
create policy "public can read active emergency contacts"
  on emergency_contacts for select
  using (is_active = true);

drop policy if exists "allow all for authenticated" on emergency_contacts;
create policy "allow all for authenticated"
  on emergency_contacts for all
  using (auth.role() = 'authenticated');

-- ข้อมูลตั้งต้น (ใส่หลัง insert municipalities แล้ว)
-- INSERT INTO emergency_contacts (municipality_id, label, number, emoji, color, bg, display_order)
-- SELECT id, 'ตำรวจ',        '191',  '👮', '#1d4ed8', '#dbeafe', 1 FROM municipalities WHERE slug = 'namlao'
-- UNION ALL
-- SELECT id, 'กู้ชีพ / EMS', '1669', '🚑', '#dc2626', '#fee2e2', 2 FROM municipalities WHERE slug = 'namlao'
-- UNION ALL
-- SELECT id, 'การไฟฟ้า',    '1129', '⚡', '#d97706', '#fef3c7', 3 FROM municipalities WHERE slug = 'namlao'
-- UNION ALL
-- SELECT id, 'ดับเพลิง',    '199',  '🚒', '#ea580c', '#ffedd5', 4 FROM municipalities WHERE slug = 'namlao'
-- UNION ALL
-- SELECT id, 'ประปา',       '1662', '💧', '#0284c7', '#e0f2fe', 5 FROM municipalities WHERE slug = 'namlao'
-- UNION ALL
-- SELECT id, 'สายด่วนรัฐบาล','1111','📞', '#7c3aed', '#ede9fe', 6 FROM municipalities WHERE slug = 'namlao';
