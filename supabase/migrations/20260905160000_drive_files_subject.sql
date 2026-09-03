-- 20260905160000_drive_files_subject.sql
--
-- เพิ่มคอลัมน์ subject ให้ drive_files เพื่อผูกไฟล์เข้ากับ "เรื่อง" ที่มันถูกอัปโหลดให้
--
-- ต้นเหตุ: supabase/functions/drive-upload/index.ts รับ subject มาอยู่แล้ว (ฝั่งคำร้อง
-- ส่ง complaint id มา — ดู src/pages/CitizenForm.jsx) แต่เอาไปใช้ตั้งชื่อโฟลเดอร์บน Drive
-- อย่างเดียว ไม่ได้บันทึกลงตาราง ผลคือ attach_complaint_photos ตรวจได้แค่ว่า
-- "ไฟล์นี้อยู่ใน bucket complaint-attachments" ไม่รู้ว่าเป็นของคำร้องไหน
--
-- ทำไมถึงเป็นช่องโหว่จริง ไม่ใช่แค่ความไม่เรียบร้อย: get_complaint_by_ref คืน id ของ
-- คำร้องมาด้วย และ ref_no เป็นเลขเรียงที่ยิงไล่ได้ไม่จำกัด ผู้โจมตีจึงได้ uuid ของคำร้อง
-- แล้วถ้าคำร้องนั้นไม่ระบุตัวตนและอายุยังไม่ถึง 15 นาที ก็เรียก attach_complaint_photos
-- เขียนทับ attachments ด้วยไฟล์ Drive ของคำร้องอื่นได้ — สองช่องนี้ต่อกันเป็นโซ่
--
-- ไฟล์นี้เพิ่มคอลัมน์อย่างเดียว apply ก่อน deploy ได้ปลอดภัย แถวเดิมเป็น NULL
-- ตัวที่บังคับใช้จริงอยู่ใน 20260905180000 ซึ่งต้อง apply หลังจาก deploy
-- edge function drive-upload รุ่นที่บันทึก subject แล้วเท่านั้น
-- (แยกไฟล์เพราะ ADD COLUMN แล้วอ้างถึงในไฟล์เดียวกันจะได้ 42703)

alter table public.drive_files
  add column if not exists subject text;

comment on column public.drive_files.subject is
  'เรื่องที่ไฟล์นี้สังกัด ตรงกับ subject ที่ drive-upload รับมา — คำร้องใช้ complaint id. NULL = ไฟล์ที่อัปโหลดก่อน 2026-09-03';
