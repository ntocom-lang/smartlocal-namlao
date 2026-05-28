-- =====================================================
-- SmartLocal 040: council สามารถ INSERT/UPDATE/DELETE events ได้
-- =====================================================

DROP POLICY IF EXISTS "staff insert events" ON events;
DROP POLICY IF EXISTS "staff update events" ON events;
DROP POLICY IF EXISTS "staff delete events" ON events;

CREATE POLICY "staff insert events" ON events
  FOR INSERT
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council'));

CREATE POLICY "staff update events" ON events
  FOR UPDATE
  USING    (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council'))
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council'));

CREATE POLICY "staff delete events" ON events
  FOR DELETE
  USING (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council'));
