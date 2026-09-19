-- ช่องทางที่คำขอเข้ามา: ผู้จองยื่นเอง (online) หรือเจ้าหน้าที่รับแทนทางโทรศัพท์/เคาน์เตอร์ (staff)
-- เดิมไม่มีร่องรอยนี้เลย ดูย้อนหลังไม่ได้ว่าคำขอที่ข้ามวันจองล่วงหน้าเป็นการรับแทนจริงหรือไม่
-- แยกไฟล์ ADD COLUMN ออกจากไฟล์ที่อ้างคอลัมน์นี้ (กับดัก 42703 — ดู docs/ai/NOTES.md)
BEGIN;
ALTER TABLE public.patient_bookings
  ADD COLUMN entry_channel text NOT NULL DEFAULT 'online'
  CHECK (entry_channel IN ('online','staff'));
COMMENT ON COLUMN public.patient_bookings.entry_channel IS
  'online=ผู้จองยื่นเอง · staff=เจ้าหน้าที่จัดคิวรับเรื่องแทนจากหน้าทำงาน (ต้องสั่งจากหน้าทำงานเท่านั้น)';
COMMIT;
