-- =====================================================
-- SmartLocal 022: Admin delete complaints policy
-- =====================================================

DROP POLICY IF EXISTS "admin delete complaints" ON complaints;
CREATE POLICY "admin delete complaints"
  ON complaints FOR DELETE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );
