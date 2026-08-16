-- ศูนย์รวมข้อมูลดิจิทัล (Data Center) — คลังพิกัด/สถานที่ทุกชนิด จัดหมวด 2 ชั้น (group_name > category)
-- ทั้งคู่เป็น text อิสระ ไม่ CHECK constraint ตายตัว เพื่อให้แต่ละเทศบาลเพิ่มหมวดใหม่ได้เองไม่ต้อง migration
create table if not exists public.data_center_entries (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(id) on delete cascade,
  group_name text not null,
  category   text not null,
  name text not null,
  description text,
  latitude  decimal(10,8) not null,
  longitude decimal(11,8) not null,
  photo_urls text[] default '{}',
  external_url text,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.data_center_entries add column if not exists location geography(POINT,4326);

create index if not exists idx_dce_location on public.data_center_entries using gist(location);
create index if not exists idx_dce_municipality on public.data_center_entries(municipality_id);
create index if not exists idx_dce_muni_group on public.data_center_entries(municipality_id, group_name);

drop trigger if exists trg_dce_sync_location on public.data_center_entries;
create trigger trg_dce_sync_location
  before insert or update of latitude, longitude on public.data_center_entries
  for each row execute function public.sync_location_from_latlng();

alter table public.data_center_entries enable row level security;

drop policy if exists "dce staff read own municipality" on public.data_center_entries;
create policy "dce staff read own municipality"
on public.data_center_entries for select to authenticated
using (
  public.get_my_role() = 'superadmin'
  or (public.get_my_role() in ('staff','officer','admin','viewer','council')
      and municipality_id = public.get_my_municipality_id())
);

drop policy if exists "dce staff insert own municipality" on public.data_center_entries;
create policy "dce staff insert own municipality"
on public.data_center_entries for insert to authenticated
with check (
  public.get_my_role() in ('staff','officer','admin','superadmin')
  and (public.get_my_role() = 'superadmin' or municipality_id = public.get_my_municipality_id())
);

drop policy if exists "dce staff update own municipality" on public.data_center_entries;
create policy "dce staff update own municipality"
on public.data_center_entries for update to authenticated
using (
  public.get_my_role() in ('staff','officer','admin','superadmin')
  and (public.get_my_role() = 'superadmin' or municipality_id = public.get_my_municipality_id())
)
with check (
  public.get_my_role() in ('staff','officer','admin','superadmin')
  and (public.get_my_role() = 'superadmin' or municipality_id = public.get_my_municipality_id())
);

drop policy if exists "dce admin delete own municipality" on public.data_center_entries;
create policy "dce admin delete own municipality"
on public.data_center_entries for delete to authenticated
using (
  public.get_my_role() in ('admin','superadmin')
  and (public.get_my_role() = 'superadmin' or municipality_id = public.get_my_municipality_id())
);

-- RPC เสริม: รวมพิกัดจาก 4 ตารางเดิมที่มีอยู่แล้วมาเป็น layer เสริมบนแผนที่เดียวกัน (SECURITY DEFINER
-- ตาม pattern เดิมของแอปนี้ ไม่ใช้ VIEW ธรรมดา กัน RLS รั่วเหมือนที่เคยเกิดปัญหามาก่อน)
create or replace function public.data_center_unified_pins(_municipality_id uuid default null)
returns table (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
declare v_muni uuid;
begin
  if public.get_my_role() not in ('superadmin','admin','officer','staff','technician','viewer','council') then
    raise exception 'Permission denied';
  end if;
  v_muni := case when public.get_my_role() = 'superadmin' then _municipality_id else public.get_my_municipality_id() end;

  return query
  select 'complaints'::text, c.id, 'คำร้อง'::text, c.category, c.subject, c.status,
         c.latitude::double precision, c.longitude::double precision, c.created_at
    from public.complaints c
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
  union all
  select 'business_registrations', b.id, 'สถานประกอบการ', b.business_type, b.business_name, b.status,
         b.latitude::double precision, b.longitude::double precision, b.created_at
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at
    from public.data_center_entries d
    where v_muni is null or d.municipality_id = v_muni;
end;
$$;

revoke all on function public.data_center_unified_pins(uuid) from public;
grant execute on function public.data_center_unified_pins(uuid) to authenticated;
;
