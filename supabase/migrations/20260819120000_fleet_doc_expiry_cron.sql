-- Daily cron: sweep fleet_vehicles document expiry dates and trigger
-- the fleet-doc-expiry-notify edge function (Telegram alerts).
--
-- Auth design: the cron job calls the edge function with a narrow-purpose
-- secret in a custom header (x-cron-secret), NOT the service_role key.
-- A leaked CRON_SECRET can only trigger this one read-mostly sweep
-- function; it cannot authenticate arbitrary Postgres/PostgREST calls
-- the way a leaked service_role key could. The secret value itself is
-- set separately (see deployment note below) — this migration only
-- wires up the extensions, the vault lookup, and the schedule.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('fleet-doc-expiry-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-doc-expiry-daily');

-- 01:00 UTC = 08:00 น. เวลาไทย (Asia/Bangkok, UTC+7)
SELECT cron.schedule(
  'fleet-doc-expiry-daily',
  '0 1 * * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/fleet-doc-expiry-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'fleet_cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ต้อง set ค่าจริงแยกต่างหาก (ห้าม hardcode secret ลง migration ที่ commit ขึ้น git):
--   select vault.create_secret('<random-secret-value>', 'fleet_cron_secret');
-- และตั้งค่าเดียวกันเป็น edge function secret:
--   supabase secrets set CRON_SECRET=<random-secret-value>
