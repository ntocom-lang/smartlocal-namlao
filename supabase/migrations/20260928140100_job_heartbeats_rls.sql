-- สมุดลงเวลาของงานอัตโนมัติ เฟส 2/2: ปิดสิทธิ์
--
-- เขียน/อ่านได้เฉพาะ service_role (Edge Function) — ปิด anon/authenticated ทั้งหมดแบบเดียวกับ
-- water_readings / water_warnings: RLS เปิดโดยไม่มี policy + REVOKE (RLS ไม่กัน TRUNCATE)
-- ให้สิทธิ์ service_role แบบเขียนชัด ไม่พึ่งสิทธิ์ตั้งต้นของ schema

DO $$
BEGIN
  IF to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260928140000_job_heartbeats_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

REVOKE ALL ON public.job_heartbeats FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.job_heartbeats TO service_role;
ALTER TABLE public.job_heartbeats ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.job_heartbeats IS
  'สมุดลงเวลาของงานอัตโนมัติ: งานเขียนเวลาที่สำเร็จล่าสุดทุกรอบ thaiwater-watchdog อ่านเพื่อจับงานที่หยุดทำงานเงียบๆ';

COMMIT;
