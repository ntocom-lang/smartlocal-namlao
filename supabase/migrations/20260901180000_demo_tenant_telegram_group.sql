-- ผูกกลุ่ม Telegram ของสนามซ้อมเข้าระบบแจ้งเตือน (เฉพาะ slug='demo' เท่านั้น)
--
-- ที่มา: E2E 2026-08-30 ปิดข้อ no-telegram-console-error ไม่ได้ เพราะสนามซ้อมไม่เคยผูกกลุ่ม
-- notify-telegram จึงคืน skipped ทุกครั้ง = เส้นทาง "ส่งจริง" ไม่เคยถูกทดสอบบนสนามซ้อมเลย
--
-- chat_id -5021899409 = กลุ่ม "เทศบาลตำบลสาธิต" ซึ่งเป็นกลุ่มทดสอบ ไม่ใช่กลุ่มงานของ อปท. จริง
-- (ค่าเป็น chat id ของกลุ่ม ไม่ใช่ความลับ ต่างจาก TELEGRAM_BOT_TOKEN ที่เก็บเป็น Edge Function
--  secret และห้ามอยู่ใน repo เด็ดขาด)
--
-- ⚠️ กลุ่มนี้เป็น "group" ธรรมดา ยังไม่ใช่ supergroup ถ้าวันหนึ่งถูกอัปเกรด (เพิ่มสมาชิกจำนวนมาก
-- หรือตั้ง public link) Telegram จะเปลี่ยน chat id เป็นแบบ -100xxxxxxxxxx แล้วแจ้งเตือนจะเงียบ
-- โดยไม่มี error ให้เห็น ต้องกลับมาแก้ค่าที่นี่ใหม่
--
-- ⚠️ demo.rk-networks.com เปิดสาธารณะ ใครเดา URL ถูกก็ยื่นคำร้องเข้ามาได้ ข้อความจะถูก push
-- เข้ากลุ่มนี้ทันทีโดยไม่มีตัวกรอง ห้ามเอา chat id ของกลุ่มงาน อปท. จริงมาใส่ที่ slug='demo'

BEGIN;

UPDATE public.municipalities
SET telegram_group_id = '-5021899409'
WHERE slug = 'demo';

DO $$
DECLARE
  demo_rows int;
  leaked_rows int;
BEGIN
  SELECT count(*) INTO demo_rows
    FROM public.municipalities
   WHERE slug = 'demo' AND telegram_group_id::text = '-5021899409';

  IF demo_rows <> 1 THEN
    RAISE EXCEPTION 'คาดว่าจะตั้งค่าให้ slug=demo หนึ่งแถว แต่ได้ % แถว', demo_rows;
  END IF;

  -- ด่านกันพลาดที่สำคัญที่สุดของไฟล์นี้: chat id ของสนามซ้อมต้องไม่ไปโผล่ที่ อปท. อื่นเด็ดขาด
  -- ไม่งั้นคำร้องจริงของประชาชนจะถูกส่งเข้ากลุ่มทดสอบ
  SELECT count(*) INTO leaked_rows
    FROM public.municipalities
   WHERE slug <> 'demo' AND telegram_group_id::text = '-5021899409';

  IF leaked_rows > 0 THEN
    RAISE EXCEPTION 'chat id ของสนามซ้อมไปอยู่กับ อปท. อื่น % แถว — ยกเลิกทั้งหมด', leaked_rows;
  END IF;
END $$;

COMMIT;
