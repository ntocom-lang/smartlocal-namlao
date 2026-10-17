-- เหตุการณ์น้ำ-ฝนที่ระบบจดเอง (เฟส 3 · PR 3.2) — ฟังก์ชันอ่านสำหรับหน้าเจ้าหน้าที่ (อ่านอย่างเดียว)
--
-- ทำไมเป็นฟังก์ชัน ไม่เปิด policy อ่านตารางตรง:
--   1) ตาราง water_events / _readings / _warnings ยังปิดสนิทต่อ anon/authenticated ตามที่ PR 3.1 ตั้งใจ ไฟล์นี้ไม่แตะสิทธิ์ตาราง
--   2) เหตุการณ์ 72 ชม. มีค่าราว 1,000 แถว ใกล้เพดาน 1,000 แถวต่อคำขอของ Supabase — อ่านตารางตรงแล้วข้อมูลจะหายเงียบ
--      ฟังก์ชันรวมเป็น jsonb ก้อนเดียวต่อเหตุการณ์ ไม่มีเพดานแถว
--
-- ใครอ่านได้ (can_view_water_events): superadmin · admin/officer/staff ของ อปท. นั้น — ช่าง (technician) สภา (council) ประชาชน ไม่ได้
--   ไม่ผูกกับกองใด (เป็นข้อมูลที่วัดได้ ไม่มีข้อมูลบุคคล) · ⚠️ ต้องให้ อบต. ยืนยันว่ากองไหนดูแลงานป้องกันสาธารณภัย
--   ถ้าจะจำกัดเฉพาะกอง ให้เปลี่ยนเงื่อนไขในฟังก์ชันนี้จุดเดียว (ไม่ได้อ้างระเบียบใด)
--
-- ไม่เขียนอะไรเลย: ไม่มีปุ่มแก้/ลบ/หมายเหตุ ระบบจดและปิดเหตุการณ์เองทั้งหมด (เจ้าของระบบสั่ง "ต้องไม่เพิ่มงานให้เจ้าหน้าที่")
--
-- ไฟล์นี้สร้างของใหม่ล้วน: ชื่อฟังก์ชันใหม่ทั้งหมด ไม่มี CREATE OR REPLACE ทับของเดิม

