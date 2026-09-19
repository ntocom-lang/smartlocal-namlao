-- สถานการณ์น้ำ-ฝน — ข้อความเตือนของ สสน. เฟส 3/3: ตั้งเวลาส่ง Telegram แจ้งเตือน อปท.
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function water-alert-notify แล้วเท่านั้น
--    (แบบ --no-verify-jwt เหมือน thaiwater-sync) ไม่งั้น cron จะยิงไป 404 ทุกชั่วโมงแบบเงียบๆ
--    ใช้ secret เดิม THAIWATER_CRON_SECRET / vault 'thaiwater_cron_secret' ไม่ต้องสร้างใหม่
--
-- นาทีที่ 15: หลังรอบดึงข้อมูล (นาทีที่ 10) ซึ่งใช้เวลาราว 2–5 วินาที · ก่อนตัวเฝ้าระวัง (นาทีที่ 25)
-- ฟังก์ชันอ่านจากฐานข้อมูลเราเท่านั้น ไม่ยิงไปต้นทางซ้ำ — timeout 20 วินาทีพอ
--
-- แจ้งเมื่อ (เจ้าของระบบเลือก 2569-09-19): สถานีฝนในรัศมีวัดได้ฝนหนักมาก ≥ 90.1 มม./24 ชม.
-- (เกณฑ์กรมอุตุฯ) · ข้อความเตือนของ สสน. ในอำเภอเดียวกับ อปท. · สถานีเตือนภัยของกรมทรัพยากรน้ำ
-- (ปิดไว้จนกว่าจะดึงได้ ดู 20260919100150)
-- ผู้รับ: กลุ่ม Telegram ของทุก อปท. ที่ตั้ง telegram_group_id ไว้และเปิดโมดูล water-situation

DO $$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง notification_deliveries (ใช้กันส่งซ้ำ)';
  END IF;
  IF to_regclass('public.water_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260919100200_water_warnings_table.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'thaiwater_cron_secret') THEN
    RAISE EXCEPTION 'ยังไม่มี vault secret thaiwater_cron_secret — ฟังก์ชันจะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('water-alert-notify-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-alert-notify-hourly');

SELECT cron.schedule(
  'water-alert-notify-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/water-alert-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'thaiwater_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) AS request_id;
  $$
);
