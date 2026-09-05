-- 20260908100200_adhoc_pin_routed_flag.sql
--
-- คู่กับ 20260908100000_odor_auto_route.sql — หมุดบนแผนที่ศูนย์ข้อมูลของผู้บริหาร (viewer/council)
-- ยังคืนธง acknowledged อยู่ ซึ่ง DataCenterMapView.jsx แปลเป็นข้อความ "ผู้รับผิดชอบรับทราบแล้ว"
-- พอเปลี่ยนมาเป็นระบบรับเรื่องอัตโนมัติ ธงนั้นจะเป็นเท็จทุกแถว (ไม่มีใครกดแล้ว) — เปลี่ยนเป็น
-- routed ที่ตรงกับสิ่งที่เกิดขึ้นจริง
--
-- ยังคืนคีย์ acknowledged ต่อไปด้วยโดยเจตนา ไม่ตัดทิ้ง: คำร้องช่วงที่ยังใช้ปุ่ม "รับทราบ" อยู่มีค่า
-- นั้นจริง และถ้าตัดคีย์ออก client รุ่นเก่าที่ยังไม่ได้ deploy จะอ่านไม่เจอแล้วขึ้น "รอรับทราบ"
-- ค้างทุกหมุดระหว่างช่วงที่ DB ใหม่แต่ bundle เก่า (หน้าต่างนี้เคยกัดมาแล้วตอน deploy)
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — body นี้คัดจาก 20260902090000 มาเพิ่มบรรทัดเดียว
-- ไม่แตะ data_center_unified_pins() เพราะโครง RETURNS TABLE และ logic การมองเห็นไม่เปลี่ยนเลย
CREATE OR REPLACE FUNCTION public.adhoc_pin_answers(p_extra jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'odor_intensity',
      CASE WHEN jsonb_typeof(p_extra -> 'odor_intensity') = 'number'
      THEN p_extra -> 'odor_intensity' END,
    'odor_time_range',
      CASE WHEN jsonb_typeof(p_extra -> 'odor_time_range') = 'string'
      THEN p_extra -> 'odor_time_range' END,
    'wind_direction',
      CASE WHEN jsonb_typeof(p_extra -> 'wind_direction') = 'string'
      THEN p_extra -> 'wind_direction' END,
    'health_effect',
      CASE WHEN jsonb_typeof(p_extra -> 'health_effect') = 'string'
      THEN p_extra -> 'health_effect' END
  )) || jsonb_build_object(
    'routed_at',    p_extra -> 'routed_at',
    'acknowledged', (p_extra ->> 'acknowledged_at') IS NOT NULL
  )
$$;

COMMENT ON FUNCTION public.adhoc_pin_answers(jsonb) IS
  'คืนเฉพาะคำตอบ structured ของคำร้องหมวดเฉพาะกิจสำหรับแสดงบนแผนที่ (whitelist 4 คีย์ + routed_at ที่ระบบประทับ + acknowledged ของสายงานเดิม) ไม่มี free-text และไม่มีข้อมูลผู้แจ้ง';

-- routed_at เป็น timestamp ไม่ใช่ชื่อ/รหัสคน จึงไม่เพิ่ม PII ให้ผู้บริหารเห็น — ยังเป็นข้อมูลชุดเดิม
-- ที่ 20260902090000 ตั้งใจให้สายวิเคราะห์เห็น (เวลา + คำตอบ structured เท่านั้น)

-- ตรวจหลัง apply (อ่านอย่างเดียว, ใช้ JWT ของ viewer):
--   select extra_data from public.data_center_unified_pins('<municipality_id>')
--    where source_table = 'complaints' and extra_data is not null limit 5;
--   → ทุกแถวต้องมี routed_at และต้องไม่มี subject/detail/reporter_name/phone หลุดมา
