-- เฟส 1/2 ของ "ทะเบียนพนักงานขับรถ" — ไฟล์นี้สร้างตารางอย่างเดียว
-- RLS / view / backfill อยู่ใน 20260903110000_fleet_drivers_rls_and_backfill.sql
-- (แยกไฟล์เพราะ CREATE TABLE แล้วอ้างคอลัมน์ในไฟล์เดียวกันเคยพัง 42703/42P01)
--
-- ทำไมต้องมีตารางนี้:
--   fleet_role (fleet_admin/fleet_staff/fleet_viewer) คือ "สิทธิ์ในระบบ" ตอบว่าทำอะไรได้
--   ส่วน "เป็นพนักงานขับรถได้หรือไม่" เป็นคุณสมบัติของบุคคล คนละแกนกัน — พนักงานขับรถ
--   ต้องบันทึกออก-กลับ/เติมน้ำมันได้ด้วย จึงต้องมี fleet_staff อยู่แล้ว ถ้ายัดเป็นค่าที่ 4
--   ของ fleet_role จะเลือกได้แค่อย่างใดอย่างหนึ่ง
--   โมเดลนี้ตรงกับ Fleetio (Contact + classification "Operator" แยกจาก User login),
--   Samsara, Odoo Fleet และระบบจองรถของหน่วยราชการไทยที่แยกเมนู
--   "จัดการผู้ใช้งาน" ออกจาก "จัดการพนักงานขับรถ"
--
-- ขอบเขตรอบนี้: พนักงานขับรถทุกคนมีบัญชีในระบบ profile_id จึงเป็น NOT NULL
-- และไม่ต้องแตะ FK fleet_trips.driver_id เดิม

CREATE TABLE IF NOT EXISTS public.fleet_drivers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id    uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  profile_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- ⚠️ PDPA: license_no เป็นข้อมูลส่วนบุคคล เปิดให้อ่านเฉพาะผู้ดูแลระบบยานพาหนะ
  -- เจ้าหน้าที่ทั่วไปอ่านผ่าน view fleet_drivers_directory ซึ่งไม่มีคอลัมน์นี้
  license_no         text,
  license_type       text,          -- ท.1 / ท.2 / ท.3 / ท.4 / ส่วนบุคคล
  license_issued_on  date,
  license_expires_on date,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'suspended', 'inactive')),
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.profiles(id),
  CONSTRAINT fleet_drivers_unique_per_muni UNIQUE (municipality_id, profile_id),
  CONSTRAINT fleet_drivers_license_no_len   CHECK (license_no   IS NULL OR char_length(license_no)   <= 40),
  CONSTRAINT fleet_drivers_license_type_len CHECK (license_type IS NULL OR char_length(license_type) <= 40),
  CONSTRAINT fleet_drivers_note_len         CHECK (note         IS NULL OR char_length(note)         <= 500),
  CONSTRAINT fleet_drivers_license_dates    CHECK (
    license_issued_on IS NULL OR license_expires_on IS NULL
    OR license_expires_on >= license_issued_on
  )
);

CREATE INDEX IF NOT EXISTS fleet_drivers_muni_status_idx
  ON public.fleet_drivers (municipality_id, status);

-- ใช้ตอนเช็คว่าโปรไฟล์นี้เป็นคนขับของ อปท. ไหนบ้าง (FleetSetup toggle)
CREATE INDEX IF NOT EXISTS fleet_drivers_profile_idx
  ON public.fleet_drivers (profile_id);

ALTER TABLE public.fleet_drivers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.fleet_drivers IS
  'ทะเบียนพนักงานขับรถของแต่ละ อปท. — คุณสมบัติ ไม่ใช่ระดับสิทธิ์ (สิทธิ์อยู่ที่ profiles.fleet_role)';
COMMENT ON COLUMN public.fleet_drivers.license_no IS
  'ข้อมูลส่วนบุคคลตาม PDPA — อ่านได้เฉพาะ fleet_is_manager เท่านั้น';
