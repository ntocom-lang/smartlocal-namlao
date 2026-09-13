-- แก้สิทธิ์ RPC ของระบบยานพาหนะที่เพิ่มใน #169/#170 ให้ตัดสินแบบเดียวกับ RLS
--
-- บั๊ก (เจอจากการใช้งานจริง 2026-09-13): กด 🚀 ออกเดินทางแล้วช่องเลขไมล์ก่อนออกไม่เติมให้
-- RPC ตอบ 403 ทุกครั้ง เพราะเดิมตรวจสิทธิ์จาก my_fleet() = "อปท. ของผู้เรียก + fleet_role ต้องไม่ว่าง"
-- ซึ่งไม่ตรงกับกติกาจริงของระบบ บัญชีที่ใช้ระบบยานพาหนะได้ปกติแต่โดนปฏิเสธ:
--   · superadmin — ไม่ได้ผูก อปท. (municipality_id = NULL โดยเจตนา) → mun_id ว่าง
--   · แอดมินของ อปท. (role = admin) ที่ไม่ได้ตั้ง fleet_role → frole ว่าง
-- ผลคือเลขไมล์ไม่เติม การ์ดคิวชนและรายชื่อรถว่างไม่ขึ้น (DB ยังตัดสินคิวถูก แต่หน้าจอไม่บอกเหตุผล)
--
-- แก้: ใช้ fleet_can_read_asset() ตัวเดียวกับที่ RLS ใช้ตัดสินว่าใครอ่านรถคันนั้นได้
-- (superadmin/admin/fleet_admin ทุกคัน · fleet_staff เฉพาะรถกองตัวเองหรือรถส่วนกลาง · fleet_viewer)
-- อปท. ของคำขอเอามาจากตัวรถ ไม่ใช่จากโปรไฟล์ผู้เรียก
-- ข้อความ error รวมเป็น FLEET_ACCESS_DENIED ตัวเดียว ไม่แยก "ไม่มีรถคันนี้" กับ "ไม่มีสิทธิ์"
-- กันใช้ RPC สืบว่ามี vehicle id ของ อปท. อื่นอยู่จริง
--
-- fleet_available_vehicles ไม่มีรถให้ใช้หา อปท. จึงเพิ่ม p_municipality_id (ค่าเริ่มต้น = อปท. ของผู้เรียก)
-- ต้อง DROP ก่อน เพราะเปลี่ยนรายการพารามิเตอร์ ถ้าสร้างเป็น overload คู่กัน PostgREST จะเลือกไม่ถูก (PGRST203)
-- หน้าจอรุ่นเก่าที่ยังส่ง 3 พารามิเตอร์ใช้ได้ต่อ เพราะตัวที่ 4 มีค่าเริ่มต้น

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fleet_trip_queue_reasons') THEN
    RAISE EXCEPTION 'ต้องรัน 20260913150100 ก่อน';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fleet_can_read_asset') THEN
    RAISE EXCEPTION 'ไม่พบ fleet_can_read_asset — schema drift ต้องตรวจก่อน apply';
  END IF;
END;
$guard$;

-- ── เลขไมล์หลังกลับครั้งล่าสุด (#170) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_vehicle_last_odometer(
  p_vehicle_id uuid,
  p_exclude_trip uuid DEFAULT NULL
)
 RETURNS TABLE(odometer numeric, returned_at timestamptz, trip_date date)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid;
BEGIN
  SELECT v.municipality_id INTO v_mun FROM public.fleet_vehicles v WHERE v.id = p_vehicle_id;
  IF v_mun IS NULL OR NOT public.fleet_can_read_asset(v_mun, p_vehicle_id) THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  -- "ล่าสุด" เรียงตามเวลากลับจริง ไม่ใช่ค่ามากสุด (บันทึกย้อนหลัง/เลขพิมพ์ผิดหลักต้องไม่แซง)
  RETURN QUERY
    SELECT t.odometer_end, t.returned_at, t.trip_date
      FROM public.fleet_trips t
     WHERE t.vehicle_id = p_vehicle_id
       AND t.municipality_id = v_mun
       AND t.status = 'completed'
       AND t.odometer_end IS NOT NULL
       AND t.id IS DISTINCT FROM p_exclude_trip
     ORDER BY COALESCE(t.returned_at, t.started_at, t.trip_date::timestamptz) DESC NULLS LAST,
              t.created_at DESC
     LIMIT 1;
