-- แยกสถานะ 'skipped' ออกจาก 'failed' ใน notification_deliveries
--
-- ที่มา: E2E 2026-08-30 บนสนามซ้อม (slug='demo') พบ console error
-- "Telegram notification failed: Edge Function returned a non-2xx status code" ทุกครั้งที่มีการ
-- เปลี่ยนสถานะคำร้อง (5 ครั้งใน 1 รอบทดสอบ) สาเหตุคือ notify-telegram คืน HTTP 422 เมื่อ อปท.
-- ไม่ได้ผูก telegram_group_id แล้วบันทึกแถวเป็น status='failed'
--
-- ปัญหาของการนับรวมเป็น failed:
--   1. อปท. ที่ "ตั้งใจไม่เปิดใช้ Telegram" ปนกับ อปท. ที่ "เปิดแล้วแต่ส่งไม่ออก" ในตารางเดียวกัน
--      → audit/รายงานความน่าเชื่อถือของช่องทางแจ้งเตือนอ่านไม่ได้
--   2. index idx_notification_deliveries_status_updated ถูกออกแบบไว้ให้ชี้เฉพาะงานที่ต้องตามต่อ
--      (pending/failed) การเอา skipped ไปกองรวมทำให้ index บวมด้วยแถวที่ไม่มีอะไรให้ทำ
--
-- ไม่ต้องแก้ index: WHERE status IN ('pending','failed') ไม่ครอบ 'skipped' อยู่แล้ว
-- ไม่ต้อง backfill แถวเก่า: last_error ของแถวเดิมยังเก็บข้อความ 'Telegram group is not configured'
-- ไว้ครบ ถ้าจะจัดประเภทย้อนหลังให้ทำแยกเป็นงาน data-fix ต่างหาก ไม่ปนกับการแก้ constraint

BEGIN;

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;

ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));

COMMENT ON COLUMN public.notification_deliveries.status IS
  'pending = กำลังส่ง | sent = ส่งสำเร็จ | failed = ส่งไม่สำเร็จ ต้องตามแก้ | '
  'skipped = อปท. นี้ไม่ได้ตั้งค่าช่องทางนี้ไว้ ไม่ใช่ความล้มเหลว';

COMMIT;
