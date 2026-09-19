-- สถานการณ์น้ำ-ฝน — ข้อความเตือนของ สสน. เฟส 2/3: สิทธิ์ + RPC + ลบข้อมูลเก่า
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — ทั้งสองตัวยกของเดิมมาทั้งก้อน
--    (ตรวจก่อนเขียน 2569-09-19: body บน production ตรงกับไฟล์ md5 เดียวกันหลังตัดช่องว่าง)
--    get_public_water_situation  ← 20260918180200 · เพิ่มช่อง 'warnings' ช่องเดียว ของเดิมไม่เปลี่ยน
--    cleanup_old_water_readings  ← 20260918150200 · เพิ่มลบ water_warnings เก่ากว่า 7 วัน
--
-- ตาราง water_warnings ปิดการเข้าถึงตรงทั้งหมดเหมือน water_readings (RLS เปิด ไม่มี policy)
-- เขียนได้เฉพาะ service_role (thaiwater-sync) อ่านได้ผ่าน RPC เท่านั้น

DO $$
BEGIN
  IF to_regclass('public.water_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260919100200_water_warnings_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

REVOKE ALL ON public.water_warnings FROM anon, authenticated, PUBLIC;
ALTER TABLE public.water_warnings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_public_water_situation(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'synced_at', (
      SELECT max(r.fetched_at)
      FROM public.water_readings AS r
      JOIN public.water_station_config AS c ON c.id = r.station_config_id
      WHERE c.municipality_id = m.id AND c.is_active
    ),
    'stations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'station_type', c.station_type,
        'station_code', c.station_code,
        'station_name', c.station_name,
        'tambon_name', c.tambon_name,
        'amphoe_name', c.amphoe_name,
        'province_name', c.province_name,
        'river_name', c.river_name,
        'agency_name', c.agency_name,
        'latitude', c.latitude,
        'longitude', c.longitude,
        'distance_km', c.distance_km,
        'is_primary', c.is_primary,
        'note', c.note,
        'recorded_at', l.recorded_at,
        'rain_24h_mm', l.rain_24h_mm,
        'rain_1h_mm', l.rain_1h_mm,
        'waterlevel_msl', l.waterlevel_msl,
        'bank_diff_m', l.bank_diff_m,
        'storage_percent', l.storage_percent,
        'situation_level', l.situation_level,
        'situation_text', l.situation_text,
        'situation_color', l.situation_color,
        'dam_storage_mcm', l.dam_storage_mcm,
        'dam_capacity_mcm', l.dam_capacity_mcm,
        'dam_inflow_mcm', l.dam_inflow_mcm,
        'dam_released_mcm', l.dam_released_mcm,
        'prev_recorded_at', p.recorded_at,
        'prev_waterlevel_msl', p.waterlevel_msl,
        'prev_dam_storage_mcm', p.dam_storage_mcm
      ) ORDER BY c.station_type, c.display_order, c.distance_km NULLS LAST, c.station_name)
      FROM public.water_station_config AS c
      LEFT JOIN LATERAL (
        SELECT r.*
        FROM public.water_readings AS r
        WHERE r.station_config_id = c.id
        ORDER BY r.recorded_at DESC
        LIMIT 1
      ) AS l ON true
      LEFT JOIN LATERAL (
        SELECT r.recorded_at, r.waterlevel_msl, r.dam_storage_mcm
        FROM public.water_readings AS r
        WHERE r.station_config_id = c.id
          AND (
            (c.station_type = 'waterlevel'
              AND r.recorded_at <= l.recorded_at - interval '50 minutes'
              AND r.recorded_at >= l.recorded_at - interval '3 hours')
            OR
            (c.station_type = 'dam'
              AND r.recorded_at <= l.recorded_at - interval '20 hours'
              AND r.recorded_at >= l.recorded_at - interval '3 days')
          )
        ORDER BY r.recorded_at DESC
        LIMIT 1
      ) AS p ON true
      WHERE c.municipality_id = m.id
        AND c.is_active
    ), '[]'::jsonb),
    -- ข้อความเตือนของ สสน. ในอำเภอ/จังหวัดของ อปท. ย้อนหลัง 24 ชม. — สถานีเดียวรายงานซ้ำหลายรอบได้
    -- จึงเอาเฉพาะข้อความล่าสุดของแต่ละสถานี (ข้อความตามต้นฉบับ ไม่ตีความ)
    'warnings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'issued_at', w.issued_at,
        'message', w.message,
        'station_name', w.station_name,
        'tambon_name', w.tambon_name
      ) ORDER BY w.issued_at DESC)
      FROM (
        SELECT DISTINCT ON (COALESCE(ww.station_name, ww.message)) ww.*
        FROM public.water_warnings AS ww
        WHERE ww.source = 'thaiwater'
          AND ww.amphoe_name = m.district
          AND ww.province_name = m.province
          AND ww.issued_at > now() - interval '24 hours'
        ORDER BY COALESCE(ww.station_name, ww.message), ww.issued_at DESC
      ) AS w
    ), '[]'::jsonb)
  )
  FROM public.municipalities AS m
  WHERE m.id = _municipality_id
    AND m.is_active = true;
$$;


REVOKE ALL ON FUNCTION public.get_public_water_situation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_water_situation(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_water_situation(uuid) IS
  'สถานการณ์น้ำ-ฝนฝั่งประชาชน — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ NULL. ข้อมูลจาก ThaiWater (สสน.) ที่ thaiwater-sync ดึงมาเก็บทุกชั่วโมง (ฝน ระดับน้ำ อ่างเก็บน้ำขนาดกลาง ข้อความเตือนของอำเภอ)';

-- คืนจำนวนแถวที่ลบรวมทั้งสองตาราง (ชนิดคืนค่าเดิม integer — cron เรียกแบบไม่อ่านค่า)
CREATE OR REPLACE FUNCTION public.cleanup_old_water_readings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted integer;
  deleted_warnings integer;
BEGIN
  DELETE FROM public.water_readings WHERE recorded_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  DELETE FROM public.water_warnings WHERE issued_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_warnings = ROW_COUNT;
  RETURN deleted + deleted_warnings;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_water_readings() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
