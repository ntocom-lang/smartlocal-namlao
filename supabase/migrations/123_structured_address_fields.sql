-- 123_structured_address_fields.sql
-- เพิ่มที่อยู่แบบโครงสร้าง (จังหวัด/อำเภอ/ตำบล/หมู่ที่/รายละเอียด) แทนช่องข้อความอิสระเดิม
-- คอลัมน์ profiles.address เดิมไม่ถูกลบ/แตะ เก็บไว้เผื่อข้อมูลเก่า

alter table municipalities
  add column if not exists district text; -- อำเภอ (province มีอยู่แล้ว)

alter table profiles
  add column if not exists address_province text,
  add column if not exists address_district text,
  add column if not exists address_subdistrict text,
  add column if not exists address_moo text,
  add column if not exists address_detail text;

-- ตั้งค่า จังหวัด/อำเภอ ของ tenant ที่มีอยู่ตอนนี้ (ข้อมูลจริง ไม่ใช่ค่าเดา)
update municipalities set district = 'ร้องกวาง' where slug = 'namlao';
update municipalities set district = 'หนองม่วงไข่' where slug = 'tamnaktham';
update municipalities set district = 'เมืองแพร่' where slug = 'muangphrae';
