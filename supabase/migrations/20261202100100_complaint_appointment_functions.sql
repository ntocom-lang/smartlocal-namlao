-- 20261202100100_complaint_appointment_functions.sql
-- งาน 1.1 แผนเทียบคู่แข่ง (แกน E1) เฟส 2/2 — ต้องรัน 20261202100000_complaint_appointment_columns.sql ก่อน
--
-- ของในไฟล์นี้
--   CHECK ของคอลัมน์ใหม่ (complaints.appointment_*, complaint_categories.fee_rates/fee_reference/track_photos)
--   complaint_fee_rates_valid(jsonb)          ตัวตรวจรูปร่างตารางอัตรา (ใช้ใน CHECK)
--   guard_complaint_appointment()             trigger: คอลัมน์ appointment_* เขียนได้ผ่าน RPC เท่านั้น
--   complaint_is_off_day(date, uuid)          ตัวช่วยภายใน: เสาร์-อาทิตย์/วันหยุดของ อปท. (กติกาเดียวกับ add_working_days)
--   complaint_thai_date(date)                 ตัวช่วยภายใน: "5 ธ.ค. 2569" สำหรับบันทึกในไทม์ไลน์
--   set_complaint_appointment(...)            เจ้าหน้าที่ยืนยัน/เลื่อน/ยกเลิกวันนัด — authenticated
--   complaint_photo_drive_id(text)            ตัวช่วยภายใน: ดึง Drive file id จาก URL รูปคำร้อง
--   complaint_track_photos(complaints)        ตัวช่วยภายใน: รูปที่หน้า /t/ แสดงได้
--   get_complaint_by_track_token(text, uuid)  เพิ่ม appointment / preferred_date / requires_appointment / fee / photos
--
-- ⚠️ get_complaint_by_track_token: CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (NOTES.md ข้อ 5)
--   ตั้งต้นจาก 20261020160100_complaint_track_token_functions.sql (นิยามล่าสุดในรีโป)
--   เทียบกับ pg_get_functiondef ของฐานจริงแล้ว 2026-11-17: เนื้อฟังก์ชันตรงกันทุกบรรทัด (ต่างแค่รูปแบบ SET/$function$)
--   ของเดิมทุกคีย์คงไว้ครบ เพิ่มคีย์ใหม่ท้าย object เท่านั้น
--
-- ── ผู้ถือลิงก์ /t/ เห็นอะไรเพิ่ม (PDPA) ──────────────────────────────────────────────────────────────
-- เห็นเพิ่ม: วันนัด + ช่วงเวลา + ข้อความถึงผู้แจ้ง (เฉพาะเรื่องที่ยังไม่เสร็จ) · วันที่ผู้แจ้งเสนอไว้ (ก่อนมีวันนัด)
--           ตารางอัตราของหมวด (ข้อมูลสาธารณะตามข้อบัญญัติ) · Drive file id ของรูปตามกติกา complaint_track_photos
-- ยังไม่เห็นเหมือนเดิม: ชื่อ เบอร์ พิกัด รายละเอียด ชื่อเจ้าหน้าที่ หมายเหตุในไทม์ไลน์ id ของคำร้อง
-- รูป: ส่งแค่ file id หน้าเว็บโหลดผ่าน drive-file?id=.. (ไม่ผ่าน /_img/ ของ Worker — edgeImage.js ข้อ 3)
--      ⚠️ ข้อเท็จจริง (ตรวจฐานจริง 2026-11-17): รูปคำร้องทุกรูป (235/235 ทั้งรูปผู้แจ้งและรูปผลงาน) เป็น drive_files.is_public = true
--      เพราะ drive-upload จัด complaint-attachments ไว้ใน PUBLIC_BUCKETS และแชร์ไฟล์ Drive แบบ "ทุกคนที่มีลิงก์"
--      ⇒ ใครมี file id ก็เปิดรูปได้อยู่แล้วโดยไม่ต้องล็อกอิน (ข้อความหัว 20261020160100 ที่ว่ารูปเป็น private ไม่ตรงความจริง)
--      ด่านเดียวของ /t/ จึงอยู่ที่ "ฟังก์ชันนี้คืน file id ไหนบ้าง" — การเปลี่ยนรูปคำร้องให้เป็น private เป็นงานแยก
--      (กระทบ <img> ทุกจุดที่ไม่ส่ง Authorization เช่น MyComplaints) รอเจ้าของระบบตัดสิน
--
-- ⚠️ เส้นที่ไม่ทำอัตโนมัติ: ไม่รับเงิน ไม่คำนวณยอดที่ต้องจ่ายจริง (อัตราแสดงอย่างเดียว) ไม่เลื่อน due_date ตามวันนัด
--
-- ── ย้อนกลับ (ย้อนไฟล์นี้ก่อน แล้วค่อยย้อน 20261202100000) ──
--   1) รัน CREATE OR REPLACE FUNCTION public.get_complaint_by_track_token ... จาก 20261020160100 บรรทัด 88-192 ซ้ำ (ทั้งก้อนรวม REVOKE/GRANT)
--   2) DROP TRIGGER IF EXISTS trg_guard_complaint_appointment ON public.complaints;
--   3) DROP FUNCTION IF EXISTS public.set_complaint_appointment(uuid, date, text, text, boolean), public.complaint_track_photos(public.complaints),
--        public.complaint_photo_drive_id(text), public.complaint_thai_date(date), public.complaint_is_off_day(date, uuid),
--        public.guard_complaint_appointment();
--   4) ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_appointment_slot_check,
--        DROP CONSTRAINT IF EXISTS complaints_appointment_consistency, DROP CONSTRAINT IF EXISTS complaints_appointment_note_check;
--      ALTER TABLE public.complaint_categories DROP CONSTRAINT IF EXISTS complaint_categories_fee_rates_check,
--        DROP CONSTRAINT IF EXISTS complaint_categories_fee_reference_check, DROP CONSTRAINT IF EXISTS complaint_categories_track_photos_check;
--   5) DROP FUNCTION IF EXISTS public.complaint_fee_rates_valid(jsonb);   (หลัง DROP CONSTRAINT เท่านั้น)

