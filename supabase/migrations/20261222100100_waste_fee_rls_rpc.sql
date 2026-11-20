-- 20261222100100_waste_fee_rls_rpc.sql
-- ขั้น 1B ทะเบียนลูกหนี้ค่าขยะ PR1 ไฟล์ 2/2 — สิทธิ์ · trigger · ประวัติ · RPC ยืนยันการคัดแยก · ตัวคำนวณยอด · เปิดโมดูลให้ demo
--   ต้องรัน 20261222100000_waste_fee_tables.sql ก่อน · ไม่แตะ profiles / payment_* / licence_* / ฟังก์ชันเดิมใดๆ
--   ฟังก์ชันใหม่ทุกตัวใช้ CREATE FUNCTION (ไม่ใช่ OR REPLACE) ⇒ ชื่อชนของเดิมเมื่อไร ล้มทั้งไฟล์ ไม่ทับเงียบ (ผลตรวจรอบ 1 ข้อ B2)
--   ใช้ waste_owner_department_id() ของโมดูลตารางเก็บขยะแบบเรียกอ่านอย่างเดียว
--
-- 1) สิทธิ์
--      ผู้จัดการทะเบียน = superadmin · admin ของ อปท. · officer/staff ที่สังกัดกองเจ้าของงานขยะ (waste_owner_department_id —
--        กองสาธารณสุขที่มีคนอยู่ ไม่งั้นสำนักปลัด ชุดเดียวกับตารางเก็บขยะ)
--      อ่าน/เขียน = ผู้จัดการทะเบียนเท่านั้น (ชื่อ เบอร์ บ้านเลขที่ของประชาชน — PDPA)
--      ช่วงส่วนลดคัดแยก: ผู้จัดการอ่านได้ เขียนได้ทาง wfee_set_sorting() เท่านั้น
--      ประชาชน / anon / council / technician / viewer: ไม่มีสิทธิ์ตารางใดๆ (ประชาชนเห็นยอดของตัวเอง = PR2)
-- 2) ระบบไม่ตัดสินแทนคน · ไม่ย้อนหลัง (เจ้าของระบบสั่ง 2569-11-20)
--      เปิดลด: เริ่มได้ตั้งแต่เดือนปัจจุบัน · เลิกลด: เดือนแรกที่ไม่ลดต้องเป็นเดือนถัดไปขึ้นไป (เดือนนี้ยังได้ลด)
--      ช่วงที่เริ่มแล้วไม่ถูกลบ/เลื่อนวันเริ่ม — ยืนยันซ้ำขณะลดอยู่ = ปฏิเสธ (ผลตรวจรอบ 1 ข้อ A1)
--      ระบบไม่สร้างยอด ไม่ยกเว้นหนี้ — PR1 คำนวณ "ยอดที่ควรเก็บ" ให้ดูเท่านั้น (wfee_account_month)
-- 3) ระบบทำเอง: ปัดวันเริ่ม/วันเลิกเก็บเป็นวันที่ 1 ของเดือน · ปัดปริมาณขึ้นเป็นกึ่งหน่วยตามข้อ ๑๐
--    · แก้ตัวเลขในแถวตัวอย่างแล้วป้าย "ตัวอย่าง" หลุดเอง
-- 4) ประวัติ waste_fee_events: trigger เขียนทุกการเพิ่ม/แก้/ลบ (ค่าเดิม → ค่าใหม่ เฉพาะช่องที่เปลี่ยน
--    · เบอร์/ที่อยู่/บ้านเลขที่บอกแค่ "changed") · การเปิด/เลิกลดลงประวัติจาก RPC พร้อมเหตุผล
--
-- ย้อนกลับ: 1) UPDATE municipalities SET enabled_modules = array_remove(enabled_modules, 'waste-fee') WHERE slug = 'demo';
--           2) DROP FUNCTION public.wfee_set_sorting(uuid, boolean, date, text), public.wfee_account_month(uuid, date),
--              public.wfee_compute(uuid, numeric, text, boolean), public.wfee_log_event(), public.waste_fee_accounts_guard(),
--              public.waste_fee_rates_guard(), public.wfee_stamp(), public.wfee_managed_municipality_id(),
--              public.wfee_is_superadmin(), public.wfee_is_manager(uuid), public.wfee_month_start(date), public.wfee_today() CASCADE;
--              (trigger/policy หายตาม — ฟังก์ชันสิทธิ์ภาษา SQL ไม่บันทึกการพึ่งพา จึงต้องระบุเองครบทุกตัว)
--           3) ลบแถว 20261222100100 ใน supabase_migrations.schema_migrations แล้วย้อนไฟล์ 1
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.waste_fee_rates') IS NULL OR to_regclass('public.waste_fee_accounts') IS NULL
     OR to_regclass('public.waste_fee_sorting_periods') IS NULL OR to_regclass('public.waste_fee_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261222100000_waste_fee_tables.sql ก่อน (ไม่พบตารางใหม่ครบ 4 ตาราง)';
  END IF;
  IF to_regprocedure('public.get_my_role()') IS NULL OR to_regprocedure('public.get_my_municipality_id()') IS NULL
     OR to_regprocedure('public.get_my_department_id()') IS NULL
     OR to_regprocedure('public.waste_owner_department_id(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์พื้นฐาน (get_my_* / waste_owner_department_id)';
  END IF;
END $guard$;

-- ── วันที่ตามเวลาไทย ───────────────────────────────────────────────────────────────
CREATE FUNCTION public.wfee_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date; $$;

-- แปลงเป็น timestamp (ไม่มีเขตเวลา) ก่อน date_trunc ⇒ ไม่ขึ้นกับ TimeZone ของ session = IMMUTABLE จริง (ผลตรวจ B7)
CREATE FUNCTION public.wfee_month_start(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$ SELECT date_trunc('month', p_date::timestamp)::date; $$;

REVOKE ALL ON FUNCTION public.wfee_today(), public.wfee_month_start(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wfee_today(), public.wfee_month_start(date) TO authenticated;

-- ── สิทธิ์ ────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.wfee_is_manager(p_municipality_id uuid)
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
        AND (public.get_my_role() = 'admin'
             OR (public.get_my_role() IN ('officer', 'staff')
                 AND public.get_my_department_id() IS NOT NULL
                 AND public.get_my_department_id() = public.waste_owner_department_id(p_municipality_id)))),
    false);
$$;

-- ตัวช่วยของ policy: ไม่รับค่าจากแถว ⇒ ห่อด้วย (SELECT …) แล้ว planner คำนวณครั้งเดียวต่อคำสั่ง (initPlan)
CREATE FUNCTION public.wfee_is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT coalesce(public.get_my_role() = 'superadmin', false); $$;

-- อปท. ที่ผู้ใช้เป็นผู้จัดการทะเบียนอยู่ (ไม่ใช่ = NULL ⇒ เทียบกับแถวไหนก็ไม่เท่า)
CREATE FUNCTION public.wfee_managed_municipality_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.wfee_is_manager(public.get_my_municipality_id()) THEN public.get_my_municipality_id() END;
$$;

REVOKE ALL ON FUNCTION public.wfee_is_manager(uuid), public.wfee_is_superadmin(), public.wfee_managed_municipality_id()
  FROM PUBLIC, anon;
-- หน้าเจ้าหน้าที่เรียกเพื่อสลับโหมด (ตัวบังคับจริงคือ policy ข้างล่าง)
GRANT EXECUTE ON FUNCTION public.wfee_is_manager(uuid), public.wfee_is_superadmin(), public.wfee_managed_municipality_id()
  TO authenticated;

-- ── ประทับผู้แก้/เวลา ──────────────────────────────────────────────────────────────
CREATE FUNCTION public.wfee_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.wfee_stamp() FROM PUBLIC, anon, authenticated;

-- ── อัตรา ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.waste_fee_rates_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key   text;
  v_val   jsonb;
BEGIN
  NEW.ordinance_ref := btrim(NEW.ordinance_ref);

  IF NEW.basis = 'place_type' AND NEW.place_type_rates IS NOT NULL THEN
    IF jsonb_typeof(NEW.place_type_rates) <> 'object' OR NEW.place_type_rates = '{}'::jsonb THEN
      RAISE EXCEPTION 'ต้องมีอัตราอย่างน้อย 1 ประเภทสถานที่' USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each(NEW.place_type_rates) LOOP
      IF v_key NOT IN ('house', 'shop', 'business', 'agency', 'other') THEN
        RAISE EXCEPTION 'ประเภทสถานที่ไม่ถูกต้อง: %', v_key USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::numeric < 0 OR (v_val #>> '{}')::numeric > 100000 THEN
        RAISE EXCEPTION 'อัตราของประเภท % ต้องเป็นตัวเลข 0–100,000 บาท', v_key USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'เปลี่ยนรหัส / อปท. ของอัตราไม่ได้' USING ERRCODE = '42501';
    END IF;
    -- แก้ตัวเลข/วันมีผลของแถวตัวอย่างแล้ว = ข้อมูลของ อปท. เอง ป้ายตัวอย่างหลุดให้เอง
    IF OLD.is_example AND NEW.is_example AND (
         NEW.effective_from, NEW.basis, NEW.base_collect, NEW.base_dispose, NEW.unit_collect, NEW.unit_dispose,
         NEW.big_unit_collect, NEW.big_unit_dispose, NEW.place_type_rates, NEW.sorting_discount, NEW.ordinance_ref)
       IS DISTINCT FROM (
         OLD.effective_from, OLD.basis, OLD.base_collect, OLD.base_dispose, OLD.unit_collect, OLD.unit_dispose,
         OLD.big_unit_collect, OLD.big_unit_dispose, OLD.place_type_rates, OLD.sorting_discount, OLD.ordinance_ref) THEN
      NEW.is_example := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.waste_fee_rates_guard() FROM PUBLIC, anon, authenticated;

-- ── บัญชีผู้ชำระ ──────────────────────────────────────────────────────────────────
CREATE FUNCTION public.waste_fee_accounts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.payer_name := btrim(NEW.payer_name);
  NEW.account_no := nullif(btrim(coalesce(NEW.account_no, '')), '');
  NEW.house_no := nullif(btrim(coalesce(NEW.house_no, '')), '');
  NEW.village := nullif(btrim(coalesce(NEW.village, '')), '');
  -- ค่าธรรมเนียมเป็นรายเดือน ⇒ วันเริ่ม/วันเลิกเก็บ = วันที่ 1 ของเดือนเสมอ
  NEW.service_from := public.wfee_month_start(NEW.service_from);
  NEW.closed_from := public.wfee_month_start(NEW.closed_from);
  -- ข้อ ๑๐: เศษไม่เกินกึ่งหน่วย = กึ่งหน่วย · เกินกึ่ง = หนึ่งหน่วย ⇒ ปัดขึ้นเป็นทวีคูณของ 0.5
  IF NEW.monthly_units IS NOT NULL THEN
    -- round(…, 1): ไม่ให้ scale 16 หลัก (1.5000000000000000) ไปโผล่ในประวัติ/JSON/ไฟล์ส่งออก (ผลตรวจรอบ 2 ข้อ C3)
    NEW.monthly_units := round(ceil(NEW.monthly_units * 2) / 2, 1);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'เปลี่ยนรหัสบัญชี / อปท. ของบัญชีไม่ได้' USING ERRCODE = '42501';
    END IF;
    IF NEW.import_batch IS DISTINCT FROM OLD.import_batch THEN
      RAISE EXCEPTION 'เปลี่ยนชุดนำเข้าไม่ได้' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.waste_fee_accounts_guard() FROM PUBLIC, anon, authenticated;

-- ── ประวัติ ───────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.wfee_log_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new     jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row     jsonb;
  v_skip    text[] := ARRAY['id', 'municipality_id', 'created_at', 'created_by', 'updated_at', 'updated_by'];
  -- ช่องติดต่อ/ที่อยู่ส่วนบุคคล: ประวัติบอกแค่ว่า "เปลี่ยน" ไม่เก็บค่า (ตารางประวัติลบไม่ได้ — ลบบัญชี/ลบชุดนำเข้าแล้วต้องไม่ค้าง)
  -- ชื่อผู้ชำระ + หมู่ยังเก็บ เพื่อย้อนตรวจได้ว่าบัญชีเปลี่ยนมือเมื่อไร (ผลตรวจรอบ 1 ข้อ A2)
  v_masked  text[] := ARRAY['payer_phone', 'address', 'house_no'];
  v_entity  text := CASE TG_TABLE_NAME WHEN 'waste_fee_rates' THEN 'rate' ELSE 'account' END;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
BEGIN
  v_row := coalesce(v_new, v_old);
  -- อปท. ถูกลบทั้งแถว (cascade) → ไม่ลงประวัติ ไม่งั้น FK ของ waste_fee_events ทำให้ลบ อปท. ไม่ได้
  IF NOT EXISTS (SELECT 1 FROM public.municipalities WHERE id = (v_row ->> 'municipality_id')::uuid) THEN
    RETURN NULL;
  END IF;

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
  ELSE
    v_changes := jsonb_strip_nulls(v_row - v_skip - v_masked);
  END IF;

  INSERT INTO public.waste_fee_events (municipality_id, entity, entity_id, action, changes, actor)
  VALUES ((v_row ->> 'municipality_id')::uuid, v_entity, (v_row ->> 'id')::uuid, lower(TG_OP), v_changes, auth.uid());
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.wfee_log_event() FROM PUBLIC, anon, authenticated;

-- ── trigger ──────────────────────────────────────────────────────────────────────
CREATE TRIGGER waste_fee_rates_guard_trigger BEFORE INSERT OR UPDATE ON public.waste_fee_rates
  FOR EACH ROW EXECUTE FUNCTION public.waste_fee_rates_guard();
CREATE TRIGGER waste_fee_rates_stamp_trigger BEFORE INSERT OR UPDATE ON public.waste_fee_rates
  FOR EACH ROW EXECUTE FUNCTION public.wfee_stamp();
CREATE TRIGGER waste_fee_rates_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.waste_fee_rates
  FOR EACH ROW EXECUTE FUNCTION public.wfee_log_event();

CREATE TRIGGER waste_fee_accounts_guard_trigger BEFORE INSERT OR UPDATE ON public.waste_fee_accounts
  FOR EACH ROW EXECUTE FUNCTION public.waste_fee_accounts_guard();
CREATE TRIGGER waste_fee_accounts_stamp_trigger BEFORE INSERT OR UPDATE ON public.waste_fee_accounts
  FOR EACH ROW EXECUTE FUNCTION public.wfee_stamp();
CREATE TRIGGER waste_fee_accounts_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.waste_fee_accounts
  FOR EACH ROW EXECUTE FUNCTION public.wfee_log_event();

-- ── ตัวคำนวณ (อ่านอย่างเดียว · SECURITY INVOKER ⇒ RLS ของผู้เรียกบังคับเอง) ─────────────────
-- ยอดรายเดือนของอัตรา p_rate_id สำหรับปริมาณ p_units หน่วย (๑๒๐ กก.) ตามโครงกฎกระทรวง ๒๕๖๗ / เทศบัญญัติข้อ ๖–๗:
--   ≤ 1 หน่วย = อัตราเหมา (แม้ใช้แค่กึ่งหน่วย) · ส่วนเกินถึง 30 หน่วย = unit_* ต่อหน่วย · ส่วนเกิน 30 หน่วย = big_unit_*
--   คัดแยก (p_sorting) + ข้อบัญญัติรุ่นนั้นมีหมวดลด ⇒ ค่ากำจัดกึ่งหนึ่ง
-- คืน jsonb: {ok, basis, collect, dispose, discount, total, ...} หรือ {ok:false, error}
-- total = collect + dispose − discount ที่ปัดแล้ว ⇒ บวกรายการย่อยได้เท่ายอดรวมเสมอ (ผลตรวจ B5)
CREATE FUNCTION public.wfee_compute(p_rate_id uuid, p_units numeric, p_place_type text, p_sorting boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  r        public.waste_fee_rates%ROWTYPE;
  v_t2     numeric;
  v_t3     numeric;
  v_col    numeric;
  v_dis    numeric;
  v_disc   numeric := 0;
  v_amount numeric;
BEGIN
  SELECT * INTO r FROM public.waste_fee_rates WHERE id = p_rate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_not_found');
  END IF;
  IF p_units IS NULL OR p_units <= 0 OR p_units * 2 <> trunc(p_units * 2) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_units');
  END IF;

  IF r.basis = 'place_type' THEN
    IF NOT (r.place_type_rates ? coalesce(p_place_type, '')) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_rate_for_place_type', 'place_type', p_place_type);
    END IF;
    v_amount := round((r.place_type_rates ->> p_place_type)::numeric, 2);
    RETURN jsonb_build_object('ok', true, 'basis', r.basis, 'rate_id', r.id, 'effective_from', r.effective_from,
      'ordinance_ref', r.ordinance_ref, 'is_example', r.is_example, 'place_type', p_place_type,
      'sorting_applied', false, 'collect', v_amount, 'dispose', 0, 'discount', 0, 'total', v_amount);
  END IF;

  v_t2 := greatest(least(p_units, 30) - 1, 0);
  v_t3 := greatest(p_units - 30, 0);
  IF v_t2 > 0 AND r.unit_collect IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_unit_rate');
  END IF;
  IF v_t3 > 0 AND r.big_unit_collect IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_big_unit_rate');
  END IF;
  v_col := round(r.base_collect + v_t2 * coalesce(r.unit_collect, 0) + v_t3 * coalesce(r.big_unit_collect, 0), 2);
  v_dis := round(r.base_dispose + v_t2 * coalesce(r.unit_dispose, 0) + v_t3 * coalesce(r.big_unit_dispose, 0), 2);
  IF coalesce(p_sorting, false) AND r.sorting_discount THEN
    v_disc := round(v_dis / 2, 2);
  END IF;
  RETURN jsonb_build_object('ok', true, 'basis', r.basis, 'rate_id', r.id, 'effective_from', r.effective_from,
    'ordinance_ref', r.ordinance_ref, 'is_example', r.is_example, 'units', p_units,
    'tier2_units', v_t2, 'tier3_units', v_t3, 'sorting_applied', v_disc > 0,
    'collect', v_col, 'dispose', v_dis, 'discount', v_disc, 'total', v_col + v_dis - v_disc);
END;
$$;

-- ยอดที่ควรเก็บของบัญชีในเดือน p_month (PR1 ใช้แสดงผล · PR2 ใช้สร้างยอดค้างแบบ snapshot)
-- รุ่นอัตรา = effective_from ล่าสุดที่ ≤ วันที่ 1 ของเดือน (สมมติฐาน ไม่คิดตามสัดส่วนวัน)
CREATE FUNCTION public.wfee_account_month(p_account_id uuid, p_month date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  a        public.waste_fee_accounts%ROWTYPE;
  v_month  date := public.wfee_month_start(p_month);
  v_rate   uuid;
  v_sort   boolean;
  v_result jsonb;
BEGIN
  IF v_month IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_month');
  END IF;
  SELECT * INTO a FROM public.waste_fee_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_found');
  END IF;
  IF v_month < a.service_from THEN
    RETURN jsonb_build_object('ok', true, 'billable', false, 'month', v_month, 'reason', 'before_service');
  END IF;
  IF a.closed_from IS NOT NULL AND v_month >= a.closed_from THEN
    RETURN jsonb_build_object('ok', true, 'billable', false, 'month', v_month, 'reason', 'closed');
  END IF;

  SELECT id INTO v_rate FROM public.waste_fee_rates
   WHERE municipality_id = a.municipality_id AND effective_from <= v_month
   ORDER BY effective_from DESC LIMIT 1;
  IF v_rate IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_rate_for_month', 'month', v_month);
  END IF;

  v_sort := EXISTS (SELECT 1 FROM public.waste_fee_sorting_periods AS p
                     WHERE p.account_id = a.id AND p.starts_on <= v_month AND (p.ends_on IS NULL OR v_month < p.ends_on));
  v_result := public.wfee_compute(v_rate, a.monthly_units, a.place_type, v_sort);
  IF (v_result ->> 'ok')::boolean THEN
    v_result := v_result || jsonb_build_object('billable', true, 'month', v_month, 'account_id', a.id,
                                               'sorting_confirmed', v_sort);
  END IF;
  RETURN v_result;
END;
$$;

-- ── RPC ยืนยันการคัดแยก (ลดค่ากำจัดกึ่งหนึ่ง หมวด ๓) ────────────────────────────────────
-- p_on = true  : ได้ลดตั้งแต่เดือน p_from (ปัดเป็นวันที่ 1) ≥ เดือนปัจจุบัน ≤ +12 เดือน
--                กำลังลดอยู่ไม่มีกำหนดเลิก = ปฏิเสธ · มีกำหนดเลิกล่วงหน้า = ยกเลิกกำหนดเลิก · ยังไม่ถึงวันเริ่ม = เลื่อนวันเริ่ม
-- p_on = false : เดือนแรกที่ไม่ลด p_from ≥ เดือนถัดไป (เดือนนี้ยังได้ลด) · ช่วงที่ยังไม่เริ่มเลย = ลบช่วงนั้น (ไม่เคยมีผล)
-- ทั้งสองทางต้องมีเหตุผล 3–1000 ตัวอักษร · คืน rate_has_discount ให้หน้าจอเตือนเมื่อรุ่นอัตราเดือนนั้นไม่มีหมวดลด (ผลตรวจ B11)
CREATE FUNCTION public.wfee_set_sorting(p_account_id uuid, p_on boolean, p_from date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_acc    public.waste_fee_accounts%ROWTYPE;
  v_live   public.waste_fee_sorting_periods%ROWTYPE;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_from   date := public.wfee_month_start(p_from);
  v_cur    date := public.wfee_month_start(public.wfee_today());
  v_op     text;
  v_start  date;
  v_end    date;
  v_disc   boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_acc FROM public.waste_fee_accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND OR NOT public.wfee_is_manager(v_acc.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบบัญชี หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุว่าจะเปิดหรือเลิกการลด' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL OR length(v_note) < 3 OR length(v_note) > 1000 THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผล/หลักฐาน (3–1000 ตัวอักษร)' USING ERRCODE = '22023';
  END IF;
  IF v_from IS NULL OR v_from > (v_cur + interval '12 months')::date THEN
    RAISE EXCEPTION 'ต้องระบุเดือน และตั้งล่วงหน้าได้ไม่เกิน 12 เดือน' USING ERRCODE = '22023';
  END IF;

  -- ช่วงที่ยังมีผลกับเดือนนี้หรืออนาคต (มีได้ไม่เกิน 1 ช่วง)
  SELECT * INTO v_live FROM public.waste_fee_sorting_periods
   WHERE account_id = v_acc.id AND (ends_on IS NULL OR ends_on > v_cur)
   ORDER BY starts_on DESC LIMIT 1 FOR UPDATE;

  IF p_on THEN
    IF v_acc.status <> 'active' THEN
      RAISE EXCEPTION 'บัญชีที่เลิกเก็บแล้ว เปิดการลดไม่ได้' USING ERRCODE = '22023';
    END IF;
    IF v_from < v_cur THEN
      RAISE EXCEPTION 'เริ่มลดได้ตั้งแต่เดือนปัจจุบันเป็นต้นไป (ไม่ย้อนหลัง)' USING ERRCODE = '22023';
    END IF;
    IF v_live.id IS NOT NULL AND v_live.starts_on <= v_cur THEN
      IF v_live.ends_on IS NULL THEN
        RAISE EXCEPTION 'บัญชีนี้ได้รับการลดอยู่แล้ว (ตั้งแต่ %)', to_char(v_live.starts_on, 'YYYY-MM') USING ERRCODE = '22023';
      END IF;
      -- มีกำหนดเลิกล่วงหน้า → ยกเลิกกำหนดเลิก ช่วงเดิมต่อเนื่อง (ไม่เลื่อนวันเริ่มที่มีผลไปแล้ว)
      -- เดือนที่เลือกต้องไม่เลยวันเลิก ไม่งั้นเดือนระหว่างวันเลิกถึงเดือนที่เลือกจะได้ลดโดยไม่มีใครยืนยัน (ผลตรวจรอบ 2 ข้อ C1)
      IF v_from > v_live.ends_on THEN
        RAISE EXCEPTION 'ช่วงเดิมกำหนดเลิก % — เลือกเดือนไม่เกินวันเลิกเพื่อยกเลิกกำหนดเลิก หรือรอช่วงเดิมสิ้นสุดก่อนแล้วจึงเริ่มใหม่',
          to_char(v_live.ends_on, 'YYYY-MM') USING ERRCODE = '22023';
      END IF;
      UPDATE public.waste_fee_sorting_periods
         SET ends_on = NULL, ended_by = NULL, ended_at = NULL, end_note = NULL
       WHERE id = v_live.id;
      v_op := 'cancel_stop'; v_start := v_live.starts_on; v_end := NULL;
    ELSIF v_live.id IS NOT NULL THEN
      -- ตั้งล่วงหน้าไว้แต่ยังไม่ถึงวันเริ่ม → เลื่อนวันเริ่มได้
      UPDATE public.waste_fee_sorting_periods
         SET starts_on = v_from, ends_on = NULL, ended_by = NULL, ended_at = NULL, end_note = NULL,
             note = v_note, confirmed_by = auth.uid(), confirmed_at = now()
       WHERE id = v_live.id;
      v_op := 'reschedule'; v_start := v_from; v_end := NULL;
    ELSE
      INSERT INTO public.waste_fee_sorting_periods (municipality_id, account_id, starts_on, note, confirmed_by)
      VALUES (v_acc.municipality_id, v_acc.id, v_from, v_note, auth.uid());
      v_op := 'start'; v_start := v_from; v_end := NULL;
    END IF;
  ELSE
    IF v_live.id IS NULL THEN
      RAISE EXCEPTION 'บัญชีนี้ไม่ได้รับการลดอยู่' USING ERRCODE = '22023';
    END IF;
    IF v_from <= v_cur THEN
      RAISE EXCEPTION 'เลิกลดได้ตั้งแต่เดือนถัดไป (เดือนนี้ยังได้ลด — ไม่ตัดย้อนหลัง)' USING ERRCODE = '22023';
    END IF;
    IF v_live.starts_on >= v_from THEN
      -- ช่วงที่ยังไม่เคยมีผลเลย → ลบทิ้ง (ประวัติยังอยู่ใน waste_fee_events)
      DELETE FROM public.waste_fee_sorting_periods WHERE id = v_live.id;
      v_op := 'drop_unstarted'; v_start := v_live.starts_on; v_end := NULL;
    ELSE
      UPDATE public.waste_fee_sorting_periods
         SET ends_on = v_from, ended_by = auth.uid(), ended_at = now(), end_note = v_note
       WHERE id = v_live.id;
      v_op := 'stop'; v_start := v_live.starts_on; v_end := v_from;
    END IF;
  END IF;

  -- เปิดลด: ดูรุ่นอัตราของเดือนแรกที่ส่วนลดจะมีผลจริง (ไม่ก่อนเดือนนี้) · เลิกลด: ไม่มีความหมาย คืน NULL (ผลตรวจรอบ 2 ข้อ C2)
  IF v_op IN ('start', 'reschedule', 'cancel_stop') THEN
    SELECT r.sorting_discount INTO v_disc FROM public.waste_fee_rates AS r
     WHERE r.municipality_id = v_acc.municipality_id AND r.effective_from <= greatest(v_start, v_cur)
     ORDER BY r.effective_from DESC LIMIT 1;
    v_disc := coalesce(v_disc, false);
  END IF;

  INSERT INTO public.waste_fee_events (municipality_id, entity, entity_id, action, changes, reason, actor)
  VALUES (v_acc.municipality_id, 'account', v_acc.id, 'sorting',
          jsonb_build_object('op', v_op, 'starts_on', v_start, 'ends_on', v_end), v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'op', v_op, 'starts_on', v_start, 'ends_on', v_end,
                            'rate_has_discount', v_disc);
END;
$$;

REVOKE ALL ON FUNCTION public.wfee_set_sorting(uuid, boolean, date, text), public.wfee_compute(uuid, numeric, text, boolean),
  public.wfee_account_month(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wfee_set_sorting(uuid, boolean, date, text), public.wfee_compute(uuid, numeric, text, boolean),
  public.wfee_account_month(uuid, date) TO authenticated;

-- ── policy ───────────────────────────────────────────────────────────────────────
DO $policies$
DECLARE
  t text;
  m text := '((SELECT public.wfee_is_superadmin()) OR municipality_id = (SELECT public.wfee_managed_municipality_id()))';
BEGIN
  FOREACH t IN ARRAY ARRAY['waste_fee_rates', 'waste_fee_accounts'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING %s', t || '_select', t, m);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK %s', t || '_insert', t, m);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING %s WITH CHECK %s', t || '_update', t, m, m);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING %s', t || '_delete', t, m);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['waste_fee_sorting_periods', 'waste_fee_events'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING %s', t || '_select', t, m);
  END LOOP;
END $policies$;

-- ── สิทธิ์ตาราง ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.waste_fee_rates, public.waste_fee_accounts TO authenticated;
GRANT SELECT ON public.waste_fee_sorting_periods, public.waste_fee_events TO authenticated;

-- ── เปิดโมดูลให้สนามซ้อม demo เท่านั้น + อัตราตัวอย่าง (อปท. อื่นแอดมินเปิดเอง · ค่าเริ่มต้นปิด · ไม่มีอัตราเริ่มต้น) ──
-- array_position แทน NOT (x = ANY …): อาร์เรย์ที่มี NULL ปนทำให้ ANY คืน NULL แล้ว UPDATE ข้ามเงียบ (ผลตรวจ B1)
UPDATE public.municipalities
   SET enabled_modules = array_append(enabled_modules, 'waste-fee')
 WHERE slug = 'demo' AND enabled_modules IS NOT NULL AND array_position(enabled_modules::text[], 'waste-fee') IS NULL;

-- โครงตามเทศบัญญัติ อปท. ที่ประกาศแล้ว (ขั้นแรก) — is_example ⇒ หน้าจอเตือนให้แก้ตามข้อบัญญัติของตัวเอง
-- มีผล 1 ธ.ค. 2569: กฎกระทรวงมีผล 17 พ.ย. แต่รุ่นอัตราเลือกตามวันที่ 1 ของเดือน (ผลตรวจ B6)
INSERT INTO public.waste_fee_rates (municipality_id, effective_from, ordinance_ref, basis,
  base_collect, base_dispose, unit_collect, unit_dispose, big_unit_collect, big_unit_dispose,
  sorting_discount, is_example, note)
SELECT id, DATE '2026-12-01', 'ตัวอย่าง — แก้เป็นข้อบัญญัติ/เทศบัญญัติของ อปท. (ข้อ ค่าเก็บขน + ค่ากำจัด รายเดือน)', 'units',
       30, 20, 51, 52, 66, 62, true, true,
       'แถวตัวอย่างของสนามซ้อม: ตัวเลขยกมาจากโครงเทศบัญญัติที่ประกาศใช้แล้วแห่งหนึ่ง ไม่ใช่อัตราของ อปท. นี้'
  FROM public.municipalities
 WHERE slug = 'demo'
ON CONFLICT (municipality_id, effective_from) DO NOTHING;

-- ── ด่านตรวจท้ายไฟล์ ──────────────────────────────────────────────────────────────
DO $check$
DECLARE
  t text;
  f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['waste_fee_rates', 'waste_fee_accounts', 'waste_fee_sorting_periods', 'waste_fee_events'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'RLS ของ % ไม่ได้เปิด', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE') OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์บน %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'REFERENCES')
       OR has_table_privilege('authenticated', 'public.' || t, 'TRIGGER') THEN
      RAISE EXCEPTION 'authenticated ยังมี TRUNCATE/REFERENCES/TRIGGER บน %', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['waste_fee_sorting_periods', 'waste_fee_events'] LOOP
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'authenticated ยังเขียน % ตรงได้ (ต้องผ่าน RPC/trigger เท่านั้น)', t;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.wfee_set_sorting(uuid, boolean, date, text)', 'public.wfee_account_month(uuid, date)',
                           'public.wfee_compute(uuid, numeric, text, boolean)', 'public.wfee_is_manager(uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon เรียก % ได้', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.wfee_log_event()', 'public.waste_fee_accounts_guard()', 'public.waste_fee_rates_guard()',
                           'public.wfee_stamp()'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'ฟังก์ชัน trigger % ถูกเปิดให้เรียกตรง', f;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.municipalities WHERE slug = 'demo' AND enabled_modules IS NOT NULL
               AND array_position(enabled_modules::text[], 'waste-fee') IS NULL) THEN
    RAISE EXCEPTION 'เปิดโมดูล waste-fee ให้ demo ไม่สำเร็จ';
  END IF;
END $check$;

COMMIT;
