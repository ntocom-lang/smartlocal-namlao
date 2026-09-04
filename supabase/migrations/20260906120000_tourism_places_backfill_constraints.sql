-- 20260906120000_tourism_places_backfill_constraints.sql
--
-- ต่อจาก 20260906110000 — กู้ข้อมูลที่เคยถูกทิ้ง แล้วค่อยรัดด้วย constraint
-- ลำดับสำคัญ: backfill ต้องมาก่อน add constraint ไม่งั้นถ้ามีพิกัดเพี้ยนอยู่ก่อนแล้ว
-- migration จะล้มทั้งไฟล์

begin;

-- ── 1. กู้พิกัดจาก maps_url ────────────────────────────────────────────────────
-- แถวที่มาจากการอนุมัติคำขอถูกเก็บเป็น 'https://maps.google.com/?q=LAT,LNG'
-- ดึงตัวเลขกลับออกมาแทนที่จะให้เจ้าหน้าที่มานั่งกรอกใหม่
update public.tourism_places
set latitude  = split_part(substring(maps_url from '[?&]q=(-?[0-9]+\.?[0-9]*,-?[0-9]+\.?[0-9]*)'), ',', 1)::double precision,
    longitude = split_part(substring(maps_url from '[?&]q=(-?[0-9]+\.?[0-9]*,-?[0-9]+\.?[0-9]*)'), ',', 2)::double precision
where latitude is null
  and maps_url ~ '[?&]q=-?[0-9]+\.?[0-9]*,-?[0-9]+\.?[0-9]*';

-- ── 2. กู้พิกัด/เวลาทำการจากคำขอลงทะเบียนต้นทาง ────────────────────────────────
-- จับคู่ด้วย (municipality_id, ชื่อ) เพราะตอนอนุมัติไม่ได้เก็บ FK กลับไปหาคำขอ
-- (ควรมี source_registration_id ในอนาคต แต่ไม่เพิ่มในเฟสนี้เพื่อไม่ให้ scope บาน)
update public.tourism_places t
set latitude   = coalesce(t.latitude,  b.latitude),
    longitude  = coalesce(t.longitude, b.longitude),
    hours_note = coalesce(t.hours_note, nullif(btrim(b.operating_hours), '')),
    facebook_url = coalesce(t.facebook_url, nullif(btrim(b.facebook_url), '')),
    line_id      = coalesce(t.line_id,      nullif(btrim(b.line_id), ''))
from public.business_registrations b
where b.status = 'approved'
  and b.municipality_id = t.municipality_id
  and b.business_name   = t.name;

-- ── 2.5 ล้างพิกัดที่กู้มาแล้วเพี้ยน ───────────────────────────────────────────
-- ถ้า maps_url เก่าเก็บอะไรที่ไม่ใช่พิกัดไทย (พิมพ์ผิด/สลับ lat-lng/ลิงก์ย่อ) ให้ทิ้งเป็น null
-- แทนที่จะปล่อยให้ constraint ข้อ 3 ล้มทั้ง migration — ข้อมูลไม่หาย maps_url ยังอยู่ครบ
update public.tourism_places
set latitude = null, longitude = null
where (latitude is not null or longitude is not null)
  and not (latitude between 5.0 and 21.0 and longitude between 96.0 and 106.0);

-- ── 3. constraint ─────────────────────────────────────────────────────────────
-- กรอบพิกัดประเทศไทย (โดยประมาณ) ไม่ใช่ -90..90 ทั่วโลก เพราะบั๊กที่เจอบ่อยที่สุด
-- ของงานกรอกพิกัดคือสลับ lat/lng กัน ซึ่งกรอบโลกจับไม่ได้แต่กรอบไทยจับได้ทันที
-- (lng ไทย ~97-106 ตกนอกช่วง lat ไทย 5-21 เสมอ)
alter table public.tourism_places
  drop constraint if exists tourism_places_lat_lng_thailand_chk;
alter table public.tourism_places
  add constraint tourism_places_lat_lng_thailand_chk check (
    (latitude is null and longitude is null)
    or (latitude between 5.0 and 21.0 and longitude between 96.0 and 106.0)
  );

alter table public.tourism_places
  drop constraint if exists tourism_places_price_range_chk;
alter table public.tourism_places
  add constraint tourism_places_price_range_chk check (
    price_range is null or price_range between 1 and 4
  );

-- opening_hours ต้องเป็น object เท่านั้น (กัน array/สตริงหลุดเข้ามาแล้วโค้ดคำนวณเวลาพัง)
-- ไม่ตรวจลึกถึงรูปแบบเวลาในระดับ DB — ให้ฝั่งฟอร์มคุม เพราะ constraint ที่ซับซ้อนเกินไป
-- จะบล็อกการแก้ข้อมูลเก่าโดยไม่จำเป็น
alter table public.tourism_places
  drop constraint if exists tourism_places_opening_hours_obj_chk;
alter table public.tourism_places
  add constraint tourism_places_opening_hours_obj_chk check (
    opening_hours is null or jsonb_typeof(opening_hours) = 'object'
  );

-- ── 4. index ที่หน้าเว็บใช้จริง ────────────────────────────────────────────────
-- ทุก query ฝั่งประชาชนคือ where municipality_id = ? and is_active order by ...
create index if not exists tourism_places_tenant_active_idx
  on public.tourism_places (municipality_id, is_active, is_featured desc, display_order);

-- ── 5. updated_at ─────────────────────────────────────────────────────────────
drop trigger if exists tourism_places_updated_at on public.tourism_places;
create trigger tourism_places_updated_at
  before update on public.tourism_places
  for each row execute function update_updated_at();

commit;