BEGIN;
-- ADD CONSTRAINT / CREATE TRIGGER ถือล็อกแรงบน complaints — ต่อคิวนานเกินให้ล้มเองแทนการค้างทั้งระบบคำร้อง
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'appointment_set_by'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaint_categories' AND column_name = 'track_photos'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261202100000_complaint_appointment_columns.sql ก่อน';
  END IF;
  IF to_regclass('public.public_holidays') IS NULL THEN
    RAISE EXCEPTION 'ต้องมีตาราง public.public_holidays ก่อน (20260831100000_public_holidays.sql)';
  END IF;
  IF to_regprocedure('public.complaint_worker_can_act(public.complaints)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20260915110100_complaint_finish_by_assignee.sql ก่อน';
  END IF;
  IF to_regprocedure('public.get_complaint_by_track_token(text,uuid)') IS NULL
     OR to_regprocedure('public.complaint_track_caller_is_staff()') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261020160100_complaint_track_token_functions.sql ก่อน';
  END IF;
  -- plpgsql ไม่ตรวจชนิดตอน CREATE — ถ้าชนิดไม่ตรง หน้า /t/ จะพังทุกครั้งที่เปิด จึงตรวจก่อน (ฐานจริง 2026-11-17: jsonb / ARRAY)
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'work_photos') IS DISTINCT FROM 'jsonb'
     OR (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'attachments') IS DISTINCT FROM 'ARRAY' THEN
    RAISE EXCEPTION 'ชนิดคอลัมน์ complaints.work_photos (ต้องเป็น jsonb) / attachments (ต้องเป็น text[]) ไม่ตรงที่ไฟล์นี้เขียนไว้';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- CHECK
-- ══════════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_appointment_slot_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_appointment_slot_check
  CHECK (appointment_slot IS NULL OR appointment_slot IN ('morning', 'afternoon', 'allday'));

ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_appointment_consistency;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_appointment_consistency
  CHECK ((appointment_date IS NULL) = (appointment_slot IS NULL));

ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_appointment_note_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_appointment_note_check
  CHECK (appointment_note IS NULL OR char_length(appointment_note) <= 300);

