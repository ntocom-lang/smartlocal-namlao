-- พยากรณ์อากาศในพื้นที่จากกรมอุตุนิยมวิทยา (NWP) เฟส 3/3 — ตั้งเวลาดึงทุก 3 ชั่วโมง
--
-- ⚠️ apply ไฟล์นี้ "หลัง" 2 อย่างเสร็จแล้วเท่านั้น (ไม่งั้น cron ยิงไปแล้วพังเงียบๆ ทุกรอบ):
--   1. deploy Edge Function tmd-sync แบบ --no-verify-jwt (cron ไม่มี JWT ส่งไป)
--   2. Edge Function secret TMD_NWP_TOKEN (token ของ อปท. จาก data.tmd.go.th/nwpapi — ตั้งแล้ว 2569-11-15)
-- ใช้ secret ของ cron ชุดเดิม THAIWATER_CRON_SECRET / vault 'thaiwater_cron_secret'
--   แบบเดียวกับ water-alert-notify / thaiwater-watchdog (งานดึงข้อมูลสาธารณะกลุ่มเดียวกัน
--   ถ้ารั่ว ทำได้แค่สั่งดึงพยากรณ์รอบเพิ่ม) ไม่ต้องสร้าง secret ใหม่
--
-- ทุก 3 ชม. นาทีที่ 20 (เยื้องจาก thaiwater-sync :10 · water-alert-notify :15 · watchdog :25)
--   water-event-tick-hourly ก็รันนาทีที่ 20 (20261016100100) แต่เป็น SQL ล้วน ไม่แย่งทรัพยากรกับการยิง HTTP นี้
-- ภาระต่อรอบ: อปท. ที่มีพิกัดไม่ซ้ำกัน × 2 คำขอ · datapoint ≈ (48 ชม. × 4 ค่า + 7 วัน × 6 ค่า) ต่อพิกัด
--   4 อปท. (3 พิกัด) ≈ 700 datapoint/รอบ — โควตาของกรม 100,000 datapoint/ชม. และ 60 คำขอ/นาที
--
-- timeout 60 วินาที: ฟังก์ชันยิงกรมทีละพิกัด (ตอบ ~0.5 วิ/คำขอ ตอนทดสอบ 2569-11-15)
--
-- ⚠️ apply แล้ว = กลุ่ม Telegram ของ อปท. ที่ตั้ง telegram_group_id + เปิดโมดูล water-situation
--   เริ่มได้ข้อความ "พยากรณ์ฝนหนัก" จริงเมื่อพยากรณ์ถึงเกณฑ์ (เจ้าของระบบอนุมัติ T2 ข้อ 4 แล้ว 2569-11-15)
--
-- ย้อนกลับ: SELECT cron.unschedule('tmd-sync-3h');

DO $$
BEGIN
  IF to_regclass('public.tmd_forecasts') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261126100000_tmd_forecast_table.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'thaiwater_cron_secret') THEN
    RAISE EXCEPTION 'ยังไม่มี vault secret thaiwater_cron_secret — ฟังก์ชันจะได้ 401 ทุกรอบ';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('tmd-sync-3h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tmd-sync-3h');

SELECT cron.schedule(
  'tmd-sync-3h',
  '20 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/tmd-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'thaiwater_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);
