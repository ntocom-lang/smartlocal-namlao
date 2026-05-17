-- =====================================================
-- SmartLocal 024: เพิ่ม viewer role (ผู้บริหาร)
-- viewer: อ่านรายงาน + คำร้องได้ แต่แก้ไขไม่ได้
-- =====================================================

-- 1. อัปเดต CHECK constraint ให้ครอบคลุม viewer
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'admin', 'viewer', 'technician', 'citizen'));

-- 2. viewer อ่าน profiles ได้ทุกคน (ใช้ policy ที่มีอยู่แล้วใน 005)
DROP POLICY IF EXISTS "admins read all profiles" ON profiles;
CREATE POLICY "admins read all profiles"
  ON profiles FOR SELECT
  USING (get_my_role() IN ('superadmin', 'admin', 'viewer'));

-- 3. viewer อ่าน complaints ได้ (complaints มี USING(true) อยู่แล้ว ไม่ต้องทำอะไร)
