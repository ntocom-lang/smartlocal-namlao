-- สถานการณ์น้ำ-ฝน — อ่างเก็บน้ำ เฟส 2/4: คอลัมน์ค่าของอ่างใน water_readings
--
-- หน่วยทั้งหมดเป็น "ล้าน ลบ.ม." ตามต้นทาง (dam_storage / normal_storage / dam_inflow / dam_released)
-- % ความจุใช้คอลัมน์ storage_percent เดิม — ต้นทางคิดเทียบ "ความจุที่ระดับเก็บกักปกติ (รนก.)"
-- ตรวจแล้วว่าตรงกัน: แม่คำปอง 5.99 ÷ 6.76 = 88.6% ต้นทางส่ง 88.55
--
-- ความจุเก็บไว้ต่อแถว ไม่ย้ายไปไว้ที่ config — ถ้ากรมชลประทานปรับความจุอ่าง ค่าใหม่ไหลตามมาเอง
-- ข้อมูลอ่างเป็นรายวัน: 1 วัน = 1 แถว (recorded_at = เที่ยงคืนของวันที่ในข้อมูล เวลาไทย)
-- รอบดึงรายชั่วโมงแค่ขยับ fetched_at ของแถววันนั้น ตัวเฝ้าระวังจึงใช้เกณฑ์ "พลาด 2 รอบ" เดิมได้
--
-- ไม่ใส่ CHECK ช่วงค่าโดยตั้งใจ เหตุผลเดียวกับ 20260918150100 (ค่าแปลกค่าเดียวทำทั้งรอบบันทึกไม่ได้)

DO $$
BEGIN
  IF to_regclass('public.water_readings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150100_water_readings_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

ALTER TABLE public.water_readings
  ADD COLUMN IF NOT EXISTS dam_storage_mcm  numeric,  -- ปริมาณน้ำในอ่างตอนนี้
  ADD COLUMN IF NOT EXISTS dam_capacity_mcm numeric,  -- ความจุที่ระดับเก็บกักปกติ (รนก.)
  ADD COLUMN IF NOT EXISTS dam_inflow_mcm   numeric,  -- น้ำไหลเข้าอ่างรายวัน
  ADD COLUMN IF NOT EXISTS dam_released_mcm numeric;  -- น้ำระบายออกรายวัน

COMMIT;
