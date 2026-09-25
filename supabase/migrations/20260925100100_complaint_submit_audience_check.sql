-- 20260925100100_complaint_submit_audience_check.sql
--
-- [เฟสฟังก์ชัน] บังคับ "ใครแจ้งคำร้องหมวดนี้ได้" ที่ทางเข้าเดียวของคำร้องทุกใบ
-- คอลัมน์ complaint_categories.submit_audience มาจาก 20260925100000 (ต้อง apply ก่อน — มีด่านตรวจด้านล่าง)
--
-- หน้าเว็บซ่อนหมวดที่ผู้ใช้ยื่นไม่ได้อยู่แล้ว แต่ฟังก์ชันนี้ GRANT ให้ anon เรียกตรงได้ ต้องกันซ้ำที่นี่
-- ค่าตั้งต้นของทุกหมวดเป็น 'public' — apply แล้วไม่มีผลกับใครจนกว่าแอดมินจะตั้งหมวดใดเป็น 'officials'
--
-- ⚠️ ตัวฟังก์ชันด้านล่างคัดจาก pg_get_functiondef() ของ production วันที่ 2569-09-25 มาทั้งตัว
-- (ตรงกับ 20260917110000_complaint_detail_no_min_length.sql ทุกบรรทัด ตรวจ diff แล้ว)
-- แล้วแทรกเฉพาะบล็อก "ใครแจ้งหมวดนี้ได้" ต่อจากเช็คกองรับผิดชอบ ไม่ได้พิมพ์ใหม่เอง
-- (ทางเข้าเดียวของคำร้องทุกใบ — พลาดบรรทัดเดียวประชาชนทุก อปท. ยื่นคำร้องไม่ได้)
-- CREATE OR REPLACE คงสิทธิ์ EXECUTE เดิม (anon, authenticated) ไว้ ไม่ต้อง GRANT ซ้ำ

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaint_categories'
      AND column_name = 'submit_audience'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260925100000_complaint_category_submit_audience.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

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

  -- ── ใครแจ้งหมวดนี้ได้ (complaint_categories.submit_audience, 20260925100000) ─────────────
  -- 'officials' = เฉพาะผู้มีตำแหน่ง: role ไม่ใช่ประชาชนและสังกัด อปท. เดียวกับคำร้อง (superadmin ผ่านทุกที่)
  -- ⚠️ ตัดสินจากตัวผู้เรียก (auth.uid()) เท่านั้น ห้ามอิง p_channel — client ส่ง 'oss_counter' เองได้
  --    เจ้าหน้าที่รับเรื่องแทนที่เคาน์เตอร์ผ่านเพราะตัวเจ้าหน้าที่เป็นผู้มีตำแหน่ง ไม่ใช่เพราะช่องทาง
  -- ⚠️ ต้องครอบ COALESCE — ผู้ไม่ล็อกอินไม่มีแถวใน profiles ได้ NULL และ IF NOT NULL ไม่ raise (หลุดผ่าน)
  -- ⚠️ ลิสต์ role ต้องตรงกับ OFFICIAL_ROLES ใน src/lib/serviceAudience.js (tests/service-audience.test.mjs ตรวจให้)
  IF v_category.submit_audience = 'officials'
    AND NOT COALESCE((
      SELECT actor.role = 'superadmin'
        OR (
          actor.role IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council')
          AND actor.municipality_id = p_municipality_id
        )
      FROM public.profiles AS actor
      WHERE actor.id = auth.uid()
    ), false)
  THEN
    RAISE EXCEPTION 'ประเภทนี้ยังไม่เปิดให้ประชาชนแจ้งทางออนไลน์ กรุณาแจ้งผ่านสมาชิกสภาในเขตของท่านหรือติดต่อสำนักงาน'
      USING ERRCODE = '42501';
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

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select position('submit_audience' in pg_get_functiondef('public.submit_citizen_complaint_v4(uuid,uuid,text,text,text,text,text,text,double precision,double precision,uuid,text,text,jsonb)'::regprocedure)) > 0;
--   → true
--   select has_function_privilege('anon', 'public.submit_citizen_complaint_v4(uuid,uuid,text,text,text,text,text,text,double precision,double precision,uuid,text,text,jsonb)', 'execute');
--   → true (ประชาชนที่ไม่ล็อกอินยังยื่นหมวด public ได้เหมือนเดิม)
