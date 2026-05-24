-- =====================================================
-- SmartLocal 032: viewer มีสิทธิ์ CRUD ใน events
-- =====================================================

DROP POLICY IF EXISTS "staff manage events" ON events;

CREATE POLICY "staff manage events" ON events
  FOR ALL
  USING (get_my_role() IN ('superadmin', 'admin', 'viewer'))
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer'));
