-- 111_add_staff_phone.sql
-- เพิ่มคอลัมน์ phone สำหรับเบอร์โทรศัพท์ติดต่อของบุคลากร/ผู้บริหาร

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN staff.phone IS
  'เบอร์โทรศัพท์ติดต่อตรง หรือ เบอร์เทศบาลต่อสายตรง';
