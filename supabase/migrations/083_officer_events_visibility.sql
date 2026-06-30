-- =====================================================
-- SmartLocal 083: officer เห็น events ได้ครบทุก audience
-- (public, staff, council, management)
-- =====================================================

DROP POLICY IF EXISTS "events select by audience" ON events;

CREATE POLICY "events select by audience" ON events
  FOR SELECT
  USING (
    CASE
      WHEN get_my_role() IN ('superadmin', 'admin') THEN true
      WHEN get_my_role() = 'officer'     THEN audience IN ('public', 'staff', 'council', 'management')
      WHEN get_my_role() = 'viewer'      THEN audience IN ('public', 'staff', 'management')
      WHEN get_my_role() = 'council'     THEN audience IN ('public', 'staff', 'council')
      WHEN get_my_role() = 'kamnan'      THEN audience IN ('public', 'staff', 'kamnan')
      WHEN get_my_role() = 'technician'  THEN audience IN ('public', 'staff')
      ELSE audience = 'public'
    END
  );
