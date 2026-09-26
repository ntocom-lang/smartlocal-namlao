-- เอกสารถึงกองทุนเจ้าของรถ — เฟสที่ 1: คอลัมน์อย่างเดียว (2569-09-19)
--
-- กระบวนการที่เจ้าของระบบยืนยัน: รถเป็นของกองทุน, อปท. รับเรื่อง + จัดคิว, คนขับเป็นเจ้าหน้าที่ อปท.
-- แล้ว อปท. ออกหนังสือนำส่งถึงกองทุน 1 ฉบับต่อ 1 เที่ยว (บัญชีรายชื่อแนบ) และสรุปเลขไมล์รายเดือน
-- ไว้เบิกกับกองทุน — กองทุนไม่ต้องอนุมัติรายเที่ยว หนังสือเป็นการแจ้ง
--
-- แยกไฟล์กับ RPC ที่อ้างคอลัมน์เหล่านี้เสมอ ถ้ารวมไฟล์เดียวจะได้ 42703 (ดู docs/ai/NOTES.md)
BEGIN;

ALTER TABLE public.patient_booking_trips
  -- เลขที่/วันที่หนังสือมาจากทะเบียนหนังสือส่งของ อปท. ที่เจ้าหน้าที่สารบรรณออก ระบบออกเลขเองไม่ได้
  ADD COLUMN forward_letter_no text CHECK (char_length(forward_letter_no) BETWEEN 1 AND 60),
  ADD COLUMN forward_letter_date date,
  ADD COLUMN forward_recorded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN forward_recorded_at timestamptz,
  -- เลขไมล์ต่อเที่ยว — คนขับกรอกที่นี่ที่เดียว ไม่ต้องลงแบบ 4 ของโมดูลยานพาหนะซ้ำ
  -- (รถไม่ใช่ทรัพย์สินของ อปท. จึงไม่อยู่ในทะเบียน fleet_vehicles)
  ADD COLUMN odometer_start integer CHECK (odometer_start >= 0),
  ADD COLUMN odometer_end integer CHECK (odometer_end >= 0);

ALTER TABLE public.patient_booking_trips
  ADD CONSTRAINT patient_booking_trips_letter_pair
  CHECK ((forward_letter_no IS NULL) = (forward_letter_date IS NULL));

-- 2,000 กม. ต่อเที่ยวเป็นเพดานกันพิมพ์เลขผิดหลัก ไม่ใช่นโยบาย (เที่ยวในจังหวัดไม่ถึงหลักร้อย)
ALTER TABLE public.patient_booking_trips
  ADD CONSTRAINT patient_booking_trips_odometer_order
  CHECK (odometer_start IS NULL OR odometer_end IS NULL
         OR (odometer_end >= odometer_start AND odometer_end - odometer_start <= 2000));

COMMIT;
