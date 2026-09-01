-- เพิ่มหมวดหมู่ให้สายด่วนฉุกเฉิน
--
-- ที่มา: ทุ่งแค้วมี 15 รายการในหน้าเดียว เรียงติดกันหมดโดยไม่มีหัวข้อคั่น อ่านแล้วลายตา
-- และคอลัมน์ color/bg ที่มีอยู่ไม่ช่วยแยกแยะ เพราะแทบทุกแถวของทุก อปท. เป็น #1d4ed8 เหมือนกัน
--
-- ค่าที่อนุญาตต้องตรงกับ EMERGENCY_CATEGORIES ใน src/lib/emergencyCategories.js
-- คอลัมน์นี้ตั้ง default 'other' ให้แถวเดิมทั้งหมดก่อน แล้วค่อย backfill ตามชื่อในไฟล์ถัดไป
-- (แยกไฟล์เพราะ ADD COLUMN แล้วอ้างถึงคอลัมน์นั้นใน statement เดียวกันจะได้ 42703)
--
-- GRANT: emergency_contacts ให้สิทธิ์ระดับตาราง (ไม่ใช่ column-level เหมือน municipalities)
-- คอลัมน์ใหม่จึงได้สิทธิ์ SELECT ของ anon/authenticated อัตโนมัติ ไม่ต้อง GRANT เพิ่ม

alter table public.emergency_contacts
  add column if not exists category text not null default 'other';

alter table public.emergency_contacts
  drop constraint if exists emergency_contacts_category_check;

alter table public.emergency_contacts
  add constraint emergency_contacts_category_check
  check (category in ('emergency', 'health', 'utility', 'government', 'leader', 'other'));

comment on column public.emergency_contacts.category is
  'หมวดสำหรับจัดกลุ่มบนหน้าสายด่วน — ค่าที่ใช้ได้ดู src/lib/emergencyCategories.js';
