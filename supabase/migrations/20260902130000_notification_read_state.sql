-- สถานะ "อ่านแล้ว" ของกระดิ่ง in-app เก็บฝั่งเซิร์ฟเวอร์
-- ของเดิมอยู่ใน localStorage อย่างเดียว เปลี่ยนเครื่อง/ล้างแคชแล้วนับ unread ใหม่ทั้งก้อน
--
-- ห้ามเก็บเนื้อหาคำร้อง/ชื่อ/เบอร์ — item_key เป็นแค่ `${complaint_id}_${status}`
-- RLS: เจ้าของแถวเท่านั้นที่อ่าน/เขียนได้ ไม่มีสิทธิ์ anon

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key text NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 80),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);

CREATE TABLE IF NOT EXISTS public.notification_cleared (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_reads_user_read_idx
  ON public.notification_reads (user_id, read_at DESC);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_cleared ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_reads_own" ON public.notification_reads;
CREATE POLICY "notification_reads_own"
  ON public.notification_reads
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_cleared_own" ON public.notification_cleared;
CREATE POLICY "notification_cleared_own"
  ON public.notification_cleared
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.notification_reads FROM anon, public;
REVOKE ALL ON TABLE public.notification_cleared FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_reads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_cleared TO authenticated;

COMMENT ON TABLE public.notification_reads IS
  'Per-user in-app notification read keys. item_key is complaint_id + status only; no PII.';
COMMENT ON TABLE public.notification_cleared IS
  'Per-user mark-all-read watermark for in-app notifications.';

COMMIT;
