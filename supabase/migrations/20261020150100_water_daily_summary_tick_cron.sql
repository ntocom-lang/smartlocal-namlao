-- สถานการณ์น้ำ-ฝน · สรุปรายวัน ไฟล์ 2/2 — ปิดสิทธิ์ตาราง + ฟังก์ชันสรุป + cron + ย้อนเติมจากข้อมูลที่ยังไม่ถูกลบ
-- (ตารางอยู่ 20261020150000)
--
-- water_daily_summary_tick() รันทุกชั่วโมงนาทีที่ 30 (thaiwater-sync :10 → water-alert-notify :15 → water_event_tick :20
-- → water_announcement_tick :25 → ตัวนี้) อ่านจากฐานข้อมูลเราเท่านั้น ไม่ยิงต้นทาง ไม่ส่งข้อความหาใคร ไม่ต้อง deploy Edge Function
--
-- ทำอะไร: สรุปค่าที่วัดได้ของ "วันนี้และ 2 วันก่อนหน้า" (วันไทย) ของทุกสถานีฝน/ระดับน้ำ/อ่างของ อปท. ที่เปิดโมดูลน้ำ-ฝน
--   ลงตาราง water_daily_summary (upsert — รันซ้ำได้ ผลเท่าเดิม) · วันที่ยังไม่จบจะค่อยๆ ถูกแทนด้วยค่าที่ครบขึ้นทุกชั่วโมง
--   · ย้อน 2 วันเผื่อรอบที่พลาด/ต้นทางส่งค่าล่าช้า (water_readings เก็บ 7 วัน จึงมีข้อมูลครบเสมอ)
--   · ไม่สรุปสถานีเตือนภัย (ews) — ไม่มีค่าตัวเลขให้สรุป (และปิดใช้งานอยู่ทุกแถว)
--   · สถานีที่ปิดใช้งานทีหลังแต่เคยมีค่า ยังถูกสรุปส่วนที่มีค่า (ประวัติไม่หาย) — หน้าที่ตัดสินว่าจะแสดงสถานีไหนอยู่ที่ฟังก์ชันอ่านของ PR ถัดไป
--
-- ⚠️ ไม่เขียนทับแถวที่ดีกว่าด้วยแถวที่แย่กว่า: แทนเฉพาะเมื่อจำนวนค่าที่วัดได้ใหม่ ≥ จำนวนเดิม — กันกรณีสั่งย้อนหลังเกินหลังข้อมูลเก่าถูก
--   cleanup_old_water_readings ลบไปแล้ว (จะได้ไม่ทำให้สรุปที่ครบกลายเป็นสรุปที่ขาด) · ฟังก์ชันนี้ไม่ลบแถวใดเลย
--
-- ค่าว่างไม่ถูกแปลงเป็น 0 · ค่าที่เวลาวัดอยู่หลังเวลาของรอบ (_now) ไม่ถูกนับ
-- พารามิเตอร์ _now / _days_back มีไว้ให้เทสต์จำลองเวลา และให้ย้อนเติมตอน apply — ฟังก์ชันถอนสิทธิ์จาก anon/authenticated แล้ว (เรียกจากเว็บไม่ได้)
--
-- ทดสอบพฤติกรรมด้วย PGlite: tests/water-daily-summary-db.test.mjs (ดูวิธีรันที่หัวไฟล์นั้น)

