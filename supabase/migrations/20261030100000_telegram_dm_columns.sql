-- ข้อ 3b ส่วนที่ 2 ตั้งค่าแจ้งเตือน (เจ้าของระบบอนุมัติ 2569-10-30): ส่งงานที่มอบหมายให้บุคลากรทาง Telegram ส่วนตัว
-- ไฟล์นี้มีแต่ DDL — ฟังก์ชันที่อ้างคอลัมน์ใหม่อยู่ไฟล์ถัดไป (20261030100100) แยกตามกติกา migration ของโปรเจกต์
--
-- 1) telegram_user_links.dm_muted — หมวดที่เจ้าของบัญชีปิดรับทาง Telegram เก็บบน server
--    (สวิตช์ปิดเด้งในหน้าเว็บเก็บใน localStorage ฝั่งส่งอ่านไม่ได้ จึงต้องเป็นค่าคนละชุด)
--    ค่าเริ่มต้น = รับครบทุกหมวด · เขียนผ่าน set_my_telegram_dm_muted() เท่านั้น
-- 2) notification_deliveries รับช่องทาง 'telegram_dm' — กันส่งซ้ำรายคน และย้อนตรวจได้ว่าส่งถึงใครเมื่อไร

BEGIN;

ALTER TABLE public.telegram_user_links
  ADD COLUMN IF NOT EXISTS dm_muted text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.telegram_user_links
  DROP CONSTRAINT IF EXISTS telegram_user_links_dm_muted_check;
ALTER TABLE public.telegram_user_links
  ADD CONSTRAINT telegram_user_links_dm_muted_check
  CHECK (dm_muted <@ ARRAY['complaint', 'event', 'esign']::text[]);

COMMENT ON COLUMN public.telegram_user_links.dm_muted IS
  'หมวดที่ปิดรับทาง Telegram ส่วนตัว (complaint/event/esign) — ค่าว่าง = รับครบ · เขียนผ่าน set_my_telegram_dm_muted()';

-- column-level SELECT เดิมให้แค่ user_id/tg_display/linked_at — เพิ่มช่องนี้ให้หน้าเว็บโชว์สวิตช์ได้ (ยังไม่เห็น chat_id)
GRANT SELECT (dm_muted) ON public.telegram_user_links TO authenticated;

ALTER TABLE public.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check
  CHECK (channel IN ('telegram', 'push', 'telegram_dm'));

COMMIT;
