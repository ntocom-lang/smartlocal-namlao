-- รายงานการสูญหาย/ความเสียหายยานพาหนะ (แบบ ๕) เฟส 2/2: ข้อกำหนด · trigger · RLS · สิทธิ์
-- ต้องรันหลัง 20261018110000_fleet_incidents_tables.sql

DO $guard$
BEGIN
  IF to_regclass('public.fleet_incidents') IS NULL OR to_regclass('public.fleet_incident_people') IS NULL THEN
    RAISE EXCEPTION 'run 20261018110000_fleet_incidents_tables.sql first';
  END IF;
END
$guard$;

-- บุคคลในรายงานต้องอยู่ อปท. เดียวกับรายงาน — FK คู่ (incident_id, municipality_id) กันข้ามเขต
-- โดยไม่ต้องพึ่ง trigger และลบรายงานแล้วรายชื่อบุคคลหายตามไปด้วย
ALTER TABLE public.fleet_incidents
  DROP CONSTRAINT IF EXISTS fleet_incidents_id_municipality_key,
  ADD CONSTRAINT fleet_incidents_id_municipality_key UNIQUE (id, municipality_id);

ALTER TABLE public.fleet_incident_people
  DROP CONSTRAINT IF EXISTS fleet_incident_people_incident_fkey,
  ADD CONSTRAINT fleet_incident_people_incident_fkey
    FOREIGN KEY (incident_id, municipality_id)
    REFERENCES public.fleet_incidents (id, municipality_id) ON DELETE CASCADE;

-- รถ/ทริปต้องเป็นของ อปท. เดียวกัน และทริปต้องเป็นของรถคันนั้น · ผู้บันทึกมาจากผู้ล็อกอินเสมอ
-- SECURITY DEFINER เพื่อตรวจการมีอยู่จริงโดยไม่ขึ้นกับ RLS ของผู้เรียก (ไม่คืนข้อมูลใดออกไป)
CREATE OR REPLACE FUNCTION public.fleet_incident_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'FLEET_INCIDENT_MUNICIPALITY_IMMUTABLE: ย้ายรายงานข้ามหน่วยงานไม่ได้';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.created_by := auth.uid();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.fleet_vehicles v
     WHERE v.id = NEW.vehicle_id AND v.municipality_id = NEW.municipality_id
  ) THEN
    RAISE EXCEPTION 'FLEET_INCIDENT_VEHICLE_MISMATCH: ยานพาหนะไม่ใช่ของหน่วยงานนี้';
  END IF;

  IF NEW.trip_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_trips t
     WHERE t.id = NEW.trip_id AND t.vehicle_id = NEW.vehicle_id AND t.municipality_id = NEW.municipality_id
  ) THEN
    RAISE EXCEPTION 'FLEET_INCIDENT_TRIP_MISMATCH: การใช้รถที่อ้างถึงไม่ใช่ของยานพาหนะคันนี้';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fleet_incident_guard ON public.fleet_incidents;
CREATE TRIGGER trg_fleet_incident_guard
  BEFORE INSERT OR UPDATE ON public.fleet_incidents
  FOR EACH ROW EXECUTE FUNCTION public.fleet_incident_guard();

DROP TRIGGER IF EXISTS trg_fleet_incidents_updated_at ON public.fleet_incidents;
CREATE TRIGGER trg_fleet_incidents_updated_at
  BEFORE UPDATE ON public.fleet_incidents
  FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_at();

DROP TRIGGER IF EXISTS trg_fleet_incident_people_updated_at ON public.fleet_incident_people;
CREATE TRIGGER trg_fleet_incident_people_updated_at
  BEFORE UPDATE ON public.fleet_incident_people
  FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_at();

