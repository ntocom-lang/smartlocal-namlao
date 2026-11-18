-- 20261211100100_payment_dues_rls_rpc.sql
-- ขั้น 1C (E4) ยอดค้าง–ชำระ PR1 ไฟล์ 2/2 — สิทธิ์ · RPC · trigger เชื่อมกับรายการรับเงินของใบอนุญาต · เปิดโมดูลให้ demo
--
-- ใครทำอะไรได้
--   แอดมิน อปท. (licence_is_admin)  ตั้งค่ารับเงิน (ช่องทาง · บัญชีปลายทาง · บริการไหนรับช่องไหน · ตัวเลือกกองคลัง)
--   ผู้จัดการทะเบียนใบอนุญาต (licence_is_manager = admin + กองที่ถือเรื่อง)
--                                  เห็นยอดค้าง · กดปรับยอด (ระบบสร้าง/ปิดตามกฎ) · บันทึกเลขใบเสร็จ · ยกเลิกยอดพร้อมเหตุผล
--   กองคลัง (ตัวเลือก finance_can_record ค่าเริ่มต้นปิด) เห็นยอดค้าง + บันทึกเลขใบเสร็จได้ (ไม่เห็นที่อยู่ผู้ประกอบการ ยกเลิกยอดไม่ได้)
--   อื่นๆ (viewer/ช่าง/ประชาชน/anon) ไม่เห็นอะไรเลย
--
-- ระบบทำเอง (ตามกฎ อธิบายได้ ตรวจย้อนได้ทุกครั้งใน payment_events):
--   1) สร้างยอดค้างเมื่อใบเข้าช่วง "ก่อนครบกำหนด N วัน" (N = due_lead_days ค่าเริ่ม 60) — อัตราจากใบ ไม่มีก็จากประเภท ไม่มีทั้งคู่ = ข้าม (นับให้เห็น)
--   2) ปิดยอดเองเมื่อมีรายการรับเงินของรอบเดียวกัน (trigger บน licence_fee_payments — บันทึกจากหน้าทะเบียนเดิมก็ปิดให้)
--   3) เปิดยอดกลับเองเมื่อรายการรับเงินนั้นถูกยกเลิก (licence_void_fee)
--   4) ยอดต่ออายุพ้นวันหมดอายุ / ใบถูกเพิกถอน-เลิกกิจการ / วันของใบเปลี่ยน → lapsed พร้อมเหตุผล
--      (ต่ออายุหลังสิ้นอายุทำไม่ได้ตาม พ.ร.ฎ. ๒๕๖๔ — ไม่ใช่การยกหนี้) · ค่าธรรมเนียมรายปี (ม.๖๕) ไม่ lapse เอง เป็นหนี้จริง
-- ห้ามระบบทำเอง: ออกใบเสร็จ · ยกเว้น/ลดยอด · ตัดสินว่าเงินที่เข้ามาเป็นของใคร (PR2 จับคู่แล้วให้คนยืนยัน)
--
-- ⚠️ ไฟล์นี้ CREATE OR REPLACE public.licence_record_fee (จาก 20261208100100) — ยกมาทั้งฟังก์ชัน แก้บรรทัดเดียว:
--    ด่านสิทธิ์รับ "กองคลังที่ อปท. เปิดตัวเลือกไว้ และเรียกผ่าน payment_record_receipt เท่านั้น" เพิ่ม
--    มีด่าน md5 หัวไฟล์: นิยามบนฐานไม่ตรงรุ่นในรีโป = หยุดทั้งไฟล์ (NOTES ข้อ 5)
--
-- ย้อนกลับ (ลำดับสำคัญ — ผลตรวจ L6):
--   1) คืน body ของ licence_record_fee ตัวเดียว (คัดเฉพาะ CREATE OR REPLACE ของฟังก์ชันนี้จาก 20261208100100 ห้ามรันทั้งไฟล์นั้น)
--      — ต้องทำก่อน DROP payment_is_finance ไม่งั้นรับเงินพังทุกคน
--   2) DROP TRIGGER payment_dues_on_fee_insert, payment_dues_on_fee_void ON public.licence_fee_payments;
--   3) export payment_events (ประวัติ account_change) แล้ว DROP TABLE ตามไฟล์ 1 (policy หายตาม)
--   4) DROP FUNCTION public.payment_* ทุกตัวในไฟล์นี้  5) เอา 'payment-dues' ออกจาก enabled_modules ของ demo

