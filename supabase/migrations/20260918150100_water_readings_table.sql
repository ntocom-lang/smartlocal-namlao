-- สถานการณ์น้ำ-ฝน เฟส 2/6 — ค่าที่วัดได้จากแต่ละสถานี
--
-- 1 แถว = 1 ค่าที่สถานีวัด (station_config_id + recorded_at ไม่ซ้ำ) — Edge Function ดึงทุกชั่วโมง
-- ถ้าสถานียังไม่ส่งค่าใหม่ จะ upsert ทับแถวเดิมแค่ขยับ fetched_at ไม่ได้เพิ่มแถว
-- เก็บย้อนหลัง 7 วัน (ลบเองทุกคืนด้วย cleanup_old_water_readings ใน 20260918150200)
-- ใช้ทำ 2 อย่าง: ดูแนวโน้มน้ำขึ้น-ลง และแสดงค่าล่าสุดต่อไปได้ตอนต้นทางล่ม
--
-- ไม่ใส่ CHECK จำกัดช่วงค่าตัวเลขหรือข้อความจากต้นทางโดยตั้งใจ — upsert เป็นก้อนเดียว
-- ค่าแปลกค่าเดียวจะทำให้ทั้งรอบบันทึกไม่ได้ ตัวกรองค่าผิดรูปอยู่ที่ Edge Function แทน

DO $$
BEGIN
  IF to_regclass('public.water_station_config') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150000_water_station_config_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_readings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_config_id uuid NOT NULL REFERENCES public.water_station_config(id) ON DELETE CASCADE,
  -- เวลาที่สถานีวัด (ต้นทางส่งเป็นเวลาไทยไม่มี offset — Edge Function แปลงเป็น timestamptz ให้แล้ว)
  recorded_at       timestamptz NOT NULL,
  -- ครั้งล่าสุดที่ระบบดึงแล้วเห็นค่านี้ — ใช้บอกว่าระบบยังดึงข้อมูลได้อยู่หรือไม่
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  -- สถานีฝน
  rain_24h_mm       numeric,
  rain_1h_mm        numeric,
  -- สถานีระดับน้ำ
  waterlevel_msl    numeric,          -- ระดับน้ำ (ม.รทก.)
  bank_diff_m       numeric,          -- ตลิ่งต่ำสุด − ระดับน้ำ: บวก = ต่ำกว่าตลิ่ง, ลบ = ล้นตลิ่ง
  storage_percent   numeric,          -- % ความจุลำน้ำ ตามที่ต้นทางคำนวณ
  -- ระดับสถานการณ์ + ป้าย + สี ตามเกณฑ์ที่ต้นทางส่งมาในคำตอบเดียวกัน (scale ของ ThaiWater)
  -- เก็บข้อความของต้นทางตรงๆ ไม่แปลความเอง — ระบบไม่ใช่ผู้ประเมินสถานการณ์น้ำ
  situation_level   smallint,
  situation_text    text,
  situation_color   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_config_id, recorded_at)
);

COMMIT;
