-- =====================================================
-- SmartLocal 084: officer + staff INSERT/UPDATE/DELETE events
-- =====================================================

DROP POLICY IF EXISTS "staff insert events" ON events;
DROP POLICY IF EXISTS "staff update events" ON events;
DROP POLICY IF EXISTS "staff delete events" ON events;

CREATE POLICY "staff insert events" ON events
  FOR INSERT
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council', 'officer', 'staff'));

CREATE POLICY "staff update events" ON events
  FOR UPDATE
  USING    (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council', 'officer', 'staff'))
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council', 'officer', 'staff'));

CREATE POLICY "staff delete events" ON events
  FOR DELETE
  USING (get_my_role() IN ('superadmin', 'admin', 'viewer', 'council', 'officer', 'staff'));
