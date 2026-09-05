-- แก้บั๊ก: ผู้ขับรถที่ถูกระบุบนใบขออนุญาต กดบันทึก "ออก/กลับ" ไม่ได้
--
-- เคสจริงที่ทุ่งแค้ว/น้ำเลา: แอดมินบันทึกคำขอแทนให้ผู้ใช้รถกองหนึ่ง และระบุผู้ขับรถ
-- อีกคนหนึ่ง โดยไม่ได้เลือก "กอง/หน่วยงาน" (department_id = NULL) พอผู้ขับกดสถานะ
-- "ออกรถ" แล้วไม่มีอะไรเกิดขึ้น ไม่มี error ใดๆ ให้เห็น
--
-- ต้นเหตุอยู่ที่ policy fleet_trips_update เดิม (20260816130000) ที่ให้สิทธิ์เขียน
-- ตาม "กอง" อย่างเดียว:
--     fleet_can_write_asset(...) AND department_id = (SELECT fdept_id FROM my_fleet())
-- ซึ่งพังได้ 2 ทาง
--   1. department_id เป็น NULL  → NULL = uuid ได้ผลเป็น NULL ไม่ใช่ true → ตกทุกครั้ง
--   2. ผู้ขับอยู่คนละกองกับกองที่ระบุบนใบ → ตกเช่นกัน แม้จะเป็นคนที่ถูกสั่งให้ขับรถคันนั้น
-- UPDATE ที่ถูก USING ปฏิเสธจะ "ไม่ตรงแถวใดเลย" ไม่ใช่ error ฝั่งแอปจึงเงียบสนิท
--
-- กติกาที่ระบบตั้งใจให้เป็นถูกเขียนไว้แล้วที่ trigger fleet_trip_guard
-- (20260903150000): สถานะ in_progress/completed ทำได้โดยผู้ขับ / ผู้บันทึกแทน /
-- ผู้ขอใช้รถ / manager  แต่ RLS ดักตกไปก่อน trigger ตัวนี้จึงไม่เคยได้ทำงานเลย
-- ไฟล์นี้จึงเปิดทางให้ "คนที่มีชื่ออยู่บนใบนั้น" ผ่าน RLS มาให้ trigger ตัดสินตามเดิม
--
-- ขอบเขตที่เปิดเพิ่ม: เฉพาะแถวที่ auth.uid() เป็น driver_id / requested_by /
-- created_by ของแถวนั้นเอง และต้องอยู่ใน อปท. เดียวกัน — ไม่ได้เปิดให้เห็นหรือแก้
-- ทริปของกองอื่นเป็นการทั่วไป ส่วนการอนุมัติ/ปฏิเสธ/ยกเลิก ยังถูก trigger กันไว้เหมือนเดิม
--
-- ไม่ต้อง backfill ข้อมูลเก่า — ใบที่ department_id เป็น NULL อยู่แล้วกลับมาใช้ได้ทันที

DROP POLICY IF EXISTS "fleet_trips_update" ON public.fleet_trips;

CREATE POLICY "fleet_trips_update" ON public.fleet_trips
  FOR UPDATE USING (
    public.fleet_is_manager(municipality_id)
    OR (
      municipality_id = (SELECT mun_id FROM public.my_fleet())
      AND auth.uid() IN (driver_id, requested_by, created_by)
    )
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
    )
  )
  WITH CHECK (
    public.fleet_is_manager(municipality_id)
    OR (
      municipality_id = (SELECT mun_id FROM public.my_fleet())
      AND auth.uid() IN (driver_id, requested_by, created_by)
    )
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
    )
  );
