-- =====================================================
-- SmartLocal 038: เพิ่ม officer และ council ใน profiles_role_check constraint
-- (036 เพิ่ม officer ใน RLS policy แต่ลืมอัปเดต CHECK constraint)
-- =====================================================

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'admin', 'officer', 'council', 'viewer', 'technician', 'citizen'));
