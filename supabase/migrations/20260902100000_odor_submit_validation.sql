-- 20260902100000_odor_submit_validation.sql
--
-- [ปัญหา P1] เงื่อนไขบังคับของหมวดกลิ่นเหม็นรบกวนอยู่ใน CitizenForm.jsx ฝั่งเดียว
-- (validateOdorFields + buildExtraData) ฐานข้อมูลไม่เคยตรวจเลย ใครก็ตามที่หยิบ anon key
-- จาก JS bundle แล้วเรียก submit_citizen_complaint_v4 ตรงๆ ส่งคำร้อง odor แบบ
-- ไม่มีพิกัด/ไม่มีคำตอบ/ใส่ค่ามั่วได้ทั้งหมด ผลคือ:
--   - หมุดบนแผนที่ผู้บริหารเป็นข้อมูลขยะที่วิเคราะห์ไม่ได้ แต่แยกไม่ออกจากของจริง
--   - ผู้รับผิดชอบได้เรื่องที่ "ไม่รู้จะไปดมจุดไหน" เพราะไม่มีพิกัด
--   - extra_data เป็น jsonb เปิดกว้าง ยัด key/ค่าอะไรเข้ามาก็ได้ รวมถึง acknowledged_at
--     ซึ่งจะทำให้คำร้องขึ้นเป็น "รับทราบแล้ว" ตั้งแต่วินาทีที่ยื่น โดยไม่มีใครรับทราบจริง
--
-- [ทางแก้] ย้ายกฎทั้งชุดมาไว้ที่ฐานข้อมูลซึ่งเป็นด่านสุดท้ายที่ข้ามไม่ได้ ฝั่ง frontend
-- ยังตรวจเหมือนเดิมเพื่อให้ผู้ใช้เห็น error เร็ว (สองชั้น ไม่ใช่ย้ายจากที่หนึ่งไปอีกที่)
--
-- กฎที่เพิ่ม (เฉพาะ p_category = 'odor' ที่เป็นหมวดเฉพาะกิจของ อปท. นั้น):
--   1. latitude/longitude ต้องไม่เป็น NULL
--   2. extra_data ต้องมีจริง และมีได้เฉพาะ 4 key: odor_intensity, odor_time_range,
--      wind_direction, health_effect
--   3. odor_intensity: จำนวนเต็ม 1–5
--   4. odor_time_range ∈ dawn/morning/afternoon/evening (ตรงกับ src/lib/odorTimeRanges.js)
--   5. wind_direction ∈ เหนือ/ใต้/ตะวันออก/ตะวันตก/ลมสงบ (ตรงกับ WIND_DIRECTIONS ใน CitizenForm.jsx)
--   6. health_effect เป็น NULL ได้ ถ้ามีต้องอยู่ใน 4 ตัวเลือกของฟอร์ม
-- กฎที่เพิ่มกับ "ทุกหมวด":
--   7. extra_data ห้ามมี key ที่เป็นของฝั่งเจ้าหน้าที่ (acknowledged_at/acknowledged_by)
--   8. ค่าใน extra_data ต้องเป็น scalar (string/number/boolean/null) ห้าม object/array ซ้อน
--   9. จำกัดจำนวน key ≤ 20, ความยาวชื่อ key ≤ 40, ความยาวค่า string ≤ 500
--
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: OssIntakeForm (รับคำร้องหน้าเคาน์เตอร์ OSS) ส่ง p_extra_data = null
-- และไม่เก็บพิกัด ถ้าเจ้าหน้าที่เลือกหมวด odor จะถูกปฏิเสธพร้อมข้อความบอกให้ไปใช้ฟอร์มที่มี
-- คำถาม+ปักหมุด — ตรงกับเจตนาของหมวดนี้ (ไม่มีพิกัด = วิเคราะห์ไม่ได้) ถ้าต้องการรับหน้าเคาน์เตอร์
-- ต้องเพิ่มคำถามและแผนที่ใน OssIntakeForm ก่อน ไม่ใช่ผ่อนกฎที่นี่
--
-- signature เดิมทุกประการ (RETURNS TABLE ไม่เปลี่ยน) จึงใช้ CREATE OR REPLACE ได้

