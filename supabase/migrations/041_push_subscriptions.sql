-- =====================================================
-- SmartLocal: push_subscriptions สำหรับ Web Push
-- =====================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth_key        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_municipality_idx
  ON push_subscriptions(municipality_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- User บันทึก/ลบ subscription ของตัวเอง
DROP POLICY IF EXISTS "user manage own subscription" ON push_subscriptions;
CREATE POLICY "user manage own subscription"
  ON push_subscriptions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Edge Function (service role) อ่านได้ทุก row เพื่อส่ง push
-- ใช้ service_role key ใน Edge Function — ไม่ต้อง RLS policy พิเศษ