DO $$
BEGIN
  IF to_regclass('public.water_daily_summary') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261020150000_water_daily_summary_table.sql ก่อนไฟล์นี้';
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
-- ตอนนี้ยังไม่มีหน้าจอ: ปิดสนิท (RLS เปิด ไม่มี policy) ฟังก์ชันอ่านสาธารณะจะเพิ่มใน PR ถัดไป
REVOKE ALL ON public.water_daily_summary FROM anon, authenticated, PUBLIC;
ALTER TABLE public.water_daily_summary ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.water_daily_summary_tick(_now timestamptz DEFAULT now(), _days_back integer DEFAULT 2)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_job      CONSTANT text := 'water-daily-summary-tick';
  c_tz       CONSTANT text := 'Asia/Bangkok';
  v_back     integer := LEAST(GREATEST(COALESCE(_days_back, 2), 0), 10);
  v_to_day   date    := (_now AT TIME ZONE 'Asia/Bangkok')::date;
  v_from_day date;
  v_from     timestamptz;
  t          record;
  v_checked  integer := 0;
  v_written  integer := 0;
  v_rows     integer;
  v_errors   text[]  := ARRAY[]::text[];
BEGIN
  v_from_day := v_to_day - v_back;
  -- ขอบเริ่มตามเวลาไทย: 00:00 ของวันแรก · ขอบท้ายคือ _now เอง (อยู่ในวันนี้ของไทยเสมอ จึงไม่ต้องมีขอบท้ายวันแยก)
  v_from := v_from_day::timestamp AT TIME ZONE c_tz;

  FOR t IN
    SELECT m.id, m.slug
    FROM public.municipalities AS m
    WHERE m.is_active
      AND (m.enabled_modules IS NULL OR 'water-situation' = ANY (m.enabled_modules))
    ORDER BY m.slug
  LOOP
    BEGIN
      v_checked := v_checked + 1;

      INSERT INTO public.water_daily_summary AS s (
        municipality_id, day, station_type, station_code, station_name, distance_km, is_primary,
        readings_count, first_recorded_at, last_recorded_at,
        rain_24h_max_mm, rain_24h_max_at, rain_1h_max_mm, rain_1h_max_at,
        bank_diff_min_m, bank_diff_min_at, waterlevel_max_msl, waterlevel_max_at, waterlevel_min_msl,
        dam_storage_last_mcm, dam_capacity_last_mcm, dam_storage_percent_last, updated_at)
      SELECT
        t.id, b.day, b.station_type, b.station_code, b.station_name, b.distance_km, b.is_primary,
        count(*)::integer, min(b.recorded_at), max(b.recorded_at),
        max(b.rain_24h_mm),
        (array_agg(b.recorded_at ORDER BY b.rain_24h_mm DESC, b.recorded_at) FILTER (WHERE b.rain_24h_mm IS NOT NULL))[1],
        max(b.rain_1h_mm),
        (array_agg(b.recorded_at ORDER BY b.rain_1h_mm DESC, b.recorded_at) FILTER (WHERE b.rain_1h_mm IS NOT NULL))[1],
        min(b.bank_diff_m),
        (array_agg(b.recorded_at ORDER BY b.bank_diff_m ASC, b.recorded_at) FILTER (WHERE b.bank_diff_m IS NOT NULL))[1],
        max(b.waterlevel_msl),
        (array_agg(b.recorded_at ORDER BY b.waterlevel_msl DESC, b.recorded_at) FILTER (WHERE b.waterlevel_msl IS NOT NULL))[1],
        min(b.waterlevel_msl),
        -- อ่าง: ค่าสุดท้ายของวันที่ไม่ว่าง (ความจุ/เปอร์เซ็นต์ดึงจากแถวเดียวกับปริมาตร)
        (array_agg(b.dam_storage_mcm ORDER BY b.recorded_at DESC) FILTER (WHERE b.station_type = 'dam' AND b.dam_storage_mcm IS NOT NULL))[1],
        (array_agg(b.dam_capacity_mcm ORDER BY b.recorded_at DESC) FILTER (WHERE b.station_type = 'dam' AND b.dam_storage_mcm IS NOT NULL))[1],
        (array_agg(b.storage_percent ORDER BY b.recorded_at DESC) FILTER (WHERE b.station_type = 'dam' AND b.dam_storage_mcm IS NOT NULL))[1],
        now()
      FROM (
        SELECT c.station_type, c.station_code, c.station_name, c.distance_km, c.is_primary,
               (r.recorded_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
               r.recorded_at, r.rain_24h_mm, r.rain_1h_mm, r.waterlevel_msl, r.bank_diff_m,
               r.storage_percent, r.dam_storage_mcm, r.dam_capacity_mcm
        FROM public.water_station_config AS c
        JOIN public.water_readings AS r ON r.station_config_id = c.id
        WHERE c.municipality_id = t.id
          AND c.station_type IN ('rain', 'waterlevel', 'dam')
          AND r.recorded_at >= v_from
          AND r.recorded_at <= _now
      ) AS b
      GROUP BY b.day, b.station_type, b.station_code, b.station_name, b.distance_km, b.is_primary
      ON CONFLICT (municipality_id, station_type, station_code, day) DO UPDATE SET
        station_name = EXCLUDED.station_name, distance_km = EXCLUDED.distance_km, is_primary = EXCLUDED.is_primary,
        readings_count = EXCLUDED.readings_count,
        first_recorded_at = EXCLUDED.first_recorded_at, last_recorded_at = EXCLUDED.last_recorded_at,
        rain_24h_max_mm = EXCLUDED.rain_24h_max_mm, rain_24h_max_at = EXCLUDED.rain_24h_max_at,
        rain_1h_max_mm = EXCLUDED.rain_1h_max_mm, rain_1h_max_at = EXCLUDED.rain_1h_max_at,
        bank_diff_min_m = EXCLUDED.bank_diff_min_m, bank_diff_min_at = EXCLUDED.bank_diff_min_at,
        waterlevel_max_msl = EXCLUDED.waterlevel_max_msl, waterlevel_max_at = EXCLUDED.waterlevel_max_at,
        waterlevel_min_msl = EXCLUDED.waterlevel_min_msl,
        dam_storage_last_mcm = EXCLUDED.dam_storage_last_mcm, dam_capacity_last_mcm = EXCLUDED.dam_capacity_last_mcm,
        dam_storage_percent_last = EXCLUDED.dam_storage_percent_last,
        updated_at = now()
      WHERE EXCLUDED.readings_count >= s.readings_count;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_written := v_written + v_rows;
    EXCEPTION WHEN OTHERS THEN
      -- อปท. หนึ่งพังไม่ลากรอบของ อปท. อื่นล้ม — บันทึกเหตุผลลงสมุดลงเวลา
      v_errors := v_errors || (t.slug || ': ' || SQLERRM);
    END;
  END LOOP;

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
    'checked', v_checked, 'written', v_written,
    'from_day', v_from_day, 'to_day', v_to_day,
    'errors', to_jsonb(v_errors));
