-- สถานการณ์น้ำ-ฝน เฟส 3 (เหตุการณ์จดเอง) PR 3.1 ไฟล์ 2/2 — ปิดสิทธิ์ตาราง + ฟังก์ชันตรวจ/เปิด/ปิดเหตุการณ์ + cron
-- (ตารางอยู่ 20261016100000)
--
-- water_event_tick() รันทุกชั่วโมงนาทีที่ 20 (thaiwater-sync นาทีที่ 10 → water-alert-notify นาทีที่ 15 → ตัวนี้)
-- อ่านจากฐานข้อมูลเราเท่านั้น ไม่ยิงต้นทาง ไม่ส่งข้อความหาใคร ไม่ต้อง deploy Edge Function
--
-- เปิดเหตุการณ์เมื่อ "ค่าสด" ของ อปท. เข้าเกณฑ์ข้อใดข้อหนึ่ง (ชุดเดียวกับแจ้งเตือนเข้ากลุ่ม Telegram ยกเว้นอ่าง):
--   ฝน 24 ชม. ≥ 90.1 มม. · ระดับน้ำต่ำกว่าตลิ่งไม่เกิน 1 ม. (ขั้นเฝ้าระวังขึ้นไป) · สถานีเตือนภัย ews ระดับ 2–3
--   · ข้อความเตือนของ สสน. ที่ระบุอำเภอ+จังหวัดเดียวกับ อปท.
--   อ่างเก็บน้ำ "ไม่" ใช้เปิดเหตุการณ์ — อ่างอยู่ชั้น "น้ำมาก" (>80%) ได้เป็นเดือนในฤดูฝน
-- ⚠️ ตัวเลขเกณฑ์ซ้ำกับ supabase/functions/water-alert-notify/index.ts และ src/lib/waterSituation.js
--    tests/water-events.test.mjs อ่านทั้งสามที่มาเทียบกัน ห้ามแก้ที่เดียว
--
-- ปิดเมื่อ (1) ค่าสดแสดงว่าไม่เข้าเกณฑ์ต่อเนื่อง 24 ชม. — รอบที่ไม่มีค่าสดพอตัดสิน "ไม่นับว่าสงบ" และนับ 24 ชม. ใหม่
--         (ค่าที่ขาดไม่ใช่ค่า 0 และไม่ใช่ "น้ำลดแล้ว")
--         (2) ไม่มีค่าสดพอตัดสินเลย 48 ชม. → ปิดพร้อมเหตุผล data_lost ไม่ปล่อยค้างตลอดไปเมื่อสถานีถูกปิด/ต้นทางล่ม
--         (3) อปท. ปิดโมดูลหรือถูกปิดใช้งาน → module_off
--
-- เหตุการณ์ใหม่คัดลอกค่าที่วัดได้ย้อนหลัง 24 ชม. ก่อนเปิด (เห็นช่วงน้ำกำลังขึ้น) แล้วเก็บเพิ่มทุกรอบจนปิด
-- พารามิเตอร์ _now มีไว้ให้เทสต์จำลองเวลา — ฟังก์ชันถอนสิทธิ์จาก anon/authenticated แล้ว เรียกได้เฉพาะ cron/เจ้าของระบบ
--
-- ทดสอบพฤติกรรมด้วย PGlite: tests/water-events-db.test.mjs (ดูวิธีรันที่หัวไฟล์นั้น)

