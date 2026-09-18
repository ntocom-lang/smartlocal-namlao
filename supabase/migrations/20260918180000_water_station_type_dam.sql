-- สถานการณ์น้ำ-ฝน — อ่างเก็บน้ำ เฟส 1/4: เปิดให้ water_station_config เก็บสถานีชนิด 'dam'
--
-- ข้อมูลอ่างเก็บน้ำขนาดกลางมาจาก ThaiWater endpoint thaiwater30/analyst/dam (API ตัวเดียวกับฝน/ระดับน้ำ
-- ไม่ต้องใช้ key) ตัวชี้สถานีคือ dam.id ของต้นทาง (ไม่มี tele_station_oldcode เหมือนสถานีโทรมาตร)
--
-- ⚠️ ห้ามใช้ API ของหน้าแผนที่ใหม่ (twa-api-public.thaiwater.net) แทน — ต้องแนบ x-api-key ที่ สสน. ฝังไว้
--    ในเว็บตัวเอง การเอากุญแจนั้นมาใช้ไม่ใช่การเรียก API สาธารณะ (ตรวจ 2569-09-18)
--
-- แยกไฟล์จากการเพิ่มคอลัมน์ (180100) และ seed (180300) ตามกติกาแยก DDL ตามเฟส

DO $$
BEGIN
  IF to_regclass('public.water_station_config') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150000_water_station_config_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

ALTER TABLE public.water_station_config
  DROP CONSTRAINT IF EXISTS water_station_config_station_type_check;

ALTER TABLE public.water_station_config
  ADD CONSTRAINT water_station_config_station_type_check
  CHECK (station_type IN ('rain', 'waterlevel', 'dam'));

COMMIT;
