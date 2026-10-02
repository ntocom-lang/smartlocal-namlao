-- หนังสือนำส่งกองทุน "แยกรายคน" — เฟสที่ 1: คอลัมน์อย่างเดียว (2569-10-02)
--
-- เจ้าของระบบสั่ง 2569-10-02: เอกสารไม่ต้องใช้ร่วมกันทั้งเที่ยวแล้ว เขาต้องการแบบแยกเป็นของใครของมัน
-- และเลือกแบบ ข = ผู้เดินทางแต่ละคนมีใบคำขอ + หนังสือนำส่งของตัวเอง เลขที่หนังสือคนละเลข
-- (เดิมเลขที่/วันที่หนังสืออยู่ที่เที่ยว patient_booking_trips.forward_letter_no ฉบับเดียวต่อเที่ยว)
--
-- เก็บเลขที่/วันที่ที่ตัวคำขอ ส่วนคอลัมน์ของเที่ยวไม่ลบ ไม่แก้: เที่ยวเก่าที่บันทึกเลขไว้แล้วยังพิมพ์ได้
-- (หน้าจอใช้เลขของคำขอก่อน ไม่มีค่อยใช้เลขของเที่ยว) และ RPC เดิมของเที่ยวยังทำงานสำหรับหน้าจอรุ่นเก่า
--
-- letter_revision แยกจาก revision ของคำขอ เหตุผลเดียวกับ docs_revision ของเที่ยว (20260919140000):
-- เลขหนังสือเป็นข้อมูลประกอบ ไม่ใช่สถานะ ถ้าบันทึกเลขแล้วเพิ่ม revision คำสั่งอื่นที่เจ้าหน้าที่/ผู้จองเปิดค้างไว้
-- (ยกเลิก แก้ข้อมูล) จะชน "คิวเปลี่ยนแล้ว" ทั้งที่ไม่มีอะไรเปลี่ยนในคิว
--
-- แยกไฟล์กับ RPC ที่อ้างคอลัมน์เหล่านี้เสมอ ถ้ารวมไฟล์เดียวจะได้ 42703 (ดู docs/ai/NOTES.md)
-- ตารางนี้ถอนสิทธิ์ตรงของ anon/authenticated ไว้แล้ว (เข้าได้ทาง RPC เท่านั้น) คอลัมน์ใหม่จึงไม่ต้อง GRANT
BEGIN;

ALTER TABLE public.patient_bookings
  ADD COLUMN forward_letter_no text CHECK (char_length(forward_letter_no) BETWEEN 1 AND 60),
  ADD COLUMN forward_letter_date date,
  ADD COLUMN forward_recorded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN forward_recorded_at timestamptz,
  ADD COLUMN letter_revision integer NOT NULL DEFAULT 0;

ALTER TABLE public.patient_bookings
  ADD CONSTRAINT patient_bookings_letter_pair
  CHECK ((forward_letter_no IS NULL) = (forward_letter_date IS NULL));

COMMIT;
