-- 20261212100200_payment_account_alert_cron.sql
-- ขั้น 1C (E4) รับชำระเงิน PR2 ไฟล์ 3/3 — ตั้งงาน pg_cron เรียก Edge Function payment-account-alert
--   ทุก 15 นาที แต่ "ยิงเฉพาะตอนมีคิวถึงรอบ" — ปกติไม่มีการเปลี่ยนบัญชี = ไม่เรียกฟังก์ชันเลย ไม่กินโควตา
--   คิวเติมเองจาก trigger บน payment_events (ไฟล์ 2) — ไม่พึ่งหน้าเว็บ คนแอบเปลี่ยนบัญชีผ่าน RPC ตรงก็ถูกแจ้ง
--   ไม่สร้างตาราง/คอลัมน์ ไม่แตะ RLS/GRANT ของตาราง
--
-- ทำไม 15 นาที + ฟังก์ชันสั้น (ผลตรวจ M-5): cron.job_run_details เก็บข้อความคำสั่งทุกรอบ และรีโปยังไม่มีงานล้างตารางนี้
--   ทุก 5 นาที + คำสั่งยาว ≈ 70 MB/ปี บนฐานแผนฟรี 500 MB · ทุก 15 นาที + เรียกฟังก์ชันบรรทัดเดียว ≈ 96 แถว/วัน แถวละไม่กี่ร้อยไบต์
--   แจ้งช้าสุด ~15 นาทีหลังเปลี่ยนบัญชี — พอสำหรับกันแอบเปลี่ยนบัญชี (ใบแจ้งชำระที่พิมพ์ใหม่จะเห็นป้ายบนจอทันทีอยู่แล้ว)
--
-- ⚠️ apply ไฟล์นี้ "หลัง" deploy Edge Function payment-account-alert แล้วเท่านั้น (แบบ --no-verify-jwt จาก master หลัง merge)
--    ไม่งั้น cron ยิงไป 404 ทุกรอบที่มีคิว · ใช้ secret เดิม (vault 'fleet_cron_secret' = edge secret CRON_SECRET)
--    ระหว่างยังไม่ได้รันไฟล์นี้ คิวค้าง pending ไว้ ไม่หาย — รันแล้วรอบแรกส่งตามให้
-- ตรวจเมื่อไม่มีข้อความ: payment_account_alerts (status/attempts/last_error) → net._http_response (เก็บ ~6 ชม.)
-- ย้อนได้ด้วย: SELECT cron.unschedule('payment-account-alert'); DROP FUNCTION public.payment_alert_kick();

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.payment_account_alerts') IS NULL
     OR to_regprocedure('public.payment_alert_claim(integer)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261212100000 และ 20261212100100 ก่อน (ไม่พบคิวแจ้งเปลี่ยนบัญชี)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                 WHERE name = 'fleet_cron_secret' AND coalesce(length(decrypted_secret), 0) > 0) THEN
    RAISE EXCEPTION 'vault secret fleet_cron_secret ไม่มีหรือถอดค่าไม่ได้ — ฟังก์ชันจะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- เรียก Edge Function เมื่อมีคิวถึงรอบ (เงื่อนไขต้องตรงกับ payment_alert_claim) — คืน request id หรือ NULL ถ้าไม่มีคิว
-- ผู้ใช้เรียกไม่ได้ (อ่าน secret จาก vault) · cron รันในนามเจ้าของ
CREATE OR REPLACE FUNCTION public.payment_alert_kick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_account_alerts AS a
     WHERE a.status = 'pending'
        OR (a.status IN ('failed', 'sending') AND a.attempts < 6 AND a.claimed_at < now() - interval '10 minutes')
        OR (a.status = 'sending' AND a.attempts >= 6 AND a.claimed_at < now() - interval '10 minutes')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/payment-account-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fleet_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_alert_kick() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('payment-account-alert')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-account-alert');

SELECT cron.schedule('payment-account-alert', '*/15 * * * *', $$SELECT public.payment_alert_kick()$$);

DO $check$
BEGIN
  IF has_function_privilege('authenticated', 'public.payment_alert_kick()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.payment_alert_kick()', 'EXECUTE') THEN
    RAISE EXCEPTION 'payment_alert_kick เรียกจากบัญชีผู้ใช้ได้ — ห้าม (อ่าน secret จาก vault)';
  END IF;
END $check$;

COMMIT;
