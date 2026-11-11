-- 20261118100200_exec_digest_cron.sql
--
-- ห้องผู้บริหาร เฟส E3-3 — ไฟล์ 3/3: ตั้งงาน cron 2 งาน (ไม่สร้างตาราง/ฟังก์ชัน ไม่แตะ RLS/GRANT)
--   exec-morning-digest    07:30 น. จันทร์–ศุกร์ เวลาไทย → สรุปเช้าถึงผู้บริหาร (วันหยุดราชการ Edge Function ข้ามเอง)
--   exec-low-rating-alert  ทุก 30 นาที 08:00–17:30 น. จันทร์–ศุกร์ → คะแนนคำร้อง ≤ 2 ที่ยังไม่ได้แจ้ง
--     นอกเวลา/วันหยุดไม่ปลุกผู้บริหาร — คะแนนที่เข้ามาช่วงนั้นถูกแจ้งรอบแรกของวันทำการถัดไป
--     (exec_low_ratings_pending ย้อน 7 วัน + กันส่งซ้ำรายคนรายคะแนนที่ notification_deliveries)
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function exec-digest-notify แล้วเท่านั้น (แบบ --no-verify-jwt)
--    ไม่งั้น cron ยิงไป 404 ทุกเช้าแล้วเงียบ · ใช้ secret เดิม (vault 'fleet_cron_secret' = edge secret CRON_SECRET)
--
-- pg_cron ใน Supabase ใช้ UTC: 00:30 UTC = 07:30 ไทย · 01:00–10:30 UTC = 08:00–17:30 ไทย
-- ไม่มีข้อความเช้าวันทำการ ให้ไล่ตามลำดับ:
--   1) job_heartbeats WHERE job_name IN ('exec-digest-notify', 'exec-low-rating-alert') — last_error รอบล่าสุด
--   2) net._http_response ของคำขอเช้านั้น — ⚠️ pg_net เก็บแค่ ~6 ชม.
--      (404 = ยังไม่ deploy · 401 พูดถึง JWT = ลืม --no-verify-jwt · 401 unauthorized = secret ไม่ตรง)
--   3) notification_deliveries WHERE notification_type IN ('exec_digest', 'exec_low_rating')
--   ⚠️ cron.job_run_details ขึ้น succeeded เสมอแม้ฟังก์ชันตอบ 401/404/500 ใช้ยืนยันไม่ได้
-- ย้อนกลับ: SELECT cron.unschedule('exec-morning-digest'); SELECT cron.unschedule('exec-low-rating-alert');

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.exec_digest_for(uuid,uuid)') IS NULL
     OR to_regprocedure('public.exec_low_ratings_pending(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'exec_digest_cron: ต้อง apply 20261118100100_exec_digest_functions.sql ก่อน';
  END IF;
  IF to_regclass('public.notification_deliveries') IS NULL OR to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'exec_digest_cron: ไม่พบ notification_deliveries / job_heartbeats';
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

SELECT cron.unschedule('exec-morning-digest')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'exec-morning-digest');
SELECT cron.unschedule('exec-low-rating-alert')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'exec-low-rating-alert');

SELECT cron.schedule(
  'exec-morning-digest',
  '30 0 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/exec-digest-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fleet_cron_secret')
    ),
    body := '{"mode":"digest"}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'exec-low-rating-alert',
  '0,30 1-10 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/exec-digest-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fleet_cron_secret')
    ),
    body := '{"mode":"low_rating"}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

COMMIT;
