-- ปักหมุดจุดรับผู้ป่วย (ทางเลือก) — เฟสที่ 1: คอลัมน์อย่างเดียว
--
-- แยกไฟล์กับ RPC ที่อ้างคอลัมน์นี้เสมอ ถ้าเขียนรวมไฟล์เดียวจะได้ 42703 (ดู docs/ai/NOTES.md)
--
-- ⚠️ PDPA: พิกัดนี้คือตำแหน่งบ้านผู้ป่วย เห็นได้เฉพาะผู้จอง เจ้าหน้าที่จัดคิว และคนขับของเที่ยวนั้น
-- ห้ามใส่ลง patient_booking_calendar (RPC สาธารณะ) เด็ดขาด — มีเทสต์กันไว้ใน tests/patient-booking-db.test.mjs
--
-- ช่วงพิกัดกันค่าที่สลับ lat/lng หรือหลุดออกนอกประเทศ (ไทยอยู่ราว 5.5–20.5 N, 97–106 E)
BEGIN;

ALTER TABLE public.patient_bookings
  ADD COLUMN pickup_lat double precision CHECK (pickup_lat BETWEEN 5 AND 21),
  ADD COLUMN pickup_lng double precision CHECK (pickup_lng BETWEEN 96 AND 106);

-- ปักหมุดแล้วต้องมีครบทั้งคู่ ไม่งั้นนำทางไม่ได้และคำนวณอะไรต่อไม่ได้
ALTER TABLE public.patient_bookings
  ADD CONSTRAINT patient_bookings_pickup_point_pair
  CHECK ((pickup_lat IS NULL) = (pickup_lng IS NULL));

COMMENT ON COLUMN public.patient_bookings.pickup_lat IS 'พิกัดจุดรับ (ทางเลือก) — ผู้สูงอายุที่ปักหมุดไม่เป็นยังจองได้ด้วยข้อความอย่างเดียว';

COMMIT;
