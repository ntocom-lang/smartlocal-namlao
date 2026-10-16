-- สถานการณ์น้ำ-ฝน เฟส 3 (เหตุการณ์จดเอง) PR 3.1 ไฟล์ 1/2 — ตารางเก็บเหตุการณ์ + ค่าที่วัดได้ช่วงเหตุการณ์
-- (สิทธิ์/ฟังก์ชันตรวจ-เปิด-ปิด/cron อยู่ 20261016100100)
--
-- ทำไมต้องเก็บ: water_readings กับ water_warnings ลบที่ 7 วัน (cleanup_old_water_readings) พอเหตุการณ์ผ่านไปหนึ่งสัปดาห์
-- ไม่เหลือบันทึกว่าน้ำขึ้นสูงสุดเท่าไร ขึ้นตอนไหน ใครเตือนอะไร — ย้อนเก็บทีหลังไม่ได้ ต้องเริ่มเก็บก่อนเกิดเหตุ
--
-- 1 แถวใน water_events = 1 ช่วงเวลาที่ระบบเห็นสัญญาณเตือนใกล้พื้นที่ (กฎเดียวกับแจ้งเตือน Telegram ยกเว้นอ่าง
-- เพราะอ่างอยู่ชั้น "น้ำมาก" ได้เป็นเดือนในฤดูฝน เหตุการณ์จะไม่ปิด) · ระบบเปิด/ปิดเองทั้งหมด ไม่มีคนกรอก
-- และทุกการเปิด/ปิดต้องบอกเหตุผลที่ตรวจย้อนได้ (open_reason / close_reason)
--
-- ค่าที่วัดได้เก็บ "สำเนา" พร้อมชื่อสถานีลงตารางนี้เอง ไม่ผูก FK ไป water_station_config:
-- ถ้าเจ้าหน้าที่ลบ/เปลี่ยนสถานีทีหลัง บันทึกของเหตุการณ์ที่ผ่านมาต้องไม่หาย (FK แบบ CASCADE จะลบตาม)
--
-- ไม่เก็บชื่อ เบอร์ หรือพิกัดของบุคคลใดทั้งสิ้น (ข้อมูลเป็นค่าที่สถานีวัดกับข้อความที่ สสน. ประกาศ)
-- ไฟล์นี้สร้างของใหม่ล้วน apply ก่อน deploy ได้ปลอดภัย (ยังไม่มีอะไรเขียนลงตารางจนกว่าไฟล์ 2 จะ apply)

DO $$
BEGIN
  IF to_regclass('public.water_readings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150100_water_readings_table.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'water_readings' AND column_name = 'dam_released_mcm'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260918180100_water_readings_dam_columns.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.water_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260919100200_water_warnings_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- เวลาที่ระบบเปิดเหตุการณ์ (เวลารอบตรวจ ไม่ใช่เวลาที่สถานีวัด — ดูเวลาวัดจริงใน open_reason)
  opened_at       timestamptz NOT NULL DEFAULT now(),
  -- สัญญาณล่าสุดที่ยังเข้าเกณฑ์ · เริ่มนับ "สงบ" เมื่อค่าสดไม่เข้าเกณฑ์รอบแรก (ล้างเมื่อเข้าเกณฑ์อีกหรือค่าขาด)
  last_hot_at     timestamptz NOT NULL DEFAULT now(),
  calm_since      timestamptz,
  -- รอบล่าสุดที่มีค่าสดพอตัดสินได้ (เข้าเกณฑ์หรือไม่เข้าเกณฑ์ก็ได้) — ไว้ปิดเหตุการณ์เมื่อค่าขายหาย
  last_fresh_at   timestamptz NOT NULL DEFAULT now(),
  -- ปิดแล้ว: ended_at = เวลาที่เห็นสัญญาณล่าสุด (calm) หรือเวลาที่เห็นค่าสดล่าสุด (data_lost/module_off)
  --          closed_at = เวลารอบตรวจที่ปิด · เปิดอยู่ = ทั้งสามคอลัมน์ว่างพร้อมกัน
  ended_at        timestamptz,
  closed_at       timestamptz,
  close_reason    text CHECK (close_reason IS NULL OR close_reason IN ('calm', 'data_lost', 'module_off')),
  -- {"rule_version":1,"triggers":[{"kind","station_code","station_name","value","recorded_at"}…]}
  -- เก็บว่า "สถานีไหน ค่าเท่าไร เมื่อไร" ที่ทำให้เปิด — คนตรวจย้อนได้ว่าระบบตัดสินจากอะไร
  open_reason     jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT water_events_closed_together CHECK (
    (closed_at IS NULL AND ended_at IS NULL AND close_reason IS NULL)
    OR (closed_at IS NOT NULL AND ended_at IS NOT NULL AND close_reason IS NOT NULL)
  )
);

-- อปท. หนึ่งมีเหตุการณ์เปิดค้างได้ทีละ 1 เรื่อง — รอบตรวจซ้อนกัน (สั่งมือระหว่าง cron) จะชนที่นี่ ไม่เปิดซ้ำ
CREATE UNIQUE INDEX IF NOT EXISTS water_events_one_open_idx
  ON public.water_events (municipality_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS water_events_muni_opened_idx
  ON public.water_events (municipality_id, opened_at DESC);

-- ค่าที่วัดได้ของทุกสถานีของ อปท. ช่วงเหตุการณ์ (รวมย้อนหลังก่อนเปิด 24 ชม. เห็นช่วงน้ำกำลังขึ้น)
CREATE TABLE IF NOT EXISTS public.water_event_readings (
  event_id        uuid        NOT NULL REFERENCES public.water_events(id) ON DELETE CASCADE,
  station_type    text        NOT NULL CHECK (station_type IN ('rain', 'waterlevel', 'dam', 'ews')),
  station_code    text        NOT NULL,
  station_name    text        NOT NULL,
  recorded_at     timestamptz NOT NULL,
  rain_24h_mm     numeric,
  rain_1h_mm      numeric,
  waterlevel_msl  numeric,
  bank_diff_m     numeric,
  storage_percent numeric,
  situation_level smallint,
  situation_text  text,
  dam_storage_mcm  numeric,
  dam_capacity_mcm numeric,
  dam_inflow_mcm   numeric,
  dam_released_mcm numeric,
  PRIMARY KEY (event_id, station_type, station_code, recorded_at)
);

-- ข้อความเตือนของ สสน. ที่ระบุอำเภอ+จังหวัดของ อปท. ช่วงเหตุการณ์ (ตามต้นฉบับ ไม่ตีความ ไม่ย่อ)
CREATE TABLE IF NOT EXISTS public.water_event_warnings (
  event_id     uuid        NOT NULL REFERENCES public.water_events(id) ON DELETE CASCADE,
  issued_at    timestamptz NOT NULL,
  message      text        NOT NULL,
  station_name text,
  tambon_name  text,
  PRIMARY KEY (event_id, issued_at, message)
);

COMMIT;
