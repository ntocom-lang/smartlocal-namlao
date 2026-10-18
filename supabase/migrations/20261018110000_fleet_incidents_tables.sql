-- รายงานการสูญหาย/ความเสียหายยานพาหนะ (แบบ ๕) — ระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษา
-- ยานพาหนะขององค์กรปกครองส่วนท้องถิ่น พ.ศ. ๒๕๖๙ ข้อ ๑๘: เกิดการสูญหาย/เสียหายให้ผู้รับผิดชอบหรือ
-- ผู้ใช้งานรีบรายงานผู้บังคับบัญชาตามลำดับจนถึงผู้บริหารท้องถิ่นทราบทันทีตามแบบ ๕
-- เจ้าของระบบเลือก 2026-10-18: เก็บในระบบ + พิมพ์ได้ทุกเมื่อ · เฉพาะผู้ดูแลยานพาหนะกรอก/เห็น
--
-- เฟส 1/2: สร้างตารางเปล่า (ข้อกำหนดของโปรเจกต์ — CREATE TABLE แล้วอ้างในไฟล์เดียวกันเคยพัง
-- ดู 20261018110100_fleet_incidents_security.sql สำหรับ FK ระหว่างสองตาราง/RLS/สิทธิ์/trigger)
--
-- ⚠️ PDPA: แยกข้อมูลบุคคลภายนอก (คู่กรณี ผู้บาดเจ็บ พยาน พนักงานสอบสวน) ไว้ใน fleet_incident_people
-- ทั้งสองตารางไม่ใช้ fleet_audit_row (ตัวนั้นคัดลอกทั้งแถวลง fleet_audit_log ลบไม่ได้)
-- ไม่มีช่องอาการบาดเจ็บ (ข้อมูลสุขภาพ = ข้อมูลอ่อนไหว) แบบ ๕ ต้นฉบับก็ไม่มี
-- นโยบายระยะเวลาเก็บ: ยังไม่ลบ — รอ DPO ของ อปท. กำหนด

CREATE TABLE IF NOT EXISTS public.fleet_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- RESTRICT: รายงานเหตุเป็นหลักฐาน ลบรถที่มีรายงานไม่ได้ (รถเลิกใช้ให้ปลดประจำการแทน)
  vehicle_id uuid NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE RESTRICT,
  trip_id uuid REFERENCES public.fleet_trips(id) ON DELETE SET NULL,
  incident_kind text NOT NULL DEFAULT 'damage' CHECK (incident_kind IN ('damage', 'loss')),
  report_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date),
  addressee text CHECK (char_length(addressee) <= 200),
  incident_date date,
  incident_time time,
  location text CHECK (char_length(location) <= 500),
  speed_kmh numeric(5,1) CHECK (speed_kmh IS NULL OR (speed_kmh >= 0 AND speed_kmh <= 300)),
  origin text CHECK (char_length(origin) <= 300),
  destination text CHECK (char_length(destination) <= 300),
  damage text CHECK (char_length(damage) <= 2000),
  other_vehicle text CHECK (char_length(other_vehicle) <= 200),
  other_plate text CHECK (char_length(other_plate) <= 50),
  other_cause text CHECK (char_length(other_cause) <= 2000),
  other_damage text CHECK (char_length(other_damage) <= 2000),
  police_station text CHECK (char_length(police_station) <= 200),
  case_result text CHECK (char_length(case_result) <= 2000),
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fleet_incident_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  -- other_driver = ผู้ขับขี่ฝ่ายตรงข้าม · other_owner = เจ้าของยานพาหนะฝ่ายตรงข้าม
  -- injured = ผู้บาดเจ็บ · witness = พยาน · investigator = พนักงานสอบสวน
  role text NOT NULL CHECK (role IN ('other_driver', 'other_owner', 'injured', 'witness', 'investigator')),
  full_name text CHECK (char_length(full_name) <= 200),
  age smallint CHECK (age IS NULL OR age BETWEEN 0 AND 130),
  address text CHECK (char_length(address) <= 500),
  license_no text CHECK (char_length(license_no) <= 50),
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_incidents_vehicle_idx
  ON public.fleet_incidents (municipality_id, vehicle_id, incident_date DESC);
CREATE INDEX IF NOT EXISTS fleet_incidents_trip_idx
  ON public.fleet_incidents (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_incident_people_incident_idx
  ON public.fleet_incident_people (incident_id, role, sort_order);

-- ปิดไว้ก่อนตั้งแต่ตอนสร้าง — ไฟล์ถัดไปจึงค่อยเปิดสิทธิ์ให้ผู้ดูแลยานพาหนะ
ALTER TABLE public.fleet_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_incident_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fleet_incidents, public.fleet_incident_people FROM PUBLIC, anon, authenticated;
