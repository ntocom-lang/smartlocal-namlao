-- 20261021100000_cctv_footage_request_guard.sql
--
-- บริการ "ขอภาพจากกล้องวงจรปิด (CCTV)" (document_type = 'cctv_footage_request') — ด่านฐานข้อมูล + ปิดเป็นค่าเริ่มต้น
--
-- ไม่มีตารางใหม่ ไม่มีคอลัมน์ใหม่: ตัวคำขอเป็นแถวของ document_requests ตามเดิม รายละเอียดเหตุการณ์เก็บใน
-- permit_form_data (jsonb ที่มีอยู่แล้ว) เหมือนคำร้องขอรับการช่วยเหลือประชาชน
--
-- ── ทำไมต้องมีด่านที่ฐานข้อมูล ───────────────────────────────────────────────────────────────────
-- นโยบาย INSERT ของ document_requests ปล่อยให้ผู้ไม่ล็อกอินยื่นประเภทไหนก็ได้ (ผู้ยื่นทั่วไปไม่ต้องล็อกอิน) ถ้ากัน
-- "ต้องล็อกอิน" ที่หน้าจออย่างเดียว ใครยิง REST ตรงด้วย anon key ก็ยื่นขอภาพกล้องโดยไม่มีตัวตนได้
-- ด่านนี้จึงอยู่ที่ trigger ของตัวเอง **ไม่แตะ route_document_request_department()** — ฟังก์ชันนั้นถูก
-- CREATE OR REPLACE ทับทั้งตัวมาแล้วหลายรอบ และเคยพังทั้งระบบจากการคัดลอกไม่ครบ (docs/ai/NOTES.md ข้อ 5)
-- ชื่อ trigger เรียงก่อน protect_* / route_* ตามตัวอักษร จึงปฏิเสธก่อนที่ใครจะถูกส่งเรื่องเข้ากอง
--
-- ด่านตรวจ (ทุกข้อ RAISE พร้อมข้อความไทยที่ส่งให้ผู้ใช้อ่านได้):
--   1. ต้องล็อกอิน · สังกัด อปท. ที่ยื่น (superadmin ผ่านทุกที่) · user_id ต้องเป็นตัวเอง
--   2. อปท. ต้องเปิดบริการอยู่ (ไม่อยู่ใน fee_schedule._removed_types — สวิตช์เดียวกับที่แอดมินกดที่หน้า
--      "ประเภทคำขอเอกสาร")
--   3. รูปแบบ/ช่วงค่าของ permit_form_data (ประเภทเหตุ วัน-เวลา ช่วงเวลา ≤ 180 นาที ฐานะผู้ขอ ฯลฯ)
--   4. จำกัด 5 คำขอ/คน/วัน (rpc_rate_limit_hit ฝั่งผู้ล็อกอินนับราย uid) — นับหลังตรวจข้อมูลผ่านแล้วเท่านั้น
--      กรอกผิดแล้วลองใหม่ไม่เสียโควตา
-- ข้ามด่านเมื่อไม่มี JWT (psql/migration) หรือเป็น service_role — แพทเทิร์นเดียวกับ 20260925120000
--
-- ⚠️ ตัวเลขใน ด่านนี้ต้องตรงกับ src/lib/cctvRequest.js (ค่าคงที่ CCTV_*) — tests/cctv-request.test.mjs เทียบให้
-- ⚠️ ผู้มีตำแหน่งสร้างคำขอแทนที่เคาน์เตอร์ไม่ได้ในรอบแรก (user_id ต้องเป็นผู้เรียก) — เป็นขอบเขตที่ตั้งใจ
--    เมนู "สร้างคำขอ walk-in" ของเจ้าหน้าที่ซ่อนประเภทนี้ไว้แล้ว
-- ⚠️ ภาพกล้องคือข้อมูลส่วนบุคคลของทุกคนที่อยู่ในภาพ ฐานทางกฎหมายที่เปิดเผยให้ผู้ขอและระเบียบ CCTV ของ อปท.
--    ต้องยืนยันกับตัวบทฉบับปัจจุบันและ DPO ก่อนที่ อปท. ใดจะเปิดสวิตช์ — ระบบเก็บแค่คำขอ ไม่รับ/ส่งไฟล์วิดีโอ
--
-- ── ปิดเป็นค่าเริ่มต้น ─────────────────────────────────────────────────────────────────────────────
-- BASE_DOCUMENT_TYPES เปิดทุกตัวโดยปริยายและปิดได้ด้วย _removed_types ไฟล์นี้จึง "เติมค่านี้ลงทุก อปท. ที่มีอยู่"
-- (ผู้ดูแล อปท. กดสวิตช์เปิดเองที่หน้าเดิม) และตั้ง trigger ให้ อปท. ที่สร้างใหม่ปิดไว้เหมือนกัน
-- ใช้ซ้ำได้: เติมเฉพาะแถวที่ยังไม่มีค่านี้ — อปท. ที่เปิดแล้ว (ค่าถูกถอดออก) ถ้า apply ไฟล์นี้ซ้ำจะถูกปิดกลับ
-- จึง **ห้าม apply ซ้ำหลังมี อปท. เปิดใช้งานแล้ว** (apply ครั้งแรกครั้งเดียวผ่าน schema_migrations)

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_cctv_footage_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_form      jsonb := NEW.permit_form_data;
  v_role      text;
  v_muni      uuid;
  v_today     date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_date      date;
  v_from      time;
  v_to        time;
  v_minutes   numeric;
  v_label     text;
  v_desc      text;
  v_bad_key   text;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'cctv_footage_request' THEN
    RETURN NEW;
  END IF;

  -- ข้ามด่านเมื่อไม่มี JWT (psql/migration) หรือเป็น service_role
  IF auth.role() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- 1) ตัวตนผู้ยื่น
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'บริการขอภาพกล้องวงจรปิดต้องเข้าสู่ระบบก่อนยื่นคำขอ'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.role, profile.municipality_id INTO v_role, v_muni
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid();

  IF COALESCE(v_role, '') <> 'superadmin' AND v_muni IS DISTINCT FROM NEW.municipality_id THEN
    RAISE EXCEPTION 'บัญชีนี้ไม่ได้สังกัดหน่วยงานที่ยื่นคำขอ'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'คำขอภาพกล้องวงจรปิดต้องยื่นในชื่อบัญชีของผู้ขอเอง'
      USING ERRCODE = '42501';
  END IF;

  -- 2) อปท. เปิดบริการหรือยัง (สวิตช์เดียวกับหน้า "ประเภทคำขอเอกสาร" = ไม่อยู่ใน _removed_types)
  IF EXISTS (
    SELECT 1 FROM public.municipalities AS municipality
    WHERE municipality.id = NEW.municipality_id
      AND jsonb_typeof(municipality.fee_schedule -> '_removed_types') = 'array'
      AND (municipality.fee_schedule -> '_removed_types') ? 'cctv_footage_request'
  ) THEN
    RAISE EXCEPTION 'หน่วยงานนี้ยังไม่เปิดบริการขอภาพจากกล้องวงจรปิด'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'คำขอใหม่ต้องเริ่มที่สถานะรอดำเนินการ'
      USING ERRCODE = '22023';
  END IF;

  -- 3) รูปแบบข้อมูลเหตุการณ์
  IF v_form IS NULL OR jsonb_typeof(v_form) <> 'object'
     OR pg_column_size(v_form) > 4096
     OR v_form ->> 'form_type' IS DISTINCT FROM 'cctv_footage_request' THEN
    RAISE EXCEPTION 'ข้อมูลคำขอภาพกล้องวงจรปิดไม่ครบหรือไม่ถูกรูปแบบ'
      USING ERRCODE = '22023';
  END IF;

  -- ไม่รับคีย์นอกรายการ — กันยัดข้อมูลอื่นลงใบที่เจ้าหน้าที่อ่านทุกใบ
  SELECT key INTO v_bad_key
  FROM jsonb_object_keys(v_form) AS key
  WHERE key <> ALL (ARRAY[
    'form_type', 'form_version', 'incident_type', 'incident_date', 'time_from', 'time_to',
    'camera_id', 'camera_label', 'description', 'requester_role', 'police_ref'
  ])
  LIMIT 1;
  IF v_bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'ข้อมูลคำขอมีช่องที่ระบบไม่รู้จัก: %', v_bad_key
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_form -> 'incident_type') IS DISTINCT FROM 'string'
     OR (v_form ->> 'incident_type') NOT IN ('property_lost', 'road_accident', 'assault', 'property_damage', 'other') THEN
    RAISE EXCEPTION 'ประเภทเหตุไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_form -> 'requester_role') IS DISTINCT FROM 'string'
     OR (v_form ->> 'requester_role') NOT IN ('victim', 'party', 'investigator') THEN
    RAISE EXCEPTION 'ฐานะของผู้ขอไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_form -> 'incident_date') IS DISTINCT FROM 'string'
     OR (v_form ->> 'incident_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'วันที่เกิดเหตุไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_date := (v_form ->> 'incident_date')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'วันที่เกิดเหตุไม่ถูกต้อง' USING ERRCODE = '22023';
  END;
  IF v_date > v_today THEN
    RAISE EXCEPTION 'วันที่เกิดเหตุต้องไม่เกินวันนี้' USING ERRCODE = '22023';
  END IF;
  IF v_today - v_date > 365 THEN
    RAISE EXCEPTION 'เหตุเกิดนานเกิน 1 ปี ไม่มีภาพให้ขอแล้ว' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_form -> 'time_from') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_form -> 'time_to') IS DISTINCT FROM 'string'
     OR (v_form ->> 'time_from') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR (v_form ->> 'time_to') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'เวลาที่ขอภาพไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_from := (v_form ->> 'time_from')::time;
  v_to   := (v_form ->> 'time_to')::time;
  v_minutes := EXTRACT(EPOCH FROM (v_to - v_from)) / 60;
  IF v_minutes <= 0 THEN
    RAISE EXCEPTION 'เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น (ขอได้ภายในวันเดียว)' USING ERRCODE = '22023';
  END IF;
  IF v_minutes > 180 THEN
    RAISE EXCEPTION 'ขอภาพได้ไม่เกิน 3 ชั่วโมงต่อคำขอ' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_form -> 'camera_label') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'กรุณาระบุจุดกล้องหรือสถานที่เกิดเหตุ' USING ERRCODE = '22023';
  END IF;
  v_label := btrim(v_form ->> 'camera_label');
  IF v_label = '' OR char_length(v_label) > 120 THEN
    RAISE EXCEPTION 'จุดกล้อง/สถานที่เกิดเหตุต้องมี 1–120 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  -- camera_id: ว่างได้ ถ้ามีต้องเป็นข้อความสั้น (uuid ของจุดในศูนย์ข้อมูล)
  IF v_form ? 'camera_id' AND jsonb_typeof(v_form -> 'camera_id') NOT IN ('null', 'string') THEN
    RAISE EXCEPTION 'รหัสจุดกล้องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_form -> 'camera_id') = 'string' AND char_length(v_form ->> 'camera_id') > 64 THEN
    RAISE EXCEPTION 'รหัสจุดกล้องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF v_form ? 'description' AND jsonb_typeof(v_form -> 'description') <> 'string' THEN
    RAISE EXCEPTION 'รายละเอียดเหตุการณ์ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_desc := btrim(COALESCE(v_form ->> 'description', ''));
  IF char_length(v_desc) > 300 THEN
    RAISE EXCEPTION 'รายละเอียดเหตุการณ์ยาวเกิน 300 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF (v_form ->> 'incident_type') = 'other' AND v_desc = '' THEN
    RAISE EXCEPTION 'เลือก "อื่นๆ" ต้องอธิบายเหตุการณ์สั้นๆ' USING ERRCODE = '22023';
  END IF;

  IF v_form ? 'police_ref' AND jsonb_typeof(v_form -> 'police_ref') <> 'string' THEN
    RAISE EXCEPTION 'เลขที่ใบแจ้งความไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_form ->> 'police_ref', '')) > 50 THEN
    RAISE EXCEPTION 'เลขที่ใบแจ้งความยาวเกิน 50 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  IF char_length(COALESCE(NEW.purpose, '')) > 200 THEN
    RAISE EXCEPTION 'วัตถุประสงค์ยาวเกิน 200 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  -- 4) จำกัดจำนวนต่อคนต่อวัน (ผู้ล็อกอินนับราย uid) — ท้ายสุด ข้อมูลผิดไม่เสียโควตา
  IF NOT public.rpc_rate_limit_hit('cctv_footage_request', 5, interval '1 day') THEN
    RAISE EXCEPTION 'ยื่นคำขอภาพกล้องวงจรปิดครบจำนวนต่อวันแล้ว กรุณาลองใหม่พรุ่งนี้'
      USING ERRCODE = 'PT429';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_cctv_footage_request() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_cctv_footage_request() IS
  'ด่านคำขอภาพกล้องวงจรปิด (document_requests): ต้องล็อกอิน/สังกัด/เปิดบริการ/รูปแบบข้อมูล/โควตา 5 ต่อวัน — ไม่แตะ route_document_request_department';

