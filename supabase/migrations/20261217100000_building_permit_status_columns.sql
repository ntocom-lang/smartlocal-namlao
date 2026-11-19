-- 20261217100000_building_permit_status_columns.sql
--
-- ขั้นย่อยของคำขออนุญาตก่อสร้าง + เลขที่/วันออก/วันหมดอายุใบอนุญาต (ขั้น 1A แผนเทียบคู่แข่ง ข้อ 11)
-- เจ้าของระบบอนุมัติแผน 2569-11-19
--
-- ไฟล์ 1 ของ 2 — DDL อย่างเดียว (กติกาโปรเจกต์: ADD COLUMN แล้วอ้างในไฟล์เดียวกัน = 42703 ⇒ แยกไฟล์)
-- ไฟล์ 2 (20261217100100) = ด่านกันแก้ตรง + RPC ที่ตรวจสิทธิ์ + บันทึก audit_logs
--
-- ทำไมเป็นคอลัมน์ใน document_requests ไม่ใช่ทะเบียนใบอนุญาต 1B (licences, 20261208100000)
--   ทะเบียน 1B ออกแบบตาม พ.ร.บ.การสาธารณสุข: business_name NOT NULL, ค่าธรรมเนียมรายปี, ต่ออายุโดยชำระ
--   (renewal_by_fee) และ category CHECK ไม่มีหมวดอาคาร — ใบอนุญาตก่อสร้างไม่เข้ารูป ยัดเข้าไปได้สูตรต่ออายุผิด
-- ทำไมไม่ใส่ใน permit_form_data (jsonb ของแบบ ข.๑)
--   ก้อนนั้นเป็นคำตอบของผู้ยื่น — เจ้าหน้าที่เขียนทับทั้งก้อนเสี่ยงชนกัน และไม่มีบันทึกย้อนตรวจ
--
-- หลักการ
--   - "หมดอายุ" ไม่เก็บเป็นสถานะ คำนวณจาก permit_expires_on เทียบวันนี้ทุกครั้ง (กันสถานะค้างผิด)
--   - วันหมดอายุ = ตามที่พิมพ์ในใบอนุญาตจริง เจ้าหน้าที่กรอก · ระบบไม่คำนวณจากกฎหมาย
--     (อายุใบอนุญาตตาม พ.ร.บ.ควบคุมอาคาร พ.ศ. ๒๕๒๒ ยังไม่ได้ยืนยันกับตัวบทฉบับปัจจุบัน)
--   - ระบบไม่ตัดสินอนุญาต — ขั้นย่อยเป็นการแจ้งความคืบหน้า ผลอนุญาต/ไม่อนุญาตยังเป็นการตัดสินของผู้มีอำนาจ
--   - permit_stage_by ไม่มี FK (แบบเดียวกับ appointment_set_by #750 — กันชน trigger ตอนลบบัญชี)
--   - ทุกคอลัมน์ NULL ได้ แถวเดิมไม่ต้อง backfill · ไม่ผูกกับ status 4 ค่าเดิม
--
-- ย้อนกลับ: ALTER TABLE public.document_requests DROP CONSTRAINT …(3 ตัว), DROP COLUMN …(6 ตัว)
--           (รันไฟล์ 2 แล้วต้อง DROP ฟังก์ชัน/trigger ของไฟล์ 2 ก่อน)

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ด่าน drift: คอลัมน์ชื่อเดียวกันที่มีอยู่ก่อนแต่ชนิดไม่ตรง = ต้องหยุดหาสาเหตุ ไม่ข้ามด้วย IF NOT EXISTS เงียบๆ
DO $guard$
DECLARE
  v_bad text;
BEGIN
  IF to_regclass('public.document_requests') IS NULL THEN
    RAISE EXCEPTION 'building_permit_status: ไม่พบตาราง document_requests';
  END IF;
  SELECT string_agg(c.column_name || ':' || c.data_type, ', ') INTO v_bad
  FROM information_schema.columns AS c
  JOIN (VALUES ('permit_stage', 'text'), ('permit_no', 'text'), ('permit_issued_on', 'date'),
               ('permit_expires_on', 'date'), ('permit_stage_at', 'timestamp with time zone'),
               ('permit_stage_by', 'uuid')) AS want(col, typ) ON want.col = c.column_name
  WHERE c.table_schema = 'public' AND c.table_name = 'document_requests' AND c.data_type <> want.typ;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Column drift: document_requests มีคอลัมน์ชื่อเดียวกันแต่ชนิดไม่ตรง: %', v_bad;
  END IF;
END $guard$;

ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS permit_stage      text,
  ADD COLUMN IF NOT EXISTS permit_no         text,
  ADD COLUMN IF NOT EXISTS permit_issued_on  date,
  ADD COLUMN IF NOT EXISTS permit_expires_on date,
  ADD COLUMN IF NOT EXISTS permit_stage_at   timestamptz,
  ADD COLUMN IF NOT EXISTS permit_stage_by   uuid;

ALTER TABLE public.document_requests
  DROP CONSTRAINT IF EXISTS document_requests_permit_stage_check,
  DROP CONSTRAINT IF EXISTS document_requests_permit_fields_check,
  DROP CONSTRAINT IF EXISTS document_requests_permit_dates_check;

-- NULL = ยังไม่เริ่มขั้นย่อย (รับคำขอแล้ว) · ลำดับ: ตรวจเอกสาร → ตรวจสถานที่/แบบ → เสนอพิจารณา → ออกใบแล้ว รอรับ → รับใบแล้ว
ALTER TABLE public.document_requests
  ADD CONSTRAINT document_requests_permit_stage_check CHECK (
    permit_stage IS NULL
    OR coalesce(document_type = 'building_permit'
                AND permit_stage IN ('doc_check', 'site_inspection', 'review', 'issued', 'collected'), false)
  ),
  -- เลขที่/วันที่มีได้เฉพาะขั้นที่ออกใบแล้ว · เลขที่ 1–60 ตัวอักษร (แบบเดียวกับ licences.licence_no)
  -- coalesce: permit_stage NULL → "NULL IN (…)" = NULL ทั้ง CHECK จะได้ NULL ซึ่ง Postgres ถือว่าผ่าน (ผลตรวจรอบ 1 ข้อ 2)
  ADD CONSTRAINT document_requests_permit_fields_check CHECK (
    (coalesce(permit_stage IN ('issued', 'collected'), false)
      OR (permit_no IS NULL AND permit_issued_on IS NULL AND permit_expires_on IS NULL))
    AND (permit_no IS NULL OR length(btrim(permit_no)) BETWEEN 1 AND 60)
  ),
  -- กันกรอกปี พ.ศ. ลงช่องวันที่ (2569 → ปี ค.ศ. 2569) และวันหมดอายุก่อนวันออก
  ADD CONSTRAINT document_requests_permit_dates_check CHECK (
    (permit_issued_on IS NULL OR permit_issued_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
    AND (permit_expires_on IS NULL OR permit_expires_on BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
    AND (permit_issued_on IS NULL OR permit_expires_on IS NULL OR permit_expires_on > permit_issued_on)
  );

-- รองรับเตือนก่อนหมดอายุ/ตัวเลขห้องผู้บริหารในเฟสถัดไป (ใบที่มีวันหมดอายุเท่านั้น — partial index เล็ก)
CREATE INDEX IF NOT EXISTS document_requests_permit_expiry_idx
  ON public.document_requests (municipality_id, permit_expires_on)
  WHERE permit_expires_on IS NOT NULL;

COMMENT ON COLUMN public.document_requests.permit_stage IS
  'ขั้นย่อยคำขออนุญาตก่อสร้าง (NULL=รับคำขอ/doc_check/site_inspection/review/issued/collected) — แก้ผ่าน set_building_permit_stage เท่านั้น';
COMMENT ON COLUMN public.document_requests.permit_expires_on IS
  'วันหมดอายุตามที่พิมพ์ในใบอนุญาตจริง (เจ้าหน้าที่กรอก ระบบไม่คำนวณจากกฎหมาย) · "หมดอายุ" คำนวณจากวันที่ ไม่เก็บสถานะ';

NOTIFY pgrst, 'reload schema';

COMMIT;