-- รูปร่างตารางอัตรา: array ≤ 20 แถว · แถวละ {item 1-120, unit 1-40, rate ตัวเลข 0-1,000,000, note ≤ 200 (ไม่ใส่ก็ได้)}
-- plpgsql วนทีละแถว — เงื่อนไข AND ใน SQL ไม่รับประกันลำดับ cast ::numeric จะพังกับค่าที่ไม่ใช่ตัวเลขก่อนถูกกรอง
-- ⚠️ ห้าม REVOKE ฟังก์ชันนี้จาก authenticated: Postgres ตรวจสิทธิ์ EXECUTE ของฟังก์ชันใน CHECK ด้วยสิทธิ์ของผู้ที่ INSERT/UPDATE
--    ถอนแล้วแอดมินจะแก้หมวดคำร้องไม่ได้เลย (ฟังก์ชันไม่อ่านตาราง ไม่มีอะไรรั่ว)
-- ⚠️ แก้ให้เข้มขึ้นภายหลัง แถวเดิมจะไม่ถูกตรวจซ้ำ — ต้อง DROP/ADD constraint ใหม่
CREATE OR REPLACE FUNCTION public.complaint_fee_rates_valid(p_rates jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_row  jsonb;
  v_key  text;
  v_rate numeric;
BEGIN
  IF p_rates IS NULL OR jsonb_typeof(p_rates) <> 'array' OR jsonb_array_length(p_rates) > 20 THEN
    RETURN false;
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rates) LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN RETURN false; END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
      IF v_key NOT IN ('item', 'unit', 'rate', 'note') THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_typeof(v_row -> 'item') IS DISTINCT FROM 'string'
       OR char_length(btrim(v_row ->> 'item')) NOT BETWEEN 1 AND 120 THEN RETURN false; END IF;
    IF jsonb_typeof(v_row -> 'unit') IS DISTINCT FROM 'string'
       OR char_length(btrim(v_row ->> 'unit')) NOT BETWEEN 1 AND 40 THEN RETURN false; END IF;
    IF jsonb_typeof(v_row -> 'rate') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    v_rate := (v_row ->> 'rate')::numeric;
    IF v_rate < 0 OR v_rate > 1000000 THEN RETURN false; END IF;
    IF v_row ? 'note' AND jsonb_typeof(v_row -> 'note') <> 'null' THEN
      IF jsonb_typeof(v_row -> 'note') <> 'string' OR char_length(v_row ->> 'note') > 200 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE public.complaint_categories DROP CONSTRAINT IF EXISTS complaint_categories_fee_rates_check;
ALTER TABLE public.complaint_categories
  ADD CONSTRAINT complaint_categories_fee_rates_check
  CHECK (public.complaint_fee_rates_valid(fee_rates));

ALTER TABLE public.complaint_categories DROP CONSTRAINT IF EXISTS complaint_categories_fee_reference_check;
ALTER TABLE public.complaint_categories
  ADD CONSTRAINT complaint_categories_fee_reference_check
  CHECK (fee_reference IS NULL OR char_length(fee_reference) <= 300);

ALTER TABLE public.complaint_categories DROP CONSTRAINT IF EXISTS complaint_categories_track_photos_check;
ALTER TABLE public.complaint_categories
  ADD CONSTRAINT complaint_categories_track_photos_check
  CHECK (track_photos IN ('none', 'after', 'both'));

-- ══════════════════════════════════════════════════════════════════════════════════
-- trigger: appointment_* เขียนได้ผ่าน set_complaint_appointment() เท่านั้น (แบบเดียวกับ guard_complaint_parked)
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.guard_complaint_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trusted boolean := auth.role() IS NULL
                       OR auth.role() = 'service_role'
                       OR coalesce(current_setting('app.complaint_appointment', true), '') = '1';
BEGIN
  IF v_trusted THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.appointment_date IS NOT NULL OR NEW.appointment_slot IS NOT NULL OR NEW.appointment_note IS NOT NULL
       OR NEW.appointment_set_at IS NOT NULL OR NEW.appointment_set_by IS NOT NULL THEN
      RAISE EXCEPTION 'วันนัดตั้งตอนยื่นคำร้องไม่ได้ (ใส่วันที่สะดวกในข้อมูลประกอบแทน)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.appointment_date   IS DISTINCT FROM OLD.appointment_date
     OR NEW.appointment_slot   IS DISTINCT FROM OLD.appointment_slot
     OR NEW.appointment_note   IS DISTINCT FROM OLD.appointment_note
     OR NEW.appointment_set_at IS DISTINCT FROM OLD.appointment_set_at
     OR NEW.appointment_set_by IS DISTINCT FROM OLD.appointment_set_by THEN
    RAISE EXCEPTION 'วันนัดแก้ได้ผ่านปุ่ม "นัดหมาย" เท่านั้น (set_complaint_appointment)' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_complaint_appointment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_complaint_appointment ON public.complaints;
