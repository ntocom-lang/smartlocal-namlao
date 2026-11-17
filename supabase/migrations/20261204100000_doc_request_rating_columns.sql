-- 20261204100000_doc_request_rating_columns.sql
--
-- [เฟสคอลัมน์ 1/2] ประเมินความพึงพอใจรายเรื่องของคำขอ E-Service (แผนเทียบคู่แข่ง ข้อ 1.2 · เจ้าของระบบอนุมัติ 2569-11-17)
-- ต้อง apply ก่อน 20261204100100 (ฟังก์ชัน/policy/trigger ที่อ้างคอลัมน์ในไฟล์นี้ — docs/ai/NOTES.md ข้อ 3)
--
-- 1) satisfaction_ratings.document_request_id — ผูกคะแนนกับคำขอ ใช้ตารางเดิมเพราะหน้าผลการประเมิน รายงานอัตราตอบ (#681)
--    และห้องผู้บริหารอ่านตารางนี้อยู่แล้ว
--    - ON DELETE SET NULL: admin ลบคำขอ (สแปม/ทดสอบ) แล้วคะแนนยังอยู่เป็นสถิติ ไม่หายไปพร้อมคำขอ (กติกาเดียวกับ complaint_id)
--    - CHECK ห้ามผูกทั้งคำร้องและคำขอในแถวเดียว — SET NULL ทำให้กลายเป็น NULL ทั้งคู่ได้ ซึ่งผ่าน CHECK นี้ (ไม่พังตอนลบ)
--    - unique (document_request_id, is_verified) รูปเดียวกับคำร้อง: 1 คำขอ = 1 คะแนนจากผู้ยื่นที่ยืนยันตัวตน
--      (ช่อง unverified เผื่อไว้ถ้าวันหน้ามีลิงก์ติดตามคำขอแบบไม่ล็อกอิน — ตอนนี้ไม่มีทางเขียนช่องนั้น)
--      แถวคำร้อง/แบบประเมินรวมมี document_request_id เป็น NULL ⇒ ไม่ชนกัน (Postgres ถือ NULL ไม่เท่ากัน)
--
-- 2) document_requests.finished_at — เวลาที่คำขอปิด (เสร็จสิ้น/ไม่อนุมัติ) ประทับโดย trigger ในไฟล์ 2 เท่านั้น
--    ทำไมต้องมี: ตารางนี้ไม่มีเวลาปิดเรื่อง — issued_at มีเฉพาะใบที่แนบไฟล์เอกสาร, updated_at ขยับทุกครั้งที่แก้อะไรก็ได้
--    ใช้กับ (ก) ช่วงชวนประเมิน 30 วันหลังปิด (ข) อัตราตอบรายเดือนตามเดือนที่ปิด (สูตรเดียวกับคำร้อง #681)
--    แถวเดิมเป็น NULL โดยตั้งใจ — ไม่ย้อนเติมจาก updated_at เพราะจะได้วันที่ที่ดูเหมือนจริงแต่ไม่ใช่ (สตง. ทักได้)
--    ผลข้างเคียง: คำขอที่ปิดก่อนไฟล์นี้ไม่เด้งชวนประเมินเอง (ปุ่มประเมินที่การ์ดยังกดได้) และไม่เข้ารายงานรายเดือน
--
-- ย้อนกลับ (ต้องถอนไฟล์ 2 ก่อน):
--   DROP INDEX IF EXISTS public.satisfaction_ratings_doc_request_once;
--   ALTER TABLE public.satisfaction_ratings DROP CONSTRAINT IF EXISTS satisfaction_ratings_one_subject,
--                                          DROP COLUMN IF EXISTS document_request_id;
--   ALTER TABLE public.document_requests DROP COLUMN IF EXISTS finished_at;
--   ⚠️ ถ้ามีคะแนนคำขอแล้ว DROP COLUMN จะทำให้แถวนั้นกลายเป็น "ประเมินภาพรวม" ในรายงาน — export หรือ DELETE ก่อน (เจ้าของระบบตัดสิน)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND (table_name, column_name) IN
--         (('satisfaction_ratings', 'document_request_id'), ('document_requests', 'finished_at'));   → 2 แถว uuid / timestamp with time zone
--   SELECT indexname FROM pg_indexes WHERE indexname = 'satisfaction_ratings_doc_request_once';     → 1 แถว

BEGIN;

-- ตารางที่ประชาชนใช้ทั้งวัน — ถ้ามีธุรกรรมค้างล็อกไว้ ให้ล้มเร็วแล้วรันใหม่ ดีกว่ารอจนคิวคำขอค้างทั้งระบบ
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.satisfaction_ratings') IS NULL OR to_regclass('public.document_requests') IS NULL THEN
    RAISE EXCEPTION 'doc_request_rating: ไม่พบตาราง satisfaction_ratings หรือ document_requests';
  END IF;
  -- คอลัมน์ชื่อเดียวกันที่มีอยู่ก่อนแต่ชนิดไม่ตรง = drift ต้องหยุดหาสาเหตุ ไม่ข้ามด้วย IF NOT EXISTS เงียบๆ
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'satisfaction_ratings'
               AND column_name = 'document_request_id' AND data_type <> 'uuid') THEN
    RAISE EXCEPTION 'Column drift: satisfaction_ratings.document_request_id มีอยู่แล้วแต่ไม่ใช่ uuid';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'document_requests'
               AND column_name = 'finished_at' AND data_type <> 'timestamp with time zone') THEN
    RAISE EXCEPTION 'Column drift: document_requests.finished_at มีอยู่แล้วแต่ไม่ใช่ timestamptz';
  END IF;