DO $$
BEGIN
  IF to_regclass('public.water_events') IS NULL
     OR to_regclass('public.water_event_readings') IS NULL
     OR to_regclass('public.water_event_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261016100000_water_events_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260928140000_job_heartbeats_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ pg_cron — เปิดที่ Database → Extensions ก่อน (20260918150500 เปิดไว้แล้วบน production)';
  END IF;
END;
$$;

BEGIN;

-- ตารางใหม่ได้ ALL ให้ anon/authenticated อัตโนมัติจาก default privileges ของ Supabase — ถอนก่อน
-- ตอนนี้ยังไม่มีหน้าจอ: ปิดสนิท (RLS เปิด ไม่มี policy) หน้าเจ้าหน้าที่จะเพิ่มสิทธิ์อ่านใน PR 3.2
REVOKE ALL ON public.water_events          FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.water_event_readings  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.water_event_warnings  FROM anon, authenticated, PUBLIC;
ALTER TABLE public.water_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_event_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_event_warnings  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.water_event_tick(_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- ⚠️ เกณฑ์ ต้องตรงกับ water-alert-notify/index.ts (HEAVY_RAIN_MM, LEVEL_WATCH_M, *_FRESH_HOURS)
  c_heavy_rain    CONSTANT numeric  := 90.1;
  c_level_watch   CONSTANT numeric  := 1;
  c_fresh_rain    CONSTANT interval := interval '3 hours';
  c_fresh_level   CONSTANT interval := interval '3 hours';
  c_fresh_ews     CONSTANT interval := interval '12 hours';
  c_fresh_warning CONSTANT interval := interval '6 hours';
  c_lead          CONSTANT interval := interval '24 hours';
  c_calm          CONSTANT interval := interval '24 hours';
  c_data_lost     CONSTANT interval := interval '48 hours';
  c_job           CONSTANT text     := 'water-event-tick';
  t               record;
  v_triggers      jsonb;
  v_hot           boolean;
  v_evaluable     boolean;
  ev_id           uuid;
  ev_opened       timestamptz;
  ev_last_hot     timestamptz;
  ev_calm_since   timestamptz;
  ev_last_fresh   timestamptz;
  v_checked       integer := 0;
  v_opened        integer := 0;
  v_closed        integer := 0;
  v_rows          integer;
  v_errors        text[]  := ARRAY[]::text[];
BEGIN
  FOR t IN
    SELECT m.id, m.slug, m.district, m.province
    FROM public.municipalities AS m
    WHERE m.is_active
      AND (m.enabled_modules IS NULL OR 'water-situation' = ANY (m.enabled_modules))
    ORDER BY m.slug
  LOOP
    BEGIN
      v_checked := v_checked + 1;
      ev_id := NULL; ev_opened := NULL; ev_last_hot := NULL; ev_calm_since := NULL; ev_last_fresh := NULL;

      -- ── 1) สัญญาณที่เข้าเกณฑ์ตอนนี้ (เฉพาะค่าสด · ค่าว่างไม่เข้าเกณฑ์ ไม่ถูกแปลงเป็น 0) ──
      SELECT COALESCE(jsonb_agg(x.j), '[]'::jsonb)
      INTO v_triggers
      FROM (
        SELECT jsonb_build_object(
                 'kind', 'rain', 'station_code', c.station_code, 'station_name', c.station_name,
                 'value', l.rain_24h_mm, 'recorded_at', l.recorded_at) AS j
        FROM public.water_station_config AS c
        CROSS JOIN LATERAL (
          SELECT r.rain_24h_mm, r.recorded_at FROM public.water_readings AS r
          WHERE r.station_config_id = c.id AND r.recorded_at <= _now
          ORDER BY r.recorded_at DESC LIMIT 1
        ) AS l
        WHERE c.municipality_id = t.id AND c.is_active AND c.station_type = 'rain'
          AND l.rain_24h_mm IS NOT NULL AND l.rain_24h_mm >= c_heavy_rain
          AND l.recorded_at >= _now - c_fresh_rain
        UNION ALL
        SELECT jsonb_build_object(
                 'kind', 'waterlevel', 'station_code', c.station_code, 'station_name', c.station_name,
                 'value', l.bank_diff_m, 'recorded_at', l.recorded_at)
        FROM public.water_station_config AS c
        CROSS JOIN LATERAL (
          SELECT r.bank_diff_m, r.recorded_at FROM public.water_readings AS r
          WHERE r.station_config_id = c.id AND r.recorded_at <= _now
          ORDER BY r.recorded_at DESC LIMIT 1
        ) AS l
        WHERE c.municipality_id = t.id AND c.is_active AND c.station_type = 'waterlevel'
          AND l.bank_diff_m IS NOT NULL AND l.bank_diff_m <= c_level_watch
          AND l.recorded_at >= _now - c_fresh_level
        UNION ALL
        SELECT jsonb_build_object(
                 'kind', 'ews', 'station_code', c.station_code, 'station_name', c.station_name,
                 'value', l.situation_level, 'recorded_at', l.recorded_at)
        FROM public.water_station_config AS c
        CROSS JOIN LATERAL (
          SELECT r.situation_level, r.recorded_at FROM public.water_readings AS r
          WHERE r.station_config_id = c.id AND r.recorded_at <= _now
          ORDER BY r.recorded_at DESC LIMIT 1
        ) AS l
        WHERE c.municipality_id = t.id AND c.is_active AND c.station_type = 'ews'
          AND l.situation_level IN (2, 3)
          AND l.recorded_at >= _now - c_fresh_ews
        UNION ALL
        SELECT jsonb_build_object(
                 'kind', 'warning', 'station_code', NULL, 'station_name', w.station_name,
                 'value', NULL, 'recorded_at', w.issued_at)
        FROM public.water_warnings AS w
        WHERE w.source = 'thaiwater'
          AND w.amphoe_name = t.district AND w.province_name = t.province
          AND w.issued_at >= _now - c_fresh_warning AND w.issued_at <= _now
      ) AS x;
      v_hot := jsonb_array_length(v_triggers) > 0;

      -- ── 2) มีค่าสดพอ "ตัดสินว่าสงบ" ไหม: สถานีฝน/ระดับน้ำอย่างน้อยหนึ่งแห่งส่งค่าจริงของตัวชี้วัดนั้นภายใน 3 ชม. ──
      SELECT EXISTS (
        SELECT 1
        FROM public.water_station_config AS c
        CROSS JOIN LATERAL (
          SELECT r.rain_24h_mm, r.bank_diff_m, r.recorded_at FROM public.water_readings AS r
          WHERE r.station_config_id = c.id AND r.recorded_at <= _now
          ORDER BY r.recorded_at DESC LIMIT 1
        ) AS l
        WHERE c.municipality_id = t.id AND c.is_active
          AND ((c.station_type = 'rain' AND l.rain_24h_mm IS NOT NULL AND l.recorded_at >= _now - c_fresh_rain)
            OR (c.station_type = 'waterlevel' AND l.bank_diff_m IS NOT NULL AND l.recorded_at >= _now - c_fresh_level))
      ) INTO v_evaluable;

      -- ── 3) เปิด/ต่ออายุเหตุการณ์ ──
      SELECT e.id, e.opened_at, e.last_hot_at, e.calm_since, e.last_fresh_at
      INTO ev_id, ev_opened, ev_last_hot, ev_calm_since, ev_last_fresh
      FROM public.water_events AS e
      WHERE e.municipality_id = t.id AND e.closed_at IS NULL;

      IF ev_id IS NULL THEN
        IF v_hot THEN
          INSERT INTO public.water_events (municipality_id, opened_at, last_hot_at, last_fresh_at, open_reason)
          VALUES (t.id, _now, _now, _now, jsonb_build_object('rule_version', 1, 'triggers', v_triggers))
          RETURNING id, opened_at, last_hot_at, calm_since, last_fresh_at
          INTO ev_id, ev_opened, ev_last_hot, ev_calm_since, ev_last_fresh;
          v_opened := v_opened + 1;
        END IF;
      ELSIF v_hot THEN
        UPDATE public.water_events
        SET last_hot_at = _now, last_fresh_at = _now, calm_since = NULL
        WHERE id = ev_id
        RETURNING last_hot_at, calm_since, last_fresh_at INTO ev_last_hot, ev_calm_since, ev_last_fresh;
      ELSIF v_evaluable THEN
        UPDATE public.water_events
        SET last_fresh_at = _now, calm_since = COALESCE(calm_since, _now)
        WHERE id = ev_id
        RETURNING last_hot_at, calm_since, last_fresh_at INTO ev_last_hot, ev_calm_since, ev_last_fresh;
      ELSE
        -- ไม่มีค่าสดพอตัดสิน: ไม่นับว่าสงบ และเริ่มนับ 24 ชม. ใหม่เมื่อค่ากลับมา
        UPDATE public.water_events
        SET calm_since = NULL
        WHERE id = ev_id
        RETURNING last_hot_at, calm_since, last_fresh_at INTO ev_last_hot, ev_calm_since, ev_last_fresh;
      END IF;

      IF ev_id IS NOT NULL THEN
        -- ── 4) เก็บค่าที่วัดได้ + ข้อความ สสน. (ก่อนปิดเสมอ ค่ารอบท้ายจะได้ไม่ตกหล่น) ──
        INSERT INTO public.water_event_readings (
          event_id, station_type, station_code, station_name, recorded_at,
          rain_24h_mm, rain_1h_mm, waterlevel_msl, bank_diff_m, storage_percent,
          situation_level, situation_text,
          dam_storage_mcm, dam_capacity_mcm, dam_inflow_mcm, dam_released_mcm)
        SELECT ev_id, c.station_type, c.station_code, c.station_name, r.recorded_at,
               r.rain_24h_mm, r.rain_1h_mm, r.waterlevel_msl, r.bank_diff_m, r.storage_percent,
               r.situation_level, r.situation_text,
               r.dam_storage_mcm, r.dam_capacity_mcm, r.dam_inflow_mcm, r.dam_released_mcm
        FROM public.water_readings AS r
        JOIN public.water_station_config AS c ON c.id = r.station_config_id
        WHERE c.municipality_id = t.id AND c.is_active
          AND r.recorded_at >= ev_opened - c_lead AND r.recorded_at <= _now
        ON CONFLICT (event_id, station_type, station_code, recorded_at) DO NOTHING;

        INSERT INTO public.water_event_warnings (event_id, issued_at, message, station_name, tambon_name)
        SELECT ev_id, w.issued_at, w.message, w.station_name, w.tambon_name
        FROM public.water_warnings AS w
        WHERE w.source = 'thaiwater'
          AND w.amphoe_name = t.district AND w.province_name = t.province
          AND w.issued_at >= ev_opened - c_lead AND w.issued_at <= _now
        ON CONFLICT (event_id, issued_at, message) DO NOTHING;

        -- ── 5) ปิด ──
        IF ev_calm_since IS NOT NULL AND _now - ev_calm_since >= c_calm THEN
          UPDATE public.water_events
          SET ended_at = ev_last_hot, closed_at = _now, close_reason = 'calm'
          WHERE id = ev_id;
          v_closed := v_closed + 1;
        ELSIF _now - ev_last_fresh >= c_data_lost THEN
          UPDATE public.water_events
          SET ended_at = ev_last_fresh, closed_at = _now, close_reason = 'data_lost'
          WHERE id = ev_id;
          v_closed := v_closed + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- อปท. หนึ่งพังไม่ลากรอบของ อปท. อื่นล้ม — บันทึกเหตุผลลงสมุดลงเวลา
      v_errors := v_errors || (t.slug || ': ' || SQLERRM);
    END;
  END LOOP;

  -- อปท. ที่ปิดโมดูล/ถูกปิดใช้งานระหว่างมีเหตุการณ์เปิดอยู่ ไม่ปล่อยค้าง
  UPDATE public.water_events AS e
  SET ended_at = e.last_fresh_at, closed_at = _now, close_reason = 'module_off'
  WHERE e.closed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.municipalities AS m
      WHERE m.id = e.municipality_id AND m.is_active
        AND (m.enabled_modules IS NULL OR 'water-situation' = ANY (m.enabled_modules))
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_closed := v_closed + v_rows;

  -- สมุดลงเวลา: สำเร็จ = last_ok_at · มี อปท. พัง = last_error (last_ok_at เดิมไม่ถูกลบ)
  -- เขียนไม่สำเร็จไม่ทำให้งานของรอบนี้ย้อนกลับ
  BEGIN
    IF cardinality(v_errors) = 0 THEN
      INSERT INTO public.job_heartbeats (job_name, last_ok_at, updated_at)
      VALUES (c_job, now(), now())
      ON CONFLICT (job_name) DO UPDATE SET last_ok_at = EXCLUDED.last_ok_at, updated_at = EXCLUDED.updated_at;
    ELSE
      INSERT INTO public.job_heartbeats (job_name, last_error_at, last_error, updated_at)
      VALUES (c_job, now(), left(array_to_string(v_errors, ' | '), 500), now())
      ON CONFLICT (job_name) DO UPDATE
        SET last_error_at = EXCLUDED.last_error_at, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', cardinality(v_errors) = 0,
    'checked', v_checked, 'opened', v_opened, 'closed', v_closed,
    'errors', to_jsonb(v_errors));
END;
$$;

REVOKE ALL ON FUNCTION public.water_event_tick(timestamptz) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.water_events IS
  'เหตุการณ์น้ำ-ฝนที่ระบบเปิด/ปิดเอง (water_event_tick) — เก็บบันทึกไว้เกิน 7 วันที่ water_readings ลบ · ไม่มีข้อมูลบุคคล · ตอนนี้ยังไม่มีหน้าจอ';
COMMENT ON FUNCTION public.water_event_tick(timestamptz) IS
  'ตรวจค่าสดของทุก อปท. ที่เปิดโมดูลน้ำ-ฝน แล้วเปิด/ต่อ/ปิดเหตุการณ์ + คัดลอกค่าที่วัดได้ช่วงเหตุการณ์ · cron นาทีที่ 20 · _now ไว้เทสต์จำลองเวลา';

SELECT cron.unschedule('water-event-tick-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-event-tick-hourly');

SELECT cron.schedule(
  'water-event-tick-hourly',
  '20 * * * *',
  $cron$SELECT public.water_event_tick();$cron$
);

NOTIFY pgrst, 'reload schema';

COMMIT;
