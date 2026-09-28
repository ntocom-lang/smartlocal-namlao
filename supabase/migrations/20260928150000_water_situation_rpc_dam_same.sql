-- สถานการณ์น้ำ-ฝน: บอกว่าตัวเลขอ่างเก็บน้ำซ้ำเดิมมากี่วัน
--
-- ที่มา (ตรวจ 2569-09-28 จาก API ของเว็บกรมชลประทาน app.rid.go.th/reservoir):
-- อ่างขนาดกลางทั้ง 5 แห่งของ จ.แพร่ ตัวเลขค้างที่ค่าของ 19 ส.ค. นาน 40 วัน — ต้นทางลงวันที่ใหม่ทุกวัน
-- ด้วยปริมาตร/ไหลเข้า/ระบายชุดเดิม ป้าย "ข้อมูลอาจไม่เป็นปัจจุบัน" ที่ดูจากวันที่จึงจับไม่ได้ และหน้าเว็บ
-- ขึ้น "ข้อมูลของวันนี้" คู่กับตัวเลขของ 40 วันก่อน (ทั้งประเทศค้างทั้งจังหวัด 2 จังหวัด 19 อ่าง)
--
-- เพิ่ม 3 ช่องให้สถานีชนิด dam (ชนิดอื่นเป็น null):
--   dam_same_count  = จำนวนรายงานล่าสุดที่ปริมาตร/ไหลเข้า/ระบายเท่ากับรายงานล่าสุดทุกช่อง (นับตัวล่าสุดด้วย)
--   dam_same_since  = วันที่ของรายงานแรกในชุดนั้น
--   dam_same_capped = true เมื่อไม่มีรายงานที่ต่างเลยในข้อมูลที่เก็บไว้ (7 วัน) → ของจริงอาจนานกว่านี้
-- หน้าเว็บตัดสินเองว่าจะขึ้นป้ายหรือไม่ (DAM_SAME_MIN_REPORTS) — RPC ส่งแค่ข้อเท็จจริง
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — ยกของเดิมจาก 20260919100300 มาทั้งก้อน เพิ่มแค่ 3 ช่อง
--    กับ LATERAL 2 ตัว ของเดิมไม่เปลี่ยน (ตรวจก่อนเขียน 2569-09-28: body บน production ตรงกับไฟล์นั้น
--    md5 หลังตัดช่องว่าง ef87449a59f9c5bcbf0921853f417293) · ด่านข้างล่างหยุดทันทีถ้ามีคนแก้ไปก่อน

DO $$
DECLARE
  current_md5 text;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s', '', 'g')) INTO current_md5
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_public_water_situation';
  IF current_md5 IS DISTINCT FROM 'ef87449a59f9c5bcbf0921853f417293' THEN
    RAISE EXCEPTION 'get_public_water_situation บน production ไม่ตรงกับ 20260919100300 (md5 %) — ตรวจก่อนเขียนทับ', current_md5;
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
        'prev_dam_storage_mcm', p.dam_storage_mcm,
        -- อ่าง: ตัวเลขทุกช่องซ้ำกับรายงานล่าสุดติดกันมากี่รายงาน (ชนิดอื่นเป็น null)
        'dam_same_count', CASE WHEN c.station_type = 'dam' THEN s.same_count END,
        'dam_same_since', CASE WHEN c.station_type = 'dam' THEN s.same_since END,
        'dam_same_capped', CASE WHEN c.station_type = 'dam' THEN ch.changed_at IS NULL END
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
      -- อ่าง: รายงานล่าสุดที่ตัวเลขต่างจากรายงานล่าสุด (IS DISTINCT FROM นับค่าว่างด้วย เช่นอ่างที่ไม่มีค่าไหลเข้า)
      LEFT JOIN LATERAL (
        SELECT max(d.recorded_at) AS changed_at
        FROM public.water_readings AS d
        WHERE c.station_type = 'dam'
          AND d.station_config_id = c.id
          AND (d.dam_storage_mcm IS DISTINCT FROM l.dam_storage_mcm
            OR d.dam_inflow_mcm IS DISTINCT FROM l.dam_inflow_mcm
            OR d.dam_released_mcm IS DISTINCT FROM l.dam_released_mcm)
      ) AS ch ON true
      -- รายงานหลังจากนั้นทั้งหมดเท่ากับรายงานล่าสุดทุกช่อง (ตามนิยามของ changed_at)
      LEFT JOIN LATERAL (
        SELECT count(*) AS same_count, min(r.recorded_at) AS same_since
        FROM public.water_readings AS r
        WHERE c.station_type = 'dam'
          AND r.station_config_id = c.id
          AND r.recorded_at > COALESCE(ch.changed_at, '-infinity'::timestamptz)
      ) AS s ON true
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

COMMIT;
