-- 20260908100100_odor_submit_block_routed_at.sql
--
-- คู่กับ 20260908100000_odor_auto_route.sql — ปิดช่องให้ผู้ยื่นคำร้องตั้งเวลารับเรื่องเอง
--
-- submit_citizen_complaint_v4 กัน acknowledged_at/acknowledged_by ไว้แล้ว (ข้อ 7 ของไมเกรชัน
-- 20260902100000) ด้วยเหตุผลเดียวกันเป๊ะ: extra_data เป็น jsonb เปิดกว้าง ใครหยิบ anon key จาก
-- bundle แล้วเรียก RPC ตรงๆ ก็ยัดคีย์อะไรก็ได้ พอเปลี่ยนมาใช้ routed_at เป็นสถานะที่ประชาชนเห็น
-- คีย์ใหม่ก็ต้องอยู่ในบัญชีต้องห้ามชุดเดียวกัน ไม่งั้นแค่ปลอมค่ามาก็ทำให้คำร้องขึ้นเป็น
-- "ระบบรับเรื่องแล้ว" ย้อนหลังเป็นปีได้ และตัวเลขในรายงานวิเคราะห์เพี้ยนตาม
--
-- เผื่อ routed_to ไว้ในบัญชีด้วยทั้งที่ยังไม่ได้ใช้ — ถ้าวันหนึ่งเพิ่มคีย์นั้นจริงจะได้ไม่ลืมกลับ
-- มาปิดช่อง (ค่าใช้จ่ายคือศูนย์ เพราะหมวด odor มี whitelist key อยู่แล้วอีกชั้น)
--
-- ⚠️ ไฟล์นี้คัดลอก body ทั้งก้อนของ submit_citizen_complaint_v4 จาก 20260902100000 มาแก้บรรทัดเดียว
-- (บรรทัด IF p_extra_data ?| ARRAY[...]) — CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน จะแก้เฉพาะบางส่วน
-- ไม่ได้ ถ้ามีไมเกรชันอื่นแก้ฟังก์ชันนี้ระหว่างทาง ต้องคัดจากฉบับล่าสุด ไม่ใช่จากไฟล์เดิม
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
  'รับคำร้องจากประชาชน: resolve category/department ใน DB, ตรวจ PII/ความยาว/พิกัด และบังคับกฎของหมวดเฉพาะกิจ odor (พิกัด + คำตอบ structured ครบตามตัวเลือกที่กำหนด) ที่ระดับฐานข้อมูล ไม่พึ่ง validation ฝั่ง browser; ปฏิเสธคีย์ที่เซิร์ฟเวอร์เป็นผู้เขียน (acknowledged_at/acknowledged_by/routed_at/routed_to)';


-- ตรวจหลัง apply:
--   select * from public.submit_citizen_complaint_v4(gen_random_uuid(), '<muni>', 'odor', 'environment',
--     null, 'ทดสอบยัด routed_at เอง 10 ตัวอักษร', '0000000000', 'ทดสอบ', 18.0, 99.0, null, 'citizen_online',
--     null, '{"odor_intensity":3,"odor_time_range":"morning","wind_direction":"เหนือ","routed_at":"2500-01-01"}'::jsonb);
--   → ต้องได้ 'ข้อมูลประกอบคำร้องมีฟิลด์ที่สงวนไว้สำหรับระบบ' (42501)
--   เคสเดิมของ 20260902100000 (ไม่มีพิกัด / ความรุนแรงนอกช่วง / acknowledged_at) ต้องยังได้ error เหมือนเดิม