END;
$$;

REVOKE ALL ON FUNCTION public.water_daily_summary_tick(timestamptz, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.water_daily_summary_tick(timestamptz, integer) IS
  'สรุปค่าที่วัดได้รายวัน (วันไทย) ของสถานีฝน/ระดับน้ำ/อ่างของทุก อปท. ที่เปิดโมดูลน้ำ-ฝน ลง water_daily_summary — ย้อน _days_back วัน (ค่าเริ่มต้น 2 สูงสุด 10) รันซ้ำได้ ไม่เขียนทับแถวที่ครบกว่า ไม่ลบแถว ค่าว่างไม่เป็น 0';

SELECT cron.unschedule('water-daily-summary-tick-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-daily-summary-tick-hourly');

SELECT cron.schedule(
  'water-daily-summary-tick-hourly',
  '30 * * * *',
  $cron$SELECT public.water_daily_summary_tick();$cron$
);

-- ย้อนเติมจากข้อมูลที่ water_readings ยังเก็บอยู่ตอน apply (ราว 7–8 วัน) — ก่อนที่ cleanup รอบถัดไปจะลบไป · รันซ้ำได้ ไม่เขียนทับแถวที่ครบกว่า
SELECT public.water_daily_summary_tick(now(), 8);

NOTIFY pgrst, 'reload schema';

COMMIT;
