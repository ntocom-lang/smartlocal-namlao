-- 20260917110000_complaint_detail_no_min_length.sql
--
-- ยกเลิกขั้นต่ำ 10 ตัวอักษรของช่องรายละเอียดคำร้อง "ทุกหมวด"
--
-- เจ้าของระบบสั่ง 2569-09-17: ให้กรอกกี่ตัวอักษรก็ได้ — ยังบังคับว่าต้องกรอก (ห้ามว่าง) และยาวไม่เกิน
-- 5000 ตัวอักษรเหมือนเดิม กฎนั้นอยู่ท่อนบนของฟังก์ชันและไม่ถูกแตะ
--
-- ของเดิม: 20260908110000 ยกเว้นให้เฉพาะหมวดกลิ่นเหม็นรบกวน หมวดอื่นยังบังคับ 10 ตัวอักษร
-- ผลคือผู้ร้องที่พิมพ์สั้น เช่น "ไฟดับ" ถูกปฏิเสธทั้งที่ข้อความสื่อความชัดพอ
--
-- ⚠️ ข้อเสียที่รับทราบแล้ว: คำร้องบางใบจะมีรายละเอียดสั้นมากจนสั่งงานต่อไม่ได้ ข้อความนี้ไหลไปขึ้น
-- ใบพิมพ์เสนอผู้บังคับบัญชาและข้อความแจ้งเตือน Telegram โดยตรง — ผู้รับผิดชอบแก้ข้อความได้เอง
-- (edit_complaint_text จาก 20260915110100) และมีหมวด/ลักษณะปัญหา/สถานที่/พิกัด/รูปประกอบอยู่แล้ว
--
-- ⚠️ ตัวฟังก์ชันด้านล่างคัดจาก pg_get_functiondef() ของ production วันที่ 2569-09-17 มาทั้งตัว
-- แล้วลบเฉพาะบล็อก "ขั้นต่ำ 10 ตัวอักษร" ออก ไม่ได้พิมพ์ใหม่เอง (กันพลาดบรรทัดอื่นของฟังก์ชัน
-- ที่เป็นทางเข้าเดียวของคำร้องทุกใบ)

CREATE OR REPLACE FUNCTION public.submit_citizen_complaint_v4(p_id uuid, p_municipality_id uuid, p_category text, p_form_type text, p_village text, p_detail text, p_phone text, p_reporter_name text, p_latitude double precision, p_longitude double precision, p_user_id uuid, p_channel text, p_issue_type text DEFAULT NULL::text, p_extra_data jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(id uuid, ref_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;