DROP TRIGGER IF EXISTS guard_cctv_footage_request_trigger ON public.document_requests;
CREATE TRIGGER guard_cctv_footage_request_trigger
  BEFORE INSERT ON public.document_requests
  FOR EACH ROW
  WHEN (NEW.document_type = 'cctv_footage_request')
  EXECUTE FUNCTION public.guard_cctv_footage_request();

-- ── ปิดเป็นค่าเริ่มต้น: เติมลง อปท. ที่มีอยู่ + ตั้ง trigger ให้ อปท. ใหม่ ──────────────────────────
UPDATE public.municipalities
SET fee_schedule = jsonb_set(
  COALESCE(fee_schedule, '{}'::jsonb),
  '{_removed_types}',
  COALESCE(
    CASE WHEN jsonb_typeof(fee_schedule -> '_removed_types') = 'array' THEN fee_schedule -> '_removed_types' END,
    '[]'::jsonb
  ) || to_jsonb('cctv_footage_request'::text)
)
WHERE NOT COALESCE(
  jsonb_typeof(fee_schedule -> '_removed_types') = 'array'
  AND (fee_schedule -> '_removed_types') ? 'cctv_footage_request',
  false
);

CREATE OR REPLACE FUNCTION public.municipality_default_cctv_off()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT COALESCE(
    jsonb_typeof(NEW.fee_schedule -> '_removed_types') = 'array'
    AND (NEW.fee_schedule -> '_removed_types') ? 'cctv_footage_request',
    false
  ) THEN
    NEW.fee_schedule := jsonb_set(
      COALESCE(NEW.fee_schedule, '{}'::jsonb),
      '{_removed_types}',
      COALESCE(
        CASE WHEN jsonb_typeof(NEW.fee_schedule -> '_removed_types') = 'array' THEN NEW.fee_schedule -> '_removed_types' END,
        '[]'::jsonb
      ) || to_jsonb('cctv_footage_request'::text)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ฟังก์ชัน trigger ไม่ต้องให้ API เรียกได้ (เรียกตรงไม่ได้อยู่แล้ว แต่ไม่เปิดสิทธิ์ที่ไม่จำเป็น)
REVOKE ALL ON FUNCTION public.municipality_default_cctv_off() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.municipality_default_cctv_off() IS
  'อปท. ที่สร้างใหม่ปิดบริการขอภาพกล้องวงจรปิดไว้ก่อน (เติมลง fee_schedule._removed_types) — แอดมินกดเปิดเองหลังตัดสินนโยบาย';

DROP TRIGGER IF EXISTS municipalities_default_cctv_off_trigger ON public.municipalities;
CREATE TRIGGER municipalities_default_cctv_off_trigger
  BEFORE INSERT ON public.municipalities
  FOR EACH ROW
  EXECUTE FUNCTION public.municipality_default_cctv_off();

COMMIT;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select slug, fee_schedule -> '_removed_types' ? 'cctv_footage_request' as cctv_off from public.municipalities order by slug;
--   → true ทุกแถว
--   select tgname from pg_trigger where tgrelid = 'public.document_requests'::regclass and not tgisinternal order by tgname;
--   → guard_cctv_footage_request_trigger อยู่ก่อน protect_document_request_scope_trigger และ route_document_request_department_trigger
