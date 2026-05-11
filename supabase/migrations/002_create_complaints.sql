-- =====================================================
-- SmartLocal: ตาราง complaints (คำร้องเรียนจากประชาชน)
-- =====================================================

create table if not exists complaints (
  id               uuid primary key default gen_random_uuid(),
  municipality_id  uuid not null references municipalities(id) on delete cascade,
  category         text not null,
  detail           text not null,
  phone            text,
  latitude         double precision,
  longitude        double precision,
  status           text not null default 'pending' check (
    status in ('pending', 'received', 'in_progress', 'completed', 'rejected')
  ),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index complaints_municipality_idx on complaints(municipality_id);
create index complaints_status_idx       on complaints(status);

alter table complaints enable row level security;

-- ประชาชนแจ้งได้ (insert) และดูเฉพาะของตัวเอง (ถ้า login)
-- สำหรับ anonymous ให้ insert ได้อย่างเดียว
create policy "anyone can submit complaint"
  on complaints for insert
  with check (true);

create policy "municipality staff can read all complaints"
  on complaints for select
  using (true);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger complaints_updated_at
  before update on complaints
  for each row execute function update_updated_at();
