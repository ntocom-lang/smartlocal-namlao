-- ให้ "คนที่มีชื่ออยู่บนใบขออนุญาต" มองเห็นใบของตัวเองได้เสมอ แม้รถจะเป็นของกองอื่น
--
-- ต่อจาก 20260906140000 ที่เปิดให้คนกลุ่มนี้ "บันทึก" ออก/กลับได้แล้ว แต่ยังติดด่านอ่าน:
-- fleet_trips_select ใช้ fleet_can_read_asset() ซึ่งสำหรับ fleet_staff ยอมเฉพาะ
-- (v.department_id = กองตัวเอง OR v.is_pool) ผลคือถ้าแอดมินบันทึกคำขอโดยให้คนขับ
-- มาจากคนละกองกับกองเจ้าของรถ คนขับจะ "มองไม่เห็นใบนั้นเลย" ปุ่มออกรถไม่ขึ้นตั้งแต่ต้น
-- และไม่มี error ให้เห็นด้วย เพราะแถวหายไปจากผลลัพธ์เงียบๆ
--
-- ตอนนี้ยังไม่กระทบ อปท. จริง (รถทุกคันของน้ำเลา/ทุ่งแค้วเป็นของกลางหลัง 20260906090000)
-- แต่ อปท. ที่ซื้อรถแยกรายกองจะเจอทันทีที่ยืมคนขับข้ามกอง ซึ่งเป็นเรื่องปกติของ อปท. เล็ก
--
-- ขอบเขตที่เปิดเพิ่ม: เฉพาะแถวที่ auth.uid() เป็น driver_id / requested_by / created_by
-- ของแถวนั้นเอง และอยู่ใน อปท. เดียวกัน — ไม่ได้เปิดให้เห็นทริปของกองอื่นเป็นการทั่วไป

DROP POLICY IF EXISTS "fleet_trips_select" ON public.fleet_trips;

CREATE POLICY "fleet_trips_select" ON public.fleet_trips
  FOR SELECT USING (
    public.fleet_can_read_asset(municipality_id, vehicle_id)
    OR (
      municipality_id = (SELECT mun_id FROM public.my_fleet())
      AND auth.uid() IN (driver_id, requested_by, created_by)
    )
  );

-- เห็นแถวทริปอย่างเดียวไม่พอ — หน้ารายการ join ชื่อรถมาจาก fleet_vehicles ด้วย
-- (SELECT ใน FleetTrips.jsx: `vehicle:fleet_vehicles(id,name,license_plate,...)`)
-- ถ้าไม่เปิดตรงนี้ด้วย คนขับจะเห็นใบของตัวเองแบบไม่มีชื่อรถและไม่มีทะเบียน ซึ่งใช้งานจริงไม่ได้
-- ใช้ฟังก์ชัน SECURITY DEFINER เพื่อไม่ให้ policy ของ fleet_vehicles ไปกระตุ้น RLS ของ
-- fleet_trips ซ้อนกัน และให้ planner ใช้ idx_ftrip_veh (vehicle_id, trip_date DESC) ได้
CREATE OR REPLACE FUNCTION public.fleet_is_named_on_trip_for_vehicle(
  p_municipality_id uuid,
  p_vehicle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fleet_trips t
    WHERE t.vehicle_id = p_vehicle_id
      AND t.municipality_id = p_municipality_id
      AND auth.uid() IN (t.driver_id, t.requested_by, t.created_by)
  );
$$;

REVOKE ALL ON FUNCTION public.fleet_is_named_on_trip_for_vehicle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_is_named_on_trip_for_vehicle(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "fleet_vehicles_select" ON public.fleet_vehicles;

CREATE POLICY "fleet_vehicles_select" ON public.fleet_vehicles
  FOR SELECT USING (
    public.fleet_can_read_asset(municipality_id, id)
    OR public.fleet_is_named_on_trip_for_vehicle(municipality_id, id)
  );
