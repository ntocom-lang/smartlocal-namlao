-- 20261222100300_waste_fee_sorting_confirmers.sql
-- ขั้น 1B ทะเบียนค่าธรรมเนียมขยะ PR1 ไฟล์ 4/4 — ผู้ยืนยันการคัดแยกตั้งค่าราย อปท. + ประวัติไม่เก็บหมู่
--   เจ้าของระบบสั่ง 2569-11-20 (หลังไฟล์ 1–2 ขึ้นฐานจริงแล้ว):
--     (1) ผู้ยืนยันคัดแยก = waste_fee_settings.sorting_confirmer_roles · ค่าเริ่มต้น admin + officer ของกองที่ถือเรื่อง
--         + ช่องอ้างอิงคำสั่งมอบหมาย (ไม่บังคับ) ลงประวัติทุกครั้งที่ยืนยัน/เลิก
--         ⚠️ ต้องยืนยันอำนาจกับกฎกระทรวง/ข้อบัญญัติก่อน PR2 ออกยอดจริง
--     (2) ประวัติเก็บชื่อผู้ชำระ ไม่เก็บหมู่/ที่อยู่ (แนวเดียวกับประวัติทะเบียนใบอนุญาต) ⇒ มาสก์ village เพิ่ม
--         ตรวจฐานจริงก่อนเขียนไฟล์นี้: ยังไม่มีบัญชีเลย (0 แถว) และประวัติไม่มีค่า village ⇒ ไม่มีข้อมูลเก่าต้องล้าง
--
--   ฟังก์ชันใหม่ (CREATE FUNCTION): wfee_is_admin · wfee_admin_municipality_id · wfee_can_confirm_sorting · waste_fee_settings_guard
--   แก้ฟังก์ชันของงานนี้เอง 2 ตัว (CREATE OR REPLACE ⇒ เขียนทับทั้งฟังก์ชัน — คัดลอกนิยามเต็มจากไฟล์ 2 แก้เฉพาะจุดที่ระบุ):
--     wfee_log_event   + มาสก์ village · + entity 'settings' (entity_id = municipality_id)
--     wfee_set_sorting สิทธิ์ wfee_is_manager → wfee_can_confirm_sorting · + delegation_ref ในประวัติ
--   ด่าน md5: นิยามบนฐานต้องเป็นของไฟล์ 2 (ตรวจ 2569-11-20 md5(prosrc) ตามด่านข้างล่าง) — ถ้ามีคนแก้ไปก่อน ล้มทั้งไฟล์ ไม่ทับ
--   สิทธิ์ EXECUTE เดิมของ 2 ตัวนั้นคงเดิม (CREATE OR REPLACE ไม่ล้าง GRANT)
--
-- ย้อนกลับ: 0) DROP TRIGGER waste_fee_settings_log_trigger ON public.waste_fee_settings;  (ต้องทำก่อน — ตัวลงประวัติรุ่นไฟล์ 2
--              ไม่รู้จัก settings จะใส่ entity_id = NULL แล้วการเขียนค่าตั้งล้มทุกครั้ง)
--           1) รันส่วน CREATE … wfee_log_event / wfee_set_sorting ของไฟล์ 20261222100100 ซ้ำ (เปลี่ยน CREATE เป็น CREATE OR REPLACE)
--           2) DROP FUNCTION public.wfee_can_confirm_sorting(uuid), public.wfee_admin_municipality_id(), public.wfee_is_admin(uuid),
--              public.waste_fee_settings_guard() CASCADE;  3) ย้อนไฟล์ 3 · 4) ลบแถว 20261222100300 ใน schema_migrations
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.waste_fee_settings') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261222100200_waste_fee_settings_table.sql ก่อน';
  END IF;
  -- ตัด \r ก่อนเทียบ: ไฟล์ที่ checkout บน Windows เป็น CRLF (ฐานจริงรันจาก CRLF ⇒ prosrc มี \r — ตรวจ 2569-11-20)
  -- ค่าด้านล่าง = md5 หลังตัด \r ⇒ ด่านผ่านทั้งไฟล์ LF/CRLF และล้มเมื่อเนื้อฟังก์ชันเปลี่ยนจริงเท่านั้น
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.wfee_set_sorting(uuid,boolean,date,text)')), chr(13), ''))
       IS DISTINCT FROM '10a2c5adf39fbc5bb563e979ba64978c'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.wfee_log_event()')), chr(13), ''))
       IS DISTINCT FROM 'c1c02c18a4b5d11038fd956a25391144' THEN
    RAISE EXCEPTION 'wfee_set_sorting / wfee_log_event บนฐานไม่ใช่ฉบับของ 20261222100100 — มีคนแก้ไปก่อน หยุดไม่ทับ (ตรวจ npm run work:active)';
  END IF;
