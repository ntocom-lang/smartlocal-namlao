-- 20261020160000_complaint_track_token_column.sql
--
-- [เฟส DDL] ลิงก์ติดตามเรื่องของผู้แจ้ง (เฟส 1) — เพิ่มคอลัมน์กับดัชนีเท่านั้น ฟังก์ชันอยู่ไฟล์ถัดไป
-- (20261020160100) — แยกไฟล์ตาม NOTES.md ข้อ 3: ADD COLUMN แล้วอ้างในไฟล์เดียวกันเคยพัง 42703
--
-- ── ทำไมต้องมี ───────────────────────────────────────────────────────────────────────────────
-- คำร้อง 49 จาก 66 เรื่องของน้ำเลา สท. เป็นผู้ยื่นแทนชาวบ้าน (วัด 2026-10-19) ผู้แจ้งตัวจริงไม่มีบัญชี
-- จึงไม่เห็นความคืบหน้า ให้คะแนนไม่ได้ และแจ้งกลับว่ายังไม่เรียบร้อยไม่ได้ (ทั้งสามอย่างผูกกับ auth.uid() ของผู้ยื่น)
-- ref_no เป็นเลขเรียง (ES-69-0123) เดาได้ จึงใช้เป็นกุญแจให้สิทธิ์อะไรเพิ่มไม่ได้ — ต้องมีโทเคนสุ่มแยกต่างหาก
--
-- ── โทเคน ────────────────────────────────────────────────────────────────────────────────────
-- 32 ตัวอักษรฐาน 16 จาก gen_random_uuid() (ไม่ต้องพึ่ง extension) = สุ่ม 122 บิต เดาไม่ได้ในทางปฏิบัติ
-- ให้ค่าเริ่มต้นที่ฝั่งฐานข้อมูล → ฟังก์ชันยื่นคำร้อง submit_citizen_complaint_v4 ("ทางเข้าเดียวของคำร้องทุกใบ")
-- ไม่ต้องแก้สักบรรทัด และคำร้องเดิมทุกใบได้โทเคนทันทีตอน ADD COLUMN (ค่าเริ่มต้นแบบ volatile คำนวณรายแถว)
-- ⚠️ ไม่มีนโยบาย/GRANT ให้ anon อ่านตาราง complaints ตรงๆ โทเคนจึงออกทางฟังก์ชันที่ตรวจสิทธิ์เท่านั้น
--
-- ── คะแนนผ่านลิงก์ ───────────────────────────────────────────────────────────────────────────
-- satisfaction_ratings.via_link แยกคะแนนที่ผู้แจ้งให้เองผ่านลิงก์ ออกจากคะแนนที่เจ้าของเรื่องที่ล็อกอินให้
-- (ใช้ทำรายงาน "คะแนนจากผู้รับบริการตัวจริง" ในอนาคต) แถวเดิมทั้งหมดเป็น false ซึ่งถูกต้อง เพราะลิงก์ยังไม่เคยมี

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS track_token text NOT NULL
  DEFAULT replace(gen_random_uuid()::text, '-', '');

ALTER TABLE public.complaints
  DROP CONSTRAINT IF EXISTS complaints_track_token_format;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_track_token_format CHECK (track_token ~ '^[0-9a-f]{32}$');

CREATE UNIQUE INDEX IF NOT EXISTS complaints_track_token_key
  ON public.complaints (track_token);

COMMENT ON COLUMN public.complaints.track_token IS
  'โทเคนสุ่มของลิงก์ติดตามเรื่อง (/t/<โทเคน>) ผู้ถือลิงก์ดูสถานะ ให้คะแนน และแจ้งกลับได้ — ห้ามใส่ใน view/ฟังก์ชันสาธารณะ ออกได้ทาง get_complaint_track_token() เท่านั้น';

ALTER TABLE public.satisfaction_ratings
  ADD COLUMN IF NOT EXISTS via_link boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.satisfaction_ratings.via_link IS
  'true = ผู้แจ้งให้คะแนนเองผ่านลิงก์ติดตามเรื่อง (rate_complaint_by_track_token) ไม่ใช่เจ้าของเรื่องที่ล็อกอิน';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) = count(distinct track_token) as unique_ok, bool_and(track_token ~ '^[0-9a-f]{32}$') as format_ok
--     from public.complaints;                                  → true, true
--   select count(*) from public.complaints where track_token is null;  → 0
