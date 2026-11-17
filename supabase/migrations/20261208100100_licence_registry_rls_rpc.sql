-- 20261208100100_licence_registry_rls_rpc.sql
-- ขั้น 1B (E3) ทะเบียนใบอนุญาต ไฟล์ 2/3 — ฟังก์ชันสิทธิ์ · trigger · ประวัติ · RPC รับค่าธรรมเนียม/เปลี่ยนสถานะ · policy
--   ต้องรัน 20261208100000_licence_registry_tables.sql ก่อน · ไม่แตะ profiles / admin_update_user / ตารางเดิมใดๆ
--
-- 1) สิทธิ์ (ไม่เพิ่มคอลัมน์ *_role ใน profiles โดยตั้งใจ — ไม่ต้อง CREATE OR REPLACE guard_profile_privileged_update /
--    admin_update_user ซึ่งเคยถูกเขียนทับจนบั๊กกลับมา 2 รอบ)
--      ผู้จัดการทะเบียน = superadmin · admin ของ อปท. · officer/staff ที่สังกัด "กองที่ถือเรื่อง" ของ อปท. นั้น
--        กองที่ถือเรื่อง = licence_settings.owner_department_id ถ้าตั้งไว้ (และเป็นกองของ อปท. เดียวกัน)
--                         ไม่ตั้ง = กองสาธารณสุขที่มีคนสังกัดจริง ไม่งั้นสำนักปลัด (แนวเดียวกับ waste_owner_department_id)
--      อ่าน = ผู้จัดการทะเบียนเท่านั้น (มีชื่อผู้ประกอบการที่เป็นบุคคลธรรมดา — PDPA) · ผู้บริหารเห็นตัวเลขผ่าน RPC เฟสถัดไป
--      ค่าตั้ง (กองที่ถือเรื่อง/วันเตือน) = superadmin / admin ของ อปท. เท่านั้น
--      ประชาชน / anon / council / technician / viewer: ไม่มีสิทธิ์ตารางใดๆ
-- 2) ระบบไม่ตัดสินแทนคน
--      เปลี่ยนสถานะ (พักใช้/เพิกถอน/เลิกกิจการ/คืนสถานะ) ทางเดียวผ่าน licence_set_status() ต้องมีเหตุผล (+เลขคำสั่งเมื่อพักใช้/เพิกถอน)
--      รับค่าธรรมเนียมผ่าน licence_record_fee() ต้องมีเลขใบเสร็จ — ระบบขยายวันตามกฎ:
--        renewal (พ.ร.ฎ. ๒๕๖๔): ชำระไม่เกินวันสุดท้ายของใบ → วันหมดอายุใหม่ = เดิม + อายุใบ · ชำระหลังสิ้นอายุ = ปฏิเสธ (ต้องยื่นใหม่)
--        annual (ม.๖๕): วันครบกำหนดถัดไป = เดิม + 12 เดือน · ค่าปรับร้อยละ ๒๐ เจ้าหน้าที่ยืนยันยอดเอง (หน้าจอคำนวณเสนอ)
--      ยกเลิกรายการรับเงินที่บันทึกผิดผ่าน licence_void_fee() ได้เฉพาะรายการล่าสุดของใบ ต้องมีเหตุผล ย้อนวันกลับให้เอง
-- 3) ด่าน: ใบที่มีรายการรับเงินแล้ว แก้วันหมดอายุ/วันครบกำหนดตรงๆ ไม่ได้ (ต้องผ่าน RPC) — กัน "ต่ออายุ" โดยไม่มีเงินเข้า
--          ใบใหม่ต้องเพิ่มเป็น active เท่านั้น · ใบอนุญาตต้องมีวันหมดอายุ · หนังสือรับรองการแจ้งห้ามมีวันหมดอายุ
-- 4) ประวัติ licence_events: trigger เขียนทุกการเพิ่ม/แก้/ลบของ ค่าตั้ง/ประเภท/ใบ (ค่าเดิม → ค่าใหม่ เฉพาะช่องที่เปลี่ยน)
--      RPC ระบุ action (status/renew/fee/void) + เหตุผล ผ่าน set_config แบบ local (ผู้ใช้ตั้งเองไม่ได้ — PostgREST ไม่เปิด pg_catalog)
--
-- ย้อนกลับ: DROP FUNCTION public.licence_record_fee, public.licence_void_fee, public.licence_set_status,
--           public.licence_is_manager, public.licence_is_admin, public.licence_owner_department_id, public.licence_today,
--           public.licence_stamp, public.licence_types_guard, public.licences_guard, public.licence_settings_guard,
--           public.licence_log_event, public.licence_is_superadmin, public.licence_managed_municipality_id,
--           public.licence_admin_municipality_id CASCADE; (trigger/policy หายตาม — 3 ตัวหลังต้องระบุเอง ฟังก์ชัน SQL
--           ไม่บันทึกว่าพึ่ง licence_is_manager จึงไม่ถูก CASCADE ตาม) แล้วย้อนไฟล์ 1
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.licence_settings') IS NULL OR to_regclass('public.licence_types') IS NULL
     OR to_regclass('public.licences') IS NULL OR to_regclass('public.licence_fee_payments') IS NULL
     OR to_regclass('public.licence_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261208100000_licence_registry_tables.sql ก่อน (ไม่พบตารางใหม่ครบ 5 ตาราง)';
  END IF;
  IF to_regprocedure('public.get_my_role()') IS NULL OR to_regprocedure('public.get_my_municipality_id()') IS NULL
     OR to_regprocedure('public.get_my_department_id()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์พื้นฐาน (get_my_role / get_my_municipality_id / get_my_department_id)';
  END IF;
END $guard$;

-- ── วันนี้ตามเวลาไทย ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date; $$;
REVOKE ALL ON FUNCTION public.licence_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.licence_today() TO authenticated;

-- ── สิทธิ์ ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_owner_department_id(p_municipality_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    (SELECT s.owner_department_id
       FROM public.licence_settings AS s
       JOIN public.departments AS d ON d.id = s.owner_department_id AND d.municipality_id = s.municipality_id
      WHERE s.municipality_id = p_municipality_id),
    (SELECT department.id
       FROM public.departments AS department
      WHERE department.municipality_id = p_municipality_id
        AND (lower(department.code) IN ('health', 'general')
             OR department.name ILIKE '%สาธารณสุข%'
             OR department.name ILIKE '%สำนักปลัด%')
      ORDER BY
        -- กองที่มีคนอยู่จริงมาก่อน — กองสาธารณสุขที่เพิ่งสร้างแต่ยังไม่มีใคร ต้องไม่ดึงสิทธิ์ออกจากสำนักปลัด
        EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.department_id = department.id) DESC,
        (lower(department.code) = 'health' OR department.name ILIKE '%สาธารณสุข%') DESC,
        department.sort_order,
        department.id
      LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.licence_owner_department_id(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.licence_is_admin(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    public.get_my_role() = 'superadmin'
    OR (p_municipality_id IS NOT NULL
        AND p_municipality_id = public.get_my_municipality_id()
        AND public.get_my_role() = 'admin'),
    false);
$$;

CREATE OR REPLACE FUNCTION public.licence_is_manager(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.licence_is_admin(p_municipality_id) OR coalesce(
    p_municipality_id IS NOT NULL
    AND p_municipality_id = public.get_my_municipality_id()
    AND public.get_my_role() IN ('officer', 'staff')
    AND public.get_my_department_id() IS NOT NULL
    AND public.get_my_department_id() = public.licence_owner_department_id(p_municipality_id),
    false);
$$;

-- ตัวช่วยของ policy: ไม่รับค่าจากแถว ⇒ policy ห่อด้วย (SELECT …) แล้ว planner คำนวณครั้งเดียวต่อคำสั่ง (initPlan)
-- แทนการเรียก licence_is_manager ทุกแถว (ทะเบียนหลักพันใบ × ไล่ profiles ในทางเดากองเอง — ผลตรวจรอบ 1 ข้อ 3)
CREATE OR REPLACE FUNCTION public.licence_is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT coalesce(public.get_my_role() = 'superadmin', false); $$;

-- อปท. ที่ผู้ใช้ "เป็นผู้จัดการทะเบียน" อยู่ (ไม่ใช่ผู้จัดการ = NULL ⇒ เทียบกับแถวไหนก็ไม่เท่า)
CREATE OR REPLACE FUNCTION public.licence_managed_municipality_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.licence_is_manager(public.get_my_municipality_id()) THEN public.get_my_municipality_id() END;
$$;

CREATE OR REPLACE FUNCTION public.licence_admin_municipality_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.licence_is_admin(public.get_my_municipality_id()) THEN public.get_my_municipality_id() END;
$$;

REVOKE ALL ON FUNCTION public.licence_is_admin(uuid), public.licence_is_manager(uuid), public.licence_is_superadmin(),
  public.licence_managed_municipality_id(), public.licence_admin_municipality_id() FROM PUBLIC, anon;
-- หน้าเจ้าหน้าที่เรียกเพื่อสลับโหมด (ตัวบังคับจริงคือ policy ข้างล่าง)
GRANT EXECUTE ON FUNCTION public.licence_is_admin(uuid), public.licence_is_manager(uuid), public.licence_is_superadmin(),
  public.licence_managed_municipality_id(), public.licence_admin_municipality_id() TO authenticated;

-- ── ประทับผู้แก้/เวลา ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN NEW.updated_by ELSE OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.licence_stamp() FROM PUBLIC, anon, authenticated;

-- ── ค่าตั้ง ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
    RAISE EXCEPTION 'เปลี่ยน อปท. ของค่าตั้งไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.departments WHERE id = NEW.owner_department_id AND municipality_id = NEW.municipality_id) THEN
    RAISE EXCEPTION 'กองที่ถือเรื่องต้องเป็นกองของ อปท. เดียวกัน' USING ERRCODE = '23514';
  END IF;
  -- เรียงวันเตือนจากมากไปน้อย ตัดค่าซ้ำ
  NEW.remind_days := ARRAY(SELECT DISTINCT d FROM unnest(NEW.remind_days) AS d ORDER BY d DESC);
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.licence_settings_guard() FROM PUBLIC, anon, authenticated;

-- ── ประเภทใบอนุญาต ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_types_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  -- ชนิดเอกสารคำนวณจากหมวดเสมอ (ไม่เชื่อค่าที่ส่งมา) — ม.๔๘: อาหารไม่เกิน ๒๐๐ ตร.ม. = หนังสือรับรองการแจ้ง
  -- ไม่มีอายุ และไม่อยู่ในบัญชีท้าย พ.ร.ฎ. ๒๕๖๔ · ม.๕๕: ใบอนุญาตตาม พ.ร.บ. นี้อายุหนึ่งปี → 12 เดือน (หมวด other ตั้งเองได้)
  IF NEW.category = 'food_notice' THEN
    NEW.doc_kind := 'notice_certificate';
    NEW.validity_months := NULL;
    NEW.renewal_by_fee := false;
  ELSE
    NEW.doc_kind := 'licence';
    IF NEW.category <> 'other' OR NEW.validity_months IS NULL THEN
      NEW.validity_months := 12;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'เปลี่ยนรหัสประเภทไม่ได้' USING ERRCODE = '42501';
    END IF;
    IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'เปลี่ยน อปท. ของประเภทใบอนุญาตไม่ได้' USING ERRCODE = '42501';
    END IF;
    -- ใบอนุญาต ↔ หนังสือรับรองการแจ้ง ความหมายของวันที่ต่างกันทั้งหมด เปลี่ยนเมื่อมีใบในทะเบียนแล้วไม่ได้
    -- (ตรวจหลังคำนวณ doc_kind จากหมวดแล้ว — กันการเปลี่ยนหมวดเพื่อเลี่ยงด่าน)
    -- อายุใบ (หมวด other) เปลี่ยนได้ มีผลกับการต่ออายุครั้งถัดไปเท่านั้น ไม่ย้อนแก้ใบเดิม
    IF NEW.doc_kind IS DISTINCT FROM OLD.doc_kind
       AND EXISTS (SELECT 1 FROM public.licences WHERE licence_type_id = OLD.id) THEN
      RAISE EXCEPTION 'ประเภทนี้มีใบในทะเบียนแล้ว เปลี่ยนชนิดเอกสาร (ใบอนุญาต/หนังสือรับรองการแจ้ง) ไม่ได้ — สร้างประเภทใหม่แทน'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.licence_types_guard() FROM PUBLIC, anon, authenticated;

-- ── ใบอนุญาต ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licences_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user     boolean := auth.uid() IS NOT NULL;
  v_status   boolean := coalesce(current_setting('licence.status_rpc', true), '') = 'on';
  v_fee      boolean := coalesce(current_setting('licence.fee_rpc', true), '') = 'on';
  v_kind     text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;                                     -- ใบที่มีรายการรับเงินลบไม่ได้อยู่แล้ว (FK RESTRICT)
  END IF;

  SELECT doc_kind INTO v_kind FROM public.licence_types
   WHERE id = NEW.licence_type_id AND municipality_id = NEW.municipality_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'ไม่พบประเภทใบอนุญาตของ อปท. นี้' USING ERRCODE = '23503';
  END IF;

  -- รูปแบบวันที่ตามชนิดเอกสาร
  IF v_kind = 'licence' THEN
    IF NEW.expires_on IS NULL THEN
      RAISE EXCEPTION 'ใบอนุญาตต้องมีวันหมดอายุ' USING ERRCODE = '23514';
    END IF;
    NEW.next_fee_due_on := NULL;
  ELSE
    IF NEW.expires_on IS NOT NULL THEN
      RAISE EXCEPTION 'หนังสือรับรองการแจ้งไม่มีวันหมดอายุ (ใช้วันครบกำหนดค่าธรรมเนียมรายปีแทน)' USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.business_name := btrim(NEW.business_name);
  NEW.holder_name := btrim(NEW.holder_name);
  NEW.licence_no := nullif(btrim(coalesce(NEW.licence_no, '')), '');

  IF TG_OP = 'INSERT' THEN
    IF v_user AND NOT v_status AND NEW.status <> 'active' THEN
      RAISE EXCEPTION 'เพิ่มใบใหม่ได้เฉพาะสถานะใช้งาน — พักใช้/เพิกถอน/เลิกกิจการ ทำผ่านปุ่มเปลี่ยนสถานะ' USING ERRCODE = '42501';
    END IF;
    IF v_user AND NOT v_status THEN
      NEW.status_from := NULL; NEW.status_until := NULL; NEW.status_order_ref := NULL; NEW.status_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'เปลี่ยนรหัสใบไม่ได้ (ประวัติจะหลุดจากใบ)' USING ERRCODE = '42501';
  END IF;
  IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
    RAISE EXCEPTION 'เปลี่ยน อปท. ของใบอนุญาตไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.import_batch IS DISTINCT FROM OLD.import_batch THEN
    RAISE EXCEPTION 'เปลี่ยนชุดนำเข้าไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF v_user AND NOT v_status AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.status_from IS DISTINCT FROM OLD.status_from
       OR NEW.status_until IS DISTINCT FROM OLD.status_until OR NEW.status_order_ref IS DISTINCT FROM OLD.status_order_ref
       OR NEW.status_reason IS DISTINCT FROM OLD.status_reason) THEN
    RAISE EXCEPTION 'เปลี่ยนสถานะได้ทางปุ่มเปลี่ยนสถานะเท่านั้น (ต้องมีเหตุผล/เลขคำสั่ง)' USING ERRCODE = '42501';
  END IF;
  IF v_user AND NOT v_fee
     AND (NEW.expires_on IS DISTINCT FROM OLD.expires_on OR NEW.next_fee_due_on IS DISTINCT FROM OLD.next_fee_due_on
          OR NEW.licence_type_id IS DISTINCT FROM OLD.licence_type_id)
     AND EXISTS (SELECT 1 FROM public.licence_fee_payments WHERE licence_id = OLD.id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'ใบนี้มีรายการรับค่าธรรมเนียมแล้ว แก้วันหมดอายุ/วันครบกำหนด/ประเภทตรงๆ ไม่ได้ — บันทึกรับเงิน หรือยกเลิกรายการที่ผิดก่อน'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.licences_guard() FROM PUBLIC, anon, authenticated;

-- ── ประวัติ ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_log_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row     jsonb;
  v_skip    text[] := ARRAY['id', 'municipality_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'sort_order'];
  v_entity  text;
  v_action  text := lower(TG_OP);
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_rpc_action text := nullif(current_setting('licence.action', true), '');
  v_reason  text := nullif(current_setting('licence.reason', true), '');
  v_entity_id uuid;
  -- ช่องติดต่อส่วนบุคคล: ประวัติบอกแค่ว่า "เปลี่ยน" ไม่เก็บค่า (ตารางประวัติลบไม่ได้ — ลบใบ/ลบชุดนำเข้าแล้วต้องไม่ค้าง)
  -- ชื่อผู้ถือใบยังเก็บ เพราะต้องย้อนตรวจได้ว่าใบเปลี่ยนมือเมื่อไร (เจ้าของระบบเปลี่ยนได้)
  v_masked  text[] := ARRAY['holder_phone', 'address'];
BEGIN
  v_row := coalesce(v_new, v_old);
  -- อปท. ถูกลบทั้งแถว (cascade) → ไม่ลงประวัติ ไม่งั้น FK ของ licence_events ทำให้ลบ อปท. ไม่ได้
  IF NOT EXISTS (SELECT 1 FROM public.municipalities WHERE id = (v_row ->> 'municipality_id')::uuid) THEN
    RETURN NULL;
  END IF;

  v_entity := CASE TG_TABLE_NAME
    WHEN 'licence_settings' THEN 'settings'
    WHEN 'licence_types' THEN 'type'
    WHEN 'licences' THEN 'licence'
  END;
  v_entity_id := CASE WHEN v_entity = 'settings' THEN (v_row ->> 'municipality_id')::uuid ELSE (v_row ->> 'id')::uuid END;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY (v_skip);
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        IF v_key = ANY (v_masked) THEN
          v_changes := v_changes || jsonb_build_object(v_key, 'changed');
        ELSE
          v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
        END IF;
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    IF v_entity = 'licence' AND v_rpc_action IN ('status', 'renew', 'fee', 'void') THEN
      v_action := v_rpc_action;
    END IF;
  ELSE
    v_changes := jsonb_strip_nulls(v_row - v_skip - v_masked);
  END IF;

  INSERT INTO public.licence_events (municipality_id, entity, entity_id, licence_id, action, changes, reason, actor)
  VALUES ((v_row ->> 'municipality_id')::uuid, v_entity, v_entity_id,
          CASE WHEN v_entity = 'licence' THEN v_entity_id END,
          v_action, v_changes, CASE WHEN v_action IN ('status', 'renew', 'fee', 'void') THEN v_reason END, auth.uid());
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.licence_log_event() FROM PUBLIC, anon, authenticated;

-- ── trigger ──────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS licence_settings_guard_trigger ON public.licence_settings;
CREATE TRIGGER licence_settings_guard_trigger BEFORE INSERT OR UPDATE ON public.licence_settings
  FOR EACH ROW EXECUTE FUNCTION public.licence_settings_guard();
DROP TRIGGER IF EXISTS licence_settings_log_trigger ON public.licence_settings;
CREATE TRIGGER licence_settings_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.licence_settings
  FOR EACH ROW EXECUTE FUNCTION public.licence_log_event();

DROP TRIGGER IF EXISTS licence_types_guard_trigger ON public.licence_types;
CREATE TRIGGER licence_types_guard_trigger BEFORE INSERT OR UPDATE ON public.licence_types
  FOR EACH ROW EXECUTE FUNCTION public.licence_types_guard();
DROP TRIGGER IF EXISTS licence_types_stamp_trigger ON public.licence_types;
CREATE TRIGGER licence_types_stamp_trigger BEFORE INSERT OR UPDATE ON public.licence_types
  FOR EACH ROW EXECUTE FUNCTION public.licence_stamp();
DROP TRIGGER IF EXISTS licence_types_log_trigger ON public.licence_types;
CREATE TRIGGER licence_types_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.licence_types
  FOR EACH ROW EXECUTE FUNCTION public.licence_log_event();

DROP TRIGGER IF EXISTS licences_guard_trigger ON public.licences;
CREATE TRIGGER licences_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON public.licences
  FOR EACH ROW EXECUTE FUNCTION public.licences_guard();
DROP TRIGGER IF EXISTS licences_stamp_trigger ON public.licences;
CREATE TRIGGER licences_stamp_trigger BEFORE INSERT OR UPDATE ON public.licences
  FOR EACH ROW EXECUTE FUNCTION public.licence_stamp();
DROP TRIGGER IF EXISTS licences_log_trigger ON public.licences;
CREATE TRIGGER licences_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.licences
  FOR EACH ROW EXECUTE FUNCTION public.licence_log_event();

-- ── RPC เปลี่ยนสถานะ (คำสั่งเจ้าพนักงานท้องถิ่น — ระบบบันทึก ไม่ตัดสิน) ─────────────────
CREATE OR REPLACE FUNCTION public.licence_set_status(
  p_licence_id uuid, p_status text, p_reason text,
  p_order_ref text DEFAULT NULL, p_from date DEFAULT NULL, p_until date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lic    public.licences%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref    text := nullif(btrim(coalesce(p_order_ref, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_lic FROM public.licences WHERE id = p_licence_id FOR UPDATE;
  IF NOT FOUND OR NOT public.licence_is_manager(v_lic.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบใบอนุญาต หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'suspended', 'revoked', 'closed') THEN
    RAISE EXCEPTION 'สถานะไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผล (3–2000 ตัวอักษร)' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NOT NULL AND length(v_ref) > 200 THEN
    RAISE EXCEPTION 'เลขที่คำสั่งยาวเกิน 200 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF p_status = v_lic.status AND p_status <> 'suspended' THEN
    RAISE EXCEPTION 'ใบนี้อยู่ในสถานะนี้แล้ว' USING ERRCODE = '22023';
  END IF;
  IF v_lic.status IN ('revoked', 'closed') AND p_status <> v_lic.status AND v_ref IS NULL THEN
    -- คืนสถานะใบที่ถูกเพิกถอน/เลิกกิจการ = มีคำสั่ง/หนังสือใหม่เท่านั้น (เช่น ชนะอุทธรณ์) หรือบันทึกข้อความแก้ข้อมูลที่บันทึกผิด
    -- (ค่าเริ่มต้นที่เข้มไว้ก่อน — เลิกกิจการแล้วกลับมาทำใหม่ตามปกติคือยื่นขอใบใหม่)
    RAISE EXCEPTION 'ใบที่ถูกเพิกถอน/เลิกกิจการ เปลี่ยนสถานะได้เมื่อระบุเลขที่คำสั่ง/หนังสือที่ให้เปลี่ยน' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'suspended' THEN
    IF v_ref IS NULL OR p_from IS NULL OR p_until IS NULL OR p_until < p_from THEN
      RAISE EXCEPTION 'พักใช้ต้องระบุเลขที่คำสั่ง วันเริ่ม และวันสิ้นสุด' USING ERRCODE = '22023';
    END IF;
    -- ม.๕๙ พักใช้ตามที่เห็นสมควร แต่ไม่เกินสิบห้าวัน (นับวันเริ่มเป็นวันที่ ๑)
    IF (p_until - p_from + 1) > 15 THEN
      RAISE EXCEPTION 'พักใช้ใบอนุญาตได้ไม่เกิน 15 วัน (พ.ร.บ.การสาธารณสุข ม.59)' USING ERRCODE = '22023';
    END IF;
  ELSIF p_status = 'revoked' THEN
    IF v_ref IS NULL THEN
      RAISE EXCEPTION 'เพิกถอนต้องระบุเลขที่คำสั่ง' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM set_config('licence.status_rpc', 'on', true);
  PERFORM set_config('licence.action', 'status', true);
  PERFORM set_config('licence.reason', v_reason, true);
  UPDATE public.licences
     SET status = p_status,
         status_from = CASE WHEN p_status = 'active' THEN NULL ELSE coalesce(p_from, public.licence_today()) END,
         status_until = CASE WHEN p_status = 'suspended' THEN p_until END,
         status_order_ref = CASE WHEN p_status = 'active' THEN NULL ELSE v_ref END,
         status_reason = CASE WHEN p_status = 'active' THEN NULL ELSE v_reason END
   WHERE id = p_licence_id;
  -- คืนสถานะ active: เหตุผลอยู่ใน licence_events (คอลัมน์ในแถวล้างเพราะ CHECK กำหนดให้ใช้กับสถานะที่ไม่ใช่ active)
  PERFORM set_config('licence.status_rpc', '', true);
  PERFORM set_config('licence.action', '', true);
  PERFORM set_config('licence.reason', '', true);
END;
$$;

-- ── RPC รับค่าธรรมเนียม ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.licence_record_fee(
  p_licence_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_receipt_no text,
  p_surcharge numeric DEFAULT 0, p_no_material_change boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lic     public.licences%ROWTYPE;
  v_type    public.licence_types%ROWTYPE;
  v_receipt text := nullif(btrim(coalesce(p_receipt_no, '')), '');
  v_today   date := public.licence_today();
  v_from    date;
  v_to      date;
  v_pay_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_lic FROM public.licences WHERE id = p_licence_id FOR UPDATE;
  IF NOT FOUND OR NOT public.licence_is_manager(v_lic.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบใบอนุญาต หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_type FROM public.licence_types WHERE id = v_lic.licence_type_id;

  IF v_lic.status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'ใบที่ถูกเพิกถอน/เลิกกิจการแล้ว รับค่าธรรมเนียมต่ออายุไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('renewal', 'annual') THEN
    RAISE EXCEPTION 'ชนิดการรับเงินไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF v_receipt IS NULL OR length(v_receipt) > 60 THEN
    RAISE EXCEPTION 'ต้องระบุเลขที่ใบเสร็จ (ไม่เกิน 60 ตัวอักษร)' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 10000000 OR coalesce(p_surcharge, 0) < 0 OR coalesce(p_surcharge, 0) > 10000000 THEN
    RAISE EXCEPTION 'จำนวนเงินไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on > v_today OR p_paid_on < v_today - 400 THEN
    RAISE EXCEPTION 'วันที่ชำระต้องไม่เกินวันนี้ และย้อนหลังได้ไม่เกิน 400 วัน' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.licence_fee_payments
              WHERE municipality_id = v_lic.municipality_id AND receipt_no = v_receipt AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'เลขที่ใบเสร็จนี้บันทึกไปแล้ว' USING ERRCODE = '23505';
  END IF;

  IF p_kind = 'renewal' THEN
    IF v_type.doc_kind <> 'licence' OR NOT v_type.renewal_by_fee THEN
      RAISE EXCEPTION 'ประเภทนี้ไม่ได้ตั้งให้ต่ออายุโดยชำระค่าธรรมเนียม' USING ERRCODE = '22023';
    END IF;
    IF NOT coalesce(p_no_material_change, false) THEN
      RAISE EXCEPTION 'ต่ออายุโดยชำระค่าธรรมเนียมได้เฉพาะเมื่อผู้ประกอบการรับรองว่าไม่เปลี่ยนแปลงสาระสำคัญ — ถ้าเปลี่ยนแปลง ต้องยื่นคำขอ'
        USING ERRCODE = '22023';
    END IF;
    -- พ.ร.ฎ. ๒๕๖๔ ม.๕: ชำระก่อนใบอนุญาตสิ้นอายุ (expires_on = วันสุดท้ายที่ใบยังใช้ได้)
    IF p_paid_on > v_lic.expires_on THEN
      RAISE EXCEPTION 'ชำระหลังใบอนุญาตสิ้นอายุ (%) — ต่ออายุไม่ได้ ต้องยื่นคำขอรับใบอนุญาตใหม่', v_lic.expires_on
        USING ERRCODE = '22023';
    END IF;
    IF v_type.renewal_window_days IS NOT NULL AND p_paid_on < v_lic.expires_on - v_type.renewal_window_days THEN
      RAISE EXCEPTION 'ยังไม่ถึงช่วงต่ออายุตามข้อกำหนดของท้องถิ่น (ล่วงหน้าได้ไม่เกิน % วัน)', v_type.renewal_window_days
        USING ERRCODE = '22023';
    END IF;
    -- ต่อล่วงหน้าเกิน 1 รอบไม่ได้: ต้องชำระภายในรอบอายุปัจจุบันของใบ (กันบันทึกซ้ำคนละเลขใบเสร็จแล้วใบได้อายุเพิ่มเงียบๆ)
    -- ⚠️ การชำระล่วงหน้าหลายรอบตาม พ.ร.ฎ. ๒๕๖๔ / ข้อบัญญัติ ต้องยืนยันกับตัวบท — ค่าเริ่มต้นเข้มไว้ก่อน
    IF p_paid_on < ((v_lic.expires_on + 1) - make_interval(months => v_type.validity_months))::date THEN
      RAISE EXCEPTION 'ใบนี้ต่ออายุไว้ล่วงหน้าแล้ว (ใช้ได้ถึง %) — ต่อซ้อนเกิน 1 รอบไม่ได้', v_lic.expires_on
        USING ERRCODE = '22023';
    END IF;
    v_from := v_lic.expires_on + 1;
    -- นับจากวันเริ่มรอบใหม่ แล้วลบ 1 วัน: วันปลายเดือนไม่เพี้ยนสะสม (1 มี.ค. → 28/29 ก.พ. ถูกทุกปี)
    v_to := (v_from + make_interval(months => v_type.validity_months))::date - 1;
  ELSE
    IF v_type.doc_kind <> 'notice_certificate' THEN
      RAISE EXCEPTION 'ค่าธรรมเนียมรายปีใช้กับหนังสือรับรองการแจ้งเท่านั้น' USING ERRCODE = '22023';
    END IF;
    IF v_lic.next_fee_due_on IS NULL THEN
      RAISE EXCEPTION 'ใบนี้ยังไม่ได้ตั้งวันครบกำหนดชำระค่าธรรมเนียม' USING ERRCODE = '22023';
    END IF;
    IF p_paid_on < (v_lic.next_fee_due_on - interval '12 months')::date THEN
      RAISE EXCEPTION 'ค่าธรรมเนียมรอบนี้ชำระไว้แล้ว (ครบกำหนดครั้งถัดไป %) — ชำระซ้อนเกิน 1 รอบไม่ได้', v_lic.next_fee_due_on
        USING ERRCODE = '22023';
    END IF;
    v_from := v_lic.next_fee_due_on;
    v_to := ((v_lic.next_fee_due_on + interval '12 months')::date) - 1;
  END IF;

  INSERT INTO public.licence_fee_payments (municipality_id, licence_id, kind, paid_on, amount, surcharge, receipt_no,
                                           period_from, period_to, no_material_change, prev_expires_on, prev_fee_due_on, recorded_by, created_at)
  VALUES (v_lic.municipality_id, v_lic.id, p_kind, p_paid_on, round(p_amount, 2), round(coalesce(p_surcharge, 0), 2), v_receipt,
          v_from, v_to, coalesce(p_no_material_change, false), v_lic.expires_on, v_lic.next_fee_due_on, auth.uid(),
          clock_timestamp())   -- เวลาที่ INSERT จริง (now() = เวลาเริ่ม transaction เรียงผิดได้เมื่อรอ lock กัน)
  RETURNING id INTO v_pay_id;

  PERFORM set_config('licence.fee_rpc', 'on', true);
  PERFORM set_config('licence.action', CASE WHEN p_kind = 'renewal' THEN 'renew' ELSE 'fee' END, true);
  PERFORM set_config('licence.reason', 'ใบเสร็จ ' || v_receipt, true);
  IF p_kind = 'renewal' THEN
    UPDATE public.licences SET expires_on = v_to WHERE id = v_lic.id;
  ELSE
    UPDATE public.licences SET next_fee_due_on = v_to + 1 WHERE id = v_lic.id;
  END IF;
  PERFORM set_config('licence.fee_rpc', '', true);
  PERFORM set_config('licence.action', '', true);
  PERFORM set_config('licence.reason', '', true);

  RETURN jsonb_build_object('payment_id', v_pay_id, 'period_from', v_from, 'period_to', v_to,
                            'expires_on', CASE WHEN p_kind = 'renewal' THEN v_to END,
                            'next_fee_due_on', CASE WHEN p_kind = 'annual' THEN v_to + 1 END);
END;
$$;

-- ── RPC ยกเลิกรายการรับเงินที่บันทึกผิด (เฉพาะรายการล่าสุดของใบ) ──────────────────────
CREATE OR REPLACE FUNCTION public.licence_void_fee(p_payment_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pay    public.licence_fee_payments%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pay FROM public.licence_fee_payments WHERE id = p_payment_id;
  IF NOT FOUND OR NOT public.licence_is_manager(v_pay.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบรายการ หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  -- ล็อกใบก่อน แล้วอ่านรายการซ้ำ (กันยกเลิกพร้อมกันสองคน)
  PERFORM 1 FROM public.licences WHERE id = v_pay.licence_id FOR UPDATE;
  SELECT * INTO v_pay FROM public.licence_fee_payments WHERE id = p_payment_id;
  IF v_pay.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'รายการนี้ถูกยกเลิกไปแล้ว' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผล (3–1000 ตัวอักษร)' USING ERRCODE = '22023';
  END IF;
  -- "ล่าสุด" = วันในใบตอนนี้คือผลของรายการนี้ (ไม่พึ่งเวลาอย่างเดียว) + ไม่มีรายการที่ใหม่กว่า
  IF EXISTS (SELECT 1 FROM public.licence_fee_payments
              WHERE licence_id = v_pay.licence_id AND voided_at IS NULL
                AND (created_at, id) > (v_pay.created_at, v_pay.id))
     OR NOT EXISTS (SELECT 1 FROM public.licences AS l WHERE l.id = v_pay.licence_id
                     AND ((v_pay.kind = 'renewal' AND l.expires_on = v_pay.period_to)
                          OR (v_pay.kind = 'annual' AND l.next_fee_due_on = v_pay.period_to + 1))) THEN
    RAISE EXCEPTION 'ยกเลิกได้เฉพาะรายการล่าสุดของใบ — ยกเลิกรายการที่ใหม่กว่าก่อน' USING ERRCODE = '22023';
  END IF;

  UPDATE public.licence_fee_payments
     SET voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   WHERE id = v_pay.id;

  PERFORM set_config('licence.fee_rpc', 'on', true);
  PERFORM set_config('licence.action', 'void', true);
  PERFORM set_config('licence.reason', 'ยกเลิกใบเสร็จ ' || v_pay.receipt_no || ': ' || v_reason, true);
  IF v_pay.kind = 'renewal' THEN
    UPDATE public.licences SET expires_on = v_pay.prev_expires_on WHERE id = v_pay.licence_id;
  ELSE
    UPDATE public.licences SET next_fee_due_on = v_pay.prev_fee_due_on WHERE id = v_pay.licence_id;
  END IF;
  PERFORM set_config('licence.fee_rpc', '', true);
  PERFORM set_config('licence.action', '', true);
  PERFORM set_config('licence.reason', '', true);

  -- ประวัติของรายการรับเงิน (ตารางนี้ไม่มี trigger ลงประวัติ — เขียนตรงที่นี่)
  INSERT INTO public.licence_events (municipality_id, entity, entity_id, licence_id, action, changes, reason, actor)
  VALUES (v_pay.municipality_id, 'payment', v_pay.id, v_pay.licence_id, 'void',
          jsonb_build_object('receipt_no', v_pay.receipt_no, 'amount', v_pay.amount, 'kind', v_pay.kind),
          v_reason, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.licence_set_status(uuid, text, text, text, date, date),
  public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean),
  public.licence_void_fee(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.licence_set_status(uuid, text, text, text, date, date),
  public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean),
  public.licence_void_fee(uuid, text) TO authenticated;

-- ── policy ───────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "licence_settings_select" ON public.licence_settings;
DROP POLICY IF EXISTS "licence_settings_insert" ON public.licence_settings;
DROP POLICY IF EXISTS "licence_settings_update" ON public.licence_settings;
CREATE POLICY "licence_settings_select" ON public.licence_settings FOR SELECT TO authenticated
  USING ((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_managed_municipality_id()));
CREATE POLICY "licence_settings_insert" ON public.licence_settings FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_admin_municipality_id()));
CREATE POLICY "licence_settings_update" ON public.licence_settings FOR UPDATE TO authenticated
  USING ((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_admin_municipality_id()))
  WITH CHECK ((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_admin_municipality_id()));

DO $policies$
DECLARE
  t text;
  m text := '((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_managed_municipality_id()))';
BEGIN
  FOREACH t IN ARRAY ARRAY['licence_types', 'licences'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING %s', t || '_select', t, m);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK %s', t || '_insert', t, m);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING %s WITH CHECK %s', t || '_update', t, m, m);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING %s', t || '_delete', t, m);
  END LOOP;
END $policies$;

DROP POLICY IF EXISTS "licence_fee_payments_select" ON public.licence_fee_payments;
CREATE POLICY "licence_fee_payments_select" ON public.licence_fee_payments FOR SELECT TO authenticated
  USING ((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_managed_municipality_id()));
DROP POLICY IF EXISTS "licence_events_select" ON public.licence_events;
CREATE POLICY "licence_events_select" ON public.licence_events FOR SELECT TO authenticated
  USING ((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.licence_managed_municipality_id()));

-- ── สิทธิ์ตาราง ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.licence_settings TO authenticated;
REVOKE DELETE ON public.licence_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.licence_types, public.licences TO authenticated;
GRANT SELECT ON public.licence_fee_payments, public.licence_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.licence_fee_payments, public.licence_events FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.licence_settings, public.licence_types, public.licences,
  public.licence_fee_payments, public.licence_events FROM authenticated;
REVOKE ALL ON public.licence_settings, public.licence_types, public.licences,
  public.licence_fee_payments, public.licence_events FROM anon;
REVOKE ALL ON SEQUENCE public.licence_events_id_seq FROM PUBLIC, anon, authenticated;

-- ── ด่านตรวจท้ายไฟล์ ──────────────────────────────────────────────────────────────
DO $check$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['licence_settings', 'licence_types', 'licences', 'licence_fee_payments', 'licence_events'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'RLS ของ % ไม่ได้เปิด', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE') OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์บน %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'authenticated ยังมี TRUNCATE บน %', t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.licence_fee_payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.licence_fee_payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.licence_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.licence_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.licence_events', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated ยังเขียนตารางรับเงิน/ประวัติตรงได้';
  END IF;
  IF has_function_privilege('anon', 'public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.licence_set_status(uuid, text, text, text, date, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.licence_void_fee(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.licence_owner_department_id(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.licence_log_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'สิทธิ์ EXECUTE ของฟังก์ชันใบอนุญาตหลุด';
  END IF;
END $check$;

COMMIT;
