-- 106_fix_cross_municipality_rls.sql
-- แก้ cross-municipality data leak ใน 3 ตาราง:
--   1. profiles  — admin/officer/viewer อ่านข้าม อบต. ได้ (ไม่มี municipality filter)
--   2. profiles  — technician อ่านข้าม อบต. ได้
--   3. category_assignments — admin/technician อ่านข้าม อบต. ได้
--
-- หลักการ:
--   - staff ที่มี municipality_id → อ่านได้เฉพาะคนใน municipality เดียวกัน
--   - citizen ที่ municipality_id IS NULL → อ่านได้เสมอ (ต้องใช้ใน complaint workflow)
--   - superadmin → อ่านได้ทั้งระบบ (system owner)

-- ─── 1. profiles: admin / officer / viewer / council ─────────────────────────

DROP POLICY IF EXISTS "admins read all profiles" ON profiles;
CREATE POLICY "admins read all profiles"
  ON profiles FOR SELECT
  USING (
    -- ตัวเองเสมอ
    id = auth.uid()
    -- superadmin: อ่านได้ทุกคน
    OR get_my_role() = 'superadmin'
    -- admin / officer / viewer / council: อ่านได้เฉพาะ municipality ตัวเอง
    -- + citizen profiles (municipality_id IS NULL) ที่จำเป็นต้องใช้ใน complaint workflow
    OR (
      get_my_role() IN ('admin', 'officer', 'viewer', 'council')
      AND (
        municipality_id = get_my_municipality_id()
        OR municipality_id IS NULL
      )
    )
  );

-- ─── 2. profiles: technician ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "technician read profiles" ON profiles;
CREATE POLICY "technician read profiles"
  ON profiles FOR SELECT
  USING (
    get_my_role() = 'technician'
    AND (
      municipality_id = get_my_municipality_id()
      OR municipality_id IS NULL
    )
  );

-- ─── 3. category_assignments: admin manage ────────────────────────────────────

DROP POLICY IF EXISTS "admin manage category assignments" ON category_assignments;
CREATE POLICY "admin manage category assignments"
  ON category_assignments FOR ALL
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer')
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- ─── 4. category_assignments: technician read ────────────────────────────────

DROP POLICY IF EXISTS "technician read category assignments" ON category_assignments;
CREATE POLICY "technician read category assignments"
  ON category_assignments FOR SELECT
  USING (
    get_my_role() = 'technician'
    AND municipality_id = get_my_municipality_id()
  );
