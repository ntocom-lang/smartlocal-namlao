-- เฝ้าระวังระบบดึงข้อมูลน้ำ-ฝน — แจ้ง Telegram เมื่อรอบดึงพลาดติดกัน 2 รอบ
-- (เจ้าของระบบสั่ง 2569-09-18 ปลายทางคือกลุ่มของ tenant 'demo' เท่านั้น ดูเหตุผลในหัวไฟล์ index.ts)
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function thaiwater-watchdog แล้วเท่านั้น
--    (แบบ --no-verify-jwt เหมือน thaiwater-sync) ไม่งั้น cron จะยิงไป 404 ทุกชั่วโมงแบบเงียบๆ
--    ใช้ secret เดิม THAIWATER_CRON_SECRET / vault 'thaiwater_cron_secret' ไม่ต้องสร้างใหม่
--
-- นาทีที่ 25: ห่างจาก thaiwater-sync (นาทีที่ 10) 15 นาที เผื่อให้รอบดึงทำงานจบก่อนเสมอ
--   (รอบจริงใช้เวลาราว 4 วินาที เพดานของฟังก์ชันคือ 50 วินาที)
--   เกณฑ์ค้าง 125 นาทีในโค้ดสัมพันธ์กับตารางเวลานี้โดยตรง: พลาด 1 รอบ = อายุ 75 นาที
--   พลาด 2 รอบ = 135 นาที → ถ้าย้ายเวลา cron ต้องทบทวน STALE_MINUTES ด้วย
--
-- timeout 20 วินาที: งานนี้แค่ query ตารางเล็กแล้วยิง Telegram API ไม่ได้ดาวน์โหลดอะไรจากต้นทาง

DO $$
BEGIN
  IF to_regclass('public.water_readings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150100_water_readings_table.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'thaiwater_cron_secret') THEN
    RAISE EXCEPTION 'ยังไม่มี vault secret thaiwater_cron_secret — ตัวเฝ้าระวังจะได้ 401 ทุกรอบ';
  END IF;
  -- ต้องมีกลุ่มปลายทางจริง ไม่งั้นฟังก์ชันตอบ 500 ทุกชั่วโมงโดยไม่มีใครเห็น
  IF NOT EXISTS (
    SELECT 1 FROM public.municipalities WHERE slug = 'demo' AND telegram_group_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'tenant demo ยังไม่ได้ตั้ง telegram_group_id — ตั้งก่อนแล้วค่อย apply ไฟล์นี้';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('thaiwater-watchdog-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'thaiwater-watchdog-hourly');

SELECT cron.schedule(
  'thaiwater-watchdog-hourly',
  '25 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/thaiwater-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'thaiwater_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) AS request_id;
  $$
);
