-- สถานะการตรวจวัดมลพิษของยานพาหนะ — ระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษายานพาหนะ
-- ขององค์กรปกครองส่วนท้องถิ่น พ.ศ. ๒๕๖๙ ข้อ ๒๐: ตรวจมลพิษทุกหกเดือน หรือทุกระยะทาง ๑๕,๐๐๐ กม.
-- แล้วแต่อย่างใดถึงก่อน (ใช้บังคับ 17 มี.ค. 2569) — เจ้าของระบบอนุมัติแนวทาง 2026-10-17
--
-- เจ้าหน้าที่ไม่ต้องกรอกอะไรใหม่: บันทึกการตรวจเป็นรายการซ่อมบำรุงประเภท 'emission'
-- (fleet_maintenance.maintenance_type ไม่มี CHECK อยู่แล้ว) ระบบหาวันครบกำหนดให้เอง
-- ตัวนี้คืน "ข้อเท็จจริง" รายคัน ส่วนการตัดสินว่าใกล้/เกินกำหนดอยู่ที่ src/lib/fleetEmission.js
-- และ supabase/functions/fleet-doc-expiry-notify (เกณฑ์ต้องตรงกัน)
--
-- SECURITY INVOKER: หน้าจอเรียกด้วยสิทธิ์ผู้ใช้ RLS ของ fleet_* กรองคันที่มองเห็นให้เอง
-- edge function เรียกด้วย service_role เห็นทุกคันของ อปท. นั้น
--
-- ไม่นับ: รถไฟฟ้า (ไม่มีไอเสีย) · รถที่ปลดประจำการ · ทรัพย์สินที่ไม่ใช่ยานพาหนะ
-- รถที่วัดเป็นชั่วโมง (meter_unit = 'hour') ใช้แค่เกณฑ์ 6 เดือน ไม่มีเกณฑ์ 15,000 กม.
--
-- เลขไมล์ปัจจุบัน = เลขกลับของทริปที่เสร็จล่าสุด (เรียงตามเวลาจริงแบบ fleet_vehicle_last_odometer)
-- ถ้ายังไม่มีทริป ใช้เลขไมล์ตอนเติมน้ำมันล่าสุด แล้วจึงเลขไมล์ตอนซ่อมล่าสุด
-- ไม่ใช้ค่ามากสุด เพราะเลขที่พิมพ์ผิดหลัก (เคย 278,715 → 287,715) จะดันให้เตือนเกินกำหนดผิดๆ

CREATE OR REPLACE FUNCTION public.fleet_emission_status(p_municipality_id uuid)
 RETURNS TABLE(
   vehicle_id uuid,
   last_check_date date,
   last_check_meter numeric,
   current_meter numeric,
   due_date date,
   due_meter numeric
 )
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT v.id,
         last_check.service_date,
         last_check.odometer,
         COALESCE(trip.meter, fuel.meter, maint.meter),
         (last_check.service_date + interval '6 months')::date,
         CASE WHEN v.meter_unit = 'hour' OR last_check.odometer IS NULL THEN NULL
              ELSE last_check.odometer + 15000 END
    FROM public.fleet_vehicles v
    LEFT JOIN LATERAL (
      SELECT m.service_date, m.odometer
        FROM public.fleet_maintenance m
       WHERE m.vehicle_id = v.id AND m.maintenance_type = 'emission'
       ORDER BY m.service_date DESC, m.created_at DESC
       LIMIT 1
    ) last_check ON true
    LEFT JOIN LATERAL (
      SELECT t.odometer_end AS meter
        FROM public.fleet_trips t
       WHERE t.vehicle_id = v.id AND t.status = 'completed' AND t.odometer_end IS NOT NULL
       ORDER BY COALESCE(t.returned_at, t.started_at, t.trip_date::timestamptz) DESC NULLS LAST, t.created_at DESC
       LIMIT 1
    ) trip ON true
    LEFT JOIN LATERAL (
      SELECT f.odometer AS meter
        FROM public.fleet_fuel_records f
       WHERE f.vehicle_id = v.id AND f.odometer IS NOT NULL
       ORDER BY f.filled_at DESC, f.created_at DESC
       LIMIT 1
    ) fuel ON true
    LEFT JOIN LATERAL (
      SELECT m.odometer AS meter
        FROM public.fleet_maintenance m
       WHERE m.vehicle_id = v.id AND m.odometer IS NOT NULL
       ORDER BY m.service_date DESC, m.created_at DESC
       LIMIT 1
    ) maint ON true
   WHERE v.municipality_id = p_municipality_id
     AND COALESCE(v.asset_kind, 'vehicle') = 'vehicle'
     AND COALESCE(v.status, '') <> 'retired'
     AND COALESCE(v.fuel_type, '') <> 'electric'
$function$;

REVOKE ALL ON FUNCTION public.fleet_emission_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_emission_status(uuid) TO authenticated, service_role;
