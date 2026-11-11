-- 20261118100000_exec_digest_dm_categories.sql
--
-- ห้องผู้บริหาร เฟส E3-3 — ไฟล์ 1/3: เพิ่มหมวด Telegram ส่วนตัวที่ปิดรับได้ 2 หมวด
--   exec_digest = สรุปเช้า 07:30 วันทำการ (ผู้บริหาร)
--   exec_alert  = แจ้งทันทีเมื่อมีคะแนนประเมินคำร้อง ≤ 2 (ผู้บริหาร)
-- ค่าเริ่มต้น = รับ (dm_muted ว่าง = รับครบทุกหมวด ตามเดิม — ไม่ต้องแก้ข้อมูลแถวเดิม)
-- เจ้าของระบบตัดสินแล้ว (แผน E3 อนุมัติ 2026-11-10): ผู้บริหารเปิด-ปิดเองได้ในหน้าตั้งค่าแจ้งเตือนเดิม
--
-- ไฟล์นี้มีแต่ CHECK constraint (DDL) — ฟังก์ชันที่รับค่าใหม่อยู่ไฟล์ 2 (20261118100100) แยกตามกติกา NOTES.md ข้อ 3
-- ต้องตรงกับ: TELEGRAM_DM_CATEGORIES (src/lib/telegramLink.js) · set_my_telegram_dm_muted() (ไฟล์ 2)
--
-- ⚠️ ADD CONSTRAINT ตรวจทุกแถวเดิมภายใต้ ACCESS EXCLUSIVE lock ของ telegram_user_links (ตารางเล็ก หลักสิบแถว)
--    ค่าเดิมเป็นเซตย่อยของชุดใหม่เสมอ (ชุดเดิม complaint/event/esign อยู่ในชุดใหม่ครบ) ⇒ ไม่มีแถวล้ม
--    รอคิวล็อกไม่เกิน 5 วินาที (notify-telegram อ่านตารางนี้ทุกครั้งที่ส่ง DM) แล้วล้มทั้งไฟล์ ดีกว่าค้างบล็อกการส่ง
--
-- ย้อนกลับ (ต้องย้อนไฟล์ 2 ก่อน และต้องล้างค่าใหม่ออกก่อน ไม่งั้น ADD CONSTRAINT ล้ม):
--   UPDATE public.telegram_user_links
--      SET dm_muted = ARRAY(SELECT k FROM unnest(dm_muted) AS k WHERE k IN ('complaint', 'event', 'esign'));
--   ALTER TABLE public.telegram_user_links DROP CONSTRAINT telegram_user_links_dm_muted_check;
--   ALTER TABLE public.telegram_user_links ADD CONSTRAINT telegram_user_links_dm_muted_check
--     CHECK (dm_muted <@ ARRAY['complaint', 'event', 'esign']::text[]);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว) — คาด 1 แถว ที่มี exec_digest และ exec_alert:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'telegram_user_links_dm_muted_check';

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'telegram_user_links' AND column_name = 'dm_muted'
  ) THEN
    RAISE EXCEPTION 'exec_digest_dm_categories: ไม่พบ telegram_user_links.dm_muted — ต้อง apply 20261030100000 ก่อน';
  END IF;
END $$;

ALTER TABLE public.telegram_user_links
  DROP CONSTRAINT IF EXISTS telegram_user_links_dm_muted_check;
ALTER TABLE public.telegram_user_links
  ADD CONSTRAINT telegram_user_links_dm_muted_check
  CHECK (dm_muted <@ ARRAY['complaint', 'event', 'esign', 'exec_digest', 'exec_alert']::text[]);

COMMENT ON COLUMN public.telegram_user_links.dm_muted IS
  'หมวดที่ปิดรับทาง Telegram ส่วนตัว (complaint/event/esign/exec_digest/exec_alert) — ค่าว่าง = รับครบ · เขียนผ่าน set_my_telegram_dm_muted()';

COMMIT;
