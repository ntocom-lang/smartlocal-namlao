-- 20261211100000_payment_dues_tables.sql
-- ขั้น 1C (E4) ยอดค้าง–ชำระ PR1 ไฟล์ 1/2 — ตารางใหม่ 3 ตาราง (RLS เปิด ยังไม่มี policy = ปฏิเสธทุกคน จนกว่าไฟล์ 2 วางสิทธิ์)
--   เจ้าของระบบอนุมัติ 2569-11-18 "ตามแนะนำทั้งหมด" (แผน cityvariety ข้อ 0.5 + แผน 1C):
--     C1 ตั้งค่ารับเงินราย อปท. · C2 ยอดค้างกลาง · C3 ใบแจ้งชำระ + QR · C5 ใส่เลขใบเสร็จ e-LAAS → ต่ออายุให้เอง
--     นำร่องค่าธรรมเนียมใบอนุญาตก่อน · กองที่ถือเรื่องกรอกเลขใบเสร็จ + ตัวเลือกให้กองคลังกรอกได้ · ไม่รับสลิป
--   ตัวบทที่ใช้ออกแบบ (ระเบียบ มท. ว่าด้วยการรับเงิน … ของ อปท. พ.ศ. ๒๕๖๖ — ฉบับรวบรวม ทม.ดอนสัก ต้องยืนยันกับราชกิจจาฯ):
--     ข้อ ๙ วรรคสาม รับผ่านระบบอิเล็กทรอนิกส์ของสถาบันการเงิน (คิวอาร์โค้ด บาร์โค้ด ฯลฯ)
--     ข้อ ๙ วรรคห้า เงินที่ยังตรวจไม่ได้ว่าเป็นรายการใด ออกใบเสร็จเมื่อตรวจได้ ⇒ "ยอดค้าง" แยกจาก "การรับเงิน"
--     ข้อ ๑๔ ใบเสร็จออกโดยหน่วยงานคลัง/e-LAAS ⇒ ระบบนี้ไม่ออกใบเสร็จ เก็บแค่เลขที่ใบเสร็จที่เจ้าหน้าที่กรอก
--
--   payment_settings  ค่าตั้งรับเงินราย อปท. (ช่องทาง · บัญชีปลายทาง · บริการไหนรับช่องไหน) — 1 แถว/อปท. ไม่มีแถว = ไม่รับเงิน
--   payment_dues      ยอดค้างที่ระบบสร้างเองตามกฎ (ใบอนุญาตใกล้ครบกำหนด) · ปิดยอดเมื่อมีการรับเงินที่บันทึกด้วยเลขใบเสร็จ
--   payment_events    ประวัติ ระบบเขียนเอง เขียนเพิ่มอย่างเดียว (รวมการเปลี่ยนบัญชีปลายทาง — จุดโกงที่ง่ายที่สุดของระบบรับเงิน)
--
--   - ไม่แตะระบบแนบสลิปเดิมของคำขอเอกสาร (migration 060: document_requests.payment_* + bucket payment-slips)
--   - ไม่ใช้ municipalities.promptpay_id / bank_* เดิม (060/067) — ตารางนั้นใช้ column-level GRANT และแก้ได้หลายทาง
--     บัญชีรับเงินต้องอยู่ที่ที่แก้ได้ทางเดียว (RPC ของแอดมิน) และลงประวัติทุกครั้ง
--   - Ref1 เป็นเลขสุ่ม ไม่ใช่เลขบัตรประชาชน/เลขใบอนุญาต (PDPA + เดาเลขของคนอื่นไม่ได้ประโยชน์อะไร)
--   - created_by / updated_by / actor / closed_by ไม่ใส่ FK โดยตั้งใจ (บัญชีที่ลาออก/ถูกรวมต้องลบได้ — บทเรียน #658)
--   - FK ระหว่างตารางอยู่ในไฟล์นี้ได้ เพราะไม่มีฟังก์ชัน/trigger อ้างตารางใหม่ (NOTES ข้อ 3)
--
-- ย้อนกลับ: DROP TABLE public.payment_events, public.payment_dues, public.payment_settings; (ไฟล์ 2 ต้องย้อนก่อน)

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.municipalities') IS NULL OR to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ municipalities / departments';
  END IF;
  IF to_regclass('public.licences') IS NULL OR to_regclass('public.licence_fee_payments') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261208100000_licence_registry_tables.sql ก่อน (ยอดค้างนำร่องผูกกับทะเบียนใบอนุญาต)';
  END IF;
END $guard$;

-- ── 1) ค่าตั้งรับเงินราย อปท. ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_settings (
  municipality_id        uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- ช่องทาง (ค่าเริ่มต้นปิดทุกช่อง · ไม่มีปุ่ม "เปิดทั้งหมด")
  counter_enabled        boolean NOT NULL DEFAULT false,   -- ③ ชำระที่ อปท. (เคาน์เตอร์)
  promptpay_enabled      boolean NOT NULL DEFAULT false,   -- ② QR พร้อมเพย์ของบัญชี อปท. (ระบุยอด)
  bill_payment_enabled   boolean NOT NULL DEFAULT false,   -- ① QR Bill Payment ข้ามธนาคาร (มี Ref1)
  -- พร้อมเพย์ของ อปท.: เลขนิติบุคคล/เลขประจำตัวผู้เสียภาษี 13 หลัก หรือเบอร์มือถือ 10 หลัก
  -- รับเฉพาะเลขประจำตัวผู้เสียภาษีของหน่วยงาน (ขึ้นต้น 0) — เบอร์มือถือ/เลขบัตรประชาชนเป็นพร้อมเพย์ของบุคคล ห้ามใช้รับเงินของ อปท.
  -- (ผลตรวจ M4: จุดโกงที่ง่ายที่สุดคือเปลี่ยนเป็นบัญชีส่วนตัว + เลขส่วนตัวจะค้างในประวัติที่ลบไม่ได้)
  promptpay_id           text CHECK (promptpay_id IS NULL OR promptpay_id ~ '^0[0-9]{12}$'),
  -- รหัสผู้รับชำระ (Biller ID) ที่ธนาคารออกให้ อปท. — 15 หลัก (เลขผู้เสียภาษี 13 + ลำดับ 2) ตามเอกสารธนาคาร ต้องยืนยันกับธนาคารของ อปท.
  biller_id              text CHECK (biller_id IS NULL OR biller_id ~ '^[0-9]{15}$'),
  bank_name              text CHECK (bank_name IS NULL OR length(btrim(bank_name)) BETWEEN 2 AND 100),
  -- ชื่อบัญชีผู้รับ — พิมพ์บนใบแจ้งชำระให้ผู้ชำระตรวจกับชื่อที่แอปธนาคารแสดงก่อนกดจ่าย
  payee_name             text CHECK (payee_name IS NULL OR length(btrim(payee_name)) BETWEEN 2 AND 200),
  -- บริการไหนรับช่องทางไหน { "<source>": ["counter","promptpay","bill_payment"] } — ไฟล์ 2 ตรวจคีย์/ค่า
  source_channels        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_channels) = 'object'),
  -- บริการที่ e-LAAS ออกใบแจ้งหนี้ให้อยู่แล้ว ⇒ ระบบไม่สร้าง QR ซ้ำ (กันกองคลังทำสองระบบ) แต่ยังติดตามยอดค้างให้
  elaas_invoice_sources  text[] NOT NULL DEFAULT '{}'::text[],
  -- สร้างยอดค้างล่วงหน้ากี่วันก่อนวันครบกำหนด
  due_lead_days          integer NOT NULL DEFAULT 60 CHECK (due_lead_days BETWEEN 1 AND 180),
  -- ตัวเลือก: ให้กองคลังบันทึกเลขใบเสร็จได้ด้วย (ค่าเริ่มต้นปิด — ไม่เพิ่มงานกองคลังเว้นแต่ อปท. เลือกเอง)
  finance_department_id  uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  finance_can_record     boolean NOT NULL DEFAULT false,
  account_changed_at     timestamptz,   -- ครั้งล่าสุดที่บัญชีปลายทางเปลี่ยน (ป้ายเตือนบนหน้าจอ 30 วัน)
  account_changed_by     uuid,
  updated_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_settings_promptpay_needs_id CHECK (NOT promptpay_enabled OR promptpay_id IS NOT NULL),
  CONSTRAINT payment_settings_bill_needs_id CHECK (NOT bill_payment_enabled OR biller_id IS NOT NULL),
  CONSTRAINT payment_settings_finance_needs_dept CHECK (NOT finance_can_record OR finance_department_id IS NOT NULL)
);

