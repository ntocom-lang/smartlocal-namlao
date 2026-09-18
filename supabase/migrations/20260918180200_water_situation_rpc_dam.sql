-- สถานการณ์น้ำ-ฝน — อ่างเก็บน้ำ เฟส 3/4: RPC ส่งค่าของอ่างเก็บน้ำด้วย
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — ตัวนี้ยกมาจาก 20260918150200 ทั้งก้อน
--    (ตรวจก่อนเขียน 2569-09-18: body บน production ตรงกับไฟล์นั้น md5 เดียวกันหลังตัดช่องว่าง)
--    เพิ่มแค่ 2 อย่าง ของเดิมไม่เปลี่ยนสักฟิลด์ หน้าเว็บรุ่นที่ใช้อยู่จึงทำงานต่อได้ทันที:
--    1. ฟิลด์ค่าของอ่าง dam_storage_mcm / dam_capacity_mcm / dam_inflow_mcm / dam_released_mcm
--    2. ค่าก่อนหน้าของอ่าง (prev_dam_storage_mcm) — อ่างเป็นข้อมูลรายวัน จึงเทียบกับ "เมื่อวาน"
--       (เก่ากว่าค่าล่าสุด 20 ชั่วโมง–3 วัน) ส่วนระดับน้ำยังเทียบราว 1 ชั่วโมงเหมือนเดิม

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'water_readings' AND column_name = 'dam_released_mcm'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260918180100_water_readings_dam_columns.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

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
    ), '[]'::jsonb)
  )
  FROM public.municipalities AS m
  WHERE m.id = _municipality_id
    AND m.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_water_situation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_water_situation(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_water_situation(uuid) IS
  'สถานการณ์น้ำ-ฝนฝั่งประชาชน — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ NULL. ข้อมูลจาก ThaiWater (สสน.) ที่ thaiwater-sync ดึงมาเก็บทุกชั่วโมง (ฝน ระดับน้ำ อ่างเก็บน้ำขนาดกลาง)';

NOTIFY pgrst, 'reload schema';

COMMIT;
