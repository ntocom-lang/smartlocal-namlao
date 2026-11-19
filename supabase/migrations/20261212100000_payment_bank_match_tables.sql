-- 20261212100000_payment_bank_match_tables.sql
-- ขั้น 1C (E4) รับชำระเงิน PR2 ไฟล์ 1/3 — ตารางนำเข้าไฟล์ธนาคาร + จับคู่ยอด · คิวแจ้งเปลี่ยนบัญชีรับเงิน (Telegram)
--
-- ทำไม (ระเบียบ มท. ว่าด้วยการรับเงินฯ ของ อปท. พ.ศ. 2566 — ฉบับรวบรวม ทม.ดอนสัก ต้องยืนยันกับราชกิจจาฯ ต้นฉบับ):
--   ข้อ 9 วรรคห้า  ได้รับเงินที่ยังตรวจไม่ได้ว่าเป็นรายการใด ให้ออกใบเสร็จเมื่อตรวจได้  ⇒ เงินเข้าแต่ยังไม่ระบุยอด = สถานะ unmatched
--   ข้อ 11 / 13   ลง e-LAAS ภายในวันที่ได้รับเงิน · ตรวจยอดกับรายงานจากระบบอิเล็กทรอนิกส์ประจำวัน ⇒ ไฟล์ธนาคารเป็นหลักฐานฝั่งเงินเข้า
--   ระบบนี้ "ไม่ออกใบเสร็จ" — จับคู่แล้วยอดยังรอชำระจนกองที่ถือเรื่อง/กองคลังกรอกเลขใบเสร็จ e-LAAS (payment_record_receipt เดิม)
--
-- ตารางใหม่
--   payment_bank_imports   รอบนำเข้าไฟล์ (ชื่อไฟล์ จำนวนแถว ผล) — ไม่มีทางลบ
--   payment_bank_txns      รายการเงินเข้าที่นำเข้า: วันเวลา ยอด Ref1 (เฉพาะรูปแบบของระบบนี้) เลขอ้างอิงธนาคาร
--                          ไม่เก็บชื่อ/เลขบัญชีผู้โอน · ไม่เก็บ Ref2 · Ref1 ของบริการอื่น (อาจเป็นเลขบัตรประชาชน) ไม่เก็บ เก็บแค่ธง ref1_foreign
--                          (PDPA เก็บเท่าที่จำเป็น — เจ้าของตัดสิน 2026-11-18 + ผลตรวจ M-3 · ตารางนี้ไม่มีทางลบ)
--   payment_account_alerts คิวแจ้ง Telegram เมื่อบัญชีรับเงินเปลี่ยน (1 แถวต่อเหตุการณ์ account_change ใน payment_events)
-- คอลัมน์ใหม่
--   payment_settings.bank_file_mapping  การจับคู่คอลัมน์ของไฟล์ธนาคาร ตั้งครั้งเดียวต่อ อปท. ต่อชนิดไฟล์
-- แก้ CHECK ของ payment_events ให้รับประวัติของรายการเงินเข้า (entity bank_import / bank_txn)
--
-- ไฟล์นี้มีแต่ DDL (NOTES: ADD COLUMN/CREATE TABLE แยกไฟล์จากโค้ดที่อ้างถึง) — ฟังก์ชัน/สิทธิ์/trigger อยู่ไฟล์ 2
-- ย้อนกลับ: ไฟล์ 3 → 2 ก่อน แล้ว DROP TABLE payment_account_alerts, payment_bank_txns, payment_bank_imports;
--           ALTER TABLE payment_settings DROP COLUMN bank_file_mapping; แล้วคืน CHECK ของ payment_events เป็นรายการเดิม
--           (ต้องลบแถว payment_events ที่ entity ใหม่ก่อน — export เก็บไว้ถ้าใช้งานจริงแล้ว)

BEGIN;

