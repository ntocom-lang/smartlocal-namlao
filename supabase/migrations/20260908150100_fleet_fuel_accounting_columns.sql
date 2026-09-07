-- เฟส 2/3 — เพิ่มคอลัมน์บัญชี/งบประมาณให้บันทึกการเติมเชื้อเพลิง (DDL อย่างเดียว)
-- ต้องรัน 20260908150000_fleet_vendors_table.sql ก่อน เพราะอ้าง fleet_vendors เป็น FK
-- ตัวบังคับข้ามสังกัดอยู่ในไฟล์ถัดไป (20260908150200) ห้ามอ้างคอลัมน์ใหม่ในไฟล์นี้
--
-- ที่มาแต่ละช่อง
--   department_id      งบน้ำมันใน fleet_budgets ตั้งเป็น "รายกองรายเดือน" แต่บันทึกการเติม
--                      ไม่เคยมีกองเลย จึงตัดงบไม่ได้ และรถส่วนกลาง (is_pool) ก็เดาจากตัวรถไม่ได้
--   vendor_id          คู่สัญญาตามใบกำกับภาษี แทนการพิมพ์ชื่อแบรนด์ลง fuel_station
--   amount_before_vat  มูลค่าสินค้าก่อน VAT (ใบกำกับภาษีแยกบรรทัดไว้ เช่น 1,401.87)
--   vat_amount         ภาษีมูลค่าเพิ่ม (เช่น 98.13) — total_cost ยังเป็นยอดรวมเหมือนเดิม

ALTER TABLE public.fleet_fuel_records
  ADD COLUMN IF NOT EXISTS department_id     uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS vendor_id         uuid REFERENCES public.fleet_vendors(id),
  ADD COLUMN IF NOT EXISTS amount_before_vat numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_amount        numeric(12,2);

COMMENT ON COLUMN public.fleet_fuel_records.department_id IS
  'กอง/หน่วยงานที่รับภาระค่าใช้จ่าย ใช้ตัดงบประมาณใน fleet_budgets — รายการเก่าก่อน 2569-09-08 เป็น NULL';
COMMENT ON COLUMN public.fleet_fuel_records.vendor_id IS
  'ผู้ขายตามทะเบียน fleet_vendors — fuel_station คงไว้เป็นข้อความอิสระของข้อมูลเดิม';
COMMENT ON COLUMN public.fleet_fuel_records.amount_before_vat IS 'มูลค่าสินค้าก่อนภาษีมูลค่าเพิ่ม ตามใบกำกับภาษี';
COMMENT ON COLUMN public.fleet_fuel_records.vat_amount IS 'ภาษีมูลค่าเพิ่มตามใบกำกับภาษี';

ALTER TABLE public.fleet_fuel_records
  DROP CONSTRAINT IF EXISTS fleet_fuel_amount_before_vat_check;
ALTER TABLE public.fleet_fuel_records
  ADD CONSTRAINT fleet_fuel_amount_before_vat_check
  CHECK (amount_before_vat IS NULL OR amount_before_vat >= 0) NOT VALID;

ALTER TABLE public.fleet_fuel_records
  DROP CONSTRAINT IF EXISTS fleet_fuel_vat_amount_check;
ALTER TABLE public.fleet_fuel_records
  ADD CONSTRAINT fleet_fuel_vat_amount_check
  CHECK (vat_amount IS NULL OR vat_amount >= 0) NOT VALID;

-- ⚠️ เคยมี fleet_fuel_vat_sum_check บังคับให้ amount_before_vat + vat_amount = total_cost
-- ถอดออกแล้ว (ดู 20260908150300) เพราะ total_cost เป็นคอลัมน์ GENERATED = round(liters*price,2)
-- ซึ่งเป็นยอดคำนวณย้อน ไม่ใช่ยอดที่จ่ายจริง ปั๊มมักเติมเป็นยอดเงินกลม เคสจริง
-- 42.13 ล. x 35.60 = 1,499.83 แต่ใบกำกับภาษีออก 1,500.00 ห้ามผูกสองยอดนี้เข้าหากันอีก

CREATE INDEX IF NOT EXISTS fleet_fuel_records_department_idx
  ON public.fleet_fuel_records (municipality_id, department_id, filled_at);