BEGIN;

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('public.payment_settings') IS NULL OR to_regclass('public.payment_dues') IS NULL
     OR to_regclass('public.payment_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261211100000_payment_dues_tables.sql ก่อน (ไม่พบตารางใหม่ครบ 3 ตาราง)';
  END IF;
  IF to_regprocedure('public.licence_is_manager(uuid)') IS NULL OR to_regprocedure('public.licence_is_admin(uuid)') IS NULL
     OR to_regprocedure('public.licence_is_superadmin()') IS NULL OR to_regprocedure('public.licence_today()') IS NULL
     OR to_regprocedure('public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261208100100_licence_registry_rls_rpc.sql ก่อน (ไม่พบฟังก์ชันสิทธิ์/รับเงินของทะเบียนใบอนุญาต)';
  END IF;
  -- รุ่นที่ไฟล์นี้ยกมาแก้ = 20261208100100 (ตัด \r ก่อนคิด md5 — ไฟล์ในเครื่อง Windows เป็น CRLF)
  -- หรือรุ่นที่ไฟล์นี้เขียนแล้ว (รันซ้ำ) · อย่างอื่น = ฐานมีคนแก้ไปแล้ว หยุดก่อนเขียนทับ
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_md5
    FROM pg_proc AS p WHERE p.oid = 'public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean)'::regprocedure;
  IF v_md5 NOT IN ('fe7fea5589253e79f3627c5a87948532', 'bc0d47aaea13290a5604554789e14d54') THEN
    RAISE EXCEPTION 'Function drift: licence_record_fee บนฐาน (md5 %) ไม่ตรงกับรุ่นในรีโป — เทียบ pg_get_functiondef ก่อน ห้ามเขียนทับ', v_md5;
  END IF;
END $guard$;

-- ── สิทธิ์ ────────────────────────────────────────────────────────────────────────
-- กองคลังบันทึกเลขใบเสร็จได้ไหม (ตัวเลือกราย อปท. ค่าเริ่มต้นปิด)
CREATE OR REPLACE FUNCTION public.payment_is_finance(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    p_municipality_id IS NOT NULL
    AND p_municipality_id = public.get_my_municipality_id()
    AND public.get_my_role() IN ('officer', 'staff')
    AND public.get_my_department_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.payment_settings AS s
                 WHERE s.municipality_id = p_municipality_id
                   AND s.finance_can_record
                   AND s.finance_department_id = public.get_my_department_id()),
    false);
$$;

-- ผู้ดูแลยอดค้าง = ผู้จัดการทะเบียนใบอนุญาต (admin + กองที่ถือเรื่อง) หรือกองคลังที่เปิดตัวเลือก
CREATE OR REPLACE FUNCTION public.payment_can_handle(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.licence_is_manager(p_municipality_id) OR public.payment_is_finance(p_municipality_id);
$$;

-- ตัวช่วยของ policy (initPlan: คิดครั้งเดียวต่อคำสั่ง ไม่ใช่ทุกแถว)
CREATE OR REPLACE FUNCTION public.payment_handled_municipality_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN public.payment_can_handle(public.get_my_municipality_id()) THEN public.get_my_municipality_id() END;
$$;

-- โมดูลเปิดอยู่ไหม (enabled_modules ว่าง = ระบบเก่าที่ยังไม่ได้ตั้ง ถือว่าเปิด — ตรงกับ staffMenuAccess)
CREATE OR REPLACE FUNCTION public.payment_module_on(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((SELECT m.enabled_modules IS NULL OR array_position(m.enabled_modules::text[], 'payment-dues') IS NOT NULL
                     FROM public.municipalities AS m WHERE m.id = p_municipality_id), false);
$$;

REVOKE ALL ON FUNCTION public.payment_is_finance(uuid), public.payment_can_handle(uuid),
  public.payment_handled_municipality_id(), public.payment_module_on(uuid) FROM PUBLIC, anon;
-- หน้าจอเรียกเพื่อสลับโหมด (ตัวบังคับจริงคือ policy/RPC)
GRANT EXECUTE ON FUNCTION public.payment_is_finance(uuid), public.payment_can_handle(uuid),
  public.payment_handled_municipality_id(), public.payment_module_on(uuid) TO authenticated;

-- ── ประวัติ (เขียนจากฟังก์ชันในไฟล์นี้เท่านั้น) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payment_log(
  p_municipality_id uuid, p_entity text, p_entity_id uuid, p_action text, p_changes jsonb, p_reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.payment_events (municipality_id, entity, entity_id, action, changes, reason, actor)
  VALUES (p_municipality_id, p_entity, p_entity_id, p_action, coalesce(p_changes, '{}'::jsonb), p_reason, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.payment_log(uuid, text, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── ค่าตั้ง: ตรวจค่า + ประทับการเปลี่ยนบัญชีปลายทาง + ลงประวัติ ───────────────────────────
CREATE OR REPLACE FUNCTION public.payment_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key       text;
  v_val       jsonb;
  v_sources   text[] := ARRAY['licence'];
  v_channels  text[] := ARRAY['counter', 'promptpay', 'bill_payment'];
  v_account   boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
    RAISE EXCEPTION 'เปลี่ยน อปท. ของค่าตั้งไม่ได้' USING ERRCODE = '42501';
  END IF;
  IF NEW.finance_department_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.departments WHERE id = NEW.finance_department_id AND municipality_id = NEW.municipality_id) THEN
    RAISE EXCEPTION 'กองคลังต้องเป็นกองของ อปท. เดียวกัน' USING ERRCODE = '23514';
  END IF;

  -- บริการไหนรับช่องไหน: คีย์ต้องเป็นบริการที่รู้จัก ค่าเป็นอาร์เรย์ช่องทางที่รู้จัก (เรียง + ตัดซ้ำให้)
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(NEW.source_channels) LOOP
    IF NOT (v_key = ANY (v_sources)) THEN
      RAISE EXCEPTION 'ไม่รู้จักบริการ % ในการตั้งช่องทาง', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_val) <> 'array' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_val) AS e
          WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY (v_channels))) THEN
      RAISE EXCEPTION 'ช่องทางของบริการ % ไม่ถูกต้อง (รับได้: counter, promptpay, bill_payment)', v_key USING ERRCODE = '22023';
    END IF;
    NEW.source_channels := jsonb_set(NEW.source_channels, ARRAY[v_key],
      coalesce((SELECT jsonb_agg(c ORDER BY c) FROM (SELECT DISTINCT e #>> '{}' AS c FROM jsonb_array_elements(v_val) AS e) AS d),
               '[]'::jsonb));
  END LOOP;
  IF array_position(NEW.elaas_invoice_sources, NULL) IS NOT NULL
     OR NOT (NEW.elaas_invoice_sources <@ v_sources) THEN
    RAISE EXCEPTION 'บริการที่ e-LAAS ออกใบแจ้งหนี้ ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  NEW.elaas_invoice_sources := ARRAY(SELECT DISTINCT s FROM unnest(NEW.elaas_invoice_sources) AS s ORDER BY s);

  NEW.bank_name := nullif(btrim(coalesce(NEW.bank_name, '')), '');
  NEW.payee_name := nullif(btrim(coalesce(NEW.payee_name, '')), '');

  -- บัญชีปลายทางเปลี่ยน = ประทับเวลา/ผู้แก้ (ผู้ใช้ส่งค่า account_changed_* มาเองไม่ได้ — คิดจากค่าจริงเสมอ)
  IF TG_OP = 'INSERT' THEN
    v_account := NEW.promptpay_id IS NOT NULL OR NEW.biller_id IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.payee_name IS NOT NULL;
  ELSE
    v_account := NEW.promptpay_id IS DISTINCT FROM OLD.promptpay_id OR NEW.biller_id IS DISTINCT FROM OLD.biller_id
              OR NEW.bank_name IS DISTINCT FROM OLD.bank_name OR NEW.payee_name IS DISTINCT FROM OLD.payee_name;
  END IF;
  IF v_account THEN
    NEW.account_changed_at := now();
    NEW.account_changed_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.account_changed_at := OLD.account_changed_at;
    NEW.account_changed_by := OLD.account_changed_by;
  ELSE
    NEW.account_changed_at := NULL;
    NEW.account_changed_by := NULL;
  END IF;
  NEW.updated_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'UPDATE' THEN OLD.updated_by END);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_settings_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payment_settings_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_new     jsonb := to_jsonb(NEW);
  v_skip    text[] := ARRAY['municipality_id', 'updated_at', 'updated_by', 'account_changed_at', 'account_changed_by'];
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY (v_skip);
      IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSE
    v_changes := jsonb_strip_nulls(v_new - v_skip);
  END IF;
  -- เลขบัญชี/พร้อมเพย์/รหัสผู้รับชำระ ไม่ใช่ข้อมูลส่วนบุคคลของประชาชน — เก็บค่าเดิม→ใหม่เต็มเพื่อย้อนตรวจการแอบเปลี่ยนบัญชี
  PERFORM public.payment_log(NEW.municipality_id, 'settings', NEW.municipality_id,
    CASE WHEN NEW.account_changed_at IS DISTINCT FROM (v_old ->> 'account_changed_at')::timestamptz
              AND NEW.account_changed_at IS NOT NULL THEN 'account_change'
         WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END,
    v_changes, NULL);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_settings_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_settings_guard_trigger ON public.payment_settings;
CREATE TRIGGER payment_settings_guard_trigger BEFORE INSERT OR UPDATE ON public.payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.payment_settings_guard();
DROP TRIGGER IF EXISTS payment_settings_log_trigger ON public.payment_settings;
CREATE TRIGGER payment_settings_log_trigger AFTER INSERT OR UPDATE ON public.payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.payment_settings_log();

-- RPC บันทึกค่าตั้ง (แอดมิน อปท. เท่านั้น — ทางเดียวที่แก้ค่าตั้งได้)
CREATE OR REPLACE FUNCTION public.payment_save_settings(
  p_municipality_id uuid,
  p_counter_enabled boolean, p_promptpay_enabled boolean, p_bill_payment_enabled boolean,
  p_promptpay_id text, p_biller_id text, p_bank_name text, p_payee_name text,
  p_source_channels jsonb, p_elaas_invoice_sources text[], p_due_lead_days integer,
  p_finance_department_id uuid, p_finance_can_record boolean)
RETURNS public.payment_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.payment_settings%ROWTYPE;
  v_pp  text := nullif(regexp_replace(coalesce(p_promptpay_id, ''), '[\s-]', '', 'g'), '');
  v_bid text := nullif(regexp_replace(coalesce(p_biller_id, ''), '[\s-]', '', 'g'), '');
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.licence_is_admin(p_municipality_id) THEN
    RAISE EXCEPTION 'ตั้งค่ารับเงินได้เฉพาะแอดมินของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.municipalities WHERE id = p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบ อปท.' USING ERRCODE = '42501';
  END IF;
  IF v_pp IS NOT NULL AND v_pp !~ '^0[0-9]{12}$' THEN
    RAISE EXCEPTION 'พร้อมเพย์ของ อปท. ต้องเป็นเลขประจำตัวผู้เสียภาษีของหน่วยงาน 13 หลัก (ขึ้นต้นด้วย 0) — ใช้เบอร์มือถือหรือเลขบัตรประชาชนไม่ได้'
      USING ERRCODE = '22023';
  END IF;
  IF v_bid IS NOT NULL AND v_bid !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'รหัสผู้รับชำระ (Biller ID) ต้องเป็นตัวเลข 15 หลัก' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_promptpay_enabled, false) AND v_pp IS NULL THEN
    RAISE EXCEPTION 'เปิดช่องทางพร้อมเพย์ต้องระบุเลขพร้อมเพย์ของ อปท.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_bill_payment_enabled, false) AND v_bid IS NULL THEN
    RAISE EXCEPTION 'เปิดช่องทาง Bill Payment ต้องระบุรหัสผู้รับชำระ (Biller ID) จากธนาคาร' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_finance_can_record, false) AND p_finance_department_id IS NULL THEN
    RAISE EXCEPTION 'เปิดให้กองคลังบันทึกเลขใบเสร็จ ต้องเลือกกองคลัง' USING ERRCODE = '22023';
  END IF;
  IF p_due_lead_days IS NOT NULL AND (p_due_lead_days < 1 OR p_due_lead_days > 180) THEN
    RAISE EXCEPTION 'สร้างยอดล่วงหน้าได้ 1–180 วัน' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_settings AS s (municipality_id, counter_enabled, promptpay_enabled, bill_payment_enabled,
    promptpay_id, biller_id, bank_name, payee_name, source_channels, elaas_invoice_sources, due_lead_days,
    finance_department_id, finance_can_record)
  VALUES (p_municipality_id, coalesce(p_counter_enabled, false), coalesce(p_promptpay_enabled, false),
    coalesce(p_bill_payment_enabled, false), v_pp, v_bid, p_bank_name, p_payee_name,
    coalesce(p_source_channels, '{}'::jsonb), coalesce(p_elaas_invoice_sources, '{}'::text[]), coalesce(p_due_lead_days, 60),
    p_finance_department_id, coalesce(p_finance_can_record, false))
  ON CONFLICT (municipality_id) DO UPDATE SET
    counter_enabled = EXCLUDED.counter_enabled, promptpay_enabled = EXCLUDED.promptpay_enabled,
    bill_payment_enabled = EXCLUDED.bill_payment_enabled, promptpay_id = EXCLUDED.promptpay_id,
    biller_id = EXCLUDED.biller_id, bank_name = EXCLUDED.bank_name, payee_name = EXCLUDED.payee_name,
    source_channels = EXCLUDED.source_channels, elaas_invoice_sources = EXCLUDED.elaas_invoice_sources,
    due_lead_days = EXCLUDED.due_lead_days, finance_department_id = EXCLUDED.finance_department_id,
    finance_can_record = EXCLUDED.finance_can_record
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_save_settings(uuid, boolean, boolean, boolean, text, text, text, text, jsonb, text[], integer, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_save_settings(uuid, boolean, boolean, boolean, text, text, text, text, jsonb, text[], integer, uuid, boolean)
  TO authenticated;

-- ── Ref1: 11 หลักสุ่ม + หลักตรวจ Luhn (เจ้าหน้าที่พิมพ์ค้นผิดหลักเดียว ระบบรู้ทันที) ─────────────
CREATE OR REPLACE FUNCTION public.payment_luhn_digit(p_digits text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT ((10 - (sum(CASE WHEN (length(p_digits) - i) % 2 = 0
                          THEN CASE WHEN d * 2 > 9 THEN d * 2 - 9 ELSE d * 2 END
                          ELSE d END) % 10)) % 10)::text
    FROM (SELECT i, substr(p_digits, i, 1)::int AS d FROM generate_series(1, length(p_digits)) AS i) AS x;
$$;
REVOKE ALL ON FUNCTION public.payment_luhn_digit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_luhn_digit(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payment_new_ref1()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT b || public.payment_luhn_digit(b)
    FROM (SELECT lpad((floor(random() * 99999999999))::bigint::text, 11, '0') AS b) AS x;
$$;
REVOKE ALL ON FUNCTION public.payment_new_ref1() FROM PUBLIC, anon, authenticated;

-- ── trigger บนรายการรับเงินของใบอนุญาต: ปิดยอด / เปิดยอดกลับ ──────────────────────────
CREATE OR REPLACE FUNCTION public.payment_dues_on_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_due     public.payment_dues%ROWTYPE;
  v_channel text := nullif(current_setting('payment.channel', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- รอบเดียวกัน = ใบเดียวกัน ชนิดเดียวกัน period_from เดียวกัน (licence_record_fee คิด period_from จากวันของใบ)
    UPDATE public.payment_dues
       SET status = 'paid', payment_id = NEW.id, paid_channel = v_channel,
           closed_at = now(), closed_by = NEW.recorded_by, close_reason = NULL, updated_at = now()
     WHERE licence_id = NEW.licence_id AND kind = NEW.kind AND period_from = NEW.period_from AND status = 'open'
    RETURNING * INTO v_due;
    IF FOUND THEN
      PERFORM public.payment_log(v_due.municipality_id, 'due', v_due.id, 'paid',
        jsonb_build_object('payment_id', NEW.id, 'receipt_no', NEW.receipt_no, 'paid_on', NEW.paid_on,
                           'amount', NEW.amount, 'due_amount', v_due.amount, 'surcharge', NEW.surcharge, 'channel', v_channel),
        CASE WHEN NEW.amount <> v_due.amount THEN 'ยอดที่รับไม่เท่ายอดค้าง (บันทึกจากหน้าทะเบียนใบอนุญาต)' END);
    END IF;
  ELSIF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN
    UPDATE public.payment_dues
       SET status = 'open', payment_id = NULL, paid_channel = NULL,
           closed_at = NULL, closed_by = NULL, close_reason = NULL, updated_at = now()
     WHERE payment_id = NEW.id AND status = 'paid'
    RETURNING * INTO v_due;
    IF FOUND THEN
      PERFORM public.payment_log(v_due.municipality_id, 'due', v_due.id, 'reopen',
        jsonb_build_object('payment_id', NEW.id, 'receipt_no', NEW.receipt_no), NEW.void_reason);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_dues_on_fee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_dues_on_fee_insert ON public.licence_fee_payments;
CREATE TRIGGER payment_dues_on_fee_insert AFTER INSERT ON public.licence_fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_dues_on_fee();
DROP TRIGGER IF EXISTS payment_dues_on_fee_void ON public.licence_fee_payments;
CREATE TRIGGER payment_dues_on_fee_void AFTER UPDATE OF voided_at ON public.licence_fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_dues_on_fee();

-- ── ลบใบจากทะเบียน → ยอดหายตาม (FK CASCADE) · ลงประวัติให้ยอดที่ยังรอชำระก่อนหาย (ผลตรวจ M1) ─────────────────
CREATE OR REPLACE FUNCTION public.payment_dues_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- อปท. ถูกลบทั้งแถว (cascade) → ไม่ลงประวัติ ไม่งั้น FK ของ payment_events ทำให้ลบ อปท. ไม่ได้
  IF OLD.status = 'open' AND EXISTS (SELECT 1 FROM public.municipalities WHERE id = OLD.municipality_id) THEN
    PERFORM public.payment_log(OLD.municipality_id, 'due', OLD.id, 'cancel',
      jsonb_build_object('licence_id', OLD.licence_id, 'amount', OLD.amount, 'ref1', OLD.ref1), 'ใบถูกลบจากทะเบียน');
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_dues_on_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payment_dues_delete_log ON public.payment_dues;
CREATE TRIGGER payment_dues_delete_log BEFORE DELETE ON public.payment_dues
  FOR EACH ROW EXECUTE FUNCTION public.payment_dues_on_delete();

-- ── RPC ปรับยอดค้างตามกฎ (หน้าจอเรียกตอนเปิดเมนู · รันซ้ำได้ ไม่สร้างซ้ำ) ───────────────────────
CREATE OR REPLACE FUNCTION public.payment_sync_licence_dues(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today    date := public.licence_today();
  v_lead     integer;
  v_created  integer := 0;
  v_paid     integer := 0;
  v_lapsed   integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_rec      record;
  v_id       uuid;
  v_try      integer;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.payment_can_handle(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูแลยอดค้างของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payment_module_on(p_municipality_id) THEN
    RAISE EXCEPTION 'เมนูรับชำระเงินยังไม่เปิดสำหรับ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  -- คนเปิดเมนูพร้อมกันสองคน: ทำทีละคน (ดัชนีกันซ้ำอยู่แล้ว แต่ล็อกให้ตัวเลขที่คืนตรงกับที่ทำจริง)
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_sync:' || p_municipality_id::text, 0));
  SELECT coalesce((SELECT due_lead_days FROM public.payment_settings WHERE municipality_id = p_municipality_id), 60) INTO v_lead;

  -- (1) ปิดยอดที่รอบนั้นมีการรับเงินแล้ว (รับเงินก่อนมียอด หรือก่อนเปิดเมนูนี้)
  FOR v_rec IN
    SELECT d.id, f.id AS payment_id, f.recorded_by, f.receipt_no
      FROM public.payment_dues AS d
      JOIN public.licence_fee_payments AS f
        ON f.licence_id = d.licence_id AND f.kind = d.kind AND f.period_from = d.period_from AND f.voided_at IS NULL
     WHERE d.municipality_id = p_municipality_id AND d.status = 'open'
  LOOP
    UPDATE public.payment_dues SET status = 'paid', payment_id = v_rec.payment_id, closed_at = now(),
           closed_by = v_rec.recorded_by, updated_at = now()
     WHERE id = v_rec.id AND status = 'open';   -- ตรวจซ้ำ: แถวอาจถูกปิดระหว่างวนลูป (ผลตรวจ M2)
    CONTINUE WHEN NOT FOUND;
    PERFORM public.payment_log(p_municipality_id, 'due', v_rec.id, 'paid',
      jsonb_build_object('payment_id', v_rec.payment_id, 'receipt_no', v_rec.receipt_no), 'พบรายการรับเงินของรอบนี้ในทะเบียนใบอนุญาต');
    v_paid := v_paid + 1;
  END LOOP;

  -- (2) ยอดที่ชำระไม่ได้แล้วตามกฎ → lapsed (ไม่ใช่การยกหนี้ — บอกเหตุผลทุกแถว)
  FOR v_rec IN
    SELECT d.id,
           CASE
             WHEN l.status IN ('revoked', 'closed') AND d.kind = 'renewal'
               THEN 'ใบถูกเพิกถอน/เลิกกิจการ — ต่ออายุไม่ได้'
             WHEN d.kind = 'renewal' AND NOT t.renewal_by_fee
               THEN 'ประเภทนี้ถูกตั้งให้ต่ออายุโดยยื่นคำขอ ไม่ใช่โดยชำระค่าธรรมเนียม'
             WHEN d.kind = 'renewal' AND l.expires_on < v_today AND d.period_from = l.expires_on + 1
               THEN 'พ้นวันหมดอายุโดยยังไม่มีการรับเงิน — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้แล้ว ต้องยื่นคำขอใหม่ (พ.ร.ฎ. 2564)'
             WHEN d.kind = 'renewal' AND d.period_from IS DISTINCT FROM l.expires_on + 1
               THEN 'วันหมดอายุของใบเปลี่ยน — ระบบสร้างยอดใหม่ตามวันใหม่'
             WHEN d.kind = 'annual' AND d.period_from IS DISTINCT FROM l.next_fee_due_on
               THEN 'วันครบกำหนดค่าธรรมเนียมของใบเปลี่ยน — ระบบสร้างยอดใหม่ตามวันใหม่'
           END AS reason
      FROM public.payment_dues AS d
      JOIN public.licences AS l ON l.id = d.licence_id
      JOIN public.licence_types AS t ON t.id = l.licence_type_id
     WHERE d.municipality_id = p_municipality_id AND d.status = 'open'
  LOOP
    CONTINUE WHEN v_rec.reason IS NULL;
    UPDATE public.payment_dues SET status = 'lapsed', closed_at = now(), closed_by = NULL, close_reason = v_rec.reason,
           updated_at = now()
     WHERE id = v_rec.id AND status = 'open';
    CONTINUE WHEN NOT FOUND;
    PERFORM public.payment_log(p_municipality_id, 'due', v_rec.id, 'lapse', '{}'::jsonb, v_rec.reason);
    v_lapsed := v_lapsed + 1;
  END LOOP;

  -- (3) อัตราของใบเปลี่ยนระหว่างยอดยังเปิด → ยอดตามอัตราใหม่ (ลงประวัติค่าเดิม→ใหม่ · ใบแจ้งที่พิมพ์ไปแล้วต้องพิมพ์ใหม่)
  FOR v_rec IN
    SELECT d.id, d.amount AS old_amount, coalesce(l.fee_amount, t.default_fee) AS new_amount
      FROM public.payment_dues AS d
      JOIN public.licences AS l ON l.id = d.licence_id
      JOIN public.licence_types AS t ON t.id = l.licence_type_id
     WHERE d.municipality_id = p_municipality_id AND d.status = 'open'
       AND coalesce(l.fee_amount, t.default_fee) IS NOT NULL
       AND coalesce(l.fee_amount, t.default_fee) IS DISTINCT FROM d.amount
  LOOP
    UPDATE public.payment_dues SET amount = v_rec.new_amount, updated_at = now() WHERE id = v_rec.id AND status = 'open';
    CONTINUE WHEN NOT FOUND;
    PERFORM public.payment_log(p_municipality_id, 'due', v_rec.id, 'update',
      jsonb_build_object('amount', jsonb_build_array(v_rec.old_amount, v_rec.new_amount)), 'อัตราค่าธรรมเนียมของใบเปลี่ยน');
    v_updated := v_updated + 1;
  END LOOP;

  -- (4) สร้างยอดใหม่: ใบที่เข้าช่วงก่อนครบกำหนด และรอบนั้นยังไม่มียอดที่มีผล/ยังไม่มีการรับเงิน
  FOR v_rec IN
    SELECT l.id AS licence_id,
           CASE WHEN t.doc_kind = 'licence' THEN 'renewal' ELSE 'annual' END AS kind,
           CASE WHEN t.doc_kind = 'licence' THEN l.expires_on + 1 ELSE l.next_fee_due_on END AS period_from,
           CASE WHEN t.doc_kind = 'licence' THEN l.expires_on ELSE l.next_fee_due_on END AS due_on,
           coalesce(l.fee_amount, t.default_fee) AS amount
      FROM public.licences AS l
      JOIN public.licence_types AS t ON t.id = l.licence_type_id
     WHERE l.municipality_id = p_municipality_id
       AND l.status IN ('active', 'suspended')
       AND (
         -- ใบอนุญาตที่ต่ออายุโดยชำระค่าธรรมเนียมได้ · ยังไม่สิ้นอายุ · เข้าช่วงล่วงหน้า (ไม่ก่อนช่วงที่ข้อบัญญัติให้ชำระ)
         (t.doc_kind = 'licence' AND t.renewal_by_fee AND l.expires_on IS NOT NULL AND l.expires_on >= v_today
          AND l.expires_on - LEAST(v_lead, coalesce(t.renewal_window_days, v_lead)) <= v_today
          -- ใบอายุสั้น (หมวด other) ห้ามสร้างยอดก่อนรอบปัจจุบันเริ่ม — licence_record_fee ไม่รับเงินก่อนนั้น (ผลตรวจรอบ 2 L2)
          AND ((l.expires_on + 1) - make_interval(months => t.validity_months))::date <= v_today)
         -- หนังสือรับรองการแจ้ง: ค่าธรรมเนียมรายปี รวมที่เลยกำหนดแล้ว (ยังเป็นหนี้ ม.๖๕)
         OR (t.doc_kind = 'notice_certificate' AND l.next_fee_due_on IS NOT NULL AND l.next_fee_due_on - v_lead <= v_today))
       -- รอบนี้มียอดที่รอชำระ/ชำระแล้ว/คนยกเลิกไว้ = ไม่สร้างซ้ำ (ยอดที่คนยกเลิกต้องไม่เด้งกลับมาเอง)
       -- lapsed ไม่กัน: ใบที่คืนสถานะตามคำสั่ง หรือวันของใบถูกแก้กลับ ต้องได้ยอดของรอบนั้นอีกครั้ง
       --   (lapsed เพราะพ้นวันหมดอายุ ไม่เกิดซ้ำเพราะเงื่อนไข expires_on >= วันนี้ ด้านบนกันอยู่แล้ว)
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_dues AS d
          WHERE d.licence_id = l.id AND d.status IN ('open', 'paid', 'cancelled')
            AND d.kind = CASE WHEN t.doc_kind = 'licence' THEN 'renewal' ELSE 'annual' END
            AND d.period_from = CASE WHEN t.doc_kind = 'licence' THEN l.expires_on + 1 ELSE l.next_fee_due_on END)
       AND NOT EXISTS (
         SELECT 1 FROM public.licence_fee_payments AS f
          WHERE f.licence_id = l.id AND f.voided_at IS NULL
            AND f.kind = CASE WHEN t.doc_kind = 'licence' THEN 'renewal' ELSE 'annual' END
            AND f.period_from = CASE WHEN t.doc_kind = 'licence' THEN l.expires_on + 1 ELSE l.next_fee_due_on END)
     ORDER BY 4, 1
  LOOP
    IF v_rec.amount IS NULL THEN
      v_skipped := v_skipped + 1;   -- ไม่มีอัตราทั้งที่ใบและที่ประเภท — หน้าจอบอกจำนวนให้ไปตั้งอัตรา
      CONTINUE;
    END IF;
    v_id := NULL;
    FOR v_try IN 1..5 LOOP          -- Ref1 ชนกัน (โอกาส ~ 1 ใน 10^11) ลองเลขใหม่
      INSERT INTO public.payment_dues (municipality_id, source, kind, licence_id, period_from, due_on, amount, ref1)
      VALUES (p_municipality_id, 'licence', v_rec.kind, v_rec.licence_id, v_rec.period_from, v_rec.due_on, v_rec.amount,
              public.payment_new_ref1())
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_id;
      EXIT WHEN v_id IS NOT NULL;
      EXIT WHEN EXISTS (SELECT 1 FROM public.payment_dues AS d
                         WHERE d.licence_id = v_rec.licence_id AND d.kind = v_rec.kind
                           AND d.period_from = v_rec.period_from AND d.status IN ('open', 'paid'));
    END LOOP;
    IF v_id IS NOT NULL THEN
      PERFORM public.payment_log(p_municipality_id, 'due', v_id, 'insert',
        jsonb_build_object('licence_id', v_rec.licence_id, 'kind', v_rec.kind, 'period_from', v_rec.period_from,
                           'due_on', v_rec.due_on, 'amount', v_rec.amount),
        'ระบบสร้างตามกฎ: ใกล้ครบกำหนดภายใน ' || v_lead || ' วัน');
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'paid', v_paid, 'lapsed', v_lapsed, 'updated', v_updated,
                            'skipped_no_fee', v_skipped, 'lead_days', v_lead, 'today', v_today);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_sync_licence_dues(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_sync_licence_dues(uuid) TO authenticated;

-- ── RPC รายการยอด (รวมชื่อร้าน/ผู้ประกอบการจากทะเบียน — กองคลังอ่านตารางใบอนุญาตตรงไม่ได้) ──────────
CREATE OR REPLACE FUNCTION public.payment_list_dues(p_municipality_id uuid, p_status text DEFAULT 'open')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_manager boolean;
  v_status  text := coalesce(p_status, 'open');
  v_limit   constant integer := 2000;
  v_total   integer;
  v_rows    jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.payment_can_handle(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูยอดค้างของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('open', 'paid', 'lapsed', 'cancelled', 'closed', 'all') THEN
    RAISE EXCEPTION 'สถานะไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  -- ที่อยู่ใช้พิมพ์ใบแจ้งชำระ — เฉพาะผู้จัดการทะเบียน (กองคลังใช้แค่ชื่อร้าน/เลขใบ/Ref1 จับคู่ใบเสร็จ: PDPA เท่าที่จำเป็น)
  v_manager := public.licence_is_manager(p_municipality_id);
  -- 'closed' = lapsed + cancelled (แท็บ "ปิดแล้ว" ของหน้าจอ)
  SELECT count(*) INTO v_total FROM public.payment_dues AS d
   WHERE d.municipality_id = p_municipality_id
     AND (v_status = 'all' OR d.status = v_status OR (v_status = 'closed' AND d.status IN ('lapsed', 'cancelled')));
  -- ยอดที่ปิดแล้วเรียงใหม่สุดก่อน (ตัดที่เพดาน = ของเก่าสุดหลุด ไม่ใช่ของล่าสุด) · รอชำระเรียงตามวันครบกำหนด
  SELECT coalesce(jsonb_agg(x.row_data ORDER BY x.n), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT row_number() OVER (ORDER BY CASE d.status WHEN 'open' THEN 0 ELSE 1 END,
                                         CASE WHEN d.status = 'open' THEN d.due_on END,
                                         d.closed_at DESC NULLS LAST, d.ref1) AS n,
             jsonb_build_object(
               'id', d.id, 'source', d.source, 'kind', d.kind, 'licence_id', d.licence_id,
               'period_from', d.period_from, 'due_on', d.due_on, 'amount', d.amount, 'ref1', d.ref1,
               'status', d.status, 'payment_id', d.payment_id, 'paid_channel', d.paid_channel,
               'closed_at', d.closed_at, 'close_reason', d.close_reason, 'created_at', d.created_at,
               'licence_no', l.licence_no, 'business_name', l.business_name, 'holder_name', l.holder_name,
               'address', CASE WHEN v_manager THEN l.address END, 'village', CASE WHEN v_manager THEN l.village END,
               'licence_status', l.status, 'expires_on', l.expires_on, 'next_fee_due_on', l.next_fee_due_on,
               'type_name', t.name, 'category', t.category, 'doc_kind', t.doc_kind,
               'receipt_no', f.receipt_no, 'paid_on', f.paid_on, 'paid_amount', f.amount, 'paid_surcharge', f.surcharge
             ) AS row_data
        FROM public.payment_dues AS d
        JOIN public.licences AS l ON l.id = d.licence_id
        JOIN public.licence_types AS t ON t.id = l.licence_type_id
        LEFT JOIN public.licence_fee_payments AS f ON f.id = d.payment_id
       WHERE d.municipality_id = p_municipality_id
         AND (v_status = 'all' OR d.status = v_status OR (v_status = 'closed' AND d.status IN ('lapsed', 'cancelled')))
       ORDER BY 1
       LIMIT v_limit
    ) AS x;
  -- ไม่ตัดเงียบ (NOTES ข้อ 14): หน้าจอบอกเมื่อ truncated
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'truncated', v_total > v_limit, 'limit', v_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_list_dues(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_list_dues(uuid, text) TO authenticated;

-- ── RPC บันทึกเลขใบเสร็จของยอด → ทะเบียนใบอนุญาตขยายวันเอง (ผ่าน licence_record_fee ตัวเดิม ด่านเดิมทุกข้อ) ─────
CREATE OR REPLACE FUNCTION public.payment_record_receipt(
  p_due_id uuid, p_paid_on date, p_amount numeric, p_receipt_no text, p_channel text,
  p_surcharge numeric DEFAULT 0, p_no_material_change boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_due    public.payment_dues%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  -- ล็อกใบก่อนแล้วค่อยล็อกยอด — ลำดับเดียวกับ licence_record_fee ที่เรียกตรง (ล็อกใบ → trigger ล็อกยอด) กัน deadlock (ผลตรวจ L1)
  SELECT * INTO v_due FROM public.payment_dues WHERE id = p_due_id;
  IF NOT FOUND OR NOT public.payment_can_handle(v_due.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบยอด หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.licences WHERE id = v_due.licence_id FOR UPDATE;
  SELECT * INTO v_due FROM public.payment_dues WHERE id = p_due_id FOR UPDATE;
  -- ใบ (และยอด) อาจถูกลบระหว่างอ่านครั้งแรกกับล็อก → v_due เป็น NULL ทั้งแถว (ผลตรวจรอบ 2 L1)
  IF NOT FOUND OR v_due.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'ยอดนี้ไม่ได้อยู่ในสถานะรอชำระแล้ว' USING ERRCODE = '22023';
  END IF;
  -- ยอดที่รับต้องเท่ายอดค้าง (ค่าปรับแยกช่อง) — รับไม่ครบแล้วปิดยอด = ลดยอดเองโดยไม่มีเหตุผล (ผลตรวจ M3)
  IF p_amount IS NULL OR round(p_amount, 2) <> v_due.amount THEN
    RAISE EXCEPTION 'ยอดที่รับ (%) ไม่เท่ายอดค้าง (%) — ถ้าอัตราค่าธรรมเนียมเปลี่ยน ให้แก้อัตราที่ทะเบียนแล้วกด "ปรับยอดค้าง" ก่อน · ค่าปรับใส่ช่องค่าปรับแยก · ประชาชนจ่ายตามใบแจ้งเดิมไปแล้ว ให้กองที่ถือเรื่องบันทึกจากเมนูทะเบียนใบอนุญาต (ระบบลงเหตุผลยอดไม่เท่าให้)',
      p_amount, v_due.amount USING ERRCODE = '22023';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('counter', 'promptpay', 'bill_payment', 'other') THEN
    RAISE EXCEPTION 'ช่องทางที่รับเงินไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('payment.channel', p_channel, true);
  PERFORM set_config('payment.receipt_rpc', 'on', true);   -- ให้ licence_record_fee รับกองคลัง (เฉพาะทางนี้)
  v_result := public.licence_record_fee(v_due.licence_id, v_due.kind, p_paid_on, p_amount, p_receipt_no,
                                        p_surcharge, p_no_material_change);
  PERFORM set_config('payment.receipt_rpc', '', true);
  PERFORM set_config('payment.channel', '', true);

  -- trigger ต้องปิดยอดนี้แล้ว — ถ้าไม่ปิด แปลว่ารอบของใบไม่ตรงกับยอด (วันของใบเปลี่ยนหลังสร้างยอด) ย้อนทั้งหมด
  IF NOT EXISTS (SELECT 1 FROM public.payment_dues WHERE id = p_due_id AND status = 'paid'
                    AND payment_id = (v_result ->> 'payment_id')::uuid) THEN
    RAISE EXCEPTION 'ยอดนี้ไม่ตรงกับรอบปัจจุบันของใบ (วันหมดอายุ/วันครบกำหนดเปลี่ยน) — กด "ปรับยอดค้าง" แล้วบันทึกที่ยอดใหม่'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_result || jsonb_build_object('due_id', p_due_id);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_record_receipt(uuid, date, numeric, text, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_record_receipt(uuid, date, numeric, text, text, numeric, boolean) TO authenticated;

-- ── RPC ยกเลิกยอด (คนตัดสิน ต้องมีเหตุผล · กองคลังทำไม่ได้ — เป็นเรื่องของกองที่ถือเรื่อง) ─────────────
CREATE OR REPLACE FUNCTION public.payment_cancel_due(p_due_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_due    public.payment_dues%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_due FROM public.payment_dues WHERE id = p_due_id FOR UPDATE;
  IF NOT FOUND OR NOT public.licence_is_manager(v_due.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบยอด หรือไม่มีสิทธิ์ยกเลิก' USING ERRCODE = '42501';
  END IF;
  IF v_due.status <> 'open' THEN
    RAISE EXCEPTION 'ยกเลิกได้เฉพาะยอดที่รอชำระ' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผล (3–1000 ตัวอักษร)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payment_dues SET status = 'cancelled', closed_at = now(), closed_by = auth.uid(), close_reason = v_reason,
         updated_at = now()
   WHERE id = p_due_id;
  PERFORM public.payment_log(v_due.municipality_id, 'due', p_due_id, 'cancel', jsonb_build_object('amount', v_due.amount), v_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_cancel_due(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_cancel_due(uuid, text) TO authenticated;

-- ── licence_record_fee: ยกมาทั้งฟังก์ชันจาก 20261208100100 แก้เฉพาะด่านสิทธิ์ (ดูหัวไฟล์) ─────────────────────
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
  -- 20261211100100 (E4): กองคลังที่ อปท. เปิดตัวเลือก finance_can_record บันทึกได้ — เฉพาะเมื่อเรียกผ่าน payment_record_receipt
  -- (ธง payment.receipt_rpc ตั้งได้จากฟังก์ชันฐานข้อมูลเท่านั้น PostgREST ไม่เปิด set_config) ด่านอื่นทุกข้อคงเดิม
  IF NOT FOUND OR NOT (public.licence_is_manager(v_lic.municipality_id)
                       OR (coalesce(current_setting('payment.receipt_rpc', true), '') = 'on'
                           AND public.payment_is_finance(v_lic.municipality_id))) THEN
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

-- ── policy (อ่านอย่างเดียว · เขียนผ่าน RPC) ──────────────────────────────────────────
DO $policies$
DECLARE
  t text;
  m text := '((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.payment_handled_municipality_id()))';
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_settings', 'payment_dues', 'payment_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING %s', t || '_select', t, m);
  END LOOP;
END $policies$;

REVOKE ALL ON public.payment_settings, public.payment_dues, public.payment_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.payment_settings, public.payment_dues, public.payment_events FROM authenticated;
GRANT SELECT ON public.payment_settings, public.payment_dues, public.payment_events TO authenticated;
REVOKE ALL ON SEQUENCE public.payment_events_id_seq FROM PUBLIC, anon, authenticated;

-- ── เปิดโมดูลให้สนามซ้อม demo เท่านั้น (อปท. อื่นแอดมินเปิดเองที่หน้าจัดการโมดูล · ค่าเริ่มต้นปิด) ─────────
-- (check:uniform บล็อก deploy ถ้าไม่มี อปท. ใดเปิดคีย์ใหม่เลย — บทเรียน #757)
UPDATE public.municipalities
   SET enabled_modules = array_append(enabled_modules, 'payment-dues')
 WHERE slug = 'demo' AND enabled_modules IS NOT NULL
   AND array_position(enabled_modules::text[], 'payment-dues') IS NULL;

-- ── ด่านตรวจท้ายไฟล์ (ผู้รันไม่ใช่เจ้าของตาราง REVOKE ไม่ error แต่ไม่มีผล — บทเรียน #657) ──────────
DO $check$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_settings', 'payment_dues', 'payment_events'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'RLS ของ % ไม่ได้เปิด', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'anon ยังมีสิทธิ์บน %', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'authenticated ยังเขียน % ตรงได้', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.payment_record_receipt(uuid, date, numeric, text, text, numeric, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.payment_sync_licence_dues(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.payment_list_dues(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.payment_cancel_due(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.payment_save_settings(uuid, boolean, boolean, boolean, text, text, text, text, jsonb, text[], integer, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.payment_log(uuid, text, uuid, text, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.payment_new_ref1()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.payment_dues_on_fee()', 'EXECUTE') THEN
    RAISE EXCEPTION 'สิทธิ์ EXECUTE ของฟังก์ชันรับชำระเงินหลุด';
  END IF;
  IF EXISTS (SELECT 1 FROM public.municipalities WHERE slug = 'demo' AND enabled_modules IS NOT NULL
             AND array_position(enabled_modules::text[], 'payment-dues') IS NULL) THEN
    RAISE EXCEPTION 'เปิดโมดูล payment-dues ให้ demo ไม่สำเร็จ';
  END IF;
  -- body ที่ apply แล้วต้องตรง md5 รุ่นแก้ที่ด่านหัวไฟล์รับ (แก้ body ในไฟล์นี้ = ต้องคำนวณค่านี้ใหม่ — ผลตรวจ L7)
  IF (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc AS p
       WHERE p.oid = 'public.licence_record_fee(uuid, text, date, numeric, text, numeric, boolean)'::regprocedure)
     <> 'bc0d47aaea13290a5604554789e14d54' THEN
    RAISE EXCEPTION 'licence_record_fee หลัง apply ไม่ตรง md5 รุ่นแก้ (bc0d47aa…) — คำนวณค่าใหม่ในด่านหัวไฟล์';
  END IF;
END $check$;

COMMIT;
