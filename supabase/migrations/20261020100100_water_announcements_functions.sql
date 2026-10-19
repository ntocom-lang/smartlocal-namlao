-- สถานการณ์น้ำ-ฝน เฟส 2 (ประกาศของ อบต. ที่มีผู้ยืนยัน) PR 2.1 ไฟล์ 2/2 — ปิดสิทธิ์ตาราง + ฟังก์ชัน + ตัวล็อกข้อมูล + cron
-- (ตารางอยู่ 20261020100000)
--
-- ภาพรวม
--   water_announcement_tick()      cron นาทีที่ 25 (หลัง water_event_tick นาทีที่ 20) — ร่างข้อความจากเหตุการณ์ที่เปิดอยู่
--                                  ของ อปท. ที่ "เปิดใช้" เท่านั้น · อ่านจากฐานข้อมูลเราอย่างเดียว ไม่ส่งข้อความหาใคร
--   approve_water_announcement()   ผู้มีสิทธิ์กดยืนยัน → ขึ้นหน้าประชาชน (หมดอายุเอง 24 ชม. ปรับได้ถึง 72)
--   decline_water_announcement()   ผู้มีสิทธิ์เลือก "ไม่ประกาศ" (บันทึกไว้ ระบบไม่ร่างซ้ำ 12 ชม.)
--   cancel_water_announcement()    ผู้มีสิทธิ์ยกเลิกฉบับที่เผยแพร่ → หายจากหน้าประชาชนทันที
--   list_water_announcements()     หน้าเจ้าหน้าที่อ่าน (ผู้ที่ดูเหตุการณ์น้ำ-ฝนได้)
--   get_public_water_announcement() หน้าประชาชนอ่านเฉพาะฉบับที่ยืนยันแล้วและยังไม่หมดอายุ
--
-- ผู้ยืนยันได้ = บัญชีที่ตรงกับ "ผู้ลงนามระดับหน่วยงาน" ที่ active วันนี้ในทะเบียนผู้ลงนามกลาง (document_signatories)
--   บทบาทตาม water_announcement_approver_roles() = นายก + ปลัด — ⚠️ ค่าตั้งต้นของผม ไม่ได้อ้างระเบียบใด
--   อบต. ต้องยืนยันกับตัวบท/แผนป้องกันและบรรเทาสาธารณภัยฉบับปัจจุบันว่าใครมีอำนาจ แล้วแก้ที่ฟังก์ชันนั้นจุดเดียว
--   ไม่ใช้ superadmin/admin ทั่วไป (ผู้ดูแลระบบไม่ใช่ผู้มีอำนาจประกาศ) · ไม่เพิ่มคอลัมน์สิทธิ์ใน profiles
--   ผู้ลงนามที่ไม่มีบัญชี (ทะเบียนกรอกชื่อเอง) กดไม่ได้ = ไม่มีประกาศออก (ตั้งใจ)
--
-- ข้อความร่าง: ค่าที่วัดได้ล่าสุดของสถานีที่ทำให้ระบบเปิดเหตุการณ์ + เวลาวัด + คำว่า "ไม่ใช่การพยากรณ์"
--   ไม่มีคำสั่ง/ข้อแนะนำ (เช่น อพยพ) — ข้อความ "ควรทำอะไร" ต้องมาจากแผนของ อบต. เอง (เทสต์ห้ามคำเหล่านี้)
--   ค่าว่างไม่กลายเป็น 0 · ใช้เฉพาะค่าที่วัดภายใน 3 ชม. (ข้อความ สสน. 6 ชม.) ไม่มีค่าสดเลย = ไม่ร่าง
--
-- ไฟล์นี้ใหม่ล้วน: ชื่อฟังก์ชันใหม่ทั้งหมด ไม่มี CREATE OR REPLACE ทับของเดิม
-- ย้อนได้ด้วย: SELECT cron.unschedule('water-announce-tick-hourly'); แล้ว DROP FUNCTION/TRIGGER ที่ขึ้นต้น water_announcement*
--   หรือแค่ UPDATE public.water_announcement_settings SET enabled = false; (หน้าประชาชนหยุดแสดงทันที)
-- ทดสอบพฤติกรรมด้วย PGlite: tests/water-announcements-db.test.mjs (ดูวิธีรันที่หัวไฟล์นั้น)