END $guard$;

-- ── สิทธิ์ ────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.wfee_is_admin(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    public.get_my_role() = 'superadmin'
    OR (p_municipality_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND public.get_my_role() = 'admin'),
    false);
$$;

-- ตัวช่วยของ policy ค่าตั้ง (ไม่รับค่าจากแถว ⇒ initPlan)
CREATE FUNCTION public.wfee_admin_municipality_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.wfee_is_admin(public.get_my_municipality_id()) THEN public.get_my_municipality_id() END;
$$;

-- ใครยืนยัน/เลิกการลดค่ากำจัดได้: superadmin เสมอ · บทบาทใน sorting_confirmer_roles (ไม่มีแถว = admin + officer)
--   admin ของ อปท. นั้น · officer/staff ต้องสังกัดกองเจ้าของงานขยะ (waste_owner_department_id)
CREATE FUNCTION public.wfee_can_confirm_sorting(p_municipality_id uuid)
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
        AND public.get_my_role() = ANY (coalesce(
              (SELECT s.sorting_confirmer_roles FROM public.waste_fee_settings AS s WHERE s.municipality_id = p_municipality_id),
              ARRAY['admin', 'officer']::text[]))
        AND (public.get_my_role() = 'admin'
             OR (public.get_my_department_id() IS NOT NULL
                 AND public.get_my_department_id() = public.waste_owner_department_id(p_municipality_id)))),
    false);
$$;

REVOKE ALL ON FUNCTION public.wfee_is_admin(uuid), public.wfee_admin_municipality_id(), public.wfee_can_confirm_sorting(uuid)
  FROM PUBLIC, anon;
-- หน้าเจ้าหน้าที่เรียกเพื่อซ่อน/แสดงปุ่ม (ตัวบังคับจริงคือ policy และ wfee_set_sorting)
GRANT EXECUTE ON FUNCTION public.wfee_is_admin(uuid), public.wfee_admin_municipality_id(), public.wfee_can_confirm_sorting(uuid)
  TO authenticated;

-- ── ค่าตั้ง ───────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.waste_fee_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
    RAISE EXCEPTION 'เปลี่ยน อปท. ของค่าตั้งไม่ได้' USING ERRCODE = '42501';
  END IF;
  -- ตัดค่าซ้ำ + เรียงตามลำดับบทบาท ⇒ ประวัติไม่ขึ้นว่า "เปลี่ยน" เมื่อแค่สลับลำดับ
  NEW.sorting_confirmer_roles := ARRAY(SELECT r FROM unnest(NEW.sorting_confirmer_roles) AS r GROUP BY r
                                       ORDER BY array_position(ARRAY['admin', 'officer', 'staff'], r));
  NEW.sorting_delegation_ref := nullif(btrim(coalesce(NEW.sorting_delegation_ref, '')), '');
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.waste_fee_settings_guard() FROM PUBLIC, anon, authenticated;

-- ── ประวัติ (คัดลอกจากไฟล์ 2 — แก้: + village ในช่องมาสก์ · + entity settings) ───────────────
CREATE OR REPLACE FUNCTION public.wfee_log_event()
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
  -- เก็บแค่ชื่อผู้ชำระ เพื่อย้อนตรวจได้ว่าบัญชีเปลี่ยนมือเมื่อไร · หมู่/ที่อยู่ไม่เก็บ (เจ้าของระบบสั่ง 2569-11-20 แนวเดียวกับใบอนุญาต)
  v_masked  text[] := ARRAY['payer_phone', 'address', 'house_no', 'village'];
  v_entity  text := CASE TG_TABLE_NAME WHEN 'waste_fee_rates' THEN 'rate' WHEN 'waste_fee_settings' THEN 'settings' ELSE 'account' END;
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
  VALUES ((v_row ->> 'municipality_id')::uuid, v_entity,
          -- ค่าตั้งไม่มีคอลัมน์ id (1 แถว/อปท.) ⇒ ใช้รหัส อปท. เป็นตัวอ้างอิง
          CASE WHEN v_entity = 'settings' THEN (v_row ->> 'municipality_id')::uuid ELSE (v_row ->> 'id')::uuid END,
          lower(TG_OP), v_changes, auth.uid());
  RETURN NULL;
END;
$$;

