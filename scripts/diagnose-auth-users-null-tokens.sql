-- ตรวจสาเหตุที่ Admin API อ่านรายชื่อผู้ใช้ไม่ได้ ("Database error finding users")
-- รายงานอย่างเดียว ไม่แก้ข้อมูล — วางลง Supabase SQL Editor แล้วกด Run
--
-- อาการที่เจอ (2026-08-29): เรียก auth.admin.listUsers() ด้วย service_role key แล้วได้
--   ❌ Database error finding users
-- คีย์ผ่านการยืนยันตัวตนแล้ว (ถ้าคีย์ผิดจะได้ "Invalid API key" ซึ่งเป็นคนละข้อความ)
-- แปลว่าปัญหาอยู่ฝั่งฐานข้อมูล ตอน GoTrue อ่านแถวออกมาจาก auth.users
--
-- ── สมมติฐานที่น่าจะเป็นที่สุด (ต้องรันคิวรีนี้ยืนยันก่อน ห้ามเชื่อไปเลย) ──────────────
-- GoTrue เขียนด้วยภาษา Go และ map คอลัมน์ token เหล่านี้เป็น string ธรรมดา ไม่ใช่ nullable
-- ถ้าแถวไหนมีค่าเป็น NULL (ปกติต้องเป็นสตริงว่าง '') การอ่านจะพังทั้งคิวรี ไม่ใช่แค่แถวนั้น
-- กระทบ listUsers, หน้า Dashboard > Authentication > Users และ admin API อื่นที่ดึงผู้ใช้หลายคน
--
-- NULL เหล่านี้มักเกิดจากการ INSERT/UPDATE auth.users ด้วย SQL มือ ซึ่งเป็นเหตุผลเดียวกับที่
-- ห้ามแก้อีเมลใน auth.users ด้วย SQL (อีเมลถูกเก็บซ้ำที่ auth.identities ต้องผ่าน Admin API)
--
-- ใช้ jsonb แทนการอ้างชื่อคอลัมน์ตรงๆ เพื่อไม่ให้คิวรีพังถ้า Supabase เวอร์ชันนี้ไม่มีบางคอลัมน์

select
  e.key    as "คอลัมน์",
  count(*) as "จำนวนแถวที่เป็น NULL"
from auth.users u
cross join lateral jsonb_each(to_jsonb(u)) as e(key, value)
where e.key in (
  'confirmation_token',
  'recovery_token',
  'email_change',
  'email_change_token_new',
  'email_change_token_current',
  'phone_change',
  'phone_change_token',
  'reauthentication_token'
)
and e.value = 'null'::jsonb
group by e.key
order by e.key;

-- ── อ่านผลยังไง ──────────────────────────────────────────────────────────────
-- ไม่มีแถวเลย  = สมมติฐานนี้ผิด ต้องหาสาเหตุอื่นต่อ อย่าเพิ่งแก้อะไรทั้งนั้น
-- มีแถวขึ้นมา  = ยืนยันแล้ว วิธีแก้อยู่ใน scripts/fix-auth-users-null-tokens.sql
--                (แยกไฟล์ไว้ตั้งใจ จะได้ไม่เผลอรันคำสั่งแก้ไปพร้อมกับคำสั่งตรวจ)
