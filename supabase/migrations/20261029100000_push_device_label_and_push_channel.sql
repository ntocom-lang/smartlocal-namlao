-- ข้อ 2 ตั้งค่าแจ้งเตือน (เจ้าของระบบอนุมัติ 2569-10-29): รายการเครื่องที่เปิดรับ + ส่งทดสอบถึงเครื่อง + กันแจ้งเตือนซ้ำ
--
-- 1) push_subscriptions.device_label — ชื่อเครื่องที่หน้าเว็บสรุปเอง เช่น "Chrome · Windows"
--    ไม่เก็บ user-agent ดิบ (ระบุตัวเครื่องได้ละเอียดเกินจำเป็น) · แถวเดิมเป็น NULL ได้ หน้าจอขึ้น "อุปกรณ์ไม่ทราบชื่อ"
-- 2) notification_deliveries รับช่องทาง 'push' — send-push ใช้กันส่ง "คำร้องใหม่" ซ้ำ (เดิมยิงซ้ำได้ภายใน 15 นาที)
--    และจำกัดปุ่มส่งทดสอบ 3 ครั้ง/10 นาที (นับจากแถว self_test ของผู้กด)
-- 3) ถอนสิทธิ์เกินจำเป็นที่ค้างจากค่าเริ่มต้น: anon ไม่ต้องอ่านตารางนี้ (RLS ให้ว่างอยู่แล้ว) · TRUNCATE ไม่ผ่าน RLS
--    ไม่แตะ policy "user manage own subscription" (เจ้าของแถวอ่าน/เพิ่ม/แก้/ลบของตัวเองได้เหมือนเดิม)

BEGIN;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS device_label text;

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_device_label_len;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_device_label_len
  CHECK (device_label IS NULL OR char_length(btrim(device_label)) BETWEEN 1 AND 60);

COMMENT ON COLUMN public.push_subscriptions.device_label IS
  'ชื่อเครื่องที่หน้าเว็บสรุปเอง เช่น "Chrome · Windows" — ห้ามเก็บ user-agent ดิบ';

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('telegram', 'push'));

-- นับปุ่มส่งทดสอบของแต่ละคนใน 10 นาทีล่าสุด
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_push_requester
  ON public.notification_deliveries (requested_by, created_at DESC)
  WHERE channel = 'push';

REVOKE ALL ON TABLE public.push_subscriptions FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.push_subscriptions FROM authenticated;

COMMIT;
