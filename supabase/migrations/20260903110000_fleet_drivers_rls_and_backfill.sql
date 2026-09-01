-- เฟส 2/2 ของ "ทะเบียนพนักงานขับรถ" (ต้องรัน 20260903100000 ก่อน)
-- RLS + view สำหรับ dropdown + backfill จากข้อมูลเดิม

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'fleet_drivers'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260903100000_fleet_drivers_table.sql ก่อน';
  END IF;
END;
$guard$;

-- ── 1. RLS ตารางฐาน — ผู้ดูแลระบบยานพาหนะเท่านั้น ──────────────
-- เข้มกว่าตาราง fleet อื่นโดยตั้งใจ เพราะแถวนี้มีเลขใบขับขี่ (ข้อมูลส่วนบุคคลตาม PDPA)
-- เจ้าหน้าที่ทั่วไปที่ต้องการแค่ "ใครเป็นคนขับได้บ้าง" ให้อ่านผ่าน view ด้านล่าง
DROP POLICY IF EXISTS "fleet_drivers_select" ON public.fleet_drivers;
DROP POLICY IF EXISTS "fleet_drivers_insert" ON public.fleet_drivers;
DROP POLICY IF EXISTS "fleet_drivers_update" ON public.fleet_drivers;
DROP POLICY IF EXISTS "fleet_drivers_delete" ON public.fleet_drivers;

CREATE POLICY "fleet_drivers_select" ON public.fleet_drivers
  FOR SELECT USING (public.fleet_is_manager(municipality_id));
CREATE POLICY "fleet_drivers_insert" ON public.fleet_drivers
  FOR INSERT WITH CHECK (public.fleet_is_manager(municipality_id));
CREATE POLICY "fleet_drivers_update" ON public.fleet_drivers
  FOR UPDATE USING (public.fleet_is_manager(municipality_id))
  WITH CHECK (public.fleet_is_manager(municipality_id));
CREATE POLICY "fleet_drivers_delete" ON public.fleet_drivers
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

-- ── 2. ห้ามลงทะเบียนคนขับข้าม อปท. ────────────────────────────
-- RLS ยืนยันแค่ว่า "ผู้กดเป็นผู้ดูแลของ อปท. นี้" ไม่ได้ยืนยันว่าโปรไฟล์ที่ถูกเพิ่มก็อยู่ อปท. นี้
-- (FK ชี้ profiles(id) เฉยๆ) ถ้าไม่กัน แอดมินจะเพิ่ม uuid ของคนนอกสังกัดเข้าทะเบียนได้
CREATE OR REPLACE FUNCTION public.fleet_guard_driver_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_profile_muni uuid;
  v_profile_role text;
BEGIN
  SELECT municipality_id, role INTO v_profile_muni, v_profile_role
  FROM public.profiles WHERE id = NEW.profile_id;

  IF v_profile_muni IS NULL OR v_profile_muni <> NEW.municipality_id THEN
    RAISE EXCEPTION 'FLEET_DRIVER_OUTSIDE_TENANT';
  END IF;

  -- ประชาชนทั่วไปไม่ใช่เจ้าหน้าที่ ห้ามลงทะเบียนเป็นพนักงานขับรถราชการ
  IF v_profile_role = 'citizen' THEN
    RAISE EXCEPTION 'FLEET_DRIVER_REQUIRES_STAFF';
  END IF;

  IF auth.uid() IS NOT NULL AND TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fleet_guard_driver_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_guard_driver_write ON public.fleet_drivers;
CREATE TRIGGER trg_fleet_guard_driver_write
  BEFORE INSERT OR UPDATE ON public.fleet_drivers
  FOR EACH ROW EXECUTE FUNCTION public.fleet_guard_driver_write();

-- ── 3. view สำหรับ dropdown — ไม่มีเลขใบขับขี่ ────────────────
-- ตั้งใจใช้ view แบบ security definer (ค่าปริยายของ PostgreSQL) เพื่อข้าม RLS ของตารางฐาน
-- ที่จำกัดไว้เฉพาะ manager แล้วคุมขอบเขตเองด้วย fleet_can_read() ในตัว view
-- ถ้าใช้ security_invoker = true เจ้าหน้าที่ทั่วไปจะอ่านไม่ได้เลย (policy ข้อ 1 บล็อก)
DROP VIEW IF EXISTS public.fleet_drivers_directory;
CREATE VIEW public.fleet_drivers_directory AS
  SELECT
    d.id,
    d.municipality_id,
    d.profile_id,
    p.full_name,
    d.status,
    d.license_type,
    d.license_expires_on
  FROM public.fleet_drivers d
  JOIN public.profiles p ON p.id = d.profile_id
  WHERE public.fleet_can_read(d.municipality_id);

REVOKE ALL ON public.fleet_drivers_directory FROM PUBLIC, anon;
GRANT SELECT ON public.fleet_drivers_directory TO authenticated;

COMMENT ON VIEW public.fleet_drivers_directory IS
  'รายชื่อพนักงานขับรถสำหรับ dropdown — ตัด license_no ออกตาม PDPA (data minimisation)';

-- ── 4. Backfill จากข้อมูลเดิม ─────────────────────────────────
-- ทริป/บันทึกน้ำมันเดิมชี้ driver_id เป็นคนที่ยังไม่อยู่ในทะเบียน ถ้าไม่ backfill
-- dropdown จะไม่มีชื่อคนขับเดิมให้เลือก และรายงานเก่าจะดูเหมือนคนขับนอกทะเบียน
-- ⚠️ ของเดิม driver_id ถูกตั้งเป็น "ผู้ขอ" โดยปริยาย รายชื่อที่ backfill มาจึงมีคนที่
-- ไม่ใช่พนักงานขับรถจริงปนอยู่ — ให้ อปท. เข้าไปปิดสถานะเองที่ ตั้งค่า > สิทธิ์ผู้ใช้
INSERT INTO public.fleet_drivers (municipality_id, profile_id, note)
SELECT DISTINCT t.municipality_id, t.driver_id,
       'นำเข้าอัตโนมัติจากประวัติการใช้รถเดิม — โปรดตรวจสอบ'
  FROM public.fleet_trips t
  JOIN public.profiles p ON p.id = t.driver_id
 WHERE t.driver_id IS NOT NULL
   AND p.municipality_id = t.municipality_id
   AND p.role <> 'citizen'
ON CONFLICT (municipality_id, profile_id) DO NOTHING;

INSERT INTO public.fleet_drivers (municipality_id, profile_id, note)
SELECT DISTINCT f.municipality_id, f.driver_id,
       'นำเข้าอัตโนมัติจากประวัติการเติมน้ำมันเดิม — โปรดตรวจสอบ'
  FROM public.fleet_fuel_records f
  JOIN public.profiles p ON p.id = f.driver_id
 WHERE f.driver_id IS NOT NULL
   AND p.municipality_id = f.municipality_id
   AND p.role <> 'citizen'
ON CONFLICT (municipality_id, profile_id) DO NOTHING;
