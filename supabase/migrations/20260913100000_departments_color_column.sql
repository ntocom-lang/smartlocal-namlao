-- สีประจำกอง ใช้เป็นแถบสีบน-ล่างของข้อความแจ้งเตือน Telegram (notify-telegram) ให้เจ้าหน้าที่
-- กวาดตาหางานของกองตัวเองในกลุ่มได้เร็ว แอดมินเลือกเองได้ในหน้า "จัดการกอง/หน่วยงาน"
--
-- ที่มา: เดิมผูกสีกับ departments.code มาตรฐาน (exec/general/finance/engineering/education) ใน
-- edge function แต่ตำหนักธรรมกับทุ่งแค้วสร้างกองเองทั้งหมด code เป็น dept_* ทุกกอง แม้แต่
-- สำนักปลัด/กองช่าง ⇒ ได้แถบ ⬜ เหมือนกันทุกกอง ฟีเจอร์ใช้ไม่ได้เลยใน 2 อปท. นี้
--
-- ⚠️ เก็บเป็น "คีย์สี" ไม่ใช่ตัวอีโมจิ และล็อกด้วย CHECK — ค่านี้ถูกต่อเข้าหัวข้อความ Telegram ที่ส่งแบบ
-- parse_mode HTML ถ้าเปิดให้เก็บข้อความอิสระ ค่าที่มี < > & หรือยาวผิดปกติทำให้บอทส่งข้อความไม่ออก
-- รายการคีย์ต้องตรงกับ DEPARTMENT_COLORS ใน src/lib/departmentColors.js และ DEPARTMENT_COLOR_EMOJI
-- ใน supabase/functions/notify-telegram/index.ts (tests/telegram-notification-message.test.mjs ตรวจให้)
--
-- ไฟล์นี้ DDL อย่างเดียว — ค่าเริ่มต้นกับ trigger อยู่ไฟล์ถัดไป เพราะ ADD COLUMN แล้วอ้างคอลัมน์ใหม่
-- ในไฟล์เดียวกันเจอ 42703 มาแล้ว
-- departments ใช้ table-level GRANT (ไม่ใช่ column-level แบบ municipalities) คอลัมน์ใหม่จึงไม่ต้อง GRANT เพิ่ม

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.departments
  DROP CONSTRAINT IF EXISTS departments_color_check;

ALTER TABLE public.departments
  ADD CONSTRAINT departments_color_check
  CHECK (color IS NULL OR color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'black', 'white'));

COMMENT ON COLUMN public.departments.color IS
  'คีย์สีประจำกอง (red/orange/yellow/green/blue/purple/brown/black/white) ใช้เป็นแถบสีในข้อความแจ้งเตือน Telegram — ว่างได้ trigger departments_fill_color เติมให้ตอนสร้างกอง';
