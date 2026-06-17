-- บันทึกกิจกรรม staff/admin สำหรับ audit trail
CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality_id uuid      REFERENCES municipalities(id) ON DELETE CASCADE,
  actor_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name    text,
  actor_role    text,
  action        text        NOT NULL,        -- 'delete' | 'update_status' | 'approve' | 'reject' | 'assign'
  resource_type text        NOT NULL,        -- 'complaint' | 'event' | 'document_request' | 'document' | 'civil_project' | 'infrastructure_work' | 'tourism_place' | 'tourism_review'
  resource_id   text,
  resource_label text,                       -- ชื่อ/หัวข้อของ record ที่ถูกกระทำ
  metadata      jsonb,                       -- snapshot หรือข้อมูลเพิ่มเติม
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_muni_time_idx ON audit_logs(municipality_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx     ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx    ON audit_logs(action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- staff/admin ทุกคน insert ได้ (บันทึก action ตัวเอง)
DROP POLICY IF EXISTS "authenticated can insert audit logs" ON audit_logs;
CREATE POLICY "authenticated can insert audit logs" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    municipality_id IN (
      SELECT municipality_id FROM profiles WHERE id = auth.uid()
    )
  );

-- อ่านได้เฉพาะ admin และ superadmin
DROP POLICY IF EXISTS "admin can read audit logs" ON audit_logs;
CREATE POLICY "admin can read audit logs" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    municipality_id IN (
      SELECT municipality_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );
