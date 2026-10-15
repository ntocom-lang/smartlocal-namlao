-- สถานการณ์น้ำ-ฝนรายหมู่ (เฟส 1) ไฟล์ 2/3 — ตารางผูกหมู่กับสถานีวัด
-- (พิกัดหมู่อยู่ 20261015100000 · สิทธิ์/ข้อจำกัด/RPC อยู่ 20261015100200)
--
-- หนึ่งแถว = "สถานีนี้เป็นตัวแทนอ่านสถานการณ์ของหมู่นี้" เจ้าหน้าที่ตั้งครั้งเดียว ระบบไม่เดาให้เอง
-- (ระบบแนะนำสถานีที่ใกล้ แต่ "อยู่ลำน้ำเดียวกันไหม" ระบบรู้ไม่ได้ คนต้องกดยืนยัน)
--
-- อ้างสถานีด้วย (municipality_id, station_type, station_code) ไม่ใช่ uuid ของ water_station_config:
-- ตารางสถานีถอนสิทธิ์ anon/authenticated ทั้งหมด (20260918150200) หน้าตั้งค่าของเจ้าหน้าที่อ่านตรงไม่ได้
-- ต้องอ่านผ่าน get_public_water_situation() ซึ่งคืนรหัสสถานี ไม่คืน uuid
--   - FK ไป UNIQUE (municipality_id, station_type, station_code) ของ water_station_config
--     → ผูกสถานีของ อปท. อื่นไม่ได้ และสถานีที่ถูกลบออกจากระบบหายจากหมู่เองด้วย (ON DELETE CASCADE)
--   - FK ไป UNIQUE (municipality_id, moo_no) ของ waste_villages → ลดจำนวนหมู่ที่หน้าตารางเก็บขยะ
--     การผูกของหมู่ที่ถูกตัดหายตามไปด้วย (ตั้งใจ ไม่ให้เหลือการผูกลอย)
-- station_type ผูกได้ 3 ชนิด: ฝน · ระดับน้ำ · อ่าง (สถานีเตือนภัย 'ews' ติดมากับสถานีฝนรหัสเดียวกัน ไม่ผูกเดี่ยว)
--
-- ไฟล์นี้สร้างของใหม่ล้วน apply ก่อน deploy ได้ปลอดภัย

DO $$
BEGIN
  IF to_regclass('public.water_station_config') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150000_water_station_config_table.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waste_villages' AND column_name = 'longitude'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20261015100000_water_village_coords_columns.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_village_stations (
  municipality_id uuid        NOT NULL,
  moo_no          smallint    NOT NULL,
  station_type    text        NOT NULL CHECK (station_type IN ('rain', 'waterlevel', 'dam')),
  station_code    text        NOT NULL CHECK (char_length(btrim(station_code)) BETWEEN 1 AND 40),
  -- ใครผูก/เมื่อไร — ประทับจากฝั่งเซิร์ฟเวอร์ (trigger ในไฟล์ 3) เพื่อตรวจย้อนได้ว่าใครเลือกสถานีนี้ให้หมู่นี้
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipality_id, moo_no, station_type, station_code),
  FOREIGN KEY (municipality_id, moo_no)
    REFERENCES public.waste_villages (municipality_id, moo_no) ON DELETE CASCADE,
  FOREIGN KEY (municipality_id, station_type, station_code)
    REFERENCES public.water_station_config (municipality_id, station_type, station_code) ON DELETE CASCADE
);

-- ดัชนีสำหรับฝั่งสถานี: ตอนลบสถานีออกจาก config ฐานข้อมูลต้องหาแถวที่ผูกไว้เพื่อลบตาม
CREATE INDEX IF NOT EXISTS water_village_stations_station_idx
  ON public.water_village_stations (municipality_id, station_type, station_code);

COMMIT;
