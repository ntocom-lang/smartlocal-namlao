-- ไอคอนแอปแบบ maskable ของแต่ละ อปท. (เฟส 1/2: เพิ่มคอลัมน์)
--
-- ปัญหา: manifest ประกาศโลโก้เป็น purpose "any" อย่างเดียว Android จึงวางตราลงกล่องขาวแล้วย่อ
-- เหลือราว 64% ของกรอบ ดูเล็กกว่าแอปอื่นบนหน้าจอชัดเจน จะประกาศโลโก้เดิมเป็น maskable ตรงๆ
-- ก็ไม่ได้ เพราะตราเป็นวงกลมเต็มกรอบ Android จะขลิบขอบตราทิ้ง
--
-- ทางแก้: ตอนแอดมินอัปโหลดโลโก้ เบราว์เซอร์สร้างภาพ 512x512 พื้นขาว วางตรา 80% ของกรอบ
-- (อยู่ใน safe zone ของ maskable icon พอดี) แล้วเก็บ URL ไว้ที่คอลัมน์นี้ ดู src/lib/appIcon.js
-- worker/manifestIcons.js อ่านค่านี้ไปประกาศเป็น purpose "maskable"
--
-- ไม่สร้างภาพที่ Worker: แพ็กเกจฟรีให้ CPU 10ms ต่อคำขอ ไม่พอถอด/อัด PNG และ Cloudflare Images
-- เป็นบริการเสียเงิน ส่วนไฟล์บน Drive ได้ URL ใหม่ทุกครั้ง เดาชื่อล่วงหน้าไม่ได้ จึงต้องเก็บใน DB
--
-- NULL = ยังไม่มีไอคอน (หรือเพิ่งเปลี่ยนโลโก้) — manifest ใช้โลโก้แบบ "any" เหมือนเดิม

BEGIN;

ALTER TABLE public.municipalities
  ADD COLUMN IF NOT EXISTS app_icon_url text;

COMMENT ON COLUMN public.municipalities.app_icon_url IS
  'ไอคอนแอป maskable 512x512 ที่ระบบสร้างจากโลโก้ (พื้นขาว ตรา 80%) — ล้างเป็น NULL ทุกครั้งที่เปลี่ยนโลโก้ ห้ามกรอกเอง';

-- municipalities ใช้ column-level GRANT (docs/ai/NOTES.md ข้อ 4) คอลัมน์ใหม่ไม่ได้สิทธิ์อัตโนมัติ
-- worker อ่านด้วย anon key และหน้าตั้งค่าแอดมินอ่านด้วย authenticated
GRANT SELECT (app_icon_url) ON public.municipalities TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