END $guard$;

ALTER TABLE public.satisfaction_ratings
  ADD COLUMN IF NOT EXISTS document_request_id uuid REFERENCES public.document_requests(id) ON DELETE SET NULL;

ALTER TABLE public.satisfaction_ratings
  DROP CONSTRAINT IF EXISTS satisfaction_ratings_one_subject;
-- แถวเดิมทุกแถวมี document_request_id เป็น NULL จึงผ่านทันที ไม่ต้อง NOT VALID
ALTER TABLE public.satisfaction_ratings
  ADD CONSTRAINT satisfaction_ratings_one_subject CHECK (complaint_id IS NULL OR document_request_id IS NULL);

-- ไม่ใช้ partial index — ON CONFLICT inference ต้องใส่ predicate ซ้ำทุกครั้ง (เหตุผลเดียวกับ satisfaction_ratings_complaint_once)
-- ตารางเล็ก (หลักร้อยแถว) สร้างแบบปกติในธุรกรรมได้ ไม่ต้อง CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS satisfaction_ratings_doc_request_once
  ON public.satisfaction_ratings (document_request_id, is_verified);

COMMENT ON COLUMN public.satisfaction_ratings.document_request_id IS
  'คะแนนของคำขอ E-Service — เขียนได้ทางเดียวผ่าน rate_document_request() (ผู้ยื่นที่เป็นประชาชนและล็อกอินเท่านั้น) '
  'ห้ามผูกพร้อม complaint_id · รายงานต้องแยกจาก "ประเมินภาพรวม" (complaint_id และ document_request_id เป็น NULL ทั้งคู่)';

ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

COMMENT ON COLUMN public.document_requests.finished_at IS
  'เวลาที่คำขอเข้าสถานะ completed/rejected ล่าสุด — trigger stamp_document_request_finished_at ประทับเอง ไม่เชื่อค่าจากเบราว์เซอร์ '
  'ถอยกลับไปสถานะอื่น = NULL · แถวที่ปิดก่อนมีคอลัมน์นี้เป็น NULL (ไม่ย้อนเติม)';

NOTIFY pgrst, 'reload schema';

COMMIT;
