-- เฟส 1/2 ของการกันคิวรถให้ครอบคลุมเหตุการณ์จริง — เพิ่มคอลัมน์อย่างเดียว
-- (ฟังก์ชันที่อ้างคอลัมน์นี้อยู่ใน 20260913150100 แยกไฟล์ตามกติกา ADD COLUMN แล้วอ้างในไฟล์เดียวกัน = 42703)
--
-- เหตุผลที่คำขอไม่ได้รับการอนุมัติคิวอัตโนมัติ — ผู้ดูแลต้องรู้ว่าจะแก้อะไร
-- เดิมมีสถานะ "รอจัดสรรรถ" อย่างเดียว ผู้ดูแลต้องเดาเองว่ารถไม่ว่าง คนขับไม่ว่าง หรือเอกสารรถหมดอายุ
-- ตั้งค่าได้ที่ fleet_trips_guard_overlap ที่เดียว ค่าจาก client ถูกทิ้งเสมอ
--
-- hard = ผู้ดูแลอนุมัติเองก็ไม่ได้จนกว่าจะแก้ (DB ปฏิเสธ)
--   vehicle_busy        รถคันนี้มีคิวทับช่วงเวลา
--   driver_busy         ผู้ขับรถติดภารกิจอื่นทับช่วงเวลา
--   vehicle_unavailable รถไม่อยู่ในสถานะใช้งานได้ (กำลังซ่อม/ปลดประจำการ/ปลดระวาง)
-- soft = ระบบไม่อนุมัติให้อัตโนมัติ แต่ผู้ดูแลพิจารณาอนุมัติเองได้
--   vehicle_tight       คิวรถติดกันเกินไป (ห่างน้อยกว่าเวลาเผื่อ)
--   driver_tight        คิวผู้ขับรถติดกันเกินไป
--   vehicle_not_returned รถยังไม่คืนจากทริปก่อนหน้าที่เลยเวลากลับแล้ว
--   past_departure      ขอใช้รถย้อนหลัง (เวลาออกผ่านไปแล้ว)
--   long_duration       ขอใช้รถนานเกินกำหนด
--   vehicle_documents_expired พ.ร.บ./ประกัน/ภาษี/ตรวจสภาพ หมดอายุก่อนวันกลับ

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS waitlist_reasons text[];

COMMENT ON COLUMN public.fleet_trips.waitlist_reasons IS
  'เหตุผลที่ระบบไม่อนุมัติคิวอัตโนมัติ (ตั้งโดย fleet_trips_guard_overlap เท่านั้น) — เก็บไว้เป็นประวัติแม้ผู้ดูแลอนุมัติในภายหลัง';

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_waitlist_reasons_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_waitlist_reasons_check
  CHECK (waitlist_reasons IS NULL OR waitlist_reasons <@ ARRAY[
    'vehicle_busy', 'driver_busy', 'vehicle_unavailable',
    'vehicle_tight', 'driver_tight', 'vehicle_not_returned',
    'past_departure', 'long_duration', 'vehicle_documents_expired'
  ]::text[])
  NOT VALID;
