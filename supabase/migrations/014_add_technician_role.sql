-- =====================================================
-- SmartLocal: เพิ่ม technician role + assign workflow
-- =====================================================

-- 1. เพิ่ม column ใน complaints
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS assigned_to     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS technician_note text,
  ADD COLUMN IF NOT EXISTS work_photos     jsonb NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS complaints_assigned_to_idx ON complaints(assigned_to);

-- 2. เพิ่ม technician ใน role check ของ profiles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'admin', 'viewer', 'technician', 'citizen'));

-- 3. Admin สามารถ update คำร้องได้ (assign + เปลี่ยนสถานะ)
DROP POLICY IF EXISTS "admin update complaints" ON complaints;
CREATE POLICY "admin update complaints"
  ON complaints FOR UPDATE
  USING (get_my_role() IN ('admin', 'superadmin'));

-- 4. Technician อ่านได้เฉพาะงานที่ถูก assign ให้ตัวเอง
DROP POLICY IF EXISTS "technician read assigned complaints" ON complaints;
CREATE POLICY "technician read assigned complaints"
  ON complaints FOR SELECT
  USING (assigned_to = auth.uid());

-- 5. Technician update ได้เฉพาะงานที่ถูก assign
DROP POLICY IF EXISTS "technician update assigned complaints" ON complaints;
CREATE POLICY "technician update assigned complaints"
  ON complaints FOR UPDATE
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

-- 6. Technician อ่าน profiles ได้ (เพื่อเห็นข้อมูลผู้แจ้ง)
DROP POLICY IF EXISTS "technician read profiles" ON profiles;
CREATE POLICY "technician read profiles"
  ON profiles FOR SELECT
  USING (get_my_role() = 'technician');