-- ── 2) ยอดค้าง ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_dues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id    uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- แหล่งของยอด (นำร่องเฉพาะใบอนุญาต) · ขยายภายหลัง = เพิ่มค่าใน CHECK + คอลัมน์อ้างอิงของแหล่งนั้น
  source             text NOT NULL CHECK (source IN ('licence')),
  -- ชนิดยอดของใบอนุญาต ตรงกับ licence_fee_payments.kind (renewal = พ.ร.ฎ. ๒๕๖๔ · annual = ม.๖๕)
  kind               text NOT NULL CHECK (kind IN ('renewal', 'annual')),
  licence_id         uuid,
  period_from        date NOT NULL,         -- รอบที่ยอดนี้จ่ายให้ (ตรงกับ period_from ที่ licence_record_fee จะคำนวณ)
  due_on             date NOT NULL,         -- วันสุดท้ายที่ชำระได้ตามกำหนด (renewal = วันหมดอายุ · annual = วันครบกำหนด)
  amount             numeric(12, 2) NOT NULL CHECK (amount >= 0 AND amount <= 10000000),
  ref1               text NOT NULL CHECK (ref1 ~ '^[0-9]{12}$'),
  -- open = รอชำระ · paid = มีการรับเงินที่บันทึกเลขใบเสร็จแล้ว · lapsed = พ้นกำหนดต่ออายุ/ใบสิ้นสภาพ (ระบบตั้งตามกฎ ไม่ใช่ยกหนี้)
  -- cancelled = เจ้าหน้าที่ยกเลิกพร้อมเหตุผล (เช่น ยอดผิด) — ระบบไม่ยกเลิก/ยกเว้นยอดเอง
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'lapsed', 'cancelled')),
  payment_id         uuid,                  -- licence_fee_payments.id ที่ปิดยอดนี้
  paid_channel       text CHECK (paid_channel IS NULL OR paid_channel IN ('counter', 'promptpay', 'bill_payment', 'other')),
  closed_at          timestamptz,
  closed_by          uuid,                  -- NULL + status ≠ open = ระบบปิดเอง (ดูเหตุผลใน payment_events)
  close_reason       text CHECK (close_reason IS NULL OR length(close_reason) <= 1000),
  created_by         uuid,                  -- NULL = ระบบสร้างตามกฎ
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_dues_licence_needs_id CHECK (source <> 'licence' OR licence_id IS NOT NULL),
  CONSTRAINT payment_dues_paid_has_payment CHECK (status <> 'paid' OR payment_id IS NOT NULL),
  CONSTRAINT payment_dues_closed_stamp CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT payment_dues_cancel_reason CHECK (status NOT IN ('cancelled', 'lapsed') OR close_reason IS NOT NULL)
);
-- Ref1 ไม่ซ้ำใน อปท. เดียวกัน (ทุกสถานะ — ยอดที่ปิดแล้วถ้ามีเงินเข้าด้วย Ref1 เดิมต้องชี้กลับได้ไม่กำกวม)
CREATE UNIQUE INDEX IF NOT EXISTS payment_dues_ref1_unique ON public.payment_dues (municipality_id, ref1);
-- 1 รอบของ 1 ใบ มียอดที่ยังมีผลได้ยอดเดียว (ยกเลิกแล้วสร้างใหม่ได้)
CREATE UNIQUE INDEX IF NOT EXISTS payment_dues_one_per_period
  ON public.payment_dues (licence_id, kind, period_from) WHERE status IN ('open', 'paid');
