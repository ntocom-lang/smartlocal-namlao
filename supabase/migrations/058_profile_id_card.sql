-- 058_profile_id_card.sql
-- เพิ่มเลขบัตรประชาชนในโปรไฟล์ผู้ใช้ (LPA ๑.๒ การพิสูจน์และยืนยันตัวตน)

alter table profiles
  add column if not exists id_card text;

-- index สำหรับตรวจสอบซ้ำ (optional)
create unique index if not exists profiles_id_card_idx
  on profiles (id_card)
  where id_card is not null;
