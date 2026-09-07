-- ถอด fleet_fuel_vat_sum_check ออก — ผูก amount_before_vat + vat_amount เข้ากับ total_cost ไม่ได้
--
-- total_cost เป็นคอลัมน์ GENERATED ALWAYS = round(liters * price_per_liter, 2) ซึ่งเป็นยอด
-- "คำนวณย้อนจากลิตรกับราคาต่อลิตร" ส่วนยอดในใบกำกับภาษีคือยอดที่จ่ายจริง ปั๊มมักเติมเป็น
-- ยอดเงินกลม (เคสจริง: 42.13 ล. x 35.60 = 1,499.83 แต่ใบกำกับภาษีออก 1,500.00 = ต่าง 0.17)
-- เกณฑ์ 0.05 บาทเดิมจึงปฏิเสธข้อมูลจริง ปล่อยให้ทั้งสองยอดต่างกันได้ตามธรรมชาติของเอกสาร
ALTER TABLE public.fleet_fuel_records
  DROP CONSTRAINT IF EXISTS fleet_fuel_vat_sum_check;
