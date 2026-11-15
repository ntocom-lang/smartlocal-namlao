-- สถานีเตือนภัยน้ำหลาก-ดินถล่ม (ews) เฟส 2/1 — เก็บ "ชนิดเตือน + ค่าที่ทำให้เตือน" จากกรมทรัพยากรน้ำ
--
-- ที่มา (ตรวจ 2569-11-15 จาก ews.dwr.go.th/ews/web-service/stn action=LoadStation ทั้งประเทศ 2,275 สถานี
-- คู่กับ popup ใน ews.dwr.go.th/ews/assets/js/stations.js):
--   warning_type 'rain' | 'wl'  — หน้าเว็บกรมแสดงป้ายนี้ ("ปริมาณน้ำฝน"/"ระดับน้ำ") เฉพาะสถานะ 1–3
--     สถานะ 0/9 ก็มีค่า (2,051 สถานี) = ชนิดของการเตือนครั้งล่าสุด ไม่ใช่เหตุปัจจุบัน
--     ⇒ Edge Function เก็บเฉพาะตอนสถานะ 1–3 นอกนั้นเป็น null
--   rain12h — "ฝนสะสม 12 ชม." (มม.) · wl — "ระดับน้ำปัจจุบัน" (ม.) ไม่ใช่ ม.รทก. เทียบตลิ่งไม่ได้
--     สถานีชนิด RF ส่ง wl เป็น "0.00" ที่ไม่มีความหมาย ⇒ เก็บ wl เฉพาะสถานีชนิด wl
--   สถานีที่กำลังเตือน เวลาวัดเท่ากับ report_date ทุกสถานี (51/51) = แถวถูกแช่ ณ เวลาออกเตือน
--     ⇒ ตัวเลขในแถวเตือนคือค่า ณ ตอนที่ทำให้เตือน
--   เกณฑ์เตือนไม่อยู่ในข้อมูลและต่างกันรายสถานี (alert_min/alert_max หน้าเว็บกรมคอมเมนต์ทิ้ง) ⇒ ไม่เก็บ
--
-- ไม่ใส่ CHECK ตามแนวของตารางนี้ (20260918150100) — upsert เป็นก้อนเดียว ค่าแปลกค่าเดียวจะทำให้
-- ทั้งรอบบันทึกไม่ได้ ตัวกรองอยู่ที่ Edge Function (ชนิดเตือนรับเฉพาะ 'rain'/'wl')
-- ไม่ต้อง GRANT: ตารางนี้ REVOKE ALL จาก anon/authenticated (20260918150200) อ่านผ่าน RPC เท่านั้น
--
-- ⚠️ ลำดับ: รันไฟล์นี้ก่อน deploy thaiwater-sync ฉบับที่ส่งช่องใหม่ — ถ้า deploy ก่อน upsert ล้มทั้งรอบ
--    (ทุกสถานีของทุก อปท. ไม่ได้ค่าใหม่) · ฉบับเดิมของ Edge Function ใช้กับตารางที่มีช่องใหม่ได้ปกติ

BEGIN;

ALTER TABLE public.water_readings
  ADD COLUMN IF NOT EXISTS ews_warning_type text,     -- 'rain' | 'wl' เฉพาะสถานะ 1–3 ของสถานี ews
  ADD COLUMN IF NOT EXISTS ews_rain_12h_mm  numeric,  -- ฝนสะสม 12 ชม. ของสถานี ews (มม.)
  ADD COLUMN IF NOT EXISTS ews_waterlevel_m numeric;  -- ระดับน้ำของสถานี ews ชนิด wl (ม. ตามสถานี ไม่ใช่ ม.รทก.)

COMMENT ON COLUMN public.water_readings.ews_warning_type IS
  'สถานี ews: ชนิดเตือนตามกรมทรัพยากรน้ำ rain=ปริมาณน้ำฝน wl=ระดับน้ำ — มีค่าเฉพาะสถานะ 1–3';
COMMENT ON COLUMN public.water_readings.ews_rain_12h_mm IS
  'สถานี ews: ฝนสะสม 12 ชม. (มม.) — แถวที่เตือนคือค่า ณ เวลาออกเตือน';
COMMENT ON COLUMN public.water_readings.ews_waterlevel_m IS
  'สถานี ews ชนิด wl: ระดับน้ำปัจจุบัน (ม.) ตามสถานี ไม่ใช่ ม.รทก. เทียบตลิ่งไม่ได้';

COMMIT;

-- Edge Function เขียนผ่าน PostgREST — ให้ schema cache รู้จักคอลัมน์ใหม่ทันที (ไม่พึ่ง event trigger อย่างเดียว)
NOTIFY pgrst, 'reload schema';
