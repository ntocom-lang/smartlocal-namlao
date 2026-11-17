-- 20261208100200_licence_expiry_notify_cron.sql
-- ขั้น 1B (E3) ทะเบียนใบอนุญาต ไฟล์ 3/3 — ตั้งงาน pg_cron เรียก Edge Function licence-expiry-notify (วันทำการ 08:40 น. เวลาไทย)
--   ระบบเตือนเอง "ตั้งค่าครั้งเดียว": ใบอนุญาตใกล้หมดอายุ / หนังสือรับรองการแจ้งใกล้ครบกำหนดค่าธรรมเนียมรายปี
--   ตามวันเตือนใน licence_settings.remind_days (ค่าเริ่มต้น 60/30/7/0 วัน) — ไปที่กลุ่ม Telegram ของ อปท. เป็น "ตัวเลข" เท่านั้น
--   ไม่มีชื่อผู้ประกอบการ/ชื่อร้าน (PDPA: ลบย้อนหลังจาก Telegram ไม่ได้) รายชื่ออยู่ในหน้าทะเบียนที่ตรวจสิทธิ์แล้ว
--   ส่งเฉพาะ อปท. ที่เปิดโมดูล 'licence-registry' ไว้ชัดเจน (โมดูลนี้ค่าเริ่มต้นปิด)
--   ยิงเฉพาะวันจันทร์–ศุกร์: หลักเตือนที่ตรงเสาร์-อาทิตย์ ฟังก์ชันจะส่งตามในวันทำการถัดไป (claim ต่อใบต่อหลัก ไม่หาย ไม่ซ้ำ)
--   ไม่สร้างตาราง/คอลัมน์ ไม่แตะ RLS/GRANT — ไฟล์นี้ตั้งงาน cron อย่างเดียว
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function licence-expiry-notify แล้วเท่านั้น (แบบ --no-verify-jwt จาก master หลัง merge)
--    ไม่งั้น cron ยิงไป 404 ทุกเช้าแบบเงียบๆ · ใช้ secret เดิม (vault 'fleet_cron_secret' = edge secret CRON_SECRET)
-- 01:40 UTC = 08:40 น. เวลาไทย — เว้นจาก fleet-doc-expiry-daily (08:00) และงานรายเดือน (08:30/08:45 วันที่ 1)
-- ตรวจเมื่อไม่มีข้อความ: job_heartbeats (job_name = 'licence-expiry-notify') → net._http_response (เก็บ ~6 ชม.)
--   → notification_deliveries (notification_type = 'licence_expiring') · cron.job_run_details ขึ้น succeeded เสมอ ใช้ยืนยันไม่ได้
-- ย้อนได้ด้วย: SELECT cron.unschedule('licence-expiry-notify');

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง notification_deliveries (ใช้กันส่งซ้ำ)';
  END IF;
  IF to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง job_heartbeats (ฟังก์ชันเขียนผลรอบเต็มลงที่นี่ให้ watchdog เฝ้า)';
  END IF;
  IF to_regclass('public.licences') IS NULL OR to_regclass('public.licence_settings') IS NULL
     OR to_regprocedure('public.licence_today()') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261208100000 และ 20261208100100 ก่อน (ไม่พบตารางทะเบียนใบอนุญาต)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                 WHERE name = 'fleet_cron_secret' AND coalesce(length(decrypted_secret), 0) > 0) THEN
    RAISE EXCEPTION 'vault secret fleet_cron_secret ไม่มีหรือถอดค่าไม่ได้ — ฟังก์ชันจะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('licence-expiry-notify')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'licence-expiry-notify');

SELECT cron.schedule(
  'licence-expiry-notify',
  '40 1 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/licence-expiry-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fleet_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

COMMIT;