CREATE INDEX IF NOT EXISTS payment_dues_muni_status_idx ON public.payment_dues (municipality_id, status, due_on);
CREATE INDEX IF NOT EXISTS payment_dues_licence_idx ON public.payment_dues (licence_id) WHERE licence_id IS NOT NULL;
-- 1 รายการรับเงินปิดได้ยอดเดียว (กัน RETURNING INTO ในกิ่ง void ได้ 2 แถวแล้ว licence_void_fee ใช้ไม่ได้ — ผลตรวจ L4)
CREATE UNIQUE INDEX IF NOT EXISTS payment_dues_payment_unique ON public.payment_dues (payment_id) WHERE payment_id IS NOT NULL;

-- ── 3) ประวัติ ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  entity           text NOT NULL CHECK (entity IN ('settings', 'due')),
  entity_id        uuid NOT NULL,            -- ไม่ใส่ FK: ประวัติต้องอยู่ต่อแม้แถวถูกลบ
  action           text NOT NULL CHECK (action IN ('insert', 'update', 'account_change', 'paid', 'reopen', 'lapse', 'cancel')),
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason           text CHECK (reason IS NULL OR length(reason) <= 2000),
  actor            uuid,                     -- NULL = ระบบ
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_entity_idx ON public.payment_events (entity_id, created_at);
CREATE INDEX IF NOT EXISTS payment_events_muni_idx ON public.payment_events (municipality_id, created_at);

