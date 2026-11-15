-- พยากรณ์อากาศในพื้นที่จากกรมอุตุนิยมวิทยา (NWP) เฟส 1/3 — ตารางเก็บผลพยากรณ์ล่าสุดของแต่ละ อปท.
--
-- ที่มา: NWP API ของกรมอุตุนิยมวิทยา (data.tmd.go.th/nwpapi) — ฟรี ไม่มีค่าธรรมเนียม
--   (เอกสารบริการของกรม "ไม่มีค่าธรรมเนียมและค่าบริการ" ตรวจ 2569-11-15) ใช้ token ของ อปท.
--   ที่เจ้าของระบบสมัครไว้ (secret TMD_NWP_TOKEN ของ Edge Function)
-- ผู้เขียน: Edge Function tmd-sync ด้วย service_role เท่านั้น (pg_cron ทุก 3 ชม. · 20261126100200)
-- ผู้อ่าน: ทุกคนผ่าน get_public_tmd_forecast() (20261126100100) — ข้อมูลสาธารณะ ไม่มีข้อมูลส่วนบุคคล
--
-- 1 แถว = 1 อปท. เก็บเฉพาะชุดพยากรณ์ล่าสุด (เขียนทับทุกรอบ) ไม่เก็บประวัติ
--   พยากรณ์รายชั่วโมง 48 ชม. (โดเมน 2 กม.) + รายวัน 7 วัน (โดเมน 18/27 กม.) ตามเอกสารของกรม
--   เก็บเป็น jsonb ตามรูปที่ Edge Function กรองแล้ว (เวลา + ตัวเลข) ไม่ใช่คำตอบดิบของกรม
-- พิกัดที่ใช้ขอ = municipalities.latitude/longitude · grid_* = จุดกริดที่กรมใช้ตอบจริง (ปัดไปจุดใกล้สุด)
--
-- ไม่ใส่ CHECK โครงสร้าง jsonb โดยตั้งใจ (เหตุผลเดียวกับ water_readings): ค่าผิดรูปถูกกรองที่ Edge Function
-- ถ้ารอบใดดึงไม่สำเร็จ แถวเดิมคงอยู่ (หน้าเว็บบอกเวลาที่ดึงได้ล่าสุดเสมอ ไม่เอาค่าเก่ามาแสดงเป็นค่าใหม่)
--
-- ย้อนกลับ (หลังถอน cron 20261126100200 และ RPC 20261126100100 แล้ว): DROP TABLE IF EXISTS public.tmd_forecasts;
--   ข้อมูลเป็นแค่สำเนาพยากรณ์ ดึงใหม่ได้ภายใน 3 ชม. ไม่มีอะไรเสีย

BEGIN;

CREATE TABLE IF NOT EXISTS public.tmd_forecasts (
  municipality_id   uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- พิกัดที่ส่งไปขอกรมจริง (municipalities.latitude/longitude ปัดทศนิยม 4 ตำแหน่ง ≈ 11 ม. ณ ตอนดึง)
  -- อปท. ที่พิกัดปัดแล้วตรงกันใช้คำขอเดียวกัน
  request_lat       numeric NOT NULL,
  request_lon       numeric NOT NULL,
  -- จุดกริดที่กรมตอบกลับ (location.lat/lon ในคำตอบ) แยกรายชั่วโมง/รายวัน เพราะคนละโดเมน
  hourly_grid_lat   numeric,
  hourly_grid_lon   numeric,
  daily_grid_lat    numeric,
  daily_grid_lon    numeric,
  -- [{ "time": "<ISO +07:00>", "rain": mm/ชม., "tc": °C, "rh": %, "cond": 1–12 }]
  hourly            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "time": "<ISO +07:00>", "rain": mm/วัน, "tc_max": °C, "tc_min": °C, "cond": 1–12,
  --    "ws10m": ลมสูงสุด m/s, "wd10m": ทิศลม องศา }]
  daily             jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ครั้งล่าสุดที่ดึงแต่ละชุดได้สำเร็จ — ชุดหนึ่งล้มอีกชุดยังอัปเดตได้ เวลาจึงแยกกัน
  hourly_fetched_at timestamptz,
  daily_fetched_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tmd_forecasts IS
  'พยากรณ์อากาศ NWP ของกรมอุตุนิยมวิทยา ณ พิกัด อปท. (ชุดล่าสุด 1 แถว/อปท.) — เขียนโดย tmd-sync (service_role) อ่านผ่าน get_public_tmd_forecast()';

-- ===========================================================================
-- สิทธิ์ — ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon/authenticated ได้ ALL กับตารางใหม่
-- และ RLS ไม่กัน TRUNCATE จึงถอนเองทุกครั้ง (ดู 20260905200000) · เปิด RLS ไม่มี policy = อ่านตรงไม่ได้
-- ===========================================================================
REVOKE ALL ON public.tmd_forecasts FROM anon, authenticated, PUBLIC;
ALTER TABLE public.tmd_forecasts ENABLE ROW LEVEL SECURITY;

-- ด่านท้ายไฟล์: REVOKE ที่ grantor ไม่ตรงจะผ่านเงียบๆ แต่สิทธิ์ยังอยู่ — ให้ล้มทั้งไฟล์แทน
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tmd_forecasts'::regclass) THEN
    RAISE EXCEPTION 'tmd_forecast_table: RLS ไม่ได้เปิด';
  END IF;
  IF has_table_privilege('anon', 'public.tmd_forecasts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.tmd_forecasts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'tmd_forecast_table: anon/authenticated ยังมีสิทธิ์บนตาราง';
  END IF;
END;
$$;

COMMIT;
