-- สถานการณ์น้ำ-ฝน — สถานีเตือนภัยน้ำหลาก-ดินถล่ม เฟส 1/3: เปิดให้เก็บสถานีชนิด 'ews'
--
-- ข้อมูลมาจากระบบเตือนภัยล่วงหน้า น้ำหลาก-ดินถล่ม ของกรมทรัพยากรน้ำ (ews.dwr.go.th)
-- ใช้รหัสสถานีชุดเดียวกับ ThaiWater (STN....) — สถานีเตือนภัยในรัศมี 10 กม. ของทุก อปท. ที่เปิดใช้
-- เป็นสถานีฝนที่แสดงบนหน้าอยู่แล้วทั้งหมด (ตรวจ 2569-09-19) หน้าเว็บจึงติดป้ายสถานะลงบนแถวฝนเดิม
-- แถวชนิด ews มีไว้เก็บ "สถานะเตือนภัย" แยกจากค่าฝน เพราะมาจากคนละแหล่ง คนละเวลา
--
-- แยกไฟล์จาก seed (100100) ตามกติกาแยก DDL ตามเฟส

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
  CHECK (station_type IN ('rain', 'waterlevel', 'dam', 'ews'));

COMMIT;
