-- SmartLocal 118: fix audit_logs SELECT policy สำหรับ superadmin
-- ปัญหา: superadmin มี municipality_id = null → IN (null) = false → อ่านไม่ได้

DROP POLICY IF EXISTS "admin can read audit logs" ON audit_logs;
CREATE POLICY "admin can read audit logs" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'superadmin'
    )
    OR municipality_id IN (
      SELECT municipality_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'officer')
    )
  );
