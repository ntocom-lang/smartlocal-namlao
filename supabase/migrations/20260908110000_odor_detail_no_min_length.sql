-- 20260908110000_odor_detail_no_min_length.sql
--
-- ยกเลิกขั้นต่ำ 10 ตัวอักษรของช่องรายละเอียด "เฉพาะหมวดกลิ่นเหม็นรบกวน" เท่านั้น
--
-- [เหตุผล] หมวดนี้ต่างจากหมวดอื่นตรงที่บังคับคำตอบ structured ครบชุดอยู่แล้ว (ความรุนแรง 1-5,
-- ช่วงเวลาที่ได้กลิ่น, ทิศทางลม, อาการทางสุขภาพ) บวกกับพิกัด GPS ที่บังคับกรอก เจ้าหน้าที่จึงลงพื้นที่
-- ตรวจได้แม้ผู้แจ้งพิมพ์แค่ "เหม็นมาก" — ข้อมูลที่ใช้ทำงานจริงไม่ได้อยู่ในช่องรายละเอียด
-- ต่างจากหมวดถนน/ไฟฟ้าที่ไม่มีอะไรรองรับเลย ถ้าได้ detail มาว่า "พัง" คำเดียวจะสั่งการต่อไม่ได้
-- และข้อความนั้นจะไหลไปขึ้นใบพิมพ์เสนอผู้บังคับบัญชากับข้อความแจ้งเตือน Telegram ตรงๆ
--
-- [ยังบังคับเหมือนเดิม] ห้ามว่าง และยาวไม่เกิน 5000 ตัวอักษร — ทุกหมวดรวมทั้งกลิ่นเหม็น
-- ผู้แจ้งยังต้องพิมพ์อะไรสักอย่างเสมอ เพื่อให้ใบพิมพ์ราชการไม่มีช่องว่างเปล่า
--
-- [ทำไมต้องย้ายลำดับการตรวจ] เดิมด่านรายละเอียดอยู่ก่อน SELECT INTO v_category จึงยังไม่รู้ว่า
-- หมวดนี้เป็นหมวดเฉพาะกิจหรือไม่ รอบนี้แยกเป็น 2 ท่อน: ท่อน "ห้ามว่าง/ห้ามยาวเกิน" คงไว้ที่เดิม
-- (ไม่ต้องรู้จักหมวด) ส่วนท่อน "อย่างน้อย 10 ตัวอักษร" ย้ายลงไปหลัง resolve หมวด เพื่อใช้เงื่อนไข
-- p_category = 'odor' AND v_category.is_adhoc แบบเดียวกับกฎอื่นของหมวดนี้ที่มีอยู่แล้ว
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: ถ้าส่งหมวดที่ไม่มีอยู่จริงมาพร้อมรายละเอียดสั้น จะได้ error เรื่องหมวด
-- ก่อน error เรื่องความยาว (เดิมสลับกัน) — ไม่กระทบผู้ใช้จริงเพราะฟอร์มเลือกหมวดจากรายการเท่านั้น
--
-- [ทำไมไม่ใช้ complaint_category_is_adhoc()] เจตนาคือยกเว้นให้ "หมวดกลิ่นเหม็น" เพราะชุดคำถามของ
-- มันรองรับ ไม่ใช่ยกเว้นให้ "หมวดเฉพาะกิจ" ทุกตัว หมวดเฉพาะกิจตัวใหม่ในอนาคตอาจไม่มีคำถาม
-- structured เลย แล้วจะได้รับการยกเว้นนี้ไปฟรีๆ โดยไม่มีใครตั้งใจ — ระบุชื่อหมวดตรงๆ ปลอดภัยกว่า
--
-- ⚠️ ไฟล์นี้คัดลอก body ทั้งก้อนของ submit_citizen_complaint_v4 มาจาก 20260908100100
-- (ฉบับล่าสุดที่อยู่บนฐานจริง ยืนยันด้วยการเทียบ pg_get_functiondef แล้วว่าตรงกันทุกตัวอักษร)
-- ไม่ใช่จาก 20260902100000 ไม่งั้นกฎบล็อก routed_at/routed_to ที่เพิ่งใส่ไปจะหายกลับ
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

  -- ห้ามว่างและห้ามยาวเกิน 5000 — บังคับทุกหมวดไม่มีข้อยกเว้น ตรวจตรงนี้ได้เพราะไม่ต้องรู้จักหมวด
  -- ส่วนขั้นต่ำ 10 ตัวอักษรย้ายลงไปหลัง resolve หมวดแล้ว (ดูหัวไฟล์)
  IF NULLIF(btrim(p_detail), '') IS NULL OR char_length(p_detail) > 5000 THEN
    RAISE EXCEPTION 'รายละเอียดคำร้องต้องไม่ว่างและยาวไม่เกิน 5000 ตัวอักษร' USING ERRCODE = '22023';
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

    -- (7) key ที่ฝั่งเซิร์ฟเวอร์เป็นคนเขียนเท่านั้น ผู้ยื่นคำร้องตั้งเองไม่ได้เด็ดขาด
    --     acknowledged_* = การรับทราบของบุคคล (สายงานเดิม), routed_at = เวลาที่ระบบรับเรื่อง
    --     ซึ่ง route_adhoc_complaint() ประทับให้ตอน INSERT
    IF p_extra_data ?| ARRAY['acknowledged_at', 'acknowledged_by', 'routed_at', 'routed_to'] THEN
      RAISE EXCEPTION 'ข้อมูลประกอบคำร้องมีฟิลด์ที่สงวนไว้สำหรับระบบ' USING ERRCODE = '42501';
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

  -- ขั้นต่ำ 10 ตัวอักษร: ทุกหมวด "ยกเว้น" กลิ่นเหม็นรบกวน ซึ่งมีคำตอบ structured + พิกัดบังคับ
  -- รองรับอยู่แล้ว (ดูเหตุผลเต็มที่หัวไฟล์) หมวดอื่นยังบังคับเหมือนเดิมทุกประการ
  IF NOT (p_category = 'odor' AND v_category.is_adhoc)
    AND char_length(btrim(p_detail)) < 10
  THEN
    RAISE EXCEPTION 'รายละเอียดคำร้องต้องมีอย่างน้อย 10 ตัวอักษร' USING ERRCODE = '22023';
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
  'รับคำร้องจากประชาชน: resolve category/department ใน DB, ตรวจ PII/ความยาว/พิกัด และบังคับกฎของหมวดเฉพาะกิจ odor (พิกัด + คำตอบ structured ครบตามตัวเลือกที่กำหนด) ที่ระดับฐานข้อมูล ไม่พึ่ง validation ฝั่ง browser; ปฏิเสธคีย์ที่เซิร์ฟเวอร์เป็นผู้เขียน (acknowledged_at/acknowledged_by/routed_at/routed_to); รายละเอียดขั้นต่ำ 10 ตัวอักษรทุกหมวดยกเว้น odor ซึ่งมีคำตอบ structured รองรับ';



