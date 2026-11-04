-- รถรับ-ส่งผู้ป่วย "รับกลับอย่างเดียว" (เจ้าของระบบสั่ง 2569-11-04): ผู้ป่วยนอนโรงพยาบาลอยู่ ต้องการรถเฉพาะขากลับ
-- (ก) ร่วมกลับกับรถที่ออกไปส่งผู้ป่วยวันนั้น (ข) ให้รถไปรับโดยเฉพาะ — ไม่มีขาไปจากบ้าน
-- ไฟล์ 1/2: เพิ่มค่า return_mode = 'return_only' ที่ CHECK ของตาราง + บังคับว่าต้องมีเวลารับกลับ
--   อนุญาตเพิ่มอย่างเดียว ไม่แก้แถวเดิม · โค้ดเก่าไม่รู้จักค่านี้จึงไม่เคยส่งมา (ฟอร์มใหม่ส่งหลัง apply เท่านั้น)
-- ไฟล์ 2/2 (20261104100100): ตัวกระตุ้นให้เวลานัด = เวลารับกลับ + ptb_plan รู้จักคำขอที่ไม่มีขาไป
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.patient_bookings'::regclass
   AND conname='patient_bookings_return_mode_check' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%wait%later%one_way%') THEN
  RAISE EXCEPTION 'Constraint drift: patient_bookings_return_mode_check';
 END IF;
END $guard$;

ALTER TABLE public.patient_bookings DROP CONSTRAINT patient_bookings_return_mode_check;
ALTER TABLE public.patient_bookings ADD CONSTRAINT patient_bookings_return_mode_check
 CHECK (return_mode IN ('wait','later','one_way','return_only'));
ALTER TABLE public.patient_bookings ADD CONSTRAINT patient_bookings_return_only_has_time
 CHECK (return_mode<>'return_only' OR return_at IS NOT NULL);
COMMIT;
