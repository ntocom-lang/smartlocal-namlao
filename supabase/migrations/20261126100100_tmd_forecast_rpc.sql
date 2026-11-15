-- พยากรณ์อากาศในพื้นที่จากกรมอุตุนิยมวิทยา (NWP) เฟส 2/3 — RPC ฝั่งประชาชน
-- (ตารางสร้างใน 20261126100000 ไฟล์นี้จึงอ้างถึงได้)
--
-- เจ้าของระบบเลือก 2569-11-15: "เห็นได้ทุกคน แต่อ้างอิงแหล่งข้อมูลด้วย" — เปิดให้ anon อ่านได้
-- ข้อความอ้างอิงแหล่งข้อมูลอยู่ที่หน้าเว็บ (การ์ดพยากรณ์) ไม่ได้อยู่ใน RPC
--
-- บังคับระบุ อปท. เสมอ (เหตุผลเดียวกับ get_public_water_situation): ส่ง NULL ได้ NULL
-- อปท. ที่ปิดใช้งาน หรือยังไม่เคยดึงได้ = NULL (หน้าเว็บไม่แสดงการ์ด)
-- ไม่กรองข้อมูลเก่าที่นี่ — หน้าเว็บตัดชั่วโมงที่ผ่านไปแล้วเอง และบอกอายุจาก *_fetched_at
--
-- ย้อนกลับ (หลังถอน cron 20261126100200 แล้ว): DROP FUNCTION IF EXISTS public.get_public_tmd_forecast(uuid);

DO $$
BEGIN
  IF to_regclass('public.tmd_forecasts') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261126100000_tmd_forecast_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_tmd_forecast(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'hourly', f.hourly,
    'daily', f.daily,
    'hourly_fetched_at', f.hourly_fetched_at,
    'daily_fetched_at', f.daily_fetched_at,
    'hourly_grid', CASE WHEN f.hourly_grid_lat IS NULL THEN NULL
                        ELSE jsonb_build_object('lat', f.hourly_grid_lat, 'lon', f.hourly_grid_lon) END,
    'daily_grid', CASE WHEN f.daily_grid_lat IS NULL THEN NULL
                       ELSE jsonb_build_object('lat', f.daily_grid_lat, 'lon', f.daily_grid_lon) END
  )
  FROM public.tmd_forecasts AS f
  JOIN public.municipalities AS m ON m.id = f.municipality_id
  WHERE f.municipality_id = _municipality_id
    AND m.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_tmd_forecast(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tmd_forecast(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_tmd_forecast(uuid) IS
  'พยากรณ์อากาศ NWP ของกรมอุตุนิยมวิทยา ณ พิกัด อปท. — บังคับระบุ อปท. ส่ง NULL ได้ NULL. tmd-sync ดึงทุก 3 ชม.';

-- ให้ PostgREST เห็นฟังก์ชันใหม่ทันที (แบบเดียวกับ 20260918150200) ไม่งั้น anon ได้ PGRST202 จนกว่าจะ reload
NOTIFY pgrst, 'reload schema';

COMMIT;