DO $$
BEGIN
  IF to_regclass('public.water_events') IS NULL
     OR to_regclass('public.water_event_readings') IS NULL
     OR to_regclass('public.water_event_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261016100000_water_events_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF has_table_privilege('anon', 'public.water_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.water_events', 'SELECT') THEN
    RAISE EXCEPTION 'ต้อง apply 20261016100100_water_events_tick_cron.sql ก่อนไฟล์นี้ (ไฟล์นั้นปิดสิทธิ์ตารางเหตุการณ์ — ห้ามเปิดฟังก์ชันอ่านก่อนตารางปิดสนิท)';
  END IF;
  IF to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260928140000_job_heartbeats_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง profiles';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- ตัวตัดสินสิทธิ์ — ใช้ทั้งสองฟังก์ชันข้างล่าง (รูปแบบเดียวกับ can_manage_waste_schedule)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.can_view_water_events(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth.uid()
      AND p_municipality_id IS NOT NULL
      AND (
        profile.role = 'superadmin'
        OR (
          profile.municipality_id = p_municipality_id
          AND profile.role IN ('admin', 'officer', 'staff')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_water_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_water_events(uuid) TO authenticated;

-- ===========================================================================
-- รายการเหตุการณ์ของ อปท. (ใหม่ → เก่า) + สถานะการทำงานของตัวจด
--   recorder = เวลาที่ water_event_tick ทำงานจบครบรอบล่าสุด (job_heartbeats) — ให้หน้าเว็บแยก "ว่างเพราะสงบ" จาก "ว่างเพราะระบบเงียบ"
--   ไม่ส่ง last_error (ข้อความภายใน) ออกไป ส่งแค่เวลา
--   peak_rain_24h_mm / min_bank_diff_m = ค่าที่วัดได้สูงสุด/ใกล้ตลิ่งสุดทุกสถานีในเหตุการณ์ (ค่าว่างไม่นับ ไม่กลายเป็น 0)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.list_water_events(_municipality_id uuid, _limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
BEGIN
  IF NOT public.can_view_water_events(_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูเหตุการณ์น้ำ-ฝนของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'now', now(),
    'recorder', (
      SELECT jsonb_build_object('last_ok_at', h.last_ok_at, 'last_error_at', h.last_error_at)
      FROM public.job_heartbeats AS h
      WHERE h.job_name = 'water-event-tick'
    ),
    'total', (SELECT count(*) FROM public.water_events AS e WHERE e.municipality_id = _municipality_id),
    'events', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.opened_at DESC)
      FROM (
        SELECT
          e.opened_at,
          jsonb_build_object(
            'id', e.id,
            'opened_at', e.opened_at,
            'ended_at', e.ended_at,
            'closed_at', e.closed_at,
            'close_reason', e.close_reason,
            'last_fresh_at', e.last_fresh_at,
            'open_reason', e.open_reason,
            'stations_count', s.stations_count,
            'readings_count', s.readings_count,
            'peak_rain_24h_mm', s.peak_rain,
            'min_bank_diff_m', s.min_bank,
            'warnings_count', w.cnt
          ) AS j
        FROM public.water_events AS e
        CROSS JOIN LATERAL (
          SELECT
            count(DISTINCT (r.station_type, r.station_code)) AS stations_count,
            count(*) AS readings_count,
            max(r.rain_24h_mm) AS peak_rain,
            min(r.bank_diff_m) AS min_bank
          FROM public.water_event_readings AS r
          WHERE r.event_id = e.id
        ) AS s
        CROSS JOIN LATERAL (
          SELECT count(*) AS cnt FROM public.water_event_warnings AS ww WHERE ww.event_id = e.id
        ) AS w
        WHERE e.municipality_id = _municipality_id
        ORDER BY e.opened_at DESC
        LIMIT v_limit
      ) AS x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_water_events(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_water_events(uuid, integer) TO authenticated;

-- ===========================================================================
-- รายละเอียดเหตุการณ์เดียว — ค่าที่วัดได้รายสถานี (เรียงเวลา) + ข้อความ สสน. ตามต้นฉบับ
--   คืน NULL ถ้าไม่พบ หรือเหตุการณ์ไม่ใช่ของ อปท. ที่ส่งมา (ไม่บอกว่ามีอยู่ใน อปท. อื่น)
--   ค่าที่เป็น NULL ถูกตัดออกจาก JSON (jsonb_strip_nulls) — หน้าเว็บอ่านว่า "ไม่มีค่า" ไม่ใช่ 0
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_water_event(_municipality_id uuid, _event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_view_water_events(_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูเหตุการณ์น้ำ-ฝนของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'now', now(),
    'event', jsonb_build_object(
      'id', e.id,
      'opened_at', e.opened_at,
      'ended_at', e.ended_at,
      'closed_at', e.closed_at,
      'close_reason', e.close_reason,
      'last_fresh_at', e.last_fresh_at,
      'open_reason', e.open_reason
    ),
    'stations', COALESCE((
      SELECT jsonb_agg(g.j ORDER BY g.station_type, g.station_code)
      FROM (
        SELECT
          r.station_type,
          r.station_code,
          jsonb_build_object(
            'station_type', r.station_type,
            'station_code', r.station_code,
            'station_name', (array_agg(r.station_name ORDER BY r.recorded_at DESC))[1],
            'readings', jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                't', r.recorded_at,
                'rain_24h', r.rain_24h_mm,
                'rain_1h', r.rain_1h_mm,
                'level_msl', r.waterlevel_msl,
                'bank_diff', r.bank_diff_m,
                'storage_pct', r.storage_percent,
                'sit_level', r.situation_level,
                'sit_text', r.situation_text,
                'dam_storage', r.dam_storage_mcm,
                'dam_capacity', r.dam_capacity_mcm,
                'dam_inflow', r.dam_inflow_mcm,
                'dam_released', r.dam_released_mcm
              ))
              ORDER BY r.recorded_at
            )
          ) AS j
        FROM public.water_event_readings AS r
        WHERE r.event_id = e.id
        GROUP BY r.station_type, r.station_code
      ) AS g
    ), '[]'::jsonb),
    'warnings', COALESCE((
      SELECT jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'issued_at', ww.issued_at,
          'message', ww.message,
          'station_name', ww.station_name,
          'tambon_name', ww.tambon_name
        ))
        ORDER BY ww.issued_at
      )
      FROM public.water_event_warnings AS ww
      WHERE ww.event_id = e.id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.water_events AS e
  WHERE e.id = _event_id AND e.municipality_id = _municipality_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_water_event(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_water_event(uuid, uuid) TO authenticated;

COMMIT;
