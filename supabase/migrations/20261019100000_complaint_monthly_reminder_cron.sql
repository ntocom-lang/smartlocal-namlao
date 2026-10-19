-- 20261019100000_complaint_monthly_reminder_cron.sql
--
-- แจ้งเตือน Telegram วันที่ 1 ของทุกเดือน: "สรุปเรื่องร้องเรียนของเดือนที่แล้วพร้อมแล้ว" (เจ้าของระบบเลือก 2569-10-19)
-- ผู้รับ: กลุ่ม Telegram ของทุก อปท. ที่ตั้ง telegram_group_id ไว้และเปิดโมดูลเรื่องร้องเรียน
-- ข้อความมีแต่ยอดรวมกับลิงก์ไปหน้า /reports/complaints?m=YYYY-MM — เจ้าหน้าที่กดดาวน์โหลด/แชร์เอง ระบบไม่โพสต์ออกสาธารณะ
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function complaint-monthly-reminder แล้วเท่านั้น (แบบ --no-verify-jwt)
--    ไม่งั้น cron จะยิงไป 404 วันที่ 1 แล้วเงียบ (รอบเดือนละครั้ง กว่าจะรู้ก็เดือนถัดไป)
--    ใช้ secret เดิมของ fleet-doc-expiry-notify (vault 'fleet_cron_secret' = edge secret CRON_SECRET) ไม่ต้องสร้างใหม่
--
-- 01:30 UTC วันที่ 1 = 08:30 น. เวลาไทย (pg_cron ใน Supabase ใช้ UTC) ฟังก์ชันคำนวณ "เดือนที่แล้ว" ตามเวลาไทยเอง
-- ไม่มีตัวเฝ้าระวังรอบเดือน: ถ้าไม่มีข้อความเข้ากลุ่มวันที่ 1 ให้ดู notification_deliveries
--   (notification_type = 'complaint_monthly_summary') และ cron.job_run_details ของงาน 'complaint-monthly-reminder'
-- ย้อนได้ด้วย: SELECT cron.unschedule('complaint-monthly-reminder');

DO $$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง notification_deliveries (ใช้กันส่งซ้ำ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'fleet_cron_secret') THEN
    RAISE EXCEPTION 'ยังไม่มี vault secret fleet_cron_secret — ฟังก์ชันจะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('complaint-monthly-reminder')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'complaint-monthly-reminder');

SELECT cron.schedule(
  'complaint-monthly-reminder',
  '30 1 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/complaint-monthly-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fleet_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);
