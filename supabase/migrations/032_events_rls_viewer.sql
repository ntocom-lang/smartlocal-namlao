-- =====================================================
-- SmartLocal 032: audience-based events visibility
-- =====================================================

-- เพิ่ม audience column (ถ้ายังไม่มี)
ALTER TABLE events ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'public';

-- ลบ policy เก่า
DROP POLICY IF EXISTS "staff manage events" ON events;
DROP POLICY IF EXISTS "public read events" ON events;
DROP POLICY IF EXISTS "events select by audience" ON events;
DROP POLICY IF EXISTS "staff insert events" ON events;
DROP POLICY IF EXISTS "staff update events" ON events;
DROP POLICY IF EXISTS "staff delete events" ON events;

-- SELECT: กรองตาม audience + role
-- public     → ทุกคน
-- staff      → admin, superadmin, technician, viewer, council
-- management → viewer, admin, superadmin
-- council    → council, admin, superadmin
CREATE POLICY "events select by audience" ON events
  FOR SELECT
  USING (
    CASE
      WHEN get_my_role() IN ('superadmin', 'admin') THEN true
      WHEN get_my_role() = 'viewer'     THEN audience IN ('public', 'staff', 'management')
      WHEN get_my_role() = 'council'    THEN audience IN ('public', 'staff', 'council')
      WHEN get_my_role() = 'technician' THEN audience IN ('public', 'staff')
      ELSE audience = 'public'
    END
  );

-- INSERT: admin, superadmin, viewer เท่านั้น
CREATE POLICY "staff insert events" ON events
  FOR INSERT
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer'));

-- UPDATE: admin, superadmin, viewer เท่านั้น
CREATE POLICY "staff update events" ON events
  FOR UPDATE
  USING    (get_my_role() IN ('superadmin', 'admin', 'viewer'))
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'viewer'));

-- DELETE: admin, superadmin, viewer เท่านั้น
CREATE POLICY "staff delete events" ON events
  FOR DELETE
  USING (get_my_role() IN ('superadmin', 'admin', 'viewer'));