-- ── RPC ยืนยันการคัดแยก (คัดลอกจากไฟล์ 2 — แก้: สิทธิ์ wfee_can_confirm_sorting · + delegation_ref ในประวัติ) ──
CREATE OR REPLACE FUNCTION public.wfee_set_sorting(p_account_id uuid, p_on boolean, p_from date, p_note text)
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
  v_ref    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_acc FROM public.waste_fee_accounts WHERE id = p_account_id FOR UPDATE;
  -- ผู้ยืนยันตามค่าตั้งของ อปท. (ค่าเริ่มต้น admin + officer ของกองที่ถือเรื่อง) — ผู้จัดการทะเบียนคนอื่นดูได้แต่ยืนยันไม่ได้
  IF NOT FOUND OR NOT public.wfee_can_confirm_sorting(v_acc.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบบัญชี หรือไม่มีสิทธิ์ยืนยันการคัดแยก' USING ERRCODE = '42501';
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

  -- คำสั่งมอบหมายผู้รับรองที่ใช้อยู่ ณ ตอนยืนยัน (ไม่บังคับ) — เก็บคู่กับการยืนยันแต่ละครั้ง เผื่อค่าตั้งเปลี่ยนภายหลัง
  SELECT s.sorting_delegation_ref INTO v_ref FROM public.waste_fee_settings AS s WHERE s.municipality_id = v_acc.municipality_id;

  INSERT INTO public.waste_fee_events (municipality_id, entity, entity_id, action, changes, reason, actor)
  VALUES (v_acc.municipality_id, 'account', v_acc.id, 'sorting',
          jsonb_strip_nulls(jsonb_build_object('op', v_op, 'starts_on', v_start, 'ends_on', v_end, 'delegation_ref', v_ref)),
          v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'op', v_op, 'starts_on', v_start, 'ends_on', v_end,
                            'rate_has_discount', v_disc);
END;
$$;

-- ── trigger ค่าตั้ง ─────────────────────────────────────────────────────────────────
CREATE TRIGGER waste_fee_settings_guard_trigger BEFORE INSERT OR UPDATE ON public.waste_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.waste_fee_settings_guard();
CREATE TRIGGER waste_fee_settings_log_trigger AFTER INSERT OR UPDATE OR DELETE ON public.waste_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.wfee_log_event();

-- ── policy + สิทธิ์ตาราง: ผู้จัดการทะเบียนอ่าน (หน้าจอบอกได้ว่าใครยืนยันได้) · admin/superadmin ตั้งค่า · ลบไม่ได้ ──
CREATE POLICY "waste_fee_settings_select" ON public.waste_fee_settings FOR SELECT TO authenticated
  USING ((SELECT public.wfee_is_superadmin()) OR municipality_id = (SELECT public.wfee_managed_municipality_id()));
CREATE POLICY "waste_fee_settings_insert" ON public.waste_fee_settings FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.wfee_is_superadmin()) OR municipality_id = (SELECT public.wfee_admin_municipality_id()));
CREATE POLICY "waste_fee_settings_update" ON public.waste_fee_settings FOR UPDATE TO authenticated
  USING ((SELECT public.wfee_is_superadmin()) OR municipality_id = (SELECT public.wfee_admin_municipality_id()))
  WITH CHECK ((SELECT public.wfee_is_superadmin()) OR municipality_id = (SELECT public.wfee_admin_municipality_id()));
GRANT SELECT, INSERT, UPDATE ON public.waste_fee_settings TO authenticated;

-- ── ด่านตรวจท้ายไฟล์ ──────────────────────────────────────────────────────────────
DO $check$
DECLARE
  f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.waste_fee_settings'::regclass) THEN
    RAISE EXCEPTION 'RLS ของ waste_fee_settings ไม่ได้เปิด';
  END IF;
  IF has_table_privilege('anon', 'public.waste_fee_settings', 'SELECT') OR has_table_privilege('anon', 'public.waste_fee_settings', 'INSERT')
     OR has_table_privilege('anon', 'public.waste_fee_settings', 'UPDATE') OR has_table_privilege('anon', 'public.waste_fee_settings', 'DELETE')
     OR has_table_privilege('authenticated', 'public.waste_fee_settings', 'DELETE')
     OR has_table_privilege('authenticated', 'public.waste_fee_settings', 'TRUNCATE') THEN
    RAISE EXCEPTION 'สิทธิ์ตาราง waste_fee_settings เกินที่ตั้งใจ';
  END IF;
  FOREACH f IN ARRAY ARRAY['public.wfee_can_confirm_sorting(uuid)', 'public.wfee_is_admin(uuid)', 'public.wfee_admin_municipality_id()',
                           'public.wfee_set_sorting(uuid, boolean, date, text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'สิทธิ์ EXECUTE ของ % ไม่ถูกต้อง', f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.waste_fee_settings_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wfee_log_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ฟังก์ชัน trigger ถูกเปิดให้เรียกตรง';
  END IF;
END $check$;

COMMIT;