END;
$function$;

-- ── ตรวจคิวก่อนส่ง (#169) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_trip_availability(
  p_vehicle_id uuid, p_driver_id uuid,
  p_from timestamptz, p_to timestamptz,
  p_exclude_trip uuid DEFAULT NULL
)
 RETURNS TABLE(reason text, severity text, conflict_from timestamptz, conflict_to timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid;
  v_driver uuid := p_driver_id;
  v_exclude uuid := p_exclude_trip;
BEGIN
  SELECT v.municipality_id INTO v_mun FROM public.fleet_vehicles v WHERE v.id = p_vehicle_id;
  IF v_mun IS NULL OR NOT public.fleet_can_read_asset(v_mun, p_vehicle_id) THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  -- ผู้ขับ/ทริปที่ยกเว้น ต้องอยู่ใน อปท. เดียวกับรถ ไม่งั้นใช้ RPC นี้สืบคิวของ อปท. อื่นได้
  IF v_driver IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_driver AND p.municipality_id = v_mun
  ) THEN
    v_driver := NULL;
  END IF;
  IF v_exclude IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_trips t WHERE t.id = v_exclude AND t.municipality_id = v_mun
  ) THEN
    v_exclude := NULL;
  END IF;

  RETURN QUERY
    SELECT q.reason, q.severity, q.conflict_from, q.conflict_to
      FROM public.fleet_trip_queue_reasons(p_vehicle_id, v_driver, p_from, p_to, v_exclude) q;
END;
$function$;

-- ── รถที่ว่างและพร้อมใช้ (#169) ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fleet_available_vehicles(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.fleet_available_vehicles(
  p_from timestamptz, p_to timestamptz,
  p_exclude_trip uuid DEFAULT NULL,
  p_municipality_id uuid DEFAULT NULL
)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid := p_municipality_id;
  v_exclude uuid := p_exclude_trip;
BEGIN
  -- superadmin ไม่มี อปท. ในโปรไฟล์ หน้าจอต้องส่ง อปท. ที่กำลังดูมา ส่วนบัญชีทั่วไปถอยไปใช้ของโปรไฟล์
  IF v_mun IS NULL THEN
    SELECT p.municipality_id INTO v_mun FROM public.profiles p WHERE p.id = auth.uid();
  END IF;
  IF v_mun IS NULL OR NOT (
    public.fleet_is_manager(v_mun)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.municipality_id = v_mun AND p.fleet_role IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_exclude IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_trips t WHERE t.id = v_exclude AND t.municipality_id = v_mun
  ) THEN
    v_exclude := NULL;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RETURN;
  END IF;

  -- คืนเฉพาะรถที่ผู้เรียกมีสิทธิ์อ่านอยู่แล้ว (เจ้าหน้าที่กองเห็นแค่รถกองตัวเอง + รถส่วนกลาง)
  -- ⚠️ เรียกตัวตัดสินทีละคัน — พอสำหรับ อปท. (รถหลักสิบคัน) ถ้าหลายร้อยคันต้องเขียนเป็น set-based
  RETURN QUERY
    SELECT v.id
      FROM public.fleet_vehicles v
     WHERE v.municipality_id = v_mun
       AND v.asset_kind = 'vehicle'
       AND v.status = 'active'
       AND public.fleet_can_read_asset(v_mun, v.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.fleet_trip_queue_reasons(v.id, NULL, p_from, p_to, v_exclude) q
          WHERE q.reason IN ('vehicle_busy', 'vehicle_unavailable', 'vehicle_tight',
                             'vehicle_not_returned', 'vehicle_documents_expired')
       );
END;
$function$;

REVOKE ALL ON FUNCTION public.fleet_vehicle_last_odometer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_vehicle_last_odometer(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fleet_trip_availability(uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_trip_availability(uuid, uuid, timestamptz, timestamptz, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fleet_available_vehicles(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_available_vehicles(timestamptz, timestamptz, uuid, uuid) TO authenticated;
