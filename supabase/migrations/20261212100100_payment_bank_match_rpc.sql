-- 20261212100100_payment_bank_match_rpc.sql
-- ขั้น 1C (E4) รับชำระเงิน PR2 ไฟล์ 2/3 — นำเข้าไฟล์ธนาคาร · จับคู่ยอด · คิวแจ้งเปลี่ยนบัญชี · exec_summary_payment
--
-- ใครทำอะไรได้ (ชุดสิทธิ์เดิมของ PR1 — payment_can_handle = ผู้จัดการทะเบียนใบอนุญาต + กองคลังถ้า อปท. เปิดตัวเลือก)
--   นำเข้าไฟล์ / ตั้งการจับคู่คอลัมน์ / ยืนยันคู่ / ยกเลิกคู่ / ระบุว่า "ไม่ใช่เงินของระบบนี้"  → payment_can_handle + โมดูลเปิด
--   ผู้บริหาร (exec_assert_viewer) เห็นตัวเลขรวมผ่าน executive_overview → exec_summary_payment เท่านั้น
--   Edge Function payment-account-alert (service_role) อ่าน/ปิดคิวแจ้งเปลี่ยนบัญชี
--
-- โหมดการจับคู่ (payment_bank_match_mode — กฎเดียวใช้ทั้งระบบจับเอง รายการเสนอ และการกดยืนยัน):
--   open      ยอดรอชำระ · ยอดเงินเท่ากัน · (ต่ออายุ) เงินเข้าไม่เกินวันหมดอายุ → เงินเข้าเป็น matched รอเลขใบเสร็จ
--   reopen    ยอดต่ออายุที่ระบบปิดเป็น lapsed เพราะพ้นวันหมดอายุ แต่เงินเข้าก่อน/ในวันหมดอายุ (ผลตรวจ H-1)
--             → คนกดยืนยัน: เปิดยอดกลับเป็นรอชำระ (ลง 'reopen' พร้อมวันที่เงินเข้า) แล้ว matched — ระบบไม่เปิดกลับเอง
--   evidence  ยอดที่บันทึกเลขใบเสร็จไปแล้ว (เช่น กองคลังเห็นเงินในแอปธนาคารก่อนนำเข้าไฟล์) ยอดรับเท่ากัน ยังไม่มีเงินเข้าผูก (ผลตรวจ M-1)
--             → ผูกเงินเข้าเป็นหลักฐาน receipted ทันที (ไม่ใช่เงินซ้ำ ไม่ต้องคืน)
--
-- ระบบทำเอง (ตามกฎ อธิบายได้ ตรวจย้อนได้ใน payment_events):
--   1) Bill Payment: Ref1 ตรง → โหมด open = จับคู่เอง · evidence = ผูกหลักฐานเอง · reopen = ไม่ทำเอง (ขึ้นคำแนะนำให้คนกด)
--   2) พร้อมเพย์/โอน (ไม่มี Ref): เสนอคู่ — "คนกดยืนยัน" เสมอ (เจ้าของตัดสิน 2026-11-18)
--   3) ยอดปิดด้วยเลขใบเสร็จ → เงินเข้า receipted · ยกเลิกรายการรับเงิน → กลับเป็น matched (เงินยังเข้าจริง)
--   4) ยอดที่มีเงินเข้าจับคู่ไว้ ระบบไม่ปิดเป็น lapsed และไม่เปลี่ยนยอดเงินเอง · คนยกเลิกยอด = ปฏิเสธ (บอกให้ยกเลิกคู่ก่อน)
--   5) ยอดต่ออายุที่เพิ่งพ้นวันหมดอายุ: ระบบรอไฟล์ธนาคาร 7 วันก่อนปิดเป็น lapsed (ผลตรวจ H-1 — จ่ายวันศุกร์/วันหมดอายุ
--      แล้วไฟล์มาวันทำการถัดไป ต้องจับคู่ได้ตามปกติ) · พ้น 7 วันยังไม่มีเงินเข้า = lapsed ตามเดิม · เงินมาช้ากว่านั้นใช้ reopen
--   6) บัญชีรับเงินเปลี่ยน (account_change) → เข้าคิวแจ้ง Telegram เอง ไม่พึ่งหน้าเว็บ (คนแอบเปลี่ยนเรียก RPC ตรงได้)
-- ห้ามระบบทำเอง: ออกใบเสร็จ · ปิดยอดโดยไม่มีเลขใบเสร็จ · ยกหนี้/ลดยอด · จับคู่เงินที่ไม่มี Ref (พร้อมเพย์) · เปิดยอด lapsed กลับ
--
-- ไม่ CREATE OR REPLACE ฟังก์ชันของ PR1 ตัวใดเลย (ใช้ trigger เสริมแทน) แต่ trigger พึ่งพฤติกรรมของ 3 ตัว
-- (sync ใช้ CONTINUE WHEN NOT FOUND หลัง UPDATE · cancel UPDATE แล้วลงประวัติ · on_fee ปิด/เปิดยอดตามรายการรับเงิน)
-- ⇒ มีด่าน md5 หัวไฟล์ — มีคนแก้สามตัวนี้แล้ว = หยุด ต้องตรวจว่า trigger ยังถูกอยู่ไหม (ผลตรวจ L-8)
--
-- ย้อนกลับ (ลำดับสำคัญ — ผลตรวจ L-10):
--   1) SELECT cron.unschedule('payment-account-alert'); DROP FUNCTION public.payment_alert_kick(); (ไฟล์ 3)
--   2) ปล่อยคู่ก่อน: UPDATE payment_bank_txns SET status='unmatched', due_id=NULL, match_method=NULL, matched_by=NULL,
--      matched_at=NULL WHERE status='matched'; (ไม่งั้นลบใบที่มียอดจับคู่อยู่จะชน CHECK 23514 หลัง DROP trigger)
--   3) DROP TRIGGER payment_dues_guard_matched, payment_dues_bank_status, payment_dues_release_bank ON public.payment_dues;
--      DROP TRIGGER payment_events_alert_enqueue ON public.payment_events;
--   4) DROP FUNCTION ทุกตัวในไฟล์นี้ (รายชื่อในด่านท้ายไฟล์) · แล้วย้อนไฟล์ 1 (export payment_events entity ใหม่ก่อน)

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_bad text;
BEGIN
  IF to_regclass('public.payment_bank_txns') IS NULL OR to_regclass('public.payment_bank_imports') IS NULL
     OR to_regclass('public.payment_account_alerts') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261212100000_payment_bank_match_tables.sql ก่อน (ไม่พบตารางนำเข้าไฟล์ธนาคาร)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_bank_txns'
                 AND column_name = 'ref1_foreign') THEN
    RAISE EXCEPTION 'ต้องรัน 20261212100000_payment_bank_match_tables.sql รุ่นล่าสุดก่อน (ไม่พบ payment_bank_txns.ref1_foreign)';
  END IF;
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL
     OR to_regprocedure('public.executive_overview(uuid,date,date,text[])') IS NULL
     OR to_regprocedure('public.exec_digest_eligible(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชันห้องผู้บริหาร (exec_assert_viewer / executive_overview / exec_digest_eligible)';
  END IF;
  IF to_regprocedure('public.licence_today()') IS NULL OR to_regprocedure('public.payment_module_on(uuid)') IS NULL
     OR to_regprocedure('public.payment_luhn_digit(text)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ licence_today() / payment_module_on() / payment_luhn_digit() — ต้องรัน 20261208100100 และ 20261211100100 ก่อน';
  END IF;
  IF to_regclass('public.telegram_user_links') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง telegram_user_links (ผู้รับแจ้งส่วนตัว)';
  END IF;
  -- ฟังก์ชัน PR1 ที่ trigger ในไฟล์นี้พึ่งพฤติกรรม ต้องเป็นรุ่นใน 20261211100100 (md5 หลังตัด \r — ไฟล์ Windows เป็น CRLF)
  SELECT string_agg(x.fn || ' (' || coalesce(md5(replace(p.prosrc, E'\r', '')), 'ไม่พบ') || ')', ', ')
    INTO v_bad
    FROM (VALUES
      ('payment_sync_licence_dues', 'public.payment_sync_licence_dues(uuid)', '8679c7624efdfd85fa52cd46f28b6c15'),
      ('payment_cancel_due',        'public.payment_cancel_due(uuid,text)',   'f8754a3ce420d09391977d3d24b12a96'),
      ('payment_dues_on_fee',       'public.payment_dues_on_fee()',           '0239ef87effbb4de52f6e273b87645b8')
    ) AS x(fn, sig, md5_ok)
    LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(x.sig)
   WHERE p.oid IS NULL OR md5(replace(p.prosrc, E'\r', '')) <> x.md5_ok;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Function drift: % ไม่ตรงรุ่น 20261211100100 — ตรวจว่า trigger ของไฟล์นี้ยังถูกกับเนื้อใหม่ก่อน', v_bad;
  END IF;
END $guard$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 0) ตัวช่วย
-- ══════════════════════════════════════════════════════════════════════════════════
-- Ref1 รูปแบบของระบบนี้ (12 หลัก + หลักตรวจ Luhn ตาม payment_new_ref1) — บางธนาคารเติมศูนย์นำหน้า จึงตัดแล้วเติมกลับเป็น 12 หลัก
-- ไม่ใช่รูปแบบนี้ = NULL (ไม่เก็บ — อาจเป็นเลขบัตรประชาชนของรายได้อื่นที่ใช้ Biller ID เดียวกัน · ผลตรวจ M-3)
CREATE OR REPLACE FUNCTION public.payment_ref1_normalize(p_digits text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text := ltrim(coalesce(p_digits, ''), '0');
BEGIN
  IF p_digits IS NULL OR p_digits !~ '^[0-9]{1,20}$' OR v = '' OR length(v) > 12 THEN
    RETURN NULL;
  END IF;
  v := lpad(v, 12, '0');
  IF public.payment_luhn_digit(left(v, 11)) <> right(v, 1) THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_ref1_normalize(text) FROM PUBLIC, anon, authenticated;

-- แปลงวันเวลาแบบไม่ล้ม: วันที่ผิดปฏิทิน (เช่น 30 ก.พ.) = NULL ให้ผู้เรียกบอกเลขแถวได้ (ผลตรวจ L-2)
CREATE OR REPLACE FUNCTION public.payment_try_timestamptz(p_text text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?$' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::timestamptz;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_time_zone_displacement_value THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_try_timestamptz(text) FROM PUBLIC, anon, authenticated;

-- โหมดการจับคู่ของ "เงินเข้า (วันที่/ยอด)" กับยอดหนึ่ง — NULL = จับคู่ไม่ได้ (ดูหัวไฟล์)
CREATE OR REPLACE FUNCTION public.payment_bank_match_mode(p_due_id uuid, p_txn_date date, p_amount numeric)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM public.payment_bank_txns AS o WHERE o.due_id = d.id AND o.status IN ('matched', 'receipted'))
             THEN NULL
           WHEN d.status = 'open' AND d.amount = p_amount AND (d.kind <> 'renewal' OR p_txn_date <= d.due_on)
             THEN 'open'
           WHEN d.status = 'lapsed' AND d.kind = 'renewal' AND d.amount = p_amount AND p_txn_date <= d.due_on
                AND l.status IN ('active', 'suspended') AND t.renewal_by_fee AND l.expires_on + 1 = d.period_from
                AND NOT EXISTS (SELECT 1 FROM public.payment_dues AS o
                                 WHERE o.licence_id = d.licence_id AND o.kind = d.kind AND o.period_from = d.period_from
                                   AND o.status IN ('open', 'paid'))
             THEN 'reopen'
           WHEN d.status = 'paid' AND f.voided_at IS NULL AND f.amount = p_amount
             THEN 'evidence'
         END
    FROM public.payment_dues AS d
    LEFT JOIN public.licences AS l ON l.id = d.licence_id
    LEFT JOIN public.licence_types AS t ON t.id = l.licence_type_id
    LEFT JOIN public.licence_fee_payments AS f ON f.id = d.payment_id
   WHERE d.id = p_due_id;
$$;
REVOKE ALL ON FUNCTION public.payment_bank_match_mode(uuid, date, numeric) FROM PUBLIC, anon, authenticated;

-- ผูกเงินเข้ากับยอดตามโหมด (ภายใน — ผู้เรียกล็อกยอด + ตรวจสิทธิ์แล้ว) คืนสถานะใหม่ของเงินเข้า
CREATE OR REPLACE FUNCTION public.payment_bank_apply_match(p_txn_id uuid, p_due_id uuid, p_mode text, p_method text, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_txn public.payment_bank_txns%ROWTYPE;
  v_due public.payment_dues%ROWTYPE;
BEGIN
  SELECT * INTO v_txn FROM public.payment_bank_txns WHERE id = p_txn_id;
  SELECT * INTO v_due FROM public.payment_dues WHERE id = p_due_id;
  IF p_mode = 'reopen' THEN
    UPDATE public.payment_dues SET status = 'open', closed_at = NULL, closed_by = NULL, close_reason = NULL, updated_at = now()
     WHERE id = p_due_id AND status = 'lapsed';
    PERFORM public.payment_log(v_due.municipality_id, 'due', p_due_id, 'reopen',
      jsonb_build_object('txn_id', p_txn_id, 'txn_date', v_txn.txn_date, 'amount', v_txn.amount, 'previous_reason', v_due.close_reason),
      'เงินเข้าตามไฟล์ธนาคารวันที่ ' || v_txn.txn_date || ' ไม่เกินวันหมดอายุ (' || v_due.due_on || ') — เจ้าหน้าที่ยืนยันคู่');
  END IF;
  IF p_mode = 'evidence' THEN
    UPDATE public.payment_bank_txns
       SET status = 'receipted', due_id = p_due_id, payment_id = v_due.payment_id, match_method = p_method,
           matched_by = CASE WHEN p_method = 'confirmed' THEN auth.uid() END, matched_at = now(), updated_at = now()
     WHERE id = p_txn_id AND status = 'unmatched';
  ELSE
    UPDATE public.payment_bank_txns
       SET status = 'matched', due_id = p_due_id, match_method = p_method,
           matched_by = CASE WHEN p_method = 'confirmed' THEN auth.uid() END, matched_at = now(), updated_at = now()
     WHERE id = p_txn_id AND status = 'unmatched';
  END IF;
  PERFORM public.payment_log(v_txn.municipality_id, 'bank_txn', p_txn_id, 'match',
    jsonb_build_object('due_id', p_due_id, 'ref1', v_due.ref1, 'amount', v_txn.amount, 'txn_date', v_txn.txn_date,
                       'method', p_method, 'mode', p_mode, 'payment_id', CASE WHEN p_mode = 'evidence' THEN v_due.payment_id END),
    p_reason);
  RETURN CASE WHEN p_mode = 'evidence' THEN 'receipted' ELSE 'matched' END;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_bank_apply_match(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 1) การจับคู่คอลัมน์ไฟล์ธนาคาร (ตั้งครั้งเดียวต่อ อปท. ต่อชนิดไฟล์)
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.payment_save_bank_mapping(p_municipality_id uuid, p_file_kind text, p_mapping jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key  text;
  v_val  jsonb;
  v_out  jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.payment_can_handle(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ตั้งค่าการนำเข้าไฟล์ธนาคารของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payment_module_on(p_municipality_id) THEN
    RAISE EXCEPTION 'เมนูรับชำระเงินยังไม่เปิดสำหรับ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF p_file_kind IS NULL OR p_file_kind NOT IN ('bill_payment', 'account') THEN
    RAISE EXCEPTION 'ชนิดไฟล์ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF p_mapping IS NULL OR jsonb_typeof(p_mapping) <> 'object' THEN
    RAISE EXCEPTION 'รูปแบบการจับคู่คอลัมน์ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_mapping)) > 20 OR length(p_mapping::text) > 1800 THEN
    RAISE EXCEPTION 'การจับคู่คอลัมน์ยาวเกินไป' USING ERRCODE = '22023';
  END IF;
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_mapping) LOOP
    IF v_key !~ '^[a-z][a-z0-9_]{0,30}$'
       OR jsonb_typeof(v_val) NOT IN ('string', 'number', 'boolean', 'null')
       OR (jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') > 100) THEN
      RAISE EXCEPTION 'ค่าการจับคู่คอลัมน์ % ไม่ถูกต้อง', left(v_key, 40) USING ERRCODE = '22023';
    END IF;
  END LOOP;
  UPDATE public.payment_settings
     SET bank_file_mapping = jsonb_set(bank_file_mapping, ARRAY[p_file_kind], p_mapping)
   WHERE municipality_id = p_municipality_id
  RETURNING bank_file_mapping INTO v_out;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ยังไม่ได้ตั้งค่ารับเงินของ อปท. นี้ — ให้แอดมินตั้งค่าก่อน' USING ERRCODE = '22023';
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_save_bank_mapping(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_save_bank_mapping(uuid, text, jsonb) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 2) นำเข้าแถวจากไฟล์ธนาคาร + จับคู่ Bill Payment เอง
-- ══════════════════════════════════════════════════════════════════════════════════
-- หน้าเว็บอ่านไฟล์ในเครื่อง (CSV/XLSX) แล้วส่งเฉพาะช่องที่ต้องใช้: [{txn_at, amount, ref1, ref2, bank_ref}] — ไม่ส่งชื่อ/เลขบัญชีผู้โอน
--   txn_at   'YYYY-MM-DD' / 'YYYY-MM-DD HH:MI[:SS]' (ไม่มี offset = เวลาไทย) / มี offset ก็ได้ — ปี ค.ศ. เท่านั้น (หน้าเว็บแปลง พ.ศ. ให้)
--            ⚠️ ต้องเป็น "วันที่ทำรายการ" ไม่ใช่ "วันลงบัญชี" (T+1 ทำให้เงินที่จ่ายวันหมดอายุดูเหมือนจ่ายหลังหมดอายุ)
--   amount   ตัวเลขบาท ทศนิยมไม่เกิน 2 ตำแหน่ง > 0
--   ref1     ตัวเลขล้วน (ช่องว่าง/ขีดตัดให้) — มีตัวอักษร = แถวผิด (คอลัมน์จับคู่ผิด ไม่ตัดทิ้งให้ดูถูก · ผลตรวจ M-3)
--   ref2     ใช้ในคีย์กันซ้ำเท่านั้น ไม่เก็บ
--   bank_ref ตัวอักษรละติน/ตัวเลข/สัญลักษณ์คั่น ≤64 — อย่างอื่น = แถวผิด (กันชื่อคนหลุดจากคอลัมน์ที่จับคู่ผิด)
-- แถวผิดแถวเดียว = ไม่รับทั้งไฟล์ พร้อมเลขแถว (ให้คนแก้การจับคู่คอลัมน์ ไม่ใช่ระบบข้ามเงียบๆ)
-- กันนำเข้าซ้ำ: line_key = md5(ชนิด|เวลา|ยอด|Ref1|Ref2|เลขอ้างอิงธนาคาร) + ":" + ลำดับที่ของแถวที่เหมือนกันทุกช่องในไฟล์นั้น
--   ⇒ นำเข้าไฟล์เดิมซ้ำ / ไฟล์ช่วงวันที่ทับกัน = ไม่เกิดแถวซ้ำ · คนสองคนโอนยอดเท่ากันนาทีเดียวกัน (ไม่มีเลขอ้างอิง) = ได้ 2 แถว (:1 :2)
--   ข้อจำกัดที่รู้: รายการเดียวกันที่อยู่ทั้งในรายงาน Bill Payment และรายการเดินบัญชี = 2 แถว (คนละชนิดไฟล์)
--   → payment_list_bank_txns ติดป้าย maybe_duplicate ให้ (ผลตรวจ M-4)
CREATE OR REPLACE FUNCTION public.payment_import_bank_rows(
  p_municipality_id uuid, p_file_kind text, p_file_name text, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp   -- pg_temp ท้ายสุด: ตารางพักแถวอ้างชื่อเต็ม pg_temp.* · ชื่ออื่นไม่ถูกตารางชั่วคราวแย่ง
SET timezone TO 'Asia/Bangkok'
AS $$
DECLARE
  v_today     date := public.licence_today();
  v_name      text := btrim(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g'));
  v_count     integer;
  v_import    uuid;
  v_inserted  integer := 0;
  v_auto      integer := 0;
  v_evidence  integer := 0;
  v_bad       record;
  v_txn       record;
  v_due_id    uuid;
  v_mode      text;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.payment_can_handle(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์นำเข้าไฟล์ธนาคารของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payment_module_on(p_municipality_id) THEN
    RAISE EXCEPTION 'เมนูรับชำระเงินยังไม่เปิดสำหรับ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF p_file_kind IS NULL OR p_file_kind NOT IN ('bill_payment', 'account') THEN
    RAISE EXCEPTION 'ชนิดไฟล์ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ชื่อไฟล์ต้องยาว 1–200 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'ข้อมูลแถวไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 5000 THEN
    RAISE EXCEPTION 'นำเข้าได้ครั้งละ 1–5,000 แถว (ไฟล์นี้ % แถว) — แบ่งไฟล์ตามช่วงวันที่', v_count USING ERRCODE = '22023';
  END IF;

  -- ล็อกลำดับเดียวกับ payment_sync_licence_dues ก่อน แล้วค่อยล็อกของการนำเข้า — กันนำเข้ากับปรับยอดล็อกยอดสลับลำดับกัน (ผลตรวจ L-3)
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_sync:' || p_municipality_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_bank:' || p_municipality_id::text, 0));

  -- ── ตารางพักแถว: ลบของเดิมที่อาจมีคนสร้างไว้ก่อน (เช่นแนบ trigger) แล้วสร้างใหม่เสมอ (ผลตรวจ L-1) ──
  DROP TABLE IF EXISTS pg_temp.payment_bank_stage;
  CREATE TEMP TABLE payment_bank_stage (
    n integer, txn_at timestamptz, amount numeric(12, 2), ref1_raw text, ref2 text, bank_ref text, k text, err text
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.payment_bank_stage (n, txn_at, amount, ref1_raw, ref2, bank_ref, err)
  SELECT x.n,
         public.payment_try_timestamptz(x.ts),
         CASE WHEN x.amt ~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN x.amt::numeric END,
         nullif(regexp_replace(x.r1, '[\s-]', '', 'g'), ''),
         nullif(regexp_replace(x.r2, '[\s-]', '', 'g'), ''),
         nullif(btrim(x.br), ''),
         CASE
           WHEN jsonb_typeof(x.e) <> 'object' THEN 'ไม่ใช่แถวข้อมูล'
           WHEN public.payment_try_timestamptz(x.ts) IS NULL THEN 'วันเวลาไม่ถูกต้อง (ต้องเป็น ค.ศ. ปี-เดือน-วัน และเป็นวันที่มีจริง)'
           WHEN x.amt IS NULL OR x.amt !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' THEN 'ยอดเงินไม่ถูกรูปแบบ'
           WHEN regexp_replace(x.r1, '[\s-]', '', 'g') !~ '^[0-9]{0,20}$' THEN 'Ref1 ต้องเป็นตัวเลขไม่เกิน 20 หลัก (คอลัมน์จับคู่ผิดหรือเปล่า?)'
           WHEN length(regexp_replace(x.r2, '[\s-]', '', 'g')) > 20 THEN 'Ref2 ยาวเกิน 20 ตัว'
           WHEN btrim(x.br) <> '' AND btrim(x.br) !~ '^[A-Za-z0-9/_.:-]{1,64}$'
             THEN 'เลขอ้างอิงธนาคารต้องเป็นตัวอักษรอังกฤษ/ตัวเลขไม่เกิน 64 ตัว (คอลัมน์จับคู่ผิดหรือเปล่า?)'
         END
    FROM (
      SELECT t.ord::integer AS n, t.e,
             CASE WHEN jsonb_typeof(t.e -> 'txn_at') = 'string' THEN btrim(t.e ->> 'txn_at') END AS ts,
             CASE WHEN jsonb_typeof(t.e -> 'amount') IN ('string', 'number') THEN replace(btrim(t.e ->> 'amount'), ',', '') END AS amt,
             coalesce(CASE WHEN jsonb_typeof(t.e -> 'ref1') IN ('string', 'number') THEN t.e ->> 'ref1' END, '') AS r1,
             coalesce(CASE WHEN jsonb_typeof(t.e -> 'ref2') IN ('string', 'number') THEN t.e ->> 'ref2' END, '') AS r2,
             coalesce(CASE WHEN jsonb_typeof(t.e -> 'bank_ref') IN ('string', 'number') THEN t.e ->> 'bank_ref' END, '') AS br
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(e, ord)
    ) AS x;

  SELECT n, err INTO v_bad FROM pg_temp.payment_bank_stage WHERE err IS NOT NULL ORDER BY n LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'แถวที่ % : % — ไม่ได้นำเข้าทั้งไฟล์ ตรวจการจับคู่คอลัมน์แล้วลองใหม่', v_bad.n, v_bad.err USING ERRCODE = '22023';
  END IF;
  SELECT n INTO v_bad FROM pg_temp.payment_bank_stage WHERE amount <= 0 OR amount > 10000000 ORDER BY n LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'แถวที่ % : ยอดเงินต้องมากกว่า 0 และไม่เกิน 10 ล้านบาท (ไฟล์นี้ควรมีเฉพาะเงินเข้า)', v_bad.n USING ERRCODE = '22023';
  END IF;
  SELECT n INTO v_bad FROM pg_temp.payment_bank_stage
   WHERE (txn_at AT TIME ZONE 'Asia/Bangkok')::date > v_today OR (txn_at AT TIME ZONE 'Asia/Bangkok')::date < v_today - 400
   ORDER BY n LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'แถวที่ % : วันที่ต้องไม่เป็นวันในอนาคต และไม่เก่ากว่า 400 วัน (ปีเป็น พ.ศ. หรือเปล่า?)', v_bad.n USING ERRCODE = '22023';
  END IF;

  -- คีย์กันซ้ำ (ลำดับที่ของแถวที่เหมือนกันทุกช่อง เรียงตามลำดับในไฟล์) — ใช้ค่าดิบทั้ง Ref1/Ref2 แม้ไม่เก็บ
  UPDATE pg_temp.payment_bank_stage AS s
     SET k = z.h || ':' || z.occ
    FROM (
      SELECT n, h, row_number() OVER (PARTITION BY h ORDER BY n) AS occ
        FROM (SELECT n, md5(concat_ws('|', p_file_kind,
                     to_char(txn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), amount::text,
                     coalesce(ref1_raw, ''), coalesce(ref2, ''), coalesce(bank_ref, ''))) AS h
                FROM pg_temp.payment_bank_stage) AS y
    ) AS z
   WHERE z.n = s.n;

  INSERT INTO public.payment_bank_imports (municipality_id, file_kind, file_name, row_count, imported_by)
  VALUES (p_municipality_id, p_file_kind, v_name, v_count, auth.uid())
  RETURNING id INTO v_import;

  WITH ins AS (
    INSERT INTO public.payment_bank_txns (municipality_id, import_id, file_kind, txn_at, txn_date, amount, ref1, ref1_foreign,
                                          bank_ref, line_key)
    SELECT p_municipality_id, v_import, p_file_kind, s.txn_at, (s.txn_at AT TIME ZONE 'Asia/Bangkok')::date, s.amount,
           public.payment_ref1_normalize(s.ref1_raw),
           s.ref1_raw IS NOT NULL AND public.payment_ref1_normalize(s.ref1_raw) IS NULL,
           s.bank_ref, s.k
      FROM pg_temp.payment_bank_stage AS s
     ORDER BY s.n
    ON CONFLICT (municipality_id, line_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  -- ── Bill Payment: Ref1 ตรง → open = จับคู่เอง · evidence = ผูกหลักฐานเอง · reopen = ไม่ทำเอง (คนกด) ──
  IF p_file_kind = 'bill_payment' THEN
    FOR v_txn IN
      SELECT t.id, t.ref1, t.amount, t.txn_date
        FROM public.payment_bank_txns AS t
       WHERE t.import_id = v_import AND t.status = 'unmatched' AND t.ref1 IS NOT NULL
       ORDER BY t.txn_at, t.id
    LOOP
      SELECT d.id INTO v_due_id FROM public.payment_dues AS d
       WHERE d.municipality_id = p_municipality_id AND d.ref1 = v_txn.ref1
       FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      v_mode := public.payment_bank_match_mode(v_due_id, v_txn.txn_date, v_txn.amount);
      IF v_mode = 'open' THEN
        PERFORM public.payment_bank_apply_match(v_txn.id, v_due_id, 'open', 'auto_ref1', 'ระบบจับคู่: Ref1 และยอดเงินตรงกับยอดค้าง');
        v_auto := v_auto + 1;
      ELSIF v_mode = 'evidence' THEN
        PERFORM public.payment_bank_apply_match(v_txn.id, v_due_id, 'evidence', 'auto_ref1',
          'ระบบผูกหลักฐาน: Ref1 และยอดเงินตรงกับรายการรับเงินที่บันทึกเลขใบเสร็จไว้แล้ว (ไม่ใช่เงินซ้ำ)');
        v_evidence := v_evidence + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.payment_bank_imports
     SET inserted_count = v_inserted, duplicate_count = v_count - v_inserted, auto_matched = v_auto + v_evidence
   WHERE id = v_import;
  PERFORM public.payment_log(p_municipality_id, 'bank_import', v_import, 'import',
    jsonb_build_object('file_kind', p_file_kind, 'file_name', v_name, 'rows', v_count, 'inserted', v_inserted,
                       'duplicates', v_count - v_inserted, 'auto_matched', v_auto, 'auto_evidence', v_evidence), NULL);

  RETURN jsonb_build_object('import_id', v_import, 'rows', v_count, 'inserted', v_inserted,
                            'duplicates', v_count - v_inserted, 'auto_matched', v_auto, 'auto_evidence', v_evidence,
                            'unmatched', (SELECT count(*) FROM public.payment_bank_txns WHERE import_id = v_import AND status = 'unmatched'));
END;
$$;
REVOKE ALL ON FUNCTION public.payment_import_bank_rows(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_import_bank_rows(uuid, text, text, jsonb) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 3) รายการเงินเข้า + คู่ที่ระบบเสนอ
-- ══════════════════════════════════════════════════════════════════════════════════
-- candidates (เฉพาะ unmatched) = ยอดที่ payment_bank_match_mode ไม่เป็น NULL และยอดเงินเท่ากัน สูงสุด 5 รายการ
--   ยอดที่บันทึกรับเงินแล้ว (evidence) เสนอเฉพาะที่วันที่รับเงินห่างจากวันเงินเข้าไม่เกิน 7 วัน (ไม่งั้นรายการยาวเกินดู)
--   แต่ละรายการมี mode (open/reopen/evidence) ให้หน้าจอบอกว่ากดแล้วจะเกิดอะไร
-- suggested_due_id = มีคู่เข้าเงื่อนไข "รายการเดียวพอดี" (หลายรายการ = คนเลือก · ไม่มี = เงินที่ยังระบุไม่ได้ ข้อ 9 วรรคห้า)
--   ระบบไม่ผูกเองสักกรณีในรายการนี้ — คนกดยืนยัน
-- hint           เหตุที่ Ref1 ในไฟล์ไม่ถูกจับคู่เอง หรือสิ่งที่ต้องทำต่อ
-- blocked_reason (เฉพาะ matched) ยอดที่จับคู่ไว้บันทึกเลขใบเสร็จไม่ได้แล้วเพราะใบเปลี่ยน — บอกให้ยกเลิกคู่ (ผลตรวจ M-2)
-- maybe_duplicate (เฉพาะไฟล์บัญชี) วันเดียวกัน ยอดเท่ากัน กับรายการจากรายงาน Bill Payment — อาจเป็นเงินก้อนเดียวกัน (ผลตรวจ M-4)
CREATE OR REPLACE FUNCTION public.payment_list_bank_txns(p_municipality_id uuid, p_status text DEFAULT 'unmatched')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text := coalesce(p_status, 'unmatched');
  v_limit  constant integer := 2000;
  v_total  integer;
  v_rows   jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.payment_can_handle(p_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูรายการเงินเข้าของ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('unmatched', 'matched', 'receipted', 'not_ours', 'all') THEN
    RAISE EXCEPTION 'สถานะไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.payment_bank_txns AS t
   WHERE t.municipality_id = p_municipality_id AND (v_status = 'all' OR t.status = v_status);

  SELECT coalesce(jsonb_agg(x.row_data ORDER BY x.rn), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT row_number() OVER (ORDER BY t.txn_at DESC, t.id) AS rn,
             jsonb_build_object(
               'id', t.id, 'file_kind', t.file_kind, 'txn_at', t.txn_at, 'txn_date', t.txn_date, 'amount', t.amount,
               'ref1', t.ref1, 'ref1_foreign', t.ref1_foreign, 'bank_ref', t.bank_ref, 'status', t.status,
               'match_method', t.match_method, 'matched_at', t.matched_at, 'note', t.note,
               'file_name', i.file_name, 'imported_at', i.created_at,
               'due', CASE WHEN d.id IS NOT NULL THEN jsonb_build_object(
                        'id', d.id, 'ref1', d.ref1, 'kind', d.kind, 'due_on', d.due_on, 'amount', d.amount, 'status', d.status,
                        'licence_no', l.licence_no, 'business_name', l.business_name, 'receipt_no', f.receipt_no) END,
               'candidates', coalesce(c.list, '[]'::jsonb),
               'suggested_due_id', CASE WHEN c.n = 1 THEN c.only_id END,
               'hint', CASE
                 WHEN t.status <> 'unmatched' THEN NULL
                 WHEN t.ref1_foreign THEN 'Ref1 ในไฟล์ไม่ใช่รูปแบบของระบบนี้ (อาจเป็นรายได้ประเภทอื่นที่ใช้รหัสผู้รับชำระเดียวกัน)'
                 WHEN t.ref1 IS NULL THEN NULL
                 WHEN hd.id IS NULL THEN 'ไม่พบ Ref1 นี้ในยอดของระบบ'
                 WHEN hd.mode = 'reopen' THEN 'เงินเข้าก่อนวันหมดอายุ แต่ระบบปิดยอดไปแล้วเพราะไฟล์มาช้า — กดยืนยันคู่เพื่อเปิดยอดกลับ'
                 WHEN hd.mode = 'evidence' THEN 'ยอดนี้บันทึกเลขใบเสร็จแล้ว แต่ยังไม่ผูกหลักฐานเงินเข้า — กดยืนยันคู่ (ไม่ใช่เงินซ้ำ)'
                 WHEN hd.mode = 'open' THEN 'จับคู่ได้ — กดยืนยันคู่'
                 WHEN hd.has_txn THEN 'Ref1 นี้มีเงินเข้าผูกไว้แล้ว — อาจจ่ายซ้ำ (คืนเงินตามระเบียบ)'
                 WHEN hd.status = 'paid' THEN 'ยอดของ Ref1 นี้ชำระแล้วด้วยยอดต่างจากเงินเข้า — ตรวจกับกองที่ถือเรื่อง'
                 WHEN hd.status IN ('lapsed', 'cancelled') AND hd.kind = 'renewal' AND t.txn_date > hd.due_on
                   THEN 'เงินเข้าหลังวันหมดอายุของใบ — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้แล้ว (คืนเงินตามระเบียบ)'
                 WHEN hd.status IN ('lapsed', 'cancelled') THEN 'ยอดของ Ref1 นี้ปิดไปแล้ว — ตรวจกับกองที่ถือเรื่อง'
                 WHEN hd.amount <> t.amount THEN 'ยอดเงินไม่เท่ายอดค้าง (' || hd.amount || ' บาท)'
                 WHEN hd.kind = 'renewal' AND t.txn_date > hd.due_on
                   THEN 'เงินเข้าหลังวันหมดอายุของใบ — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้แล้ว (คืนเงินตามระเบียบ)'
               END,
               'blocked_reason', CASE WHEN t.status = 'matched' THEN CASE
                 WHEN l.status IN ('revoked', 'closed') AND d.kind = 'renewal'
                   THEN 'ใบถูกเพิกถอน/เลิกกิจการหลังจับคู่ — ต่ออายุไม่ได้: ยกเลิกคู่แล้วคืนเงินตามระเบียบ'
                 WHEN d.kind = 'renewal' AND NOT lt.renewal_by_fee
                   THEN 'ประเภทนี้ถูกตั้งให้ต่ออายุโดยยื่นคำขอ — ยกเลิกคู่แล้วตรวจกับกองที่ถือเรื่อง'
                 WHEN d.kind = 'renewal' AND d.period_from IS DISTINCT FROM l.expires_on + 1
                   THEN 'วันหมดอายุของใบเปลี่ยนหลังจับคู่ — ยกเลิกคู่แล้วจับคู่กับยอดรอบใหม่'
                 WHEN d.kind = 'annual' AND d.period_from IS DISTINCT FROM l.next_fee_due_on
                   THEN 'วันครบกำหนดค่าธรรมเนียมของใบเปลี่ยนหลังจับคู่ — ยกเลิกคู่แล้วจับคู่กับยอดรอบใหม่'
               END END,
               'maybe_duplicate', t.file_kind = 'account' AND EXISTS (
                 SELECT 1 FROM public.payment_bank_txns AS b
                  WHERE b.municipality_id = t.municipality_id AND b.file_kind = 'bill_payment'
                    AND b.txn_date = t.txn_date AND b.amount = t.amount AND b.status <> 'not_ours')
             ) AS row_data
        FROM public.payment_bank_txns AS t
        JOIN public.payment_bank_imports AS i ON i.id = t.import_id
        LEFT JOIN public.payment_dues AS d ON d.id = t.due_id
        LEFT JOIN public.licences AS l ON l.id = d.licence_id
        LEFT JOIN public.licence_types AS lt ON lt.id = l.licence_type_id
        LEFT JOIN public.licence_fee_payments AS f ON f.id = coalesce(t.payment_id, d.payment_id)
        -- ยอดที่ Ref1 ในไฟล์ชี้ (สำหรับ hint)
        LEFT JOIN LATERAL (
          SELECT hd0.id, hd0.status, hd0.kind, hd0.amount, hd0.due_on,
                 public.payment_bank_match_mode(hd0.id, t.txn_date, t.amount) AS mode,
                 EXISTS (SELECT 1 FROM public.payment_bank_txns AS o WHERE o.due_id = hd0.id AND o.status IN ('matched', 'receipted')) AS has_txn
            FROM public.payment_dues AS hd0
           WHERE t.status = 'unmatched' AND t.ref1 IS NOT NULL
             AND hd0.municipality_id = t.municipality_id AND hd0.ref1 = t.ref1
        ) AS hd ON true
        -- คู่ที่เสนอ
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(z.cand ORDER BY z.ord) FILTER (WHERE z.ord <= 5) AS list,
                 count(*) AS n, (array_agg(z.id))[1] AS only_id
            FROM (
              SELECT cd.id,
                     jsonb_build_object('id', cd.id, 'ref1', cd.ref1, 'kind', cd.kind, 'due_on', cd.due_on, 'amount', cd.amount,
                                        'status', cd.status, 'mode', cd.mode, 'licence_no', cl.licence_no,
                                        'business_name', cl.business_name, 'receipt_no', cf.receipt_no) AS cand,
                     row_number() OVER (ORDER BY (cd.ref1 = t.ref1) DESC NULLS LAST, abs(cd.due_on - t.txn_date), cd.ref1) AS ord
                FROM (
                  SELECT dd.*, public.payment_bank_match_mode(dd.id, t.txn_date, t.amount) AS mode
                    FROM public.payment_dues AS dd
                    LEFT JOIN public.licence_fee_payments AS ff ON ff.id = dd.payment_id
                   WHERE t.status = 'unmatched' AND dd.municipality_id = t.municipality_id
                     AND ((dd.status IN ('open', 'lapsed') AND dd.amount = t.amount)
                          OR (dd.status = 'paid' AND ff.amount = t.amount AND abs(ff.paid_on - t.txn_date) <= 7)
                          OR (dd.ref1 = t.ref1))
                ) AS cd
                JOIN public.licences AS cl ON cl.id = cd.licence_id
                LEFT JOIN public.licence_fee_payments AS cf ON cf.id = cd.payment_id
               WHERE cd.mode IS NOT NULL
            ) AS z
        ) AS c ON true
       WHERE t.municipality_id = p_municipality_id AND (v_status = 'all' OR t.status = v_status)
       ORDER BY t.txn_at DESC, t.id
       LIMIT v_limit
    ) AS x;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'truncated', v_total > v_limit, 'limit', v_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_list_bank_txns(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_list_bank_txns(uuid, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 4) คนยืนยันคู่ / ยกเลิกคู่ / ระบุว่าไม่ใช่เงินของระบบนี้
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.payment_match_bank_txn(p_txn_id uuid, p_due_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_txn    public.payment_bank_txns%ROWTYPE;
  v_due    public.payment_dues%ROWTYPE;
  v_mode   text;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_txn FROM public.payment_bank_txns WHERE id = p_txn_id;
  IF NOT FOUND OR NOT public.payment_can_handle(v_txn.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบรายการเงินเข้า หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payment_module_on(v_txn.municipality_id) THEN
    RAISE EXCEPTION 'เมนูรับชำระเงินยังไม่เปิดสำหรับ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_bank:' || v_txn.municipality_id::text, 0));
  SELECT * INTO v_txn FROM public.payment_bank_txns WHERE id = p_txn_id FOR UPDATE;
  IF v_txn.status <> 'unmatched' THEN
    RAISE EXCEPTION 'รายการเงินเข้านี้ไม่ได้อยู่ในสถานะ "ยังระบุไม่ได้" แล้ว' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_due FROM public.payment_dues WHERE id = p_due_id FOR UPDATE;
  IF NOT FOUND OR v_due.municipality_id <> v_txn.municipality_id THEN
    RAISE EXCEPTION 'ไม่พบยอดค้าง' USING ERRCODE = '22023';
  END IF;
  v_mode := public.payment_bank_match_mode(p_due_id, v_txn.txn_date, v_txn.amount);
  IF v_mode IS NULL THEN
    -- บอกเหตุผลที่ตรงที่สุด (ลำดับเดียวกับกฎ)
    IF EXISTS (SELECT 1 FROM public.payment_bank_txns WHERE due_id = p_due_id AND status IN ('matched', 'receipted')) THEN
      RAISE EXCEPTION 'ยอดนี้จับคู่กับเงินเข้ารายการอื่นแล้ว' USING ERRCODE = '22023';
    ELSIF v_due.status = 'paid' THEN
      RAISE EXCEPTION 'ยอดนี้บันทึกรับเงินด้วยยอดที่ไม่เท่าเงินเข้า (%) — ผูกเป็นหลักฐานไม่ได้', v_txn.amount USING ERRCODE = '22023';
    ELSIF v_due.status = 'open' AND v_due.amount <> v_txn.amount THEN
      RAISE EXCEPTION 'ยอดเงินเข้า (%) ไม่เท่ายอดค้าง (%) — จับคู่ไม่ได้ ถ้ารับเงินจริงให้กองที่ถือเรื่องบันทึกจากเมนูทะเบียนใบอนุญาต (ระบบลงเหตุผลยอดไม่เท่าให้)',
        v_txn.amount, v_due.amount USING ERRCODE = '22023';
    ELSIF v_due.kind = 'renewal' AND v_txn.txn_date > v_due.due_on THEN
      RAISE EXCEPTION 'เงินเข้า (%) หลังวันหมดอายุของใบ (%) — ต่ออายุโดยชำระค่าธรรมเนียมไม่ได้แล้ว ต้องยื่นคำขอใหม่ (พ.ร.ฎ. 2564)',
        v_txn.txn_date, v_due.due_on USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'ยอดนี้ไม่อยู่ในสถานะที่จับคู่ได้ (%)', v_due.status USING ERRCODE = '22023';
    END IF;
  END IF;
  v_status := public.payment_bank_apply_match(p_txn_id, p_due_id, v_mode, 'confirmed', 'เจ้าหน้าที่ยืนยันคู่');
  RETURN jsonb_build_object('txn_id', p_txn_id, 'due_id', p_due_id, 'mode', v_mode, 'status', v_status,
                            'paid_on', v_txn.txn_date, 'amount', v_txn.amount,
                            'channel', CASE v_txn.file_kind WHEN 'bill_payment' THEN 'bill_payment' ELSE 'promptpay' END);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_match_bank_txn(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_match_bank_txn(uuid, uuid) TO authenticated;

-- matched → unmatched (จับคู่ผิด) · not_ours → unmatched (ระบุผิด) — ต้องมีเหตุผลเสมอ
-- receipted แก้ที่นี่ไม่ได้ (ยกเลิกรายการรับเงินที่ทะเบียนก่อน) · ยอดที่ reopen ไว้แล้วไม่ปิดกลับเอง (sync ปิดตามกฎในรอบถัดไป)
CREATE OR REPLACE FUNCTION public.payment_reset_bank_txn(p_txn_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_txn    public.payment_bank_txns%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_txn FROM public.payment_bank_txns WHERE id = p_txn_id;
  IF NOT FOUND OR NOT public.payment_can_handle(v_txn.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบรายการเงินเข้า หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payment_module_on(v_txn.municipality_id) THEN
    RAISE EXCEPTION 'เมนูรับชำระเงินยังไม่เปิดสำหรับ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผล (3–1000 ตัวอักษร)' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_bank:' || v_txn.municipality_id::text, 0));
  SELECT * INTO v_txn FROM public.payment_bank_txns WHERE id = p_txn_id FOR UPDATE;
  IF v_txn.status = 'receipted' THEN
    RAISE EXCEPTION 'ยอดนี้บันทึกเลขใบเสร็จแล้ว — ต้องยกเลิกรายการรับเงินที่ทะเบียนใบอนุญาตก่อน' USING ERRCODE = '22023';
  END IF;
  IF v_txn.status NOT IN ('matched', 'not_ours') THEN
    RAISE EXCEPTION 'รายการนี้ยังไม่ได้จับคู่หรือระบุไว้' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payment_bank_txns
     SET status = 'unmatched', due_id = NULL, match_method = NULL, matched_by = NULL, matched_at = NULL, note = NULL, updated_at = now()
   WHERE id = p_txn_id;
  PERFORM public.payment_log(v_txn.municipality_id, 'bank_txn', p_txn_id, 'unmatch',
    jsonb_build_object('from', v_txn.status, 'due_id', v_txn.due_id, 'method', v_txn.match_method, 'note', v_txn.note), v_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_reset_bank_txn(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_reset_bank_txn(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payment_mark_bank_txn_not_ours(p_txn_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_txn    public.payment_bank_txns%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบ' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_txn FROM public.payment_bank_txns WHERE id = p_txn_id;
  IF NOT FOUND OR NOT public.payment_can_handle(v_txn.municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบรายการเงินเข้า หรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  IF NOT public.payment_module_on(v_txn.municipality_id) THEN
    RAISE EXCEPTION 'เมนูรับชำระเงินยังไม่เปิดสำหรับ อปท. นี้' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผล (3–1000 ตัวอักษร) เช่น "รายได้ค่าเช่าอาคาร ไม่ใช่ค่าธรรมเนียมใบอนุญาต"' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_bank:' || v_txn.municipality_id::text, 0));
  UPDATE public.payment_bank_txns SET status = 'not_ours', note = v_reason, updated_at = now()
   WHERE id = p_txn_id AND status = 'unmatched';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ระบุได้เฉพาะรายการที่ยังไม่ได้จับคู่' USING ERRCODE = '22023';
  END IF;
  PERFORM public.payment_log(v_txn.municipality_id, 'bank_txn', p_txn_id, 'not_ours',
    jsonb_build_object('amount', v_txn.amount, 'txn_date', v_txn.txn_date), v_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_mark_bank_txn_not_ours(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_mark_bank_txn_not_ours(uuid, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 5) trigger บนยอดค้าง — เชื่อมสถานะยอดกับรายการเงินเข้า โดยไม่แก้ฟังก์ชันของ PR1
-- ══════════════════════════════════════════════════════════════════════════════════
-- BEFORE UPDATE (RETURN NULL = ข้ามแถวเงียบๆ · payment_sync_licence_dues ใช้ "CONTINUE WHEN NOT FOUND" ไม่นับ ไม่ลงประวัติ):
--   ก) ยอดที่มีเงินเข้าจับคู่ไว้ (matched)
--      → lapsed  : ข้าม — เงินเข้าแล้ว ห้ามเขียนว่า "ไม่มีการรับเงิน"
--      → amount  : ข้าม — อัตราใหม่ไม่ทับยอดที่ประชาชนจ่ายตามใบแจ้งเดิมมาแล้ว
--      → cancelled (คนกด): ปฏิเสธพร้อมเหตุผล (payment_cancel_due ลงประวัติหลัง UPDATE โดยไม่ตรวจ FOUND จึงข้ามเงียบไม่ได้)
--   ข) ยอดต่ออายุที่เพิ่งพ้นวันหมดอายุ (ใบยังใช้งาน · รอบตรงกับวันหมดอายุของใบ) → lapsed ภายใน 7 วันหลังวันหมดอายุ: ข้าม
--      รอไฟล์ธนาคารของเงินที่จ่ายวันสุดท้าย/ก่อนวันหยุด (ผลตรวจ H-1) — พ้น 7 วันปิดตามเดิม
--      ระหว่าง 7 วันนี้ยอดยังขึ้น "รอชำระ (เลยกำหนด)" แต่รับเงินหลังวันหมดอายุไม่ได้อยู่แล้ว (licence_record_fee ตรวจ paid_on)
CREATE OR REPLACE FUNCTION public.payment_dues_guard_matched()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'open'
     AND (NEW.status IN ('lapsed', 'cancelled') OR (NEW.status = 'open' AND NEW.amount IS DISTINCT FROM OLD.amount))
     AND EXISTS (SELECT 1 FROM public.payment_bank_txns WHERE due_id = OLD.id AND status = 'matched') THEN
    IF NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'ยอดนี้มีเงินเข้าจับคู่ไว้แล้ว — ยกเลิกการจับคู่ที่แท็บ "เงินเข้าจากธนาคาร" ก่อน (ถ้าต้องคืนเงินให้ทำตามระเบียบ)'
        USING ERRCODE = '22023';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'lapsed' AND OLD.kind = 'renewal'
     AND public.licence_today() <= OLD.due_on + 7
     AND EXISTS (SELECT 1 FROM public.licences AS l JOIN public.licence_types AS t ON t.id = l.licence_type_id
                  WHERE l.id = OLD.licence_id AND l.status IN ('active', 'suspended') AND t.renewal_by_fee
                    AND l.expires_on + 1 = OLD.period_from) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_dues_guard_matched() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payment_dues_guard_matched ON public.payment_dues;
CREATE TRIGGER payment_dues_guard_matched BEFORE UPDATE ON public.payment_dues
  FOR EACH ROW EXECUTE FUNCTION public.payment_dues_guard_matched();

-- AFTER UPDATE OF status: ปิดยอดด้วยเลขใบเสร็จ → receipted · ยกเลิกรายการรับเงิน (paid → open) → กลับเป็น matched
--   ลงยอดเงินเข้าเทียบยอดที่บันทึกรับ (บันทึกจากหน้าทะเบียนอาจคนละยอด — ผลตรวจ L-11)
CREATE OR REPLACE FUNCTION public.payment_dues_bank_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_txn    uuid;
  v_amount numeric;
  v_paid   numeric;
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'paid' THEN
    UPDATE public.payment_bank_txns SET status = 'receipted', payment_id = NEW.payment_id, updated_at = now()
     WHERE due_id = NEW.id AND status = 'matched'
    RETURNING id, amount INTO v_txn, v_amount;
    IF FOUND THEN
      SELECT amount INTO v_paid FROM public.licence_fee_payments WHERE id = NEW.payment_id;
      PERFORM public.payment_log(NEW.municipality_id, 'bank_txn', v_txn, 'receipted',
        jsonb_build_object('due_id', NEW.id, 'payment_id', NEW.payment_id, 'txn_amount', v_amount, 'paid_amount', v_paid),
        CASE WHEN v_paid IS DISTINCT FROM v_amount THEN 'ยอดที่บันทึกรับไม่เท่าเงินเข้าจากธนาคาร — ตรวจกับกองที่ถือเรื่อง' END);
    END IF;
  ELSIF OLD.status = 'paid' AND NEW.status = 'open' THEN
    UPDATE public.payment_bank_txns SET status = 'matched', payment_id = NULL, updated_at = now()
     WHERE due_id = NEW.id AND status = 'receipted'
    RETURNING id INTO v_txn;
    IF FOUND THEN
      PERFORM public.payment_log(NEW.municipality_id, 'bank_txn', v_txn, 'unreceipted',
        jsonb_build_object('due_id', NEW.id, 'payment_id', OLD.payment_id), 'รายการรับเงินถูกยกเลิก — เงินเข้ายังผูกกับยอดเดิม รอเลขใบเสร็จใหม่');
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_dues_bank_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payment_dues_bank_status ON public.payment_dues;
CREATE TRIGGER payment_dues_bank_status AFTER UPDATE OF status ON public.payment_dues
  FOR EACH ROW EXECUTE FUNCTION public.payment_dues_bank_status();

-- BEFORE DELETE (ใบถูกลบจากทะเบียน → ยอดหายตาม): คืนเงินเข้าที่จับคู่ไว้เป็น "ยังระบุไม่ได้" ก่อน FK SET NULL ชน CHECK
CREATE OR REPLACE FUNCTION public.payment_dues_release_bank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_txn uuid;
BEGIN
  FOR v_txn IN
    UPDATE public.payment_bank_txns
       SET status = 'unmatched', due_id = NULL, match_method = NULL, matched_by = NULL, matched_at = NULL, updated_at = now()
     WHERE due_id = OLD.id AND status = 'matched'
    RETURNING id
  LOOP
    -- อปท. ถูกลบทั้งแถว (cascade) → ไม่ลงประวัติ (แบบเดียวกับ payment_dues_on_delete)
    IF EXISTS (SELECT 1 FROM public.municipalities WHERE id = OLD.municipality_id) THEN
      PERFORM public.payment_log(OLD.municipality_id, 'bank_txn', v_txn, 'unmatch',
        jsonb_build_object('due_id', OLD.id, 'ref1', OLD.ref1), 'ยอดถูกลบเพราะใบถูกลบจากทะเบียน — เงินเข้ากลับเป็นรายการที่ยังระบุไม่ได้');
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_dues_release_bank() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payment_dues_release_bank ON public.payment_dues;
CREATE TRIGGER payment_dues_release_bank BEFORE DELETE ON public.payment_dues
  FOR EACH ROW EXECUTE FUNCTION public.payment_dues_release_bank();

-- ══════════════════════════════════════════════════════════════════════════════════
-- 6) คิวแจ้ง Telegram เมื่อบัญชีรับเงินเปลี่ยน
-- ══════════════════════════════════════════════════════════════════════════════════
-- เติมคิวจากประวัติ account_change (payment_settings_log ของ PR1 เขียนเองทุกครั้งที่บัญชีปลายทางเปลี่ยน รวมตั้งครั้งแรก)
-- ไม่เติมย้อนหลัง: เหตุการณ์ก่อนไฟล์นี้ไม่ถูกส่ง (กันส่งของเก่าทีเดียวทั้งก้อน)
CREATE OR REPLACE FUNCTION public.payment_events_alert_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.payment_account_alerts (event_id, municipality_id) VALUES (NEW.id, NEW.municipality_id)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_events_alert_enqueue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payment_events_alert_enqueue ON public.payment_events;
CREATE TRIGGER payment_events_alert_enqueue AFTER INSERT ON public.payment_events
  FOR EACH ROW WHEN (NEW.action = 'account_change' AND NEW.entity = 'settings')
  EXECUTE FUNCTION public.payment_events_alert_enqueue();

-- ปิดบังเลขบัญชีในข้อความ (เหลือ 4 ตัวท้าย) — ชื่อธนาคาร/ชื่อบัญชีหน่วยงานไม่ปิด
CREATE OR REPLACE FUNCTION public.payment_mask_account(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN p_value IS NULL OR p_value = '' THEN NULL
              WHEN length(p_value) <= 4 THEN '••••'
              ELSE '••••' || right(p_value, 4) END;
$$;
REVOKE ALL ON FUNCTION public.payment_mask_account(text) FROM PUBLIC, anon, authenticated;

-- จองคิวที่ถึงรอบส่ง + เนื้อหาที่ต้องใช้ (service_role เท่านั้น — Edge Function payment-account-alert)
--   ถึงรอบ: pending · failed ที่ลองไม่ถึง 6 ครั้งและห่างครั้งก่อน ≥ 10 นาที · sending ค้างเกิน 10 นาที (ฟังก์ชันตายกลางทาง)
--   sending ที่ลองครบ 6 ครั้งแล้วค้าง → failed ถาวร (ไม่ค้าง sending ตลอดไป — ผลตรวจ L-7)
--   ผู้รับส่วนตัว = ผู้บริหาร (exec_digest_eligible: viewer + ตำแหน่ง top_admin ของ อปท.) + หัวหน้ากองคลังที่ตั้งไว้ในค่ารับเงิน
--   ที่ผูก Telegram ส่วนตัวแล้ว — ไม่เคารพ dm_muted (กันแอบเปลี่ยนบัญชี ผู้บริหารปิดรับไม่ได้ แบบเดียวกับ exec_nudge)
CREATE OR REPLACE FUNCTION public.payment_alert_claim(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'เรียกได้จากงานเบื้องหลังเท่านั้น' USING ERRCODE = '42501';
  END IF;
  UPDATE public.payment_account_alerts
     SET status = 'failed', last_error = coalesce(last_error, 'หยุดลองหลัง 6 ครั้ง (ค้างระหว่างส่ง)')
   WHERE status = 'sending' AND attempts >= 6 AND claimed_at < now() - interval '10 minutes';

  WITH picked AS (
    SELECT a.event_id FROM public.payment_account_alerts AS a
     WHERE a.status = 'pending'
        OR (a.status IN ('failed', 'sending') AND a.attempts < 6 AND a.claimed_at < now() - interval '10 minutes')
     ORDER BY a.event_id
     LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.payment_account_alerts AS a
       SET status = 'sending', attempts = a.attempts + 1, claimed_at = now()
      FROM picked WHERE a.event_id = picked.event_id
    RETURNING a.event_id, a.municipality_id, a.attempts
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'event_id', c.event_id,
           'attempt', c.attempts,
           'changed_at', e.created_at,
           'municipality_name', m.name,
           'telegram_group_id', m.telegram_group_id::text,
           -- ตั้งครั้งแรก = ไม่มีประวัติค่าตั้งของ อปท. นี้ก่อนเหตุการณ์นี้ (ดูจากรูป changes ไม่ได้ — elaas_invoice_sources เป็น array อยู่แล้ว)
           'first_setup', NOT EXISTS (SELECT 1 FROM public.payment_events AS pe
                                       WHERE pe.municipality_id = e.municipality_id AND pe.entity = 'settings' AND pe.id < e.id),
           'actor_name', coalesce(nullif(btrim(ap.full_name), ''), CASE WHEN e.actor IS NULL THEN 'ระบบ' ELSE 'ไม่ทราบชื่อ' END),
           'actor_title', nullif(btrim(ap.job_title), ''),
           'fields', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'field', f.k,
                      'old', CASE WHEN jsonb_typeof(e.changes -> f.k) = 'array'
                                  THEN CASE WHEN f.k IN ('promptpay_id', 'biller_id')
                                            THEN public.payment_mask_account(e.changes -> f.k ->> 0) ELSE e.changes -> f.k ->> 0 END END,
                      'new', CASE WHEN f.k IN ('promptpay_id', 'biller_id')
                                  THEN public.payment_mask_account(CASE WHEN jsonb_typeof(e.changes -> f.k) = 'array'
                                                                        THEN e.changes -> f.k ->> 1 ELSE e.changes ->> f.k END)
                                  ELSE CASE WHEN jsonb_typeof(e.changes -> f.k) = 'array' THEN e.changes -> f.k ->> 1 ELSE e.changes ->> f.k END END)
                    ORDER BY f.ord)
               FROM (VALUES ('promptpay_id', 1), ('biller_id', 2), ('bank_name', 3), ('payee_name', 4)) AS f(k, ord)
              WHERE e.changes ? f.k), '[]'::jsonb),
           'dm_chat_ids', coalesce((
             SELECT jsonb_agg(DISTINCT tl.chat_id::text)
               FROM public.profiles AS rp
               JOIN public.telegram_user_links AS tl ON tl.user_id = rp.id
              WHERE rp.municipality_id = c.municipality_id
                AND rp.role <> 'superadmin'
                AND (public.exec_digest_eligible(rp.id, c.municipality_id)
                     OR (rp.is_dept_head IS TRUE AND rp.role IN ('officer', 'staff', 'admin')
                         AND rp.department_id IS NOT NULL
                         AND rp.department_id = (SELECT s.finance_department_id FROM public.payment_settings AS s
                                                  WHERE s.municipality_id = c.municipality_id)))), '[]'::jsonb)
         ) ORDER BY c.event_id), '[]'::jsonb)
    INTO v_out
    FROM claimed AS c
    JOIN public.payment_events AS e ON e.id = c.event_id
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    LEFT JOIN public.profiles AS ap ON ap.id = e.actor;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_alert_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_alert_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.payment_alert_finish(p_event_id bigint, p_status text, p_note text, p_error text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'เรียกได้จากงานเบื้องหลังเท่านั้น' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'สถานะไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payment_account_alerts
     SET status = p_status,
         sent_at = CASE WHEN p_status = 'sent' THEN now() END,
         delivery_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500),
         last_error = CASE WHEN p_status = 'failed' THEN left(coalesce(nullif(btrim(p_error), ''), 'ส่งไม่สำเร็จ'), 500) END
   WHERE event_id = p_event_id AND status = 'sending';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_alert_finish(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_alert_finish(bigint, text, text, text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 7) ห้องผู้บริหาร: exec_summary_payment — ตัวเลขรวมเท่านั้น (ไม่มีชื่อร้าน/ผู้ประกอบการ/Ref1)
-- ══════════════════════════════════════════════════════════════════════════════════
-- สูตร (ตรงกับ formula ใน src/lib/executiveRegistry.js):
--   open             ยอดสถานะรอชำระทั้งหมด (จำนวน/บาท) — ไม่ขึ้นกับช่วงวันที่
--   overdue          รอชำระ และวันครบกำหนด (due_on) < วันนี้ (รวมยอดต่ออายุที่ระบบรอไฟล์ธนาคาร 7 วันหลังหมดอายุ)
--   paid             รายการรับเงินที่ปิดยอด (ไม่ถูกยกเลิก) วันที่รับเงิน (paid_on) อยู่ในช่วง — ยอดค่าธรรมเนียม ไม่รวมค่าปรับ
--   lapsed           ยอดที่ระบบปิดเป็น "ชำระไม่ได้แล้วตามกฎ" ในช่วง (ไม่ใช่การยกหนี้)
--   bank_unmatched   เงินเข้าจากไฟล์ธนาคารที่ยังระบุไม่ได้ (ข้อ 9 วรรคห้า) ทั้งหมด + วันที่เก่าสุด
--   awaiting_receipt เงินเข้าที่จับคู่แล้วรอเลขใบเสร็จ + จำนวนที่เงินเข้าก่อนวันนี้ (ข้อ 11: ลง e-LAAS ภายในวันที่ได้รับเงิน)
--   not_ours         เงินเข้าที่เจ้าหน้าที่ระบุว่า "ไม่ใช่เงินของระบบนี้" ในช่วง (ดุลพินิจของคน — ให้ผู้ตรวจเห็น · ผลตรวจ L-12)
--   account_changed_at บัญชีรับเงินเปลี่ยนภายใน 30 วัน (ไม่งั้น null)
CREATE OR REPLACE FUNCTION public.exec_summary_payment(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date;
  v_out   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  v_today := public.licence_today();

  SELECT jsonb_build_object(
    'configured', EXISTS (SELECT 1 FROM public.payment_settings AS s WHERE s.municipality_id = _municipality_id),
    'open', (SELECT jsonb_build_object('n', count(*), 'amount', coalesce(sum(d.amount), 0))
               FROM public.payment_dues AS d WHERE d.municipality_id = _municipality_id AND d.status = 'open'),
    'overdue', (SELECT jsonb_build_object('n', count(*), 'amount', coalesce(sum(d.amount), 0))
                  FROM public.payment_dues AS d
                 WHERE d.municipality_id = _municipality_id AND d.status = 'open' AND d.due_on < v_today),
    'paid', (SELECT jsonb_build_object('n', count(*), 'amount', coalesce(sum(f.amount), 0))
               FROM public.payment_dues AS d
               JOIN public.licence_fee_payments AS f ON f.id = d.payment_id
              WHERE d.municipality_id = _municipality_id AND d.status = 'paid' AND f.voided_at IS NULL
                AND f.paid_on BETWEEN _from AND _to),
    'lapsed', (SELECT count(*) FROM public.payment_dues AS d
                WHERE d.municipality_id = _municipality_id AND d.status = 'lapsed'
                  AND (d.closed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN _from AND _to),
    'bank_unmatched', (SELECT jsonb_build_object('n', count(*), 'amount', coalesce(sum(t.amount), 0), 'oldest', min(t.txn_date))
                         FROM public.payment_bank_txns AS t
                        WHERE t.municipality_id = _municipality_id AND t.status = 'unmatched'),
    'awaiting_receipt', (SELECT jsonb_build_object('n', count(*), 'amount', coalesce(sum(t.amount), 0), 'oldest', min(t.txn_date),
                                                   'late', count(*) FILTER (WHERE t.txn_date < v_today))
                           FROM public.payment_bank_txns AS t
                          WHERE t.municipality_id = _municipality_id AND t.status = 'matched'),
    'not_ours', (SELECT jsonb_build_object('n', count(*), 'amount', coalesce(sum(t.amount), 0))
                   FROM public.payment_bank_txns AS t
                  WHERE t.municipality_id = _municipality_id AND t.status = 'not_ours'
                    AND (t.updated_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN _from AND _to),
    'account_changed_at', (SELECT s.account_changed_at FROM public.payment_settings AS s
                            WHERE s.municipality_id = _municipality_id AND s.account_changed_at > now() - interval '30 days')
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.exec_summary_payment(uuid, date, date) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.exec_summary_payment(uuid, date, date) IS
  'ห้องผู้บริหาร: ยอดค้าง/รับแล้ว/เลยกำหนด/เงินเข้าที่ยังระบุไม่ได้/รอเลขใบเสร็จ/ระบุว่าไม่ใช่ของระบบ/บัญชีเปลี่ยน — ตัวเลขรวมเท่านั้น เรียกผ่าน executive_overview';

-- ── policy อ่านอย่างเดียว (ชุดเดียวกับ PR1) — คิวแจ้งเตือนให้ผู้ดูแลเห็นผลส่ง (ไม่มี chat id) ──────────────
DO $policies$
DECLARE
  t text;
  m text := '((SELECT public.licence_is_superadmin()) OR municipality_id = (SELECT public.payment_handled_municipality_id()))';
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_bank_imports', 'payment_bank_txns', 'payment_account_alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING %s', t || '_select', t, m);
  END LOOP;
END $policies$;

REVOKE ALL ON public.payment_bank_imports, public.payment_bank_txns, public.payment_account_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_bank_imports, public.payment_bank_txns, public.payment_account_alerts TO authenticated;

-- ── ด่านตรวจท้ายไฟล์ ─────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  t text;
  f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_bank_imports', 'payment_bank_txns', 'payment_account_alerts'] LOOP
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
  -- ผู้ใช้เรียกได้ (authenticated) แต่ anon ไม่ได้
  FOREACH f IN ARRAY ARRAY[
    'public.payment_save_bank_mapping(uuid, text, jsonb)', 'public.payment_import_bank_rows(uuid, text, text, jsonb)',
    'public.payment_list_bank_txns(uuid, text)', 'public.payment_match_bank_txn(uuid, uuid)',
    'public.payment_reset_bank_txn(uuid, text)', 'public.payment_mark_bank_txn_not_ours(uuid, text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'สิทธิ์ EXECUTE ของ % ไม่ถูกต้อง', f;
    END IF;
  END LOOP;
  -- ภายใน/งานเบื้องหลังเท่านั้น — ผู้ใช้เรียกตรงไม่ได้
  FOREACH f IN ARRAY ARRAY[
    'public.payment_alert_claim(integer)', 'public.payment_alert_finish(bigint, text, text, text)',
    'public.exec_summary_payment(uuid, date, date)', 'public.payment_mask_account(text)',
    'public.payment_ref1_normalize(text)', 'public.payment_try_timestamptz(text)',
    'public.payment_bank_match_mode(uuid, date, numeric)', 'public.payment_bank_apply_match(uuid, uuid, text, text, text)',
    'public.payment_dues_guard_matched()', 'public.payment_dues_bank_status()', 'public.payment_dues_release_bank()',
    'public.payment_events_alert_enqueue()'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'สิทธิ์ EXECUTE ของ % หลุดถึงผู้ใช้', f;
    END IF;
  END LOOP;
  -- exec_summary_payment ต้องเจ้าของเดียวกับ executive_overview ไม่งั้นตัวรวบไม่เรียก (unknown_key)
  IF (SELECT proowner FROM pg_proc WHERE oid = 'public.exec_summary_payment(uuid,date,date)'::regprocedure)
     <> (SELECT proowner FROM pg_proc WHERE oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure) THEN
    RAISE EXCEPTION 'exec_summary_payment เจ้าของไม่ตรงกับ executive_overview — ต้องรันด้วยบัญชีเดียวกับไฟล์ห้องผู้บริหาร';
  END IF;
  -- เจ้าของ payment_alert_claim ต้องเรียก exec_digest_eligible ได้ (ฟังก์ชันนั้นถอนสิทธิ์ทุก role ไว้ — ผลตรวจ L-7)
  IF NOT has_function_privilege((SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.payment_alert_claim(integer)'::regprocedure),
                                'public.exec_digest_eligible(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'เจ้าของ payment_alert_claim เรียก exec_digest_eligible ไม่ได้ — ผู้รับส่วนตัวจะว่างทุกครั้ง';
  END IF;
END $check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