CREATE OR REPLACE FUNCTION public.submit_citizen_complaint_v4(
  p_id              uuid,
  p_municipality_id uuid,
  p_category        text,
  p_form_type       text,
  p_village         text,
  p_detail          text,
  p_phone           text,
  p_reporter_name   text,
  p_latitude        double precision,
  p_longitude       double precision,
  p_user_id         uuid,
  p_channel         text,
  p_issue_type      text DEFAULT NULL,
  p_extra_data      jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, ref_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category public.complaint_categories%ROWTYPE;
  v_intensity numeric;
  v_health text;
  -- ชุดค่าที่ยอมรับ ต้องตรงกับ src/lib/odorTimeRanges.js และ CitizenForm.jsx
  -- (ที่นี่คือด่านบังคับจริง ฝั่ง client เป็นแค่ UX — แก้ที่ไหนต้องแก้ให้ครบทั้งสองที่)
  c_time_ranges  constant text[] := ARRAY['dawn', 'morning', 'afternoon', 'evening'];
  c_wind         constant text[] := ARRAY['เหนือ', 'ใต้', 'ตะวันออก', 'ตะวันตก', 'ลมสงบ'];
  c_health       constant text[] := ARRAY['เวียนศีรษะ', 'คลื่นไส้', 'ระคายเคืองทางเดินหายใจ', 'ไม่มีอาการทางกาย'];
  c_odor_keys    constant text[] := ARRAY['odor_intensity', 'odor_time_range', 'wind_direction', 'health_effect'];
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id ไม่ตรงกับผู้ใช้ที่ login' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL OR p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'ข้อมูลอ้างอิงคำร้องไม่ครบ' USING ERRCODE = '22023';
  END IF;

  IF p_channel NOT IN ('citizen_online', 'oss_counter') THEN
    RAISE EXCEPTION 'ช่องทางรับคำร้องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(p_detail), '') IS NULL
    OR char_length(btrim(p_detail)) < 10
    OR char_length(p_detail) > 5000
  THEN
    RAISE EXCEPTION 'รายละเอียดคำร้องต้องมี 10-5000 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(p_phone), '') IS NULL OR char_length(p_phone) > 30 THEN
    RAISE EXCEPTION 'เบอร์โทรติดต่อไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF char_length(coalesce(p_reporter_name, '')) > 250
    OR char_length(coalesce(p_village, '')) > 250
    OR char_length(coalesce(p_issue_type, '')) > 250
  THEN
    RAISE EXCEPTION 'ข้อมูลข้อความยาวเกินขอบเขตที่กำหนด' USING ERRCODE = '22023';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
    OR (p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90))
    OR (p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180))
  THEN
    RAISE EXCEPTION 'พิกัดไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF p_extra_data IS NOT NULL THEN
    IF jsonb_typeof(p_extra_data) <> 'object' OR pg_column_size(p_extra_data) > 65536 THEN
      RAISE EXCEPTION 'ข้อมูลประกอบคำร้องไม่ถูกต้องหรือมีขนาดเกิน 64 KB' USING ERRCODE = '22023';
    END IF;

    -- (7) key ของฝั่งเจ้าหน้าที่ ผู้ยื่นคำร้องตั้งเองไม่ได้เด็ดขาด
    IF p_extra_data ?| ARRAY['acknowledged_at', 'acknowledged_by'] THEN
      RAISE EXCEPTION 'ข้อมูลประกอบคำร้องมีฟิลด์ที่สงวนไว้สำหรับเจ้าหน้าที่' USING ERRCODE = '42501';
    END IF;

    -- (8)(9) รูปร่างของ extra_data: object ชั้นเดียว ค่าเป็น scalar เท่านั้น
    IF (SELECT count(*) FROM jsonb_object_keys(p_extra_data)) > 20 THEN
      RAISE EXCEPTION 'ข้อมูลประกอบคำร้องมีฟิลด์มากเกินกำหนด' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_each(p_extra_data) AS entry
      WHERE char_length(entry.key) > 40
         OR jsonb_typeof(entry.value) IN ('object', 'array')
         OR (jsonb_typeof(entry.value) = 'string' AND char_length(entry.value #>> '{}') > 500)
    ) THEN
      RAISE EXCEPTION 'ข้อมูลประกอบคำร้องมีรูปแบบหรือชนิดข้อมูลที่ไม่รองรับ' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_category
  FROM public.complaint_categories
  WHERE municipality_id = p_municipality_id
    AND value = p_category
    AND is_active
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ประเภทคำร้องนี้ยังไม่เปิดใช้งาน' USING ERRCODE = '22023';
  END IF;

  IF v_category.department_id IS NULL THEN
    RAISE EXCEPTION 'ประเภทคำร้องนี้ยังไม่ได้กำหนดกองรับผิดชอบ' USING ERRCODE = '23502';
  END IF;

  -- ── กฎเฉพาะหมวดกลิ่นเหม็นรบกวน ────────────────────────────────────────────
  IF p_category = 'odor' AND v_category.is_adhoc THEN
    -- (1) ไม่มีพิกัด = เจ้าหน้าที่ไม่รู้จะไปตรวจจุดไหน และหมุดวิเคราะห์ก็ไม่เกิด
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'คำร้องกลิ่นเหม็นรบกวนต้องระบุพิกัดจุดที่ได้กลิ่น' USING ERRCODE = '22023';
    END IF;

    IF p_extra_data IS NULL THEN
      RAISE EXCEPTION 'คำร้องกลิ่นเหม็นรบกวนต้องตอบคำถามให้ครบก่อนส่ง' USING ERRCODE = '22023';
    END IF;

    -- (2) whitelist key
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_extra_data) AS k
      WHERE k <> ALL (c_odor_keys)
    ) THEN
      RAISE EXCEPTION 'ข้อมูลประกอบคำร้องกลิ่นเหม็นรบกวนมีฟิลด์ที่ไม่รู้จัก' USING ERRCODE = '22023';
    END IF;

    -- (3) ระดับความรุนแรง 1–5 (จำนวนเต็ม)
    IF jsonb_typeof(p_extra_data -> 'odor_intensity') <> 'number' THEN
      RAISE EXCEPTION 'ระดับความรุนแรงของกลิ่นต้องเป็นตัวเลข 1-5' USING ERRCODE = '22023';
    END IF;
    v_intensity := (p_extra_data ->> 'odor_intensity')::numeric;
    IF v_intensity < 1 OR v_intensity > 5 OR v_intensity <> trunc(v_intensity) THEN
      RAISE EXCEPTION 'ระดับความรุนแรงของกลิ่นต้องเป็นจำนวนเต็ม 1-5' USING ERRCODE = '22023';
    END IF;

    -- (4) ช่วงเวลาที่ได้กลิ่น
    IF coalesce(p_extra_data ->> 'odor_time_range', '') <> ALL (c_time_ranges) THEN
      RAISE EXCEPTION 'ช่วงเวลาที่ได้กลิ่นไม่อยู่ในตัวเลือกที่กำหนด' USING ERRCODE = '22023';
    END IF;

    -- (5) ทิศทางลม
    IF coalesce(p_extra_data ->> 'wind_direction', '') <> ALL (c_wind) THEN
      RAISE EXCEPTION 'ทิศทางลมไม่อยู่ในตัวเลือกที่กำหนด' USING ERRCODE = '22023';
    END IF;

    -- (6) อาการทางสุขภาพ ไม่ตอบก็ได้ แต่ถ้าตอบต้องเป็นตัวเลือกของฟอร์ม
    v_health := nullif(btrim(coalesce(p_extra_data ->> 'health_effect', '')), '');
    IF v_health IS NOT NULL AND v_health <> ALL (c_health) THEN
      RAISE EXCEPTION 'อาการทางสุขภาพไม่อยู่ในตัวเลือกที่กำหนด' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.complaints (
    id, municipality_id, category_id, category, form_type, village, detail, phone,
    reporter_name, latitude, longitude, user_id, channel, department_id,
    issue_type, extra_data
  ) VALUES (
    p_id, p_municipality_id, v_category.id, p_category, p_form_type, p_village,
    p_detail, p_phone, p_reporter_name, p_latitude, p_longitude, p_user_id,
    p_channel, v_category.department_id, p_issue_type, p_extra_data
  );

  RETURN QUERY
  SELECT complaint.id, complaint.ref_no
  FROM public.complaints AS complaint
  WHERE complaint.id = p_id;