-- ร่องรอย "ใครแก้อะไร เมื่อไร" โดยไม่เก็บค่า — fleet_audit_row คัดลอกทั้งแถวลง fleet_audit_log
-- ถ้าใช้กับตารางนี้ ชื่อ/ที่อยู่/เลขใบขับขี่ของคนนอกจะค้างใน audit log ลบตามคำขอเจ้าของข้อมูลไม่ได้
-- จึงบันทึกแค่ชื่อคอลัมน์ที่เปลี่ยน (ค่าเก่า/ใหม่ไม่ลง)
CREATE OR REPLACE FUNCTION public.fleet_audit_row_redacted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_changed text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key <> 'updated_at' AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF v_changed IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.fleet_audit_log (
    municipality_id, table_name, record_id, action, old_data, new_data, changed_by, changed_at
  ) VALUES (
    (v_row ->> 'municipality_id')::uuid,
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    TG_OP,
    NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'redacted', true,
      'changed_columns', to_jsonb(v_changed),
      -- ตัวชี้ที่ไม่ใช่ข้อมูลบุคคล ให้ตามรอยได้ว่าเป็นรายงานของรถ/รายงานไหน
      'vehicle_id', v_row -> 'vehicle_id',
      'incident_id', v_row -> 'incident_id',
      'role', v_row -> 'role'
    )),
    auth.uid(),
    now()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fleet_incidents_audit ON public.fleet_incidents;
CREATE TRIGGER trg_fleet_incidents_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fleet_incidents
  FOR EACH ROW EXECUTE FUNCTION public.fleet_audit_row_redacted();

DROP TRIGGER IF EXISTS trg_fleet_incident_people_audit ON public.fleet_incident_people;
CREATE TRIGGER trg_fleet_incident_people_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fleet_incident_people
  FOR EACH ROW EXECUTE FUNCTION public.fleet_audit_row_redacted();

REVOKE ALL ON FUNCTION public.fleet_incident_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_audit_row_redacted() FROM PUBLIC, anon, authenticated;

-- เฉพาะผู้ดูแลยานพาหนะ (fleet_admin / แอดมิน อปท. / superadmin) — เจ้าของระบบเลือก 2026-10-18
-- เจ้าหน้าที่ยานพาหนะทั่วไป/ผู้ขับ/ผู้ดูรายงาน มองไม่เห็นแม้แต่ว่ามีรายงาน
DROP POLICY IF EXISTS fleet_incidents_manager_all ON public.fleet_incidents;
CREATE POLICY fleet_incidents_manager_all ON public.fleet_incidents
  FOR ALL TO authenticated
  USING (public.fleet_is_manager(municipality_id))
  WITH CHECK (public.fleet_is_manager(municipality_id));

DROP POLICY IF EXISTS fleet_incident_people_manager_all ON public.fleet_incident_people;
CREATE POLICY fleet_incident_people_manager_all ON public.fleet_incident_people
  FOR ALL TO authenticated
  USING (public.fleet_is_manager(municipality_id))
  WITH CHECK (public.fleet_is_manager(municipality_id));

-- anon ไม่ได้อะไรเลย (ค่าเริ่มต้นของ Supabase ให้ GRANT ALL กับตารางใหม่) · ไม่ให้ TRUNCATE/TRIGGER/REFERENCES
REVOKE ALL ON public.fleet_incidents, public.fleet_incident_people FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_incidents, public.fleet_incident_people TO authenticated;
GRANT ALL ON public.fleet_incidents, public.fleet_incident_people TO service_role;

COMMENT ON TABLE public.fleet_incidents IS
  'รายงานการสูญหาย/ความเสียหายยานพาหนะ (แบบ 5 ระเบียบ มท. ยานพาหนะ อปท. 2569 ข้อ 18) — เฉพาะผู้ดูแลยานพาหนะ · audit แบบไม่เก็บค่า · ระยะเวลาเก็บรอ DPO';
COMMENT ON TABLE public.fleet_incident_people IS
  'ข้อมูลส่วนบุคคลในแบบ 5 (คู่กรณี ผู้บาดเจ็บ พยาน พนักงานสอบสวน) — PDPA: เฉพาะผู้ดูแลยานพาหนะ ห้ามส่งออก Telegram/รายงานอื่น · ระยะเวลาเก็บรอ DPO';