DO $$
BEGIN
  IF to_regclass('public.water_announcements') IS NULL OR to_regclass('public.water_announcement_settings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261020100000_water_announcements_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.water_event_readings') IS NULL OR to_regclass('public.water_event_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261016100000_water_events_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('public.can_view_water_events(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261017100000_water_events_staff_rpc.sql ก่อนไฟล์นี้ (ใช้ can_view_water_events)';
  END IF;
  IF to_regclass('public.document_signatories') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง document_signatories (ทะเบียนผู้ลงนามกลาง)';
  END IF;
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง audit_logs';
  END IF;
  IF to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260928140000_job_heartbeats_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ pg_cron — เปิดที่ Database → Extensions ก่อน (เปิดไว้แล้วบน production)';
  END IF;
END;
$$;

BEGIN;

-- ตารางใหม่ได้ ALL ให้ anon/authenticated อัตโนมัติจาก default privileges ของ Supabase — ถอนก่อน (ปิดสนิท ไม่มี policy)
REVOKE ALL ON public.water_announcement_settings FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.water_announcements         FROM anon, authenticated, PUBLIC;
ALTER TABLE public.water_announcement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_announcements         ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- ตัวล็อกข้อมูล: ข้อความ/ที่มาของประกาศแก้ไม่ได้ · สถานะเปลี่ยนได้ตามเส้นทางที่กำหนดเท่านั้น · ลบ/ล้างตารางไม่ได้
--   (ข้อความที่ผู้มีสิทธิ์ยืนยัน = ข้อความที่ระบบร่าง ตรวจย้อนได้ · ฟังก์ชัน DEFINER ที่บั๊กก็เขียนทับไม่ได้)
--   ลบทั้ง อปท. (FK cascade) ทำได้ — ลบแถวตรงๆ ไม่ได้
--   FK SET NULL (ลบเหตุการณ์/บัญชี) แก้ event_id/published_by/closed_by เป็น NULL ได้ — ค่าอื่นแก้ไม่ได้
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.water_announcements_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ล้างตารางประกาศไม่ได้ (เก็บเป็นบันทึกย้อนตรวจ)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'ลบประกาศไม่ได้ (เก็บเป็นบันทึกย้อนตรวจ)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.facts IS DISTINCT FROM OLD.facts
     OR NEW.drafted_at IS DISTINCT FROM OLD.drafted_at THEN
    RAISE EXCEPTION 'แก้ข้อความหรือที่มาของประกาศไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id AND NEW.event_id IS NOT NULL THEN
    RAISE EXCEPTION 'เปลี่ยนเหตุการณ์ของประกาศไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF (NEW.published_by IS DISTINCT FROM OLD.published_by AND NEW.published_by IS NOT NULL AND OLD.published_by IS NOT NULL)
     OR (NEW.closed_by IS DISTINCT FROM OLD.closed_by AND NEW.closed_by IS NOT NULL AND OLD.closed_by IS NOT NULL) THEN
    RAISE EXCEPTION 'เปลี่ยนผู้ดำเนินการของประกาศไม่ได้' USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('declined', 'cancelled', 'superseded', 'expired', 'lapsed') THEN
    -- สถานะปลายทางแล้ว ห้ามเปลี่ยนอะไร (ยกเว้นเส้นทาง FK SET NULL ข้างบน)
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'ประกาศที่ปิดแล้วแก้ไม่ได้' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'published' THEN
    IF NEW.status NOT IN ('published', 'cancelled', 'superseded', 'expired') THEN
      RAISE EXCEPTION 'เปลี่ยนสถานะ % → % ไม่ได้', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    -- ต่ออายุ/แก้เวลาไม่ได้ — ต่ออายุ = ยืนยันฉบับใหม่ (ฉบับเก่าถูกแทนที่)
    IF NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'แก้เวลาเผยแพร่/หมดอายุของประกาศไม่ได้' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.status NOT IN ('draft', 'published', 'declined', 'lapsed') THEN
      RAISE EXCEPTION 'เปลี่ยนสถานะ % → % ไม่ได้', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.water_announcements_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS water_announcements_guard_row ON public.water_announcements;
CREATE TRIGGER water_announcements_guard_row
  BEFORE UPDATE OR DELETE ON public.water_announcements
  FOR EACH ROW EXECUTE FUNCTION public.water_announcements_guard();
DROP TRIGGER IF EXISTS water_announcements_guard_truncate ON public.water_announcements;
CREATE TRIGGER water_announcements_guard_truncate
  BEFORE TRUNCATE ON public.water_announcements
  FOR EACH STATEMENT EXECUTE FUNCTION public.water_announcements_guard();

-- ===========================================================================
-- ตัวช่วยภายใน (ไม่เปิดให้ใครเรียกจากเว็บ)
-- ===========================================================================

-- บทบาทผู้ลงนามระดับหน่วยงานที่ยืนยันประกาศได้ — ⚠️ รอ อบต. ยืนยันผู้มีอำนาจตามตัวบท (ดูหัวไฟล์) แก้ที่นี่จุดเดียว
CREATE OR REPLACE FUNCTION public.water_announcement_approver_roles()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$ SELECT ARRAY['mayor', 'clerk']::text[] $$;

REVOKE ALL ON FUNCTION public.water_announcement_approver_roles() FROM PUBLIC, anon, authenticated;

-- "19 ต.ค. 2569 เวลา 14:20 น." (เวลาไทย พ.ศ.)
CREATE OR REPLACE FUNCTION public.water_announcement_thai_time(_ts timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN _ts IS NULL THEN NULL ELSE
    extract(day FROM _ts AT TIME ZONE 'Asia/Bangkok')::int::text || ' '
    || (ARRAY['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'])
         [extract(month FROM _ts AT TIME ZONE 'Asia/Bangkok')::int] || ' '
    || (extract(year FROM _ts AT TIME ZONE 'Asia/Bangkok')::int + 543)::text
    || ' เวลา ' || to_char(_ts AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') || ' น.'
  END
$$;

REVOKE ALL ON FUNCTION public.water_announcement_thai_time(timestamptz) FROM PUBLIC, anon, authenticated;

-- ร่างข้อความ — คืน NULL เมื่อไม่มีค่าสดให้พูดถึงเลย (ไม่ร่างประกาศจากค่าที่เก่าแล้ว)
CREATE OR REPLACE FUNCTION public.water_announcement_draft_text(
  _muni_name text, _event_id uuid, _opened_at timestamptz, _triggers jsonb, _now timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_fresh         CONSTANT interval := interval '3 hours';
  c_fresh_warning CONSTANT interval := interval '6 hours';
  c_max_lines     CONSTANT integer  := 6;
  trig    record;
  r       record;
  v_lines text[] := ARRAY[]::text[];
  v_line  text;
  v_cm    integer;
  v_warn  timestamptz;
BEGIN
  -- สถานีที่ทำให้ระบบเปิดเหตุการณ์ → ค่าล่าสุดที่จดไว้ของสถานีนั้น (ไม่อ้างว่า "ยังเข้าเกณฑ์" เพราะค่าอาจลดลงแล้ว)
  FOR trig IN
    SELECT x ->> 'kind' AS kind, x ->> 'station_code' AS code, x ->> 'station_name' AS station_name
    FROM jsonb_array_elements(COALESCE(_triggers, '[]'::jsonb)) AS x
    WHERE x ->> 'kind' IN ('rain', 'waterlevel', 'ews')
    ORDER BY 1, 2
  LOOP
    SELECT rd.recorded_at, rd.rain_24h_mm, rd.bank_diff_m, rd.situation_level INTO r
    FROM public.water_event_readings AS rd
    WHERE rd.event_id = _event_id AND rd.station_type = trig.kind AND rd.station_code = trig.code
      AND rd.recorded_at <= _now
    ORDER BY rd.recorded_at DESC
    LIMIT 1;
    CONTINUE WHEN NOT FOUND OR r.recorded_at < _now - c_fresh;

    v_line := NULL;
    IF trig.kind = 'rain' AND r.rain_24h_mm IS NOT NULL THEN
      v_line := 'สถานีฝน ' || trig.station_name || ' วัดฝนสะสม 24 ชั่วโมงได้ ' || trim_scale(round(r.rain_24h_mm, 1))::text || ' มม.';
    ELSIF trig.kind = 'waterlevel' AND r.bank_diff_m IS NOT NULL THEN
      v_cm := GREATEST(1, round(abs(r.bank_diff_m) * 100)::integer);
      v_line := 'สถานีระดับน้ำ ' || trig.station_name || ' ' || CASE
        WHEN abs(r.bank_diff_m) < 0.005 THEN 'ระดับน้ำเสมอตลิ่ง'
        WHEN r.bank_diff_m > 0 THEN 'ระดับน้ำต่ำกว่าตลิ่ง ' || v_cm::text || ' ซม.'
        ELSE 'ระดับน้ำสูงกว่าตลิ่ง ' || v_cm::text || ' ซม.'
      END;
    ELSIF trig.kind = 'ews' AND r.situation_level IS NOT NULL THEN
      v_line := 'สถานีเตือนภัย ' || trig.station_name || ' รายงานระดับ ' || r.situation_level::text;
    END IF;
    IF v_line IS NOT NULL THEN
      v_lines := v_lines || (v_line || ' (วัดเมื่อ ' || public.water_announcement_thai_time(r.recorded_at) || ')');
    END IF;
  END LOOP;

  IF cardinality(v_lines) > c_max_lines THEN
    v_lines := v_lines[1:c_max_lines - 1]
      || ('และสถานีอื่นอีก ' || (cardinality(v_lines) - (c_max_lines - 1))::text || ' แห่ง (ดูที่หน้าสถานการณ์น้ำ-ฝน)');
  END IF;

  -- ข้อความเตือนของ สสน. ที่ระบุอำเภอเดียวกับ อปท. — ไม่คัดลอกข้อความ (ดูฉบับเต็มที่หน้าสถานการณ์น้ำ-ฝน)
  SELECT max(w.issued_at) INTO v_warn
  FROM public.water_event_warnings AS w
  WHERE w.event_id = _event_id AND w.issued_at >= _now - c_fresh_warning AND w.issued_at <= _now;
  IF v_warn IS NOT NULL THEN
    v_lines := v_lines || ('ข้อความเตือนของ สสน. ที่ระบุพื้นที่อำเภอเดียวกับหน่วยงานนี้ (ออกเมื่อ '
      || public.water_announcement_thai_time(v_warn) || ') ดูฉบับเต็มที่หน้าสถานการณ์น้ำ-ฝน');
  END IF;

  IF cardinality(v_lines) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN 'ประกาศจาก ' || _muni_name || E'\n'
    || 'ข้อมูลสถานการณ์น้ำ-ฝน ณ ' || public.water_announcement_thai_time(_now) || E'\n'
    || 'ระบบเฝ้าระวังเปิดเหตุการณ์เมื่อ ' || public.water_announcement_thai_time(_opened_at)
    || ' จากค่าที่วัดได้ใกล้พื้นที่ ค่าล่าสุดมีดังนี้' || E'\n'
    || '• ' || array_to_string(v_lines, E'\n• ') || E'\n'
    || 'ค่าข้างต้นเป็นค่าที่สถานีวัดได้ ไม่ใช่การพยากรณ์ ขอให้ติดตามประกาศจาก ' || _muni_name || ' ต่อไป';
END;
$$;

REVOKE ALL ON FUNCTION public.water_announcement_draft_text(text, uuid, timestamptz, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

-- บันทึกการตัดสินของคนลง audit_logs เดิม (ฝั่งเซิร์ฟเวอร์ หน้าจอข้ามไม่ได้) — metadata ไม่มีข้อมูลบุคคลอื่น
CREATE OR REPLACE FUNCTION public.water_announcement_audit(_municipality_id uuid, _action text, _announcement_id uuid, _metadata jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor record;
BEGIN
  SELECT p.full_name, p.role INTO v_actor FROM public.profiles AS p WHERE p.id = auth.uid();
  INSERT INTO public.audit_logs
    (municipality_id, actor_id, actor_name, actor_role, action, resource_type, resource_id, resource_label, metadata)
  VALUES
    (_municipality_id, auth.uid(), v_actor.full_name, v_actor.role, _action,
     'water_announcement', _announcement_id::text, 'ประกาศสถานการณ์น้ำ-ฝน', COALESCE(_metadata, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.water_announcement_audit(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- ตัวตัดสินสิทธิ์ผู้ยืนยัน — ใช้ทุกฟังก์ชันที่เปลี่ยนสถานะประกาศ และหน้าจอใช้ถามว่าจะแสดงปุ่มไหม
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.can_approve_water_announcement(_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_signatories AS s
    JOIN public.profiles AS p ON p.id = s.profile_id
    WHERE _municipality_id IS NOT NULL
      AND auth.uid() IS NOT NULL
      AND s.profile_id = auth.uid()
      AND s.municipality_id = _municipality_id
      AND p.municipality_id = _municipality_id
      AND p.role IN ('admin', 'officer', 'staff')
      AND s.is_active
      AND s.department_id IS NULL
      AND s.signatory_role = ANY (public.water_announcement_approver_roles())
      AND (s.effective_from IS NULL OR s.effective_from <= timezone('Asia/Bangkok', now())::date)
      AND (s.effective_to   IS NULL OR s.effective_to   >= timezone('Asia/Bangkok', now())::date)
  );
$$;

REVOKE ALL ON FUNCTION public.can_approve_water_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_water_announcement(uuid) TO authenticated;

-- ===========================================================================
-- ตัวร่าง (cron) — เรียกจากเว็บไม่ได้ · _now ไว้ให้เทสต์จำลองเวลา
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.water_announcement_tick(_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- ร่างเก่ากว่านี้ไม่ใช้ (ค่าที่วัดเปลี่ยนไปแล้ว) → ทิ้งแล้วร่างใหม่ด้วยค่าล่าสุด · ต้องตรงกับ approve_water_announcement
  c_draft_life    CONSTANT interval := interval '3 hours';
  -- ฉบับที่เผยแพร่จะหมดอายุภายในช่วงนี้และเหตุการณ์ยังเปิดอยู่ → ร่างฉบับต่ออายุให้ยืนยันใหม่
  c_renew_lead    CONSTANT interval := interval '3 hours';
  -- ผู้มีสิทธิ์เลือก "ไม่ประกาศ" แล้ว ไม่ร่างซ้ำเรื่องเดิมในช่วงนี้
  c_declined_hold CONSTANT interval := interval '12 hours';
  -- water_event_tick รันทุกชม. (นาทีที่ 20) — last_hot_at เก่ากว่านี้ = รอบล่าสุดไม่เข้าเกณฑ์/ตัวจดเหตุการณ์ไม่ทำงาน
  c_hot_window    CONSTANT interval := interval '90 minutes';
  c_job           CONSTANT text     := 'water-announce-tick';
  t         record;
  ev        record;
  v_body    text;
  v_rows    integer;
  v_checked integer := 0;
  v_drafted integer := 0;
  v_lapsed  integer := 0;
  v_errors  text[]  := ARRAY[]::text[];
BEGIN
  -- ฉบับที่เผยแพร่ครบอายุแล้ว → expired (ทุก อปท. แม้ปิดสวิตช์แล้ว) · หน้าประชาชนตัดสินจาก expires_at เองอยู่แล้ว ข้อนี้แค่เก็บสถานะให้ตรง
  UPDATE public.water_announcements SET status = 'expired', closed_at = expires_at
  WHERE status = 'published' AND expires_at <= _now;

  FOR t IN
    SELECT s.municipality_id, m.slug, m.name
    FROM public.water_announcement_settings AS s
    JOIN public.municipalities AS m ON m.id = s.municipality_id
    WHERE s.enabled
      AND m.is_active
      AND (m.enabled_modules IS NULL OR 'water-situation' = ANY (m.enabled_modules))
    ORDER BY m.slug
  LOOP
    BEGIN
      v_checked := v_checked + 1;

      SELECT e.id, e.opened_at, e.open_reason, e.calm_since, e.last_hot_at INTO ev
      FROM public.water_events AS e
      WHERE e.municipality_id = t.municipality_id AND e.closed_at IS NULL;

      IF NOT FOUND THEN
        -- ไม่มีเหตุการณ์เปิดอยู่ → ร่างที่ค้างหมดความหมาย (ฉบับที่เผยแพร่แล้วไม่แตะ — หมดอายุตามเวลา/ผู้มีสิทธิ์ยกเลิก)
        UPDATE public.water_announcements SET status = 'lapsed', closed_at = _now
        WHERE municipality_id = t.municipality_id AND status = 'draft';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_lapsed := v_lapsed + v_rows;
        CONTINUE;
      END IF;

      UPDATE public.water_announcements SET status = 'lapsed', closed_at = _now
      WHERE municipality_id = t.municipality_id AND status = 'draft'
        AND (drafted_at <= _now - c_draft_life OR event_id IS DISTINCT FROM ev.id);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_lapsed := v_lapsed + v_rows;

      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.water_announcements AS a
        WHERE a.municipality_id = t.municipality_id AND a.status = 'draft');
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.water_announcements AS a
        WHERE a.municipality_id = t.municipality_id AND a.status = 'published' AND a.expires_at > _now + c_renew_lead);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.water_announcements AS a
        WHERE a.municipality_id = t.municipality_id AND a.status = 'declined'
          AND a.event_id = ev.id AND a.closed_at > _now - c_declined_hold);

      -- ร่างเฉพาะตอนสัญญาณยังเข้าเกณฑ์ในรอบตรวจล่าสุดของ water_event_tick (ไม่ร่างจากเหตุการณ์ที่กำลังสงบ/ค่าขาด)
      CONTINUE WHEN ev.calm_since IS NOT NULL OR ev.last_hot_at < _now - c_hot_window;

      v_body := public.water_announcement_draft_text(t.name, ev.id, ev.opened_at, ev.open_reason -> 'triggers', _now);
      CONTINUE WHEN v_body IS NULL;

      INSERT INTO public.water_announcements (municipality_id, event_id, status, body, facts, drafted_at)
      VALUES (t.municipality_id, ev.id, 'draft', v_body,
              jsonb_build_object('rule_version', 1, 'event_opened_at', ev.opened_at,
                                 'triggers', COALESCE(ev.open_reason -> 'triggers', '[]'::jsonb)),
              _now);
      v_drafted := v_drafted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || (t.slug || ': ' || SQLERRM);
    END;
  END LOOP;

  -- ลงสมุดงานอัตโนมัติ (แบบเดียวกับ water_event_tick) — พังเงียบๆ ไม่ลากรอบล้ม
  BEGIN
    IF cardinality(v_errors) = 0 THEN
      INSERT INTO public.job_heartbeats (job_name, last_ok_at, updated_at)
      VALUES (c_job, now(), now())
      ON CONFLICT (job_name) DO UPDATE SET last_ok_at = EXCLUDED.last_ok_at, updated_at = EXCLUDED.updated_at;
    ELSE
      INSERT INTO public.job_heartbeats (job_name, last_error_at, last_error, updated_at)
      VALUES (c_job, now(), left(array_to_string(v_errors, ' | '), 500), now())
      ON CONFLICT (job_name) DO UPDATE
        SET last_error_at = EXCLUDED.last_error_at, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', cardinality(v_errors) = 0, 'checked', v_checked, 'drafted', v_drafted,
                            'lapsed', v_lapsed, 'errors', to_jsonb(v_errors));
END;
$$;

REVOKE ALL ON FUNCTION public.water_announcement_tick(timestamptz) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- ผู้มีสิทธิ์ยืนยัน / ไม่ประกาศ / ยกเลิก
--   ไม่มีสิทธิ์/พารามิเตอร์ผิด = error · สถานะไม่ตรง (ถูกจัดการแล้ว/ร่างเก่า/เหตุการณ์สิ้นสุด) = {"ok":false,"reason":…}
--   (คืนผลแทน raise เพื่อให้การตัดร่างทิ้ง "lapsed" ไม่ถูก rollback)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_water_announcement(_announcement_id uuid, _expiry_hours integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_draft_life CONSTANT interval := interval '3 hours';
  v_row      public.water_announcements%ROWTYPE;
  v_settings public.water_announcement_settings%ROWTYPE;
  v_now      timestamptz := now();
  v_hours    integer;
  v_super    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.water_announcements WHERE id = _announcement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบประกาศ' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_approve_water_announcement(v_row.municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ยืนยันประกาศของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.water_announcement_settings WHERE municipality_id = v_row.municipality_id;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  v_hours := COALESCE(_expiry_hours, v_settings.default_expiry_hours);
  IF v_hours < 1 OR v_hours > 72 THEN
    RAISE EXCEPTION 'อายุประกาศต้องอยู่ระหว่าง 1–72 ชั่วโมง' USING ERRCODE = '22023';
  END IF;
  IF v_row.status <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_handled', 'status', v_row.status);
  END IF;

  -- ยืนยันได้เฉพาะร่างของเหตุการณ์ที่ยังเปิดอยู่ และไม่เก่าเกินอายุร่าง (ค่าที่วัดต้องยังสด)
  IF NOT EXISTS (SELECT 1 FROM public.water_events AS e WHERE e.id = v_row.event_id AND e.closed_at IS NULL) THEN
    UPDATE public.water_announcements SET status = 'lapsed', closed_at = v_now WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'event_closed');
  END IF;
  IF v_row.drafted_at <= v_now - c_draft_life THEN
    UPDATE public.water_announcements SET status = 'lapsed', closed_at = v_now WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'draft_too_old');
  END IF;

  -- ฉบับเก่าที่ครบอายุแล้วปิดเป็น expired · ที่ยังเผยแพร่อยู่ถูกแทนที่ (ต่ออายุ = ยืนยันฉบับใหม่)
  UPDATE public.water_announcements SET status = 'expired', closed_at = expires_at
  WHERE municipality_id = v_row.municipality_id AND status = 'published' AND expires_at <= v_now;
  UPDATE public.water_announcements
  SET status = 'superseded', closed_at = v_now, closed_by = auth.uid()
  WHERE municipality_id = v_row.municipality_id AND status = 'published'
  RETURNING id INTO v_super;

  UPDATE public.water_announcements
  SET status = 'published', published_at = v_now, expires_at = v_now + make_interval(hours => v_hours), published_by = auth.uid()
  WHERE id = v_row.id;

  PERFORM public.water_announcement_audit(v_row.municipality_id, 'approve', v_row.id,
    jsonb_build_object('hours', v_hours, 'event_id', v_row.event_id, 'superseded_id', v_super));

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', 'published',
                            'published_at', v_now, 'expires_at', v_now + make_interval(hours => v_hours));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_water_announcement(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_water_announcement(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_water_announcement(_announcement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.water_announcements%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.water_announcements WHERE id = _announcement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบประกาศ' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_approve_water_announcement(v_row.municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ตัดสินประกาศของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_handled', 'status', v_row.status);
  END IF;

  UPDATE public.water_announcements SET status = 'declined', closed_at = v_now, closed_by = auth.uid() WHERE id = v_row.id;
  PERFORM public.water_announcement_audit(v_row.municipality_id, 'reject', v_row.id,
    jsonb_build_object('event_id', v_row.event_id));
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.decline_water_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_water_announcement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_water_announcement(_announcement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.water_announcements%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.water_announcements WHERE id = _announcement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบประกาศ' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_approve_water_announcement(v_row.municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ยกเลิกประกาศของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;
  -- ยกเลิกได้เฉพาะฉบับที่กำลังเผยแพร่ (ร่างใช้ "ไม่ประกาศ" · ฉบับที่หมดอายุไปแล้วไม่ต้องยกเลิก)
  IF v_row.status <> 'published' OR v_row.expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active', 'status', v_row.status);
  END IF;

  UPDATE public.water_announcements SET status = 'cancelled', closed_at = v_now, closed_by = auth.uid() WHERE id = v_row.id;
  PERFORM public.water_announcement_audit(v_row.municipality_id, 'cancel', v_row.id,
    jsonb_build_object('event_id', v_row.event_id, 'published_at', v_row.published_at));
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_water_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_water_announcement(uuid) TO authenticated;

-- ===========================================================================
-- หน้าเจ้าหน้าที่อ่าน (ผู้ที่ดูเหตุการณ์น้ำ-ฝนได้) — อ่านอย่างเดียว
--   pending = ร่างรอยืนยัน · current = ฉบับที่กำลังเผยแพร่ · history = ย้อนหลังใหม่→เก่า
--   can_approve = ผู้เรียกกดยืนยัน/ยกเลิกได้ไหม (หน้าจอใช้ซ่อน/แสดงปุ่ม — ตัวตัดสินจริงอยู่ที่ฟังก์ชันเขียน)
--   ไม่ส่ง facts/last_error ออกไป
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.list_water_announcements(_municipality_id uuid, _limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 20), 1), 100);
BEGIN
  IF NOT public.can_view_water_events(_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูประกาศน้ำ-ฝนของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'now', now(),
    'enabled', COALESCE((SELECT s.enabled FROM public.water_announcement_settings AS s WHERE s.municipality_id = _municipality_id), false),
    'default_expiry_hours', (SELECT s.default_expiry_hours FROM public.water_announcement_settings AS s WHERE s.municipality_id = _municipality_id),
    'can_approve', public.can_approve_water_announcement(_municipality_id),
    'recorder', (
      SELECT jsonb_build_object('last_ok_at', h.last_ok_at, 'last_error_at', h.last_error_at)
      FROM public.job_heartbeats AS h WHERE h.job_name = 'water-announce-tick'
    ),
    'pending', (
      SELECT jsonb_build_object('id', a.id, 'body', a.body, 'drafted_at', a.drafted_at)
      FROM public.water_announcements AS a
      WHERE a.municipality_id = _municipality_id AND a.status = 'draft'
    ),
    'current', (
      SELECT jsonb_build_object('id', a.id, 'body', a.body, 'published_at', a.published_at, 'expires_at', a.expires_at)
      FROM public.water_announcements AS a
      WHERE a.municipality_id = _municipality_id AND a.status = 'published' AND a.expires_at > now()
    ),
    'history', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.drafted_at DESC)
      FROM (
        SELECT a.drafted_at,
               jsonb_build_object('id', a.id, 'status', a.status, 'body', a.body, 'drafted_at', a.drafted_at,
                                  'published_at', a.published_at, 'expires_at', a.expires_at, 'closed_at', a.closed_at) AS j
        FROM public.water_announcements AS a
        WHERE a.municipality_id = _municipality_id
        ORDER BY a.drafted_at DESC
        LIMIT v_limit
      ) AS x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_water_announcements(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_water_announcements(uuid, integer) TO authenticated;

-- ===========================================================================
-- หน้าประชาชนอ่าน — เฉพาะฉบับที่ยืนยันแล้ว ยังไม่หมดอายุ และ อปท. ยังเปิดใช้ (ปิดสวิตช์ = หายทันที)
--   ไม่ส่งชื่อ/รหัสผู้ยืนยัน ไม่ส่ง facts · ไม่มีฉบับ = NULL
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_public_water_announcement(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object('id', a.id, 'body', a.body, 'published_at', a.published_at,
                            'expires_at', a.expires_at, 'issuer', m.name)
  FROM public.water_announcements AS a
  JOIN public.water_announcement_settings AS s ON s.municipality_id = a.municipality_id AND s.enabled
  JOIN public.municipalities AS m ON m.id = a.municipality_id AND m.is_active
  WHERE a.municipality_id = _municipality_id AND a.status = 'published' AND a.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_water_announcement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_water_announcement(uuid) TO anon, authenticated;

COMMENT ON TABLE public.water_announcements IS
  'ประกาศสถานการณ์น้ำ-ฝนของ อปท.: ระบบร่าง → ผู้ลงนามระดับหน่วยงานกดยืนยัน → ขึ้นหน้าประชาชน · ข้อความแก้ไม่ได้ ลบไม่ได้ · ปิดสนิท อ่าน/เขียนผ่านฟังก์ชันเท่านั้น · ไม่มีข้อมูลบุคคล';
COMMENT ON TABLE public.water_announcement_settings IS
  'เปิด/ปิดประกาศน้ำ-ฝนรายหน่วยงาน (ค่าเริ่มต้น ปิด) — เปิดกับ อปท. จริงหลัง อบต. ยืนยันผู้มีอำนาจประกาศตามตัวบทเท่านั้น';
COMMENT ON FUNCTION public.water_announcement_tick(timestamptz) IS
  'ร่างประกาศจากเหตุการณ์ที่เปิดอยู่ของ อปท. ที่เปิดใช้ · cron นาทีที่ 25 · ไม่ส่งข้อความหาใคร · _now ไว้เทสต์จำลองเวลา';
COMMENT ON FUNCTION public.water_announcement_approver_roles() IS
  'บทบาทผู้ลงนามระดับหน่วยงานที่ยืนยันประกาศได้ — ค่าตั้งต้นของผู้พัฒนา รอ อบต. ยืนยันผู้มีอำนาจตามตัวบทฉบับปัจจุบัน';

SELECT cron.unschedule('water-announce-tick-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'water-announce-tick-hourly');

SELECT cron.schedule(
  'water-announce-tick-hourly',
  '25 * * * *',
  $cron$SELECT public.water_announcement_tick();$cron$
);

NOTIFY pgrst, 'reload schema';

COMMIT;