-- ตรวจหลัง apply — หมวดกลิ่นต้องผ่าน หมวดอื่นต้องยังโดนบล็อกเหมือนเดิม
-- ⚠️ เคสที่ "ผ่าน" จะสร้างคำร้องจริงในฐาน ใช้กับ tenant demo เท่านั้น แล้วลบทิ้งหลังตรวจ
--
--   1) odor + รายละเอียดสั้น 8 ตัวอักษร → ต้องผ่าน (คืน id/ref_no)
--      select * from public.submit_citizen_complaint_v4(gen_random_uuid(), <muni>, odor, environment,
--        null, [ข้อความสั้น], 0000000000, [TEST], 18.0, 100.0, null, citizen_online, null,
--        {"odor_intensity":3,"odor_time_range":"morning","wind_direction":"เหนือ"}::jsonb);
--
--   2) หมวดปกติ (trash) + รายละเอียดสั้น → ต้องได้ error
--      "รายละเอียดคำร้องต้องมีอย่างน้อย 10 ตัวอักษร"
--
--   3) odor + รายละเอียดว่าง → ต้องได้ error
--      "รายละเอียดคำร้องต้องไม่ว่างและยาวไม่เกิน 5000 ตัวอักษร"
--
--   4) เคสเดิมของ 20260908100100 ต้องยังถูกปฏิเสธเหมือนเดิม (ยัด routed_at มาเอง
--      → "ข้อมูลประกอบคำร้องมีฟิลด์ที่สงวนไว้สำหรับระบบ") และเคสของ 20260902100000
--      (odor ไม่มีพิกัด / ความรุนแรงนอกช่วง 1-5) ต้องยังได้ error เดิมทุกข้อ