-- ไม่รอล็อกนานเกิน 5 วินาที (ไฟล์นี้ถือ ACCESS EXCLUSIVE บน payment_events/payment_settings — ผลตรวจ L-6)
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.payment_settings') IS NULL OR to_regclass('public.payment_dues') IS NULL
     OR to_regclass('public.payment_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261211100000_payment_dues_tables.sql และ 20261211100100 ก่อน (ไม่พบตารางรับชำระเงิน)';
  END IF;
  IF to_regprocedure('public.payment_can_handle(uuid)') IS NULL OR to_regprocedure('public.payment_log(uuid, text, uuid, text, jsonb, text)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261211100100_payment_dues_rls_rpc.sql ก่อน (ไม่พบฟังก์ชันรับชำระเงิน)';
  END IF;
  -- CHECK เดิมของ payment_events ต้องเป็นชื่อมาตรฐานที่ไฟล์นี้จะแทน (ไม่ตรง = มีคนแก้ไปแล้ว หยุดก่อน)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payment_events'::regclass AND conname = 'payment_events_entity_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payment_events'::regclass AND conname = 'payment_events_action_check') THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ CHECK payment_events_entity_check / payment_events_action_check ตามชื่อเดิม — ตรวจ \d payment_events ก่อน';
  END IF;
END $guard$;

-- ── การจับคู่คอลัมน์ไฟล์ธนาคาร (ไม่ใช่ความลับ ไม่ใช่ข้อมูลส่วนบุคคล — ตำแหน่ง/ชื่อหัวคอลัมน์เท่านั้น) ───────────────
ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS bank_file_mapping jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_settings_bank_file_mapping_shape') THEN
    ALTER TABLE public.payment_settings ADD CONSTRAINT payment_settings_bank_file_mapping_shape
      CHECK (jsonb_typeof(bank_file_mapping) = 'object' AND length(bank_file_mapping::text) <= 4000);
  END IF;
END $c$;

-- ── รอบนำเข้า ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_bank_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- bill_payment = รายงานรับชำระ Bill Payment ของธนาคาร (มี Ref1) · account = รายการเงินเข้าบัญชี (พร้อมเพย์/โอน — ไม่มี Ref)
  file_kind        text NOT NULL CHECK (file_kind IN ('bill_payment', 'account')),
  file_name        text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  row_count        integer NOT NULL CHECK (row_count BETWEEN 0 AND 5000),
  inserted_count   integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count  integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  auto_matched     integer NOT NULL DEFAULT 0 CHECK (auto_matched >= 0),
  imported_by      uuid,                     -- ไม่ใส่ FK: ประวัติต้องอยู่ต่อแม้ลบบัญชีผู้นำเข้า
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_bank_imports_muni_idx ON public.payment_bank_imports (municipality_id, created_at DESC);

-- ── รายการเงินเข้า ─────────────────────────────────────────────────────────────────────
-- สถานะ: unmatched (ยังระบุไม่ได้ — ข้อ 9 วรรคห้า) → matched (ผูกกับยอดแล้ว รอเลขใบเสร็จ) → receipted (ยอดปิดด้วยเลขใบเสร็จแล้ว)
--        not_ours (คนระบุว่าไม่ใช่เงินของบริการในระบบนี้ เช่น รายได้อื่น — ต้องมีเหตุผล ไม่ใช่การยกหนี้)
CREATE TABLE IF NOT EXISTS public.payment_bank_txns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  import_id        uuid NOT NULL REFERENCES public.payment_bank_imports(id) ON DELETE RESTRICT,
  file_kind        text NOT NULL CHECK (file_kind IN ('bill_payment', 'account')),
  txn_at           timestamptz NOT NULL,
  txn_date         date NOT NULL,            -- วันที่เงินเข้าตามเวลาไทย = paid_on ที่จะใช้ตอนบันทึกเลขใบเสร็จ
  amount           numeric(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  -- Ref1 เก็บเฉพาะรูปแบบของระบบนี้ (12 หลัก + หลักตรวจ Luhn ตามที่ payment_new_ref1 ออก) — อย่างอื่นเป็น NULL + ref1_foreign
  ref1             text CHECK (ref1 IS NULL OR ref1 ~ '^[0-9]{12}$'),
  ref1_foreign     boolean NOT NULL DEFAULT false,      -- ไฟล์มี Ref1 แต่ไม่ใช่ของระบบนี้ (เช่น ภาษีที่ใช้ Biller ID เดียวกัน)
  -- เลขอ้างอิงรายการของธนาคาร: ตัวอักษรละติน/ตัวเลข/สัญลักษณ์คั่นเท่านั้น (กันชื่อคนหลุดมาจากคอลัมน์ที่จับคู่ผิด)
  bank_ref         text CHECK (bank_ref IS NULL OR bank_ref ~ '^[A-Za-z0-9/_.:-]{1,64}$'),
  line_key         text NOT NULL CHECK (line_key ~ '^[0-9a-f]{32}:[0-9]{1,4}$'),   -- กันนำเข้าซ้ำ (ดูไฟล์ 2 — Ref2 อยู่ในแฮชเท่านั้น)
  status           text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'receipted', 'not_ours')),
  due_id           uuid REFERENCES public.payment_dues(id) ON DELETE SET NULL,
  match_method     text CHECK (match_method IS NULL OR match_method IN ('auto_ref1', 'confirmed')),
  matched_by       uuid,                     -- NULL + auto_ref1 = ระบบจับคู่เอง (Ref1 และยอดตรง)
  matched_at       timestamptz,
  payment_id       uuid REFERENCES public.licence_fee_payments(id) ON DELETE RESTRICT,
  note             text CHECK (note IS NULL OR length(note) <= 1000),     -- เหตุผล not_ours
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_bank_txns_matched_has_due CHECK (status NOT IN ('matched', 'receipted') OR (due_id IS NOT NULL AND matched_at IS NOT NULL)),
  CONSTRAINT payment_bank_txns_receipted_has_payment CHECK (status <> 'receipted' OR payment_id IS NOT NULL),
  CONSTRAINT payment_bank_txns_unmatched_clean CHECK (status <> 'unmatched' OR (due_id IS NULL AND payment_id IS NULL)),
  CONSTRAINT payment_bank_txns_not_ours_reason CHECK (status <> 'not_ours' OR note IS NOT NULL),
  CONSTRAINT payment_bank_txns_foreign_no_ref1 CHECK (NOT ref1_foreign OR ref1 IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_bank_txns_line_unique ON public.payment_bank_txns (municipality_id, line_key);
-- ยอดหนึ่งผูกเงินเข้าได้รายการเดียว (จ่ายซ้ำ = รายการที่สองค้าง unmatched ให้คนเห็น)
CREATE UNIQUE INDEX IF NOT EXISTS payment_bank_txns_one_per_due ON public.payment_bank_txns (due_id) WHERE status IN ('matched', 'receipted');
CREATE INDEX IF NOT EXISTS payment_bank_txns_muni_status_idx ON public.payment_bank_txns (municipality_id, status, txn_date);
CREATE INDEX IF NOT EXISTS payment_bank_txns_import_idx ON public.payment_bank_txns (import_id);
-- ป้าย "อาจซ้ำกับ Bill Payment" เทียบวัน+ยอดของรายการ Bill Payment (ผลตรวจรอบ 2 M-2)
CREATE INDEX IF NOT EXISTS payment_bank_txns_bill_day_amount_idx
  ON public.payment_bank_txns (municipality_id, txn_date, amount) WHERE file_kind = 'bill_payment';
-- คู่ที่เสนอ: ยอดรอชำระ/ปิดแล้วที่จำนวนเงินเท่ากัน (ผลตรวจรอบ 2 M-2)
CREATE INDEX IF NOT EXISTS payment_dues_muni_amount_idx
  ON public.payment_dues (municipality_id, amount) WHERE status IN ('open', 'lapsed');
-- FK ON DELETE SET NULL ใช้ดัชนีบางส่วนข้างบนไม่ได้ (ผลตรวจ L-4)
CREATE INDEX IF NOT EXISTS payment_bank_txns_due_idx ON public.payment_bank_txns (due_id) WHERE due_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_bank_txns_payment_idx ON public.payment_bank_txns (payment_id) WHERE payment_id IS NOT NULL;

-- ── คิวแจ้งเปลี่ยนบัญชีรับเงิน (outbox — Edge Function payment-account-alert อ่านด้วย service_role) ─────────
CREATE TABLE IF NOT EXISTS public.payment_account_alerts (
  event_id         bigint PRIMARY KEY REFERENCES public.payment_events(id) ON DELETE CASCADE,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  claimed_at       timestamptz,
  sent_at          timestamptz,
  delivery_note    text CHECK (delivery_note IS NULL OR length(delivery_note) <= 500),  -- "กลุ่ม ✓ · ส่วนตัว 2/3" — ไม่มี chat id
  last_error       text CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_account_alerts_status_idx ON public.payment_account_alerts (status, claimed_at);

-- ── ประวัติ: รับ entity/action ของรายการเงินเข้า ────────────────────────────────────────────
ALTER TABLE public.payment_events DROP CONSTRAINT payment_events_entity_check;
ALTER TABLE public.payment_events ADD CONSTRAINT payment_events_entity_check
  CHECK (entity IN ('settings', 'due', 'bank_import', 'bank_txn'));
ALTER TABLE public.payment_events DROP CONSTRAINT payment_events_action_check;
ALTER TABLE public.payment_events ADD CONSTRAINT payment_events_action_check
  CHECK (action IN ('insert', 'update', 'account_change', 'paid', 'reopen', 'lapse', 'cancel',
                    'import', 'match', 'unmatch', 'not_ours', 'receipted', 'unreceipted'));

ALTER TABLE public.payment_bank_imports   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_bank_txns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_account_alerts ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL (ไม่ไล่รายสิทธิ์) — ครอบ MAINTAIN ของ PG17 ด้วย (ผลตรวจ L-5)
REVOKE ALL ON public.payment_bank_imports, public.payment_bank_txns, public.payment_account_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_bank_imports, public.payment_bank_txns, public.payment_account_alerts TO authenticated;

COMMENT ON TABLE public.payment_bank_imports IS 'รับชำระเงิน: รอบนำเข้าไฟล์ธนาคาร — เขียนผ่าน payment_import_bank_rows() เท่านั้น';
COMMENT ON TABLE public.payment_bank_txns IS 'รายการเงินเข้าจากไฟล์ธนาคาร (ไม่เก็บชื่อ/เลขบัญชีผู้โอน) · จับคู่กับยอดค้าง — ระบบไม่ออกใบเสร็จ ไม่ยกหนี้';
COMMENT ON TABLE public.payment_account_alerts IS 'คิวแจ้ง Telegram เมื่อบัญชีรับเงินเปลี่ยน — trigger เติม · Edge Function payment-account-alert ส่ง';
COMMENT ON COLUMN public.payment_settings.bank_file_mapping IS
  'การจับคู่คอลัมน์ไฟล์ธนาคาร {bill_payment:{...}, account:{...}} — หน้าเว็บใช้อ่านไฟล์ ตั้งผ่าน payment_save_bank_mapping()';

COMMIT;
