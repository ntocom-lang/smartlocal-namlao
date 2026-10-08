-- เลขไมล์รถรับ-ส่งผู้ป่วย "เหมาเป็นวัน" (เจ้าของระบบสั่ง 2569-10-08) — เฟส 1/3: ตารางเปล่า
--
-- เดิมบันทึกเลขไมล์รายเที่ยว (patient_booking_trips.odometer_start/end) แต่รถคันเดียววิ่งหลายเที่ยวซ้อนเวลากันได้
-- (คน A ขึ้น 08:00 กลับ 16:00 · ระหว่างวันคน B ขึ้น 10:00 กลับ 17:00) เลขไมล์รายเที่ยวจึงแบ่งไม่ได้จริงและตัวเลขทับกัน
-- รถของกองทุนมีคันเดียวต่อหน่วยงาน → 1 แถว = 1 วัน ต่อหน่วยงาน
--   เลขไมล์ออก  = เลขไมล์กลับล่าสุดของวันก่อน (หน้าจอเติมให้ แก้ได้)
--   เลขไมล์กลับ = ใส่ครั้งเดียวตอนรถกลับถึงกองทุนสิ้นวัน · ไม่บังคับ (ค้างเป็นงาน "รอเลขไมล์ปิดวัน")
-- คอลัมน์เลขไมล์รายเที่ยวเดิมไม่ลบ (เก็บเป็นประวัติ) · อ่าน/เขียนผ่าน RPC เท่านั้น เหมือนตารางอื่นของโมดูล
-- แยกไฟล์ตามกติกา NOTES §3 (CREATE TABLE แล้วอ้างในไฟล์เดียวกันพัง 42P01):
--   ย้ายข้อมูลเดิม 20261008100100 · RPC 20261008100200
BEGIN;
CREATE TABLE public.patient_booking_odometer_days (
 id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
 service_date date NOT NULL,
 odometer_start integer CHECK (odometer_start >= 0),
 odometer_end integer CHECK (odometer_end >= 0),
 odometer_issue boolean NOT NULL DEFAULT false,
 odometer_note text NOT NULL DEFAULT '' CHECK (char_length(odometer_note) <= 300),
 recorded_by uuid REFERENCES public.profiles(id),
 recorded_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (municipality_id, service_date),
 -- เกณฑ์เดียวกับเลขไมล์รายเที่ยว (20260926141301): กลับ ≥ ออก และไม่เกิน 2,000 กม. เว้นแต่ติด "มาตรวัดมีปัญหา / รอตรวจสอบ"
 CONSTRAINT patient_booking_odometer_days_order CHECK (odometer_issue OR odometer_start IS NULL OR odometer_end IS NULL
  OR (odometer_end >= odometer_start AND odometer_end::bigint - odometer_start::bigint <= 2000))
);
ALTER TABLE public.patient_booking_odometer_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_booking_odometer_days FROM PUBLIC, anon, authenticated;
COMMIT;
