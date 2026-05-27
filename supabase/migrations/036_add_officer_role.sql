-- =====================================================
-- SmartLocal 036: เพิ่ม role 'officer' (เจ้าหน้าที่ธุรการ/ปฏิบัติงานทั่วไป)
-- =====================================================

DROP POLICY IF EXISTS "events select by audience" ON events;

CREATE POLICY "events select by audience" ON events
  FOR SELECT
  USING (
    CASE
      WHEN get_my_role() IN ('superadmin', 'admin') THEN true
      WHEN get_my_role() = 'viewer'     THEN audience IN ('public', 'staff', 'management')
      WHEN get_my_role() = 'council'    THEN audience IN ('public', 'staff', 'council')
      WHEN get_my_role() = 'kamnan'     THEN audience IN ('public', 'staff', 'kamnan')
      WHEN get_my_role() IN ('technician', 'officer') THEN audience IN ('public', 'staff')
      ELSE audience = 'public'
    END
  );
