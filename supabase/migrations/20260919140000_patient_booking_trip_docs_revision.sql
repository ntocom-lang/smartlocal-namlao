-- แก้ผลตรวจ #227 ข้อ 2: ข้อมูลเอกสาร/เลขไมล์ของเที่ยวไม่มีตัวกันคำสั่งเก่าเขียนทับค่าใหม่
--
-- revision แยกจาก patient_booking_trips.revision (สถานะเที่ยว) โดยเจตนา — ถ้าใช้ตัวเดียวกัน การกรอก
-- เลขหนังสือ/เลขไมล์จะทำให้คำสั่งของคนขับที่กดค้างไว้ (ออกไปรับ/ส่งถึง) ชน revision ทั้งที่แผนไม่เปลี่ยน
--
-- แยกไฟล์กับ RPC ที่อ้างคอลัมน์นี้ (20260919140100) ตามกติกา ADD COLUMN — ดู docs/ai/NOTES.md
BEGIN;

ALTER TABLE public.patient_booking_trips
  ADD COLUMN docs_revision integer NOT NULL DEFAULT 1 CHECK (docs_revision >= 1);

COMMIT;
