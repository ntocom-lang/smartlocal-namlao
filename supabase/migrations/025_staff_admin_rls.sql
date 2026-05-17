-- =====================================================
-- SmartLocal 025: Staff table admin RLS policies
-- =====================================================

-- INSERT: admin/superadmin เพิ่มบุคลากรได้เฉพาะหน่วยงานตัวเอง
DROP POLICY IF EXISTS "admin insert staff" ON staff;
CREATE POLICY "admin insert staff"
  ON staff FOR INSERT
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );

-- UPDATE: admin/superadmin แก้ไขบุคลากรได้เฉพาะหน่วยงานตัวเอง
DROP POLICY IF EXISTS "admin update staff" ON staff;
CREATE POLICY "admin update staff"
  ON staff FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );

-- DELETE: admin/superadmin ลบบุคลากรได้เฉพาะหน่วยงานตัวเอง
DROP POLICY IF EXISTS "admin delete staff" ON staff;
CREATE POLICY "admin delete staff"
  ON staff FOR DELETE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );
