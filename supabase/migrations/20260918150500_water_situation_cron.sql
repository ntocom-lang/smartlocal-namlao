-- สถานการณ์น้ำ-ฝน เฟส 6/6 — ตั้งเวลาดึงข้อมูลทุกชั่วโมง + ลบข้อมูลเก่าทุกคืน
--
-- ⚠️ apply ไฟล์นี้ "หลัง" 2 อย่างเสร็จแล้วเท่านั้น (ไม่งั้น cron ยิงไปแล้วพังทุกชั่วโมง):
--   1. deploy Edge Function thaiwater-sync (verify_jwt = false — cron ไม่มี JWT ส่งไป)
--   2. สร้าง secret คู่กันทั้ง 2 ที่ ด้วยค่าเดียวกัน (ห้ามใส่ค่าจริงลงไฟล์นี้หรือ git):
--        select vault.create_secret('<ค่าสุ่ม>', 'thaiwater_cron_secret');
--        npx supabase secrets set THAIWATER_CRON_SECRET=<ค่าเดียวกัน> --project-ref <ref>
--      ตั้งใจแยกจาก CRON_SECRET ของ fleet-doc-expiry-notify — secret ของ Edge Function เป็นค่ากลาง
--      ทั้งโปรเจกต์ ถ้าใช้ชื่อเดียวกัน หมุนค่าฝั่งหนึ่งจะทำอีกฝั่งพังเงียบๆ
--
-- ออกแบบสิทธิ์เหมือน 20260819120000_fleet_doc_expiry_cron.sql: ส่ง secret เฉพาะกิจทาง header
-- x-cron-secret ไม่ใช้ service_role key — ถ้ารั่ว ทำได้แค่สั่งดึงข้อมูลสาธารณะรอบเพิ่ม
--
-- timeout 60 วินาที: ค่าเริ่มต้นของ pg_net คือ 5 วินาที แต่ฟังก์ชันต้องดาวน์โหลดข้อมูลทั้งประเทศ
-- 2 ก้อน (~6.6 MB) จากต้นทาง — เพดานของ Edge Function เองคือ 150 วินาที (free plan)
--
-- หมายเหตุการตรวจผล: net.http_post แค่ "เข้าคิว" คำขอ cron.job_run_details จึงขึ้น succeeded
-- เสมอแม้ต้นทางล่ม ผลจริงดูที่ net._http_response หรือ water_readings.fetched_at

DO $$
BEGIN
  IF to_regprocedure('public.cleanup_old_water_readings()') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150200_water_situation_rls_rpc.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'thaiwater_cron_secret') THEN
    RAISE EXCEPTION 'ยังไม่มี vault secret thaiwater_cron_secret — สร้างก่อน (ดูหัวไฟล์) ไม่งั้น cron จะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('thaiwater-sync-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'thaiwater-sync-hourly');

-- นาทีที่ 10 ของทุกชั่วโมง (เยื้องจาก device-login-cleanup ที่นาทีที่ 5)
SELECT cron.schedule(
  'thaiwater-sync-hourly',
  '10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/thaiwater-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'thaiwater_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

SELECT cron.unschedule('water-readings-cleanup-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-readings-cleanup-daily');

-- 18:45 UTC = 01:45 น. เวลาไทย
SELECT cron.schedule(
  'water-readings-cleanup-daily',
  '45 18 * * *',
  $$ SELECT public.cleanup_old_water_readings(); $$
);
