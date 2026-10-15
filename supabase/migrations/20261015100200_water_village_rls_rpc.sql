-- สถานการณ์น้ำ-ฝนรายหมู่ (เฟส 1) ไฟล์ 3/3 — ข้อจำกัดพิกัด + สิทธิ์ + RLS + ตัวประทับผู้ผูก + RPC ฝั่งประชาชน
-- (พิกัดหมู่อยู่ 20261015100000 · ตารางผูกอยู่ 20261015100100 ไฟล์นี้จึงอ้างถึงได้)
--
-- ใครตั้งค่าได้ — ใช้ตัวตัดสินสิทธิ์ของทะเบียนหมู่เดิม can_manage_waste_schedule() ไม่สร้างบทบาทใหม่:
--   superadmin · admin ของ อปท. · officer/staff ของกองที่ waste_owner_department_id() เลือก (สำนักปลัดถ้าไม่มีกองสาธารณสุข)
-- เหตุผล: ทะเบียนหมู่ (waste_villages) ถูกคุมด้วยฟังก์ชันนี้อยู่แล้ว การใส่พิกัดและผูกสถานีกับหมู่เดียวกัน
-- ด้วยคนกลุ่มเดียวกันจึงไม่ขัดกัน ·
-- ⚠️ ต้องให้ อบต. ยืนยันว่ากองนี้คือผู้ดูแลงานป้องกันสาธารณภัยจริง — ถ้าไม่ใช่ ให้เปลี่ยนเงื่อนไขที่ policy 3 ตัวข้างล่าง
--    จุดเดียว (ไม่ได้อ้างระเบียบใด)
--
-- ประชาชน (รวมผู้ไม่ล็อกอิน) อ่านผ่าน get_public_water_villages() เท่านั้น — เหตุผลเดียวกับ get_public_waste_schedule:
-- RLS ไม่รู้ว่าผู้ไม่ล็อกอินเปิดเว็บของ อปท. ไหน RPC จึงบังคับให้ระบุ อปท. ทุกครั้ง
--
-- ไฟล์นี้สร้างของใหม่ล้วน: ฟังก์ชัน/trigger/policy ชื่อใหม่ทั้งหมด ไม่มี CREATE OR REPLACE ทับของเดิม
-- (ข้อจำกัด CHECK เพิ่มกับคอลัมน์ใหม่ที่ยังว่างทุกแถว จึงไม่ทำให้ข้อมูลเดิมผิดเงื่อนไข)

DO $$
BEGIN
  IF to_regclass('public.water_village_stations') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261015100100_water_village_stations_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('public.can_manage_waste_schedule(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260914100100_waste_schedule_rls_rpc.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- ข้อจำกัดพิกัดหมู่ — ใส่ทั้งคู่หรือว่างทั้งคู่ และอยู่ในช่วงพิกัดโลก
-- (ไม่จำกัดว่าต้องอยู่ในประเทศไทย: อปท. ติดชายแดนมีหมู่ที่จุดกลางอยู่ใกล้เส้นเขตได้)
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.waste_villages'::regclass AND conname = 'waste_villages_coords_valid'
  ) THEN
    ALTER TABLE public.waste_villages
      ADD CONSTRAINT waste_villages_coords_valid CHECK (
        (latitude IS NULL) = (longitude IS NULL)
        AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
        AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
      );
  END IF;
END;
$$;

-- ===========================================================================
-- สิทธิ์ระดับตาราง — ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon ได้ ALL กับตารางใหม่
-- และ RLS ไม่บังคับกับ TRUNCATE ต้องถอนเองทุกครั้ง (ดู 20260905200000)
-- ไม่ให้ UPDATE: แถวนี้ไม่มีค่าที่แก้ได้ เปลี่ยนการผูก = ลบแล้วเพิ่มใหม่
-- ===========================================================================
REVOKE ALL ON public.water_village_stations FROM anon, PUBLIC;
REVOKE TRUNCATE, TRIGGER, REFERENCES, UPDATE ON public.water_village_stations FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.water_village_stations TO authenticated;