-- ── FK (คู่ id + อปท. ⇒ ยอดอยู่ อปท. เดียวกับใบเสมอ) ─────────────────────────────────
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_dues_licence_fk') THEN
    -- ลบใบ (เช่น ยกเลิกชุดนำเข้าที่ผิด) = ยอดของใบหายตาม ⇒ ฟีเจอร์ลบ/ยกเลิกชุดนำเข้าของทะเบียนยังใช้ได้ (ผลตรวจ M1)
    -- ใบที่เคยรับเงินลบไม่ได้อยู่แล้ว (licence_fee_payments_licence_fk RESTRICT) ⇒ ยอด paid ไม่มีทางหายตามนี้
    -- ไฟล์ 2 ลงประวัติ 'cancel' ให้ยอดที่ยังรอชำระก่อนถูกลบ
    ALTER TABLE public.payment_dues ADD CONSTRAINT payment_dues_licence_fk
      FOREIGN KEY (licence_id, municipality_id) REFERENCES public.licences (id, municipality_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_dues_payment_fk') THEN
    ALTER TABLE public.payment_dues ADD CONSTRAINT payment_dues_payment_fk
      FOREIGN KEY (payment_id) REFERENCES public.licence_fee_payments (id) ON DELETE RESTRICT;
  END IF;
END $fk$;

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_dues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events   ENABLE ROW LEVEL SECURITY;

-- ปิด anon/PUBLIC ทั้งหมดตั้งแต่สร้าง (ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon ได้ ALL กับตารางใหม่)
-- authenticated: อ่านอย่างเดียว (ผ่าน policy ไฟล์ 2) · เขียนทุกอย่างผ่าน RPC SECURITY DEFINER
REVOKE ALL ON public.payment_settings, public.payment_dues, public.payment_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.payment_settings, public.payment_dues, public.payment_events FROM authenticated;
GRANT SELECT ON public.payment_settings, public.payment_dues, public.payment_events TO authenticated;

COMMENT ON TABLE public.payment_settings IS 'รับชำระเงิน: ค่าตั้งราย อปท. — แก้ผ่าน payment_save_settings() เท่านั้น (ลงประวัติ + ประทับการเปลี่ยนบัญชี)';
COMMENT ON TABLE public.payment_dues IS 'ยอดค้างที่ระบบสร้างตามกฎ · ปิดยอดเมื่อมีการรับเงินพร้อมเลขใบเสร็จ e-LAAS — ระบบไม่ออกใบเสร็จ ไม่ยกเว้นยอด';
COMMENT ON TABLE public.payment_events IS 'ประวัติรับชำระเงิน — trigger/RPC เขียนเอง ผู้ใช้อ่านได้อย่างเดียว';

COMMIT;
