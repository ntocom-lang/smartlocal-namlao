-- สถานการณ์น้ำ-ฝน · สรุปรายวัน (ฐานข้อมูลของอินโฟกราฟิก "สรุปสถานการณ์น้ำ–ฝน" วัน/สัปดาห์/เดือน/ปี) ไฟล์ 1/2 — ตาราง
-- (สิทธิ์/ฟังก์ชันสรุป/cron อยู่ 20261020150100)
--
-- ทำไมต้องเก็บ: water_readings ลบที่ 7 วัน (ยกเว้นอ่างในรัศมี 10 กม. ที่เก็บ 400 วัน) ฝนกับระดับน้ำจึงมีย้อนหลังแค่ 7 วัน
-- ทำสรุปรายเดือน/รายปีไม่ได้ และย้อนเก็บทีหลังไม่ได้ (ต้นทางส่งแต่ค่าล่าสุด) — ทุกวันที่ช้า = ข้อมูลที่หายไปตลอดกาล
-- เหตุผลเดียวกับตัวจดเหตุการณ์ (water_events) และประวัติค่าอ่าง (PR 5.1)
--
-- 1 แถว = 1 สถานี × 1 วัน (วันตามเวลาไทย) — เก็บ "ค่าสรุปของวัน" ไม่ใช่ค่ารายชั่วโมง (ประมาณ 10 สถานี × 365 วัน ≈ 3,650 แถวต่อปีต่อ อปท. ไม่ถึง 1 MB)
--
-- ⚠️ ฝนสะสม 24 ชม. (rain_24h_mm) ของต้นทางเป็นค่าที่ขึ้น–ลงเองตลอดวัน ไม่ใช่ตัวนับที่ไม่ลด (ตรวจจริง 2569-10-19:
-- STN0911 ในวันเดียว 3.5 → 2.5 → 2 → 1 → 2.5) จึงเก็บเฉพาะ "สูงสุดของวัน" ห้ามนำไปบวกรวมเป็น "ฝนรวมเดือน/ปี" (จะเกินจริง)
-- สรุปรายเดือน/ปีให้ใช้ "ค่าสูงสุดที่เคยพบ" และ "จำนวนวันที่ค่าสูงสุดถึงระดับที่กำหนด" เท่านั้น
--
-- ค่าว่างไม่ถูกแปลงเป็น 0 (วันที่สถานีส่งแต่ค่าว่าง = แถวมี readings_count แต่ช่องค่าเป็น NULL) · วันที่ไม่มีค่าเลยไม่มีแถว
-- ไม่เก็บชื่อ เบอร์ หรือพิกัดของบุคคลใดทั้งสิ้น (ค่าที่สถานีวัด + ชื่อสถานี + ระยะจากสำนักงาน)
-- ชื่อสถานี/ระยะ/is_primary เป็นสำเนา ณ รอบที่สรุปล่าสุด ไม่ผูก FK ไป water_station_config — ลบ/ปิดสถานีทีหลังแล้วสรุปเก่าไม่หาย
-- ไฟล์นี้สร้างของใหม่ล้วน apply ก่อน deploy ได้ปลอดภัย (ยังไม่มีโค้ดหน้าเว็บอ่านตารางนี้)

DO $$
BEGIN
  IF to_regclass('public.water_readings') IS NULL OR to_regclass('public.water_station_config') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150100_water_readings_table.sql (และตารางสถานี) ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'water_readings' AND column_name = 'dam_capacity_mcm'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260918180100_water_readings_dam_columns.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_daily_summary (
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- วันตามเวลาไทย (Asia/Bangkok) ของเวลาที่สถานีวัด — ค่าอ่างรายวันลงเที่ยงคืนไทย (= 17:00 UTC ของวันก่อน) นับเป็นวันนั้น
  day             date        NOT NULL,
  station_type    text        NOT NULL CHECK (station_type IN ('rain', 'waterlevel', 'dam')),
  station_code    text        NOT NULL,
  station_name    text        NOT NULL,
  distance_km     numeric,
  is_primary      boolean     NOT NULL DEFAULT false,
  -- จำนวนค่าที่วัดได้ในวันนั้น (ใช้บอกว่าวันนั้นข้อมูลครบแค่ไหน · วันที่ยังไม่จบจะค่อยๆ เพิ่มทุกชั่วโมง)
  readings_count  integer     NOT NULL CHECK (readings_count > 0),
  first_recorded_at timestamptz NOT NULL,
  last_recorded_at  timestamptz NOT NULL,
  -- สถานีฝน: สูงสุดของวัน (มม.) พร้อมเวลาที่พบ — ห้ามบวกรวมข้ามวัน (ดูหมายเหตุบนไฟล์)
  rain_24h_max_mm numeric,
  rain_24h_max_at timestamptz,
  rain_1h_max_mm  numeric,
  rain_1h_max_at  timestamptz,
  -- สถานีระดับน้ำ: ใกล้ตลิ่งที่สุดของวัน (ตลิ่งต่ำสุด − ระดับน้ำ: บวก = ต่ำกว่าตลิ่ง ลบ = ล้นตลิ่ง) + ระดับน้ำสูงสุด/ต่ำสุด (ม.รทก.)
  bank_diff_min_m numeric,
  bank_diff_min_at timestamptz,
  waterlevel_max_msl numeric,
  waterlevel_max_at  timestamptz,
  waterlevel_min_msl numeric,
  -- อ่างเก็บน้ำ: ค่าสุดท้ายที่ไม่ว่างของวัน (อ่างส่งรายวัน 1 วัน = 1 ค่า)
  dam_storage_last_mcm     numeric,
  dam_capacity_last_mcm    numeric,
  dam_storage_percent_last numeric,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipality_id, station_type, station_code, day)
);

-- ดึงเป็นช่วงวันของ อปท. หนึ่งแห่ง (สัปดาห์/เดือน/ปี)
CREATE INDEX IF NOT EXISTS water_daily_summary_muni_day_idx
  ON public.water_daily_summary (municipality_id, day DESC);

COMMENT ON TABLE public.water_daily_summary IS
  'สรุปรายวันของสถานีน้ำ-ฝน (1 แถว = 1 สถานี × 1 วันไทย) เขียนโดย water_daily_summary_tick เท่านั้น — เก็บข้ามการลบ 7 วันของ water_readings. ฝนสะสม 24 ชม. เป็นค่าที่ขึ้นลงเอง ห้ามบวกรวมข้ามวัน. ค่าว่างไม่เป็น 0';

COMMIT;