CREATE TRIGGER trg_guard_complaint_appointment
BEFORE INSERT OR UPDATE OF appointment_date, appointment_slot, appointment_note, appointment_set_at, appointment_set_by
ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_appointment();

-- ══════════════════════════════════════════════════════════════════════════════════
-- ตัวช่วยภายใน
-- ══════════════════════════════════════════════════════════════════════════════════
-- วันหยุด = เสาร์-อาทิตย์ หรือมีแถวใน public_holidays ที่ is_working_day = false
-- แถวของ อปท. มาก่อนแถวทั่วประเทศ — กติกาเดียวกับ add_working_days() (20260927220000) และ src/lib/workingDays.js
CREATE OR REPLACE FUNCTION public.complaint_is_off_day(p_day date, p_municipality_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_off boolean;
BEGIN
  IF p_day IS NULL THEN
    RETURN NULL;
  END IF;
  IF extract(isodow FROM p_day) >= 6 THEN
    RETURN true;
  END IF;
  SELECT NOT h.is_working_day INTO v_off
  FROM public.public_holidays h
  WHERE h.holiday_date = p_day
    AND (h.municipality_id = p_municipality_id OR h.municipality_id IS NULL)
  ORDER BY (h.municipality_id IS NULL)
  LIMIT 1;
  RETURN coalesce(v_off, false);
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_is_off_day(date, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complaint_thai_date(p_day date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_day IS NULL THEN NULL ELSE
    extract(day FROM p_day)::int::text || ' '
    || (ARRAY['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month FROM p_day)::int]
    || ' ' || (extract(year FROM p_day)::int + 543)::text
  END
$$;

REVOKE ALL ON FUNCTION public.complaint_thai_date(date) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- set_complaint_appointment — เจ้าหน้าที่ยืนยัน / เลื่อน / ยกเลิกวันนัด
-- ══════════════════════════════════════════════════════════════════════════════════
-- p_date NULL = ยกเลิกนัด (p_note = เหตุผล ไม่บังคับ)
-- วันหยุด: ไม่บันทึก คืน {ok:false, code:'off_day'} ให้หน้าจอถามยืนยัน แล้วเรียกซ้ำด้วย p_allow_off_day = true
-- ไม่แตะ status และ due_date — นัดหลังกำหนดคืน after_due = true ให้หน้าจอขึ้นป้าย (เจ้าของเลือก 2026-11-17)
-- ทุกครั้งที่เปลี่ยน = 1 แถวใน complaint_timeline (status 'appointment' / 'appointment_cleared') ย้อนตรวจได้
CREATE OR REPLACE FUNCTION public.set_complaint_appointment(
  p_complaint_id   uuid,
  p_date           date,
  p_slot           text    DEFAULT NULL,
  p_note           text    DEFAULT NULL,
  p_allow_off_day  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c        public.complaints%ROWTYPE;
  v_today    date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_actor    text;
  v_slot_lbl text;
  v_text     text;
  v_resched  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF p_complaint_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบเรื่อง' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(public.complaint_worker_can_act(v_c), false) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์นัดหมายเรื่องนี้' USING ERRCODE = '42501';
  END IF;
  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RAISE EXCEPTION 'หมวดเฉพาะกิจไม่ใช้การนัดหมาย' USING ERRCODE = '22023';
  END IF;
  -- 'new' = รอรับเรื่องแบบเดียวกับ 'pending' (complaintIntake.js) · ไม่ตรวจ requires_appointment โดยตั้งใจ:
  -- สวิตช์รายหมวดคุมแค่ "ถามวันที่สะดวก + แสดงกล่องนัด" เจ้าหน้าที่นัดหมวดอื่นได้เมื่อจำเป็น (ยกเว้นหมวดเฉพาะกิจ)
  IF coalesce(v_c.status, '') NOT IN ('new', 'pending', 'received', 'in_progress') THEN
    RAISE EXCEPTION 'นัดหมายได้เฉพาะเรื่องที่ยังดำเนินการอยู่' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'ข้อความถึงผู้แจ้งยาวได้ไม่เกิน 300 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor
  FROM public.profiles WHERE id = auth.uid();
  v_actor := coalesce(v_actor, 'เจ้าหน้าที่');

  -- ── ยกเลิกนัด ──
  IF p_date IS NULL THEN
    IF v_c.appointment_date IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'changed', false);
    END IF;
    PERFORM set_config('app.complaint_appointment', '1', true);
    UPDATE public.complaints
    SET appointment_date = NULL, appointment_slot = NULL, appointment_note = NULL,
        appointment_set_at = now(), appointment_set_by = auth.uid()
    WHERE id = v_c.id;
    PERFORM set_config('app.complaint_appointment', '', true);

    INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
    VALUES (v_c.id, 'appointment_cleared',
            'ยกเลิกนัด ' || public.complaint_thai_date(v_c.appointment_date)
              || CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END,
            v_actor);
    RETURN jsonb_build_object('ok', true, 'changed', true, 'cleared', true);
  END IF;

  -- ── ตั้ง/เลื่อนนัด ──
  v_slot_lbl := CASE p_slot
    WHEN 'morning'   THEN 'ช่วงเช้า'
    WHEN 'afternoon' THEN 'ช่วงบ่าย'
    WHEN 'allday'    THEN 'ทั้งวัน'
    ELSE NULL
  END;
  IF v_slot_lbl IS NULL THEN
    RAISE EXCEPTION 'ช่วงเวลานัดไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF p_date < v_today THEN
    RAISE EXCEPTION 'วันนัดย้อนหลังไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF p_date > v_today + 180 THEN
    RAISE EXCEPTION 'นัดล่วงหน้าได้ไม่เกิน 180 วัน' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(p_allow_off_day, false) AND public.complaint_is_off_day(p_date, v_c.municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'off_day');
  END IF;

  IF v_c.appointment_date IS NOT DISTINCT FROM p_date
     AND v_c.appointment_slot IS NOT DISTINCT FROM p_slot
     AND v_c.appointment_note IS NOT DISTINCT FROM v_note THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'date', p_date, 'slot', p_slot,
                              'after_due', v_c.due_date IS NOT NULL AND p_date > v_c.due_date);
  END IF;

  v_resched := v_c.appointment_date IS NOT NULL
               AND (v_c.appointment_date IS DISTINCT FROM p_date OR v_c.appointment_slot IS DISTINCT FROM p_slot);

  PERFORM set_config('app.complaint_appointment', '1', true);
  UPDATE public.complaints
  SET appointment_date = p_date, appointment_slot = p_slot, appointment_note = v_note,
      appointment_set_at = now(), appointment_set_by = auth.uid()
  WHERE id = v_c.id;
  PERFORM set_config('app.complaint_appointment', '', true);

  -- ไทม์ไลน์เก็บเฉพาะวัน+ช่วงเวลา (ข้อความถึงผู้แจ้งอยู่ในคอลัมน์แล้ว ไม่ซ้ำลงไทม์ไลน์)
  -- แก้แค่ข้อความ ไม่บันทึกแถวใหม่ — ไทม์ไลน์คือประวัติวันนัด ไม่ใช่ประวัติการพิมพ์
  IF v_c.appointment_date IS DISTINCT FROM p_date OR v_c.appointment_slot IS DISTINCT FROM p_slot THEN
    v_text := 'นัดเข้าดำเนินการ ' || public.complaint_thai_date(p_date) || ' ' || v_slot_lbl;
    IF v_resched THEN
      v_text := v_text || ' (เลื่อนจาก ' || public.complaint_thai_date(v_c.appointment_date) || ')';
    END IF;
    INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
    VALUES (v_c.id, 'appointment', v_text, v_actor);
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'changed',     true,
    'date',        p_date,
    'slot',        p_slot,
    'rescheduled', v_resched,
    'after_due',   v_c.due_date IS NOT NULL AND p_date > v_c.due_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_complaint_appointment(uuid, date, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_complaint_appointment(uuid, date, text, text, boolean) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- รูปในหน้า /t/
-- ══════════════════════════════════════════════════════════════════════════════════
-- URL รูปคำร้องที่ส่งต่อได้มีสองแบบ (ตรงกับ attach_complaint_photos 20260910010629):
--   https://<ref>.supabase.co/functions/v1/drive-file?id=FILE_ID   (ส่วนใหญ่ — ตรวจฐานจริง 2026-11-17)
--   https://drive.google.com/uc?id=FILE_ID                         (รุ่นเก่า)
-- รูปรุ่นแรกที่อยู่บน Supabase Storage ไม่แสดงในหน้า /t/ (คืน NULL) — ไม่มีทางกั้นสิทธิ์ผ่านพร็อกซีเดียวกัน
CREATE OR REPLACE FUNCTION public.complaint_photo_drive_id(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    substring(p_url from '^https://[a-z0-9-]+\.supabase\.co/functions/v1/drive-file\?id=([A-Za-z0-9_-]{10,100})$'),
    substring(p_url from '^https://drive\.google\.com/uc\?id=([A-Za-z0-9_-]{10,100})$')
  )
$$;

REVOKE ALL ON FUNCTION public.complaint_photo_drive_id(text) FROM PUBLIC, anon, authenticated;

-- กติกาเดียวของรูปในหน้า /t/ (ใช้ใน get_complaint_by_track_token) — แยกเป็นฟังก์ชันไว้ให้พร็อกซีรูปเรียกใช้ซ้ำได้
-- ถ้าวันหนึ่งรูปคำร้องเปลี่ยนเป็น private (ดูหัวไฟล์)
--   track_photos ของหมวด: none = ไม่แสดง · after = รูปผลงานเจ้าหน้าที่ เมื่อเรื่องเสร็จ · both = + รูปที่ผู้แจ้งส่งมา
--   บังคับ none เสมอ: หมวดเฉพาะกิจ (is_adhoc) · หมวดอ่อนไหว (requires_manual_intake — นิยามเดียวกับห้องผู้บริหาร)
--                     หมวดทุจริต (corruption — ชุดเดียวกับ CONFIDENTIAL_COMPLAINT_CATEGORIES) · เรื่องที่ถูกปฏิเสธ
--   ไม่เกินชุดละ 4 รูป ตามลำดับที่แนบ
CREATE OR REPLACE FUNCTION public.complaint_track_photos(p_c public.complaints)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mode      text;
  v_sensitive boolean;
  v_adhoc     boolean;
  v_after     jsonb := '[]'::jsonb;
  v_before    jsonb := '[]'::jsonb;
BEGIN
  SELECT cc.track_photos, coalesce(cc.requires_manual_intake, false), coalesce(cc.is_adhoc, false)
  INTO v_mode, v_sensitive, v_adhoc
  FROM public.complaint_categories cc
  WHERE cc.municipality_id = p_c.municipality_id
    AND (cc.id = p_c.category_id OR cc.value = p_c.category)
  ORDER BY (cc.id = p_c.category_id) DESC NULLS LAST, cc.is_active DESC, cc.sort_order
  LIMIT 1;

  IF v_mode IS NULL OR v_sensitive OR v_adhoc
     OR coalesce(p_c.category, '') = 'corruption'
     OR coalesce(p_c.status, '') = 'rejected' THEN
    v_mode := 'none';
  END IF;

  IF v_mode IN ('after', 'both')
     AND p_c.status IN ('closed', 'completed', 'done')
     AND jsonb_typeof(p_c.work_photos) = 'array' THEN
    -- work_photos เป็น jsonb array ของสตริง (ตรวจชนิดคอลัมน์ฐานจริง 2026-11-17) · ซ้ำกันเอาตัวแรก · 4 รูปแรกตามลำดับที่แนบ
    SELECT coalesce(jsonb_agg(x.fid ORDER BY x.pos), '[]'::jsonb) INTO v_after
    FROM (
      SELECT d.fid, d.pos
      FROM (
        SELECT DISTINCT ON (fid) fid, pos
        FROM (
          SELECT public.complaint_photo_drive_id(e.u) AS fid, e.pos
          FROM jsonb_array_elements(p_c.work_photos) WITH ORDINALITY AS w(v, pos)
          CROSS JOIN LATERAL (SELECT w.v #>> '{}' AS u, w.pos AS pos) e
          WHERE jsonb_typeof(w.v) = 'string'
        ) s
        WHERE fid IS NOT NULL
        ORDER BY fid, pos
      ) d
      ORDER BY d.pos
      LIMIT 4
    ) x;
  END IF;

  IF v_mode = 'both' AND p_c.attachments IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(x.fid ORDER BY x.pos), '[]'::jsonb) INTO v_before
    FROM (
      SELECT d.fid, d.pos
      FROM (
        SELECT DISTINCT ON (fid) fid, pos
        FROM (
          SELECT public.complaint_photo_drive_id(a.u) AS fid, a.pos
          FROM unnest(p_c.attachments) WITH ORDINALITY AS a(u, pos)
        ) s
        WHERE fid IS NOT NULL
        ORDER BY fid, pos
      ) d
      ORDER BY d.pos
      LIMIT 4
    ) x;
  END IF;

  RETURN jsonb_build_object('after', v_after, 'before', v_before);
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_track_photos(public.complaints) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- get_complaint_by_track_token — ของเดิมครบทุกบรรทัด + คีย์ใหม่ท้าย object
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_complaint_by_track_token(_token text, _municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_c          public.complaints%ROWTYPE;
  v_staff      boolean;
  v_owner      boolean;
  v_adhoc      boolean;
  v_shown_done boolean;
  v_actionable boolean;
  v_label      text;
  v_timeline   jsonb;
  v_rated      boolean;
  v_reopened   int;
  v_can_rate   boolean;
  v_can_reopen boolean;
  v_days_left  int := 0;
  -- งาน 1.1 (20261202100100)
  v_req_appt   boolean;
  v_fee_rates  jsonb;
  v_fee_ref    text;
  v_open       boolean;
  v_pref       text;
BEGIN
  IF NOT public.rpc_rate_limit_hit('complaint_track_get', 30, interval '5 minutes') THEN
    RAISE EXCEPTION 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  IF _token IS NULL OR _token !~ '^[0-9a-f]{32}$' OR _municipality_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_c
  FROM public.complaints
  WHERE track_token = _token AND municipality_id = _municipality_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_staff := public.complaint_track_caller_is_staff();
  v_owner := v_uid IS NOT NULL AND v_c.user_id = v_uid;
  v_adhoc := public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category);
  v_shown_done := v_c.status IN ('closed', 'completed', 'done');
  v_actionable := v_c.status IN ('closed', 'completed') AND NOT v_adhoc;

  SELECT cc.label, cc.requires_appointment, cc.fee_rates, cc.fee_reference
  INTO v_label, v_req_appt, v_fee_rates, v_fee_ref
  FROM public.complaint_categories cc
  WHERE cc.municipality_id = v_c.municipality_id
    AND (cc.id = v_c.category_id OR cc.value = v_c.category)
  ORDER BY (cc.id = v_c.category_id) DESC NULLS LAST, cc.is_active DESC, cc.sort_order
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', t.status, 'at', t.created_at) ORDER BY t.created_at), '[]'::jsonb)
  INTO v_timeline
  FROM (
    SELECT status, created_at
    FROM public.complaint_timeline
    WHERE complaint_id = v_c.id
    ORDER BY created_at DESC
    LIMIT 50
  ) t;

  v_rated := EXISTS (
    SELECT 1 FROM public.satisfaction_ratings sr
    WHERE sr.complaint_id = v_c.id AND sr.is_verified = v_owner
  ) OR (v_owner AND v_c.rating IS NOT NULL);

  v_reopened := COALESCE((v_c.extra_data ->> 'reopen_count')::int, 0);
  v_can_rate := v_actionable AND NOT v_staff AND NOT v_rated;
  v_can_reopen := v_actionable AND NOT v_staff
                  AND v_c.closed_at IS NOT NULL
                  AND v_reopened < 1
                  AND v_c.closed_at >= now() - interval '7 days';
  IF v_can_reopen THEN
    v_days_left := GREATEST(1, ceil(extract(epoch FROM (v_c.closed_at + interval '7 days' - now())) / 86400.0)::int);
  END IF;

  -- งาน 1.1: นัดหมายแสดงเฉพาะเรื่องที่ยังไม่จบ · วันที่ผู้แจ้งเสนอแสดงจนกว่าจะมีวันนัดจริง
  -- นับเฉพาะสถานะที่ยังรอ/กำลังทำ — 'parked' (พักเรื่อง) ไม่โชว์วันนัดเดิม ไม่งั้นประชาชนรอเก้อ
  v_open := coalesce(v_c.status, '') IN ('new', 'pending', 'received', 'in_progress');
  IF jsonb_typeof(v_c.extra_data) = 'object' THEN
    v_pref := v_c.extra_data ->> 'preferred_date';
    IF v_pref IS NOT NULL AND v_pref !~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_pref := NULL;
    END IF;
    -- รูปแบบถูกแต่ไม่มีวันจริง (เช่น 2026-13-45) = ทิ้ง ไม่ให้ทั้งฟังก์ชันล้ม
    IF v_pref IS NOT NULL THEN
      BEGIN
        v_pref := to_char(v_pref::date, 'YYYY-MM-DD');
      EXCEPTION WHEN others THEN
        v_pref := NULL;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found',            true,
    'ref_no',           v_c.ref_no,
    'category',         v_c.category,
    'category_label',   COALESCE(v_label, v_c.category),
    'village',          v_c.village,
    'status',           v_c.status,
    'created_at',       v_c.created_at,
    'due_date',         v_c.due_date,
    'closed_at',        v_c.closed_at,
    'is_adhoc',         v_adhoc,
    'result_note',      CASE WHEN v_shown_done THEN v_c.technician_note END,
    'reject_reason',    CASE WHEN v_c.status = 'rejected' THEN v_c.rejection_reason END,
    'timeline',         v_timeline,
    'rated',            v_rated,
    'can_rate',         v_can_rate,
    'can_reopen',       v_can_reopen,
    'reopen_days_left', v_days_left,
    'reopened',         v_reopened >= 1,
    'viewer',           CASE WHEN v_staff THEN 'staff' WHEN v_owner THEN 'owner' ELSE 'link' END,
    'server_now',       now(),
    -- งาน 1.1 (20261202100100)
    'requires_appointment', coalesce(v_req_appt, false) AND NOT v_adhoc,
    'appointment',      CASE WHEN v_open AND v_c.appointment_date IS NOT NULL THEN jsonb_build_object(
                          'date',      v_c.appointment_date,
                          'slot',      v_c.appointment_slot,
                          'note',      v_c.appointment_note,
                          'after_due', v_c.due_date IS NOT NULL AND v_c.appointment_date > v_c.due_date,
                          'past',      v_c.appointment_date < (now() AT TIME ZONE 'Asia/Bangkok')::date
                        ) END,
    'preferred_date',   CASE WHEN v_open AND v_c.appointment_date IS NULL THEN v_pref END,
    'fee',              CASE WHEN jsonb_typeof(v_fee_rates) = 'array' AND jsonb_array_length(v_fee_rates) > 0
                          THEN jsonb_build_object('rates', v_fee_rates, 'reference', v_fee_ref) END,
    'photos',           public.complaint_track_photos(v_c)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_complaint_by_track_token(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_complaint_by_track_token(text, uuid) TO anon, authenticated;

-- ตรวจสิทธิ์ผลลัพธ์ก่อน COMMIT — ไม่ตรงที่ตั้งใจ = ทั้งไฟล์ rollback
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.set_complaint_appointment(uuid, date, text, text, boolean)', false, true),
      ('public.get_complaint_by_track_token(text, uuid)',                     true,  true),
      ('public.complaint_fee_rates_valid(jsonb)',                             true,  true),
      ('public.guard_complaint_appointment()',                                false, false),
      ('public.complaint_is_off_day(date, uuid)',                             false, false),
      ('public.complaint_thai_date(date)',                                    false, false),
      ('public.complaint_photo_drive_id(text)',                               false, false),
      ('public.complaint_track_photos(public.complaints)',                    false, false)
    ) AS t(sig, want_anon, want_auth)
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') IS DISTINCT FROM r.want_anon
       OR has_function_privilege('authenticated', r.sig, 'EXECUTE') IS DISTINCT FROM r.want_auth THEN
      RAISE EXCEPTION 'สิทธิ์ EXECUTE ของ % ไม่ตรงที่ตั้งใจ (anon ต้อง %, authenticated ต้อง %)', r.sig, r.want_anon, r.want_auth;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