-- ===========================================================================
-- RLS — อ่านได้เฉพาะบุคลากรของ อปท. เดียวกัน (ประชาชนอ่านผ่าน RPC) · เขียนตามตัวตัดสินสิทธิ์เดียวกับทะเบียนหมู่
-- ===========================================================================
ALTER TABLE public.water_village_stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read water_village_stations" ON public.water_village_stations;
CREATE POLICY "read water_village_stations" ON public.water_village_stations
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (municipality_id = public.get_my_municipality_id() AND public.get_my_role() <> 'citizen')
  );

DROP POLICY IF EXISTS "insert water_village_stations" ON public.water_village_stations;
CREATE POLICY "insert water_village_stations" ON public.water_village_stations
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_waste_schedule(municipality_id));

DROP POLICY IF EXISTS "delete water_village_stations" ON public.water_village_stations;
CREATE POLICY "delete water_village_stations" ON public.water_village_stations
  FOR DELETE TO authenticated
  USING (public.can_manage_waste_schedule(municipality_id));

-- ===========================================================================
-- ประทับผู้ผูก/เวลา จากฝั่งเซิร์ฟเวอร์ — client ส่งค่ามาเองไม่ได้
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.stamp_water_village_station()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_water_village_station() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_water_village_station ON public.water_village_stations;
CREATE TRIGGER stamp_water_village_station
  BEFORE INSERT ON public.water_village_stations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_water_village_station();

-- ===========================================================================
-- RPC ฝั่งประชาชน — เลขหมู่ ชื่อ จุดกลางหมู่ และรหัสสถานีที่ผูก (ข้อมูลสถานที่ ไม่มีข้อมูลส่วนบุคคล)
--   - คืนรายการว่าง ถ้า อปท. ยังไม่มีการผูกสถานีเลยสักแถว = ยังไม่เปิดใช้ หน้าเว็บไม่ขึ้นส่วน "หมู่ของฉัน"
--     (กัน อปท. ที่มีทะเบียนหมู่ไว้ใช้กับตารางเก็บขยะ แต่ยังไม่ได้ตั้งค่าน้ำ ขึ้นการ์ด "ข้อมูลไม่พอ" ทุกหมู่)
--   - เมื่อเปิดใช้แล้ว คืนทุกหมู่ รวมหมู่ที่ยังไม่ผูกสถานี (stations = []) เพื่อให้หน้าเว็บบอก "ข้อมูลไม่พอ" ตรงๆ
--     ไม่ใช่ซ่อนหมู่นั้นแล้วให้ประชาชนเข้าใจว่าไม่มีหมู่นี้
--   - ปัดพิกัด 3 ทศนิยม (~100 ม.) กันเจ้าหน้าที่เผลอปักหมุดที่บ้านคนแล้วพิกัดบ้านหลุดสู่หน้าสาธารณะ
--   - ไม่คืน created_by (ตัวตนเจ้าหน้าที่)
--   - ไม่คัดกรองว่าสถานีที่ผูกยัง is_active หรือไม่ — หน้าเว็บเทียบกับรายการสถานีจาก get_public_water_situation()
--     สถานีที่ถูกปิดจะหาไม่เจอ แล้วขึ้น "ข้อมูลไม่พอ" ไม่ใช่ "ปกติ"
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_public_water_villages(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'villages',
    CASE
      WHEN EXISTS (SELECT 1 FROM public.water_village_stations AS any_link WHERE any_link.municipality_id = m.id)
      THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'moo_no', v.moo_no,
          'name', v.name,
          'latitude', round(v.latitude, 3),
          'longitude', round(v.longitude, 3),
          'stations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'station_type', l.station_type,
              'station_code', l.station_code
            ) ORDER BY l.station_type, l.station_code)
            FROM public.water_village_stations AS l
            WHERE l.municipality_id = v.municipality_id AND l.moo_no = v.moo_no
          ), '[]'::jsonb)
        ) ORDER BY v.moo_no)
        FROM public.waste_villages AS v
        WHERE v.municipality_id = m.id
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  )
  FROM public.municipalities AS m
  WHERE m.id = _municipality_id
    AND m.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_water_villages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_water_villages(uuid) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
