-- ผูกกลุ่ม Telegram ของ อบต.ทุ่งแค้ว เข้าระบบแจ้งเตือน (เฉพาะ slug='thungkaew')
--
-- ⚠️ ต่างจากสนามซ้อม: ทุ่งแค้วเป็น อปท. ที่ให้บริการประชาชนจริง ข้อความที่ส่งเข้ากลุ่มนี้จะมี
-- ประเภทเรื่องและสถานที่ของคำร้องจริง (ไม่มีชื่อ/เบอร์ผู้แจ้ง — ตรวจแล้วที่ notify-telegram)
-- ก่อนเปิดใช้ต้องมั่นใจว่าสมาชิกในกลุ่มเป็นเจ้าหน้าที่ที่มีหน้าที่รับเรื่องเท่านั้น (PDPA)
--
-- chat_id -5571753861 = กลุ่ม "อบต.ทุ่งแค้ว" ยืนยันจาก getUpdates ของบอทเมื่อ 2026-08-30
-- เป็น chat id ของกลุ่ม ไม่ใช่ความลับ ต่างจาก TELEGRAM_BOT_TOKEN ที่อยู่ใน Edge Function secret
--
-- ⚠️ ถ้ากลุ่มถูกอัปเกรดเป็น supergroup (สมาชิกเยอะขึ้นหรือตั้ง public link) Telegram จะเปลี่ยน
-- chat id เป็นแบบ -100xxxxxxxxxx แล้วแจ้งเตือนจะเงียบโดยไม่มี error ต้องกลับมาแก้ค่าที่นี่

BEGIN;

UPDATE public.municipalities
SET telegram_group_id = '-5571753861'
WHERE slug = 'thungkaew';

DO $$
DECLARE
  target_rows int;
  clash_rows int;
  clash_slugs text;
BEGIN
  SELECT count(*) INTO target_rows
    FROM public.municipalities
   WHERE slug = 'thungkaew' AND telegram_group_id::text = '-5571753861';

  IF target_rows <> 1 THEN
    RAISE EXCEPTION 'คาดว่าจะตั้งค่าให้ slug=thungkaew หนึ่งแถว แต่ได้ % แถว', target_rows;
  END IF;

  -- ด่านสำคัญที่สุด: หนึ่งกลุ่มต้องผูกกับ อปท. เดียวเท่านั้น ถ้าซ้ำแปลว่ากรอก chat id ผิด แล้ว
  -- คำร้องของ อปท. หนึ่งจะไหลไปโผล่ในกลุ่มของอีก อปท. หนึ่ง
  SELECT count(*), string_agg(slug, ', ') INTO clash_rows, clash_slugs
    FROM public.municipalities
   WHERE slug <> 'thungkaew' AND telegram_group_id::text = '-5571753861';

  IF clash_rows > 0 THEN
    RAISE EXCEPTION 'chat id นี้ถูกใช้โดย อปท. อื่นแล้ว (%) — ยกเลิกทั้งหมด', clash_slugs;
  END IF;
END $$;

COMMIT;
