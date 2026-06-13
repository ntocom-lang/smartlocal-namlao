-- 055_enable_postgis.sql
-- Enable PostGIS extension and add geography(POINT) columns to all spatial tables.
-- Existing lat/lng columns remain untouched — location column is auto-synced via trigger.

-- ─── 1. Extension ────────────────────────────────────────────────────────────
create extension if not exists postgis;

-- ─── 2. Add geography columns ────────────────────────────────────────────────
alter table complaints
  add column if not exists location geography(POINT, 4326);

alter table municipalities
  add column if not exists location geography(POINT, 4326);

alter table business_registrations
  add column if not exists location geography(POINT, 4326);

alter table infrastructure_works
  add column if not exists location geography(POINT, 4326);

alter table civil_projects
  add column if not exists location geography(POINT, 4326);

-- ─── 3. Backfill existing rows ───────────────────────────────────────────────
-- ST_MakePoint(lng, lat) — PostGIS uses (x=lng, y=lat) order
update complaints
  set location = ST_MakePoint(longitude, latitude)::geography
  where latitude is not null and longitude is not null;

update municipalities
  set location = ST_MakePoint(longitude, latitude)::geography
  where latitude is not null and longitude is not null;

update business_registrations
  set location = ST_MakePoint(longitude, latitude)::geography
  where latitude is not null and longitude is not null;

update infrastructure_works
  set location = ST_MakePoint(longitude, latitude)::geography
  where latitude is not null and longitude is not null;

update civil_projects
  set location = ST_MakePoint(longitude, latitude)::geography
  where latitude is not null and longitude is not null;

-- ─── 4. GIST spatial indexes ─────────────────────────────────────────────────
create index if not exists idx_complaints_location          on complaints          using gist(location);
create index if not exists idx_municipalities_location      on municipalities      using gist(location);
create index if not exists idx_business_reg_location        on business_registrations using gist(location);
create index if not exists idx_infrastructure_works_location on infrastructure_works using gist(location);
create index if not exists idx_civil_projects_location      on civil_projects      using gist(location);

-- ─── 5. Trigger: auto-sync location from lat/lng on INSERT/UPDATE ────────────
create or replace function sync_location_from_latlng()
returns trigger language plpgsql security definer as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.location := ST_MakePoint(new.longitude, new.latitude)::geography;
  else
    new.location := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_location on complaints;
create trigger trg_sync_location
  before insert or update of latitude, longitude on complaints
  for each row execute function sync_location_from_latlng();

drop trigger if exists trg_sync_location on municipalities;
create trigger trg_sync_location
  before insert or update of latitude, longitude on municipalities
  for each row execute function sync_location_from_latlng();

drop trigger if exists trg_sync_location on business_registrations;
create trigger trg_sync_location
  before insert or update of latitude, longitude on business_registrations
  for each row execute function sync_location_from_latlng();

drop trigger if exists trg_sync_location on infrastructure_works;
create trigger trg_sync_location
  before insert or update of latitude, longitude on infrastructure_works
  for each row execute function sync_location_from_latlng();

drop trigger if exists trg_sync_location on civil_projects;
create trigger trg_sync_location
  before insert or update of latitude, longitude on civil_projects
  for each row execute function sync_location_from_latlng();

-- ─── 6. RPC: หาคำร้องในรัศมี (เมตร) ────────────────────────────────────────
create or replace function complaints_near(
  _lat      double precision,
  _lng      double precision,
  _radius_m double precision default 1000,
  _municipality_id uuid default null
)
returns table (
  id            uuid,
  ref_no        text,
  subject       text,
  status        text,
  category      text,
  latitude      double precision,
  longitude     double precision,
  distance_m    double precision,
  created_at    timestamptz
)
language sql security definer stable as $$
  select
    c.id,
    c.ref_no,
    c.subject,
    c.status,
    c.category,
    c.latitude,
    c.longitude,
    ST_Distance(c.location, ST_MakePoint(_lng, _lat)::geography) as distance_m,
    c.created_at
  from complaints c
  where c.location is not null
    and ST_DWithin(c.location, ST_MakePoint(_lng, _lat)::geography, _radius_m)
    and (_municipality_id is null or c.municipality_id = _municipality_id)
  order by distance_m;
$$;

-- ─── 7. RPC: สรุป complaint cluster ต่อ grid (ใช้กับ heatmap) ───────────────
create or replace function complaints_heatmap(
  _municipality_id uuid,
  _precision int default 4   -- geohash precision: 4≈40km², 5≈5km², 6≈600m²
)
returns table (
  lat    double precision,
  lng    double precision,
  count  bigint
)
language sql security definer stable as $$
  select
    avg(c.latitude)  as lat,
    avg(c.longitude) as lng,
    count(*)         as count
  from complaints c
  where c.municipality_id = _municipality_id
    and c.location is not null
  group by
    round(c.latitude::numeric,  _precision - 1),
    round(c.longitude::numeric, _precision - 1)
  order by count desc;
$$;
