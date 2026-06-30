-- =====================================================
-- SmartLocal 085: events RLS — non-admin ต้องเป็น created_by ถึงจะ UPDATE/DELETE ได้
-- =====================================================

DROP POLICY IF EXISTS "staff update events" ON events;
DROP POLICY IF EXISTS "staff delete events" ON events;

-- UPDATE: admin/superadmin ทำได้ทุก row; council/officer/staff ทำได้เฉพาะ event ที่ตัวเองสร้าง
CREATE POLICY "staff update events" ON events
  FOR UPDATE
  USING (
    get_my_role() IN ('superadmin', 'admin')
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff')
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    get_my_role() IN ('superadmin', 'admin')
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff')
      AND created_by = auth.uid()
    )
  );

-- DELETE: เงื่อนไขเดียวกัน
CREATE POLICY "staff delete events" ON events
  FOR DELETE
  USING (
    get_my_role() IN ('superadmin', 'admin')
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff')
      AND created_by = auth.uid()
    )
  );