END;
$$;

COMMENT ON FUNCTION public.submit_citizen_complaint_v4(
  uuid, uuid, text, text, text, text, text, text,
  double precision, double precision, uuid, text, text, jsonb
) IS
  'รับคำร้องจากประชาชน: resolve category/department ใน DB, ตรวจ PII/ความยาว/พิกัด และบังคับกฎของหมวดเฉพาะกิจ odor (พิกัด + คำตอบ structured ครบตามตัวเลือกที่กำหนด) ที่ระดับฐานข้อมูล ไม่พึ่ง validation ฝั่ง browser';

-- ตรวจหลัง apply (ต้องได้ error ทุกเคส):
--   select * from public.submit_citizen_complaint_v4(gen_random_uuid(), '<muni>', 'odor', 'environment',
--     null, 'ทดสอบข้ามฟอร์ม 10 ตัวอักษร', '0000000000', 'ทดสอบ', null, null, null, 'citizen_online',
--     null, '{"odor_intensity":3,"odor_time_range":"morning","wind_direction":"เหนือ"}'::jsonb);
--     → ต้องได้ 'คำร้องกลิ่นเหม็นรบกวนต้องระบุพิกัดจุดที่ได้กลิ่น'
--   ... p_extra_data => '{"odor_intensity":9,...}' → 'ระดับความรุนแรงของกลิ่นต้องเป็นจำนวนเต็ม 1-5'
--   ... p_extra_data => '{"acknowledged_at":"2026-01-01"}' → 'มีฟิลด์ที่สงวนไว้สำหรับเจ้าหน้าที่'
