-- 20261111100000_local_plan_monthly_reminder_cron.sql
--
-- R1-C เมนูแผนพัฒนาท้องถิ่น: แจ้งเตือน Telegram วันที่ 1 ของทุกเดือน
--   "แผนการดำเนินงานปีงบนี้ยังมีรายการที่ถึงกำหนดแต่ยังไม่บันทึกผล N รายการ แยกกอง" (เจ้าของระบบอนุมัติ 2569-11-09)
-- ผู้รับ: กลุ่ม Telegram ของทุก อปท. ที่ตั้ง telegram_group_id ไว้และมีแผนการดำเนินงานฉบับประกาศของปีงบนั้น
-- ไม่มีรายการค้าง = ไม่ส่ง · ไม่สร้างตาราง/คอลัมน์ใหม่ ไม่แตะ RLS/GRANT — ไฟล์นี้ตั้งงาน cron อย่างเดียว
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function local-plan-monthly-reminder แล้วเท่านั้น (แบบ --no-verify-jwt)
--    ไม่งั้น cron จะยิงไป 404 วันที่ 1 แล้วเงียบ (รอบเดือนละครั้ง กว่าจะรู้ก็เดือนถัดไป)
--    ใช้ secret เดิมของ fleet-doc-expiry-notify (vault 'fleet_cron_secret' = edge secret CRON_SECRET) ไม่ต้องสร้างใหม่
--
-- 01:45 UTC วันที่ 1 = 08:45 น. เวลาไทย (pg_cron ใน Supabase ใช้ UTC) — เว้น 15 นาทีจาก complaint-monthly-reminder (08:30)
-- ไม่ให้สองงานยิงข้อความเข้ากลุ่มเดียวกันพร้อมกัน · ฟังก์ชันคำนวณ "เดือนที่เพิ่งจบ" ตามเวลาไทยเอง
-- ไม่มีข้อความเข้ากลุ่มวันที่ 1 ให้ไล่ตามลำดับ:
--   1) job_heartbeats WHERE job_name = 'local-plan-monthly-reminder' — last_error ของรอบล่าสุด (ฟังก์ชันเขียนเองทุกรอบเต็ม)
--   2) net._http_response ของคำขอเช้าวันที่ 1 — ⚠️ pg_net เก็บไว้แค่ ~6 ชม. ต้องดูภายในเช้าวันนั้น
--      (404 = ยังไม่ deploy · 401 ที่พูดถึง JWT = ลืม --no-verify-jwt · 401 unauthorized = secret ไม่ตรง)
--   3) notification_deliveries (notification_type = 'local_plan_monthly_due') — ไม่มีแถวเลยอาจแปลว่าไม่มีรายการค้าง
--   ⚠️ cron.job_run_details ขึ้น succeeded เสมอแม้ฟังก์ชันตอบ 401/404/500 (มันบันทึกแค่ว่าส่งคำขอเข้าคิวได้) ใช้ยืนยันไม่ได้
--   ยังไม่อยู่ในรายการเฝ้าของ thaiwater-watchdog (รอบเดือนละครั้ง ต้องตั้งเกณฑ์แยก — งานถัดไป)
-- ย้อนได้ด้วย: SELECT cron.unschedule('local-plan-monthly-reminder');

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.notification_deliveries') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง notification_deliveries (ใช้กันส่งซ้ำ)';
  END IF;
  IF to_regclass('public.local_op_item_progress') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง local_op_item_progress — ต้องรัน migration R1-A (20261110100000–20261110100200) ก่อน';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'civil_projects' AND column_name = 'registry_ref') THEN
    RAISE EXCEPTION 'ไม่พบคอลัมน์ civil_projects.registry_ref — ฟังก์ชันอ่านคอลัมน์นี้ จะ error ทุก อปท.';
  END IF;
  -- ตรวจว่าถอดค่าได้จริง ไม่ใช่แค่มีชื่อ (ไม่แสดงค่า)
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                 WHERE name = 'fleet_cron_secret' AND coalesce(length(decrypted_secret), 0) > 0) THEN
    RAISE EXCEPTION 'vault secret fleet_cron_secret ไม่มีหรือถอดค่าไม่ได้ — ฟังก์ชันจะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('local-plan-monthly-reminder')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'local-plan-monthly-reminder');

SELECT cron.schedule(
  'local-plan-monthly-reminder',
  '45 1 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/local-plan-monthly-reminder',
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
