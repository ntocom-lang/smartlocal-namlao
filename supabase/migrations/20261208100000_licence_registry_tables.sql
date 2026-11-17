-- 20261208100000_licence_registry_tables.sql
-- ขั้น 1B (E3) ทะเบียนใบอนุญาต ไฟล์ 1/3 — ตารางใหม่ 5 ตาราง (RLS เปิด ยังไม่มี policy = ปฏิเสธทุกคน จนกว่าไฟล์ 2 วางสิทธิ์)
--   เจ้าของระบบอนุมัติ 2569-11-17 (B1 ทะเบียน · B3 เตือนต่ออายุ/ค่าธรรมเนียมรายปี · B4 ต่ออายุโดยชำระค่าธรรมเนียม · ตัวเลือก Biz Portal)
--   ตัวบทที่ใช้ออกแบบ (อ่านจากฉบับรวมของกรมอนามัย — แผน cityvariety ข้อ 15):
--     พ.ร.บ.การสาธารณสุข พ.ศ. ๒๕๓๕ ม.๕๕ ใบอนุญาตอายุหนึ่งปีนับแต่วันออก · ม.๔๘ หนังสือรับรองการแจ้ง (ไม่มีอายุ จ่ายค่าธรรมเนียมรายปีตาม ม.๖๕)
--     ม.๕๔/๖๓ แบบ หลักเกณฑ์ อัตรา = ข้อกำหนดของท้องถิ่นแต่ละแห่ง ⇒ ประเภท/อัตรา/ช่วงต่ออายุ เป็นค่าตั้งราย อปท. ไม่ใช่ค่ากลาง
--     พ.ร.ฎ.การกำหนดให้ผู้รับใบอนุญาตชำระค่าธรรมเนียมการต่ออายุใบอนุญาตแทนการยื่นคำขอต่ออายุใบอนุญาต พ.ศ. ๒๕๖๔
--       ชำระก่อนสิ้นอายุ = ต่ออายุแล้ว (ยืนยันกับคู่มือประชาชน กทม. · ฉบับราชกิจจาฯ ดึงไม่ได้ ต้องยืนยันกับตัวบทอีกครั้ง)
--
--   licence_settings      ค่าตั้งราย อปท. (กองที่ถือเรื่อง · วันเตือนล่วงหน้า) — 1 แถว/อปท. ไม่มีแถว = ใช้ค่าเริ่มต้น
--   licence_types         ประเภทใบอนุญาตที่ อปท. นั้นมีข้อกำหนดของท้องถิ่นรองรับ (ไม่มีข้อบัญญัติ = ไม่ต้องสร้างประเภท)
--   licences              ทะเบียนใบอนุญาต / หนังสือรับรองการแจ้ง แต่ละใบ
--   licence_fee_payments  การรับค่าธรรมเนียมที่เจ้าหน้าที่บันทึก (เลขใบเสร็จจาก e-LAAS) — เพิ่มผ่าน RPC เท่านั้น
--   licence_events        ประวัติ ระบบเขียนเอง เขียนเพิ่มอย่างเดียว
--
--   - ระบบไม่ตัดสินแทนคน: อนุญาต/ไม่อนุญาต · พักใช้ · เพิกถอน = คำสั่งเจ้าพนักงานท้องถิ่น ระบบเก็บเลขคำสั่ง+เหตุผล
--     การรับเงิน = เจ้าหน้าที่ยืนยันพร้อมเลขใบเสร็จ ระบบแค่ขยายวันหมดอายุตามกฎ (พ.ร.ฎ. ๒๕๖๔ ไม่มีดุลพินิจ)
--   - "หมดอายุ" ไม่เก็บเป็นสถานะ คำนวณจาก expires_on < วันนี้ (เวลาไทย) — กันสถานะค้างเพราะ cron ไม่วิ่ง
--   - ไม่เก็บเลขประจำตัวประชาชน (ไม่จำเป็นต่อการเตือน/ต่ออายุ — PDPA เก็บเท่าที่จำเป็น)
--   - ไม่มีหน้าประชาชนในไฟล์นี้ (ผู้ถือใบดูของตัวเอง = เฟสคำขอออนไลน์ B5)
--   - created_by / updated_by / actor / recorded_by ไม่ใส่ FK โดยตั้งใจ (บัญชีที่ลาออก/ถูกรวมต้องลบได้ — บทเรียน #658)
--   - FK ระหว่างตารางใหม่อยู่ในไฟล์นี้ได้ เพราะทุก CREATE TABLE มาก่อน ALTER … ADD CONSTRAINT ในไฟล์เดียวกัน
--     และไม่มีฟังก์ชัน/trigger อ้างตารางใหม่ (NOTES ข้อ 3: กับดักคือฟังก์ชัน SQL ที่ตรวจชื่อตารางตอน CREATE)
--
-- ย้อนกลับ: DROP TABLE public.licence_events, public.licence_fee_payments, public.licences, public.licence_types,
--           public.licence_settings; (เสียเฉพาะข้อมูลของเมนูนี้ — ไฟล์ 2 ต้องย้อนก่อน)
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.municipalities') IS NULL OR to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ municipalities / departments';
  END IF;
END $guard$;

-- ── 1) ค่าตั้งราย อปท. ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licence_settings (
  municipality_id      uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- กองที่ถือเรื่องใบอนุญาต · NULL = ระบบเลือกเอง (กองสาธารณสุขที่มีคนอยู่ ไม่งั้นสำนักปลัด — แนวเดียวกับตารางเก็บขยะ)
  owner_department_id  uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  -- เตือนล่วงหน้ากี่วันก่อนวันหมดอายุ/วันครบกำหนดค่าธรรมเนียม (เตือนครั้งเดียวต่อหลัก) · 0 = วันครบกำหนด
  remind_days          integer[] NOT NULL DEFAULT ARRAY[60, 30, 7, 0],
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licence_settings_remind_days_ok CHECK (
    cardinality(remind_days) BETWEEN 1 AND 6
    AND array_position(remind_days, NULL) IS NULL          -- 0 <= ALL('{NULL}') = NULL ซึ่ง CHECK ถือว่าผ่าน
    AND 0 <= ALL (remind_days) AND 180 >= ALL (remind_days))
);

-- ── 2) ประเภทใบอนุญาตของ อปท. ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licence_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id      uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- หมวดตามตัวบท (ใช้จัดกลุ่ม/รายงาน) · ชื่อที่แสดงเป็นของ อปท. เองใน name
  category             text NOT NULL CHECK (category IN (
                         'health_hazard',   -- กิจการที่เป็นอันตรายต่อสุขภาพ ม.๓๓
                         'market',          -- จัดตั้งตลาด ม.๓๔
                         'food_premises',   -- สถานที่จำหน่าย/สะสมอาหาร เกิน ๒๐๐ ตร.ม. ม.๓๘ (ใบอนุญาต)
                         'food_notice',     -- สถานที่จำหน่าย/สะสมอาหาร ไม่เกิน ๒๐๐ ตร.ม. ม.๓๘/๔๘ (หนังสือรับรองการแจ้ง)
                         'street_vending',  -- จำหน่ายสินค้าในที่หรือทางสาธารณะ ม.๔๑
                         'waste_service',   -- รับทำการเก็บ ขน กำจัดสิ่งปฏิกูล/มูลฝอย ม.๑๙
                         'other')),
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  -- licence = มีวันหมดอายุ · notice_certificate = ไม่มีวันหมดอายุ แต่จ่ายค่าธรรมเนียมรายปี
  doc_kind             text NOT NULL DEFAULT 'licence' CHECK (doc_kind IN ('licence', 'notice_certificate')),
  validity_months      integer CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 60),
  -- ใช้ พ.ร.ฎ. ๒๕๖๔ (ชำระแทนยื่นคำขอ) ได้ไหม — ม.๑๙ ไม่อยู่ในบัญชีท้าย พ.ร.ฎ. ตามแนวทางที่อ่าน ⇒ หน้าจอตั้งค่าเริ่ม false ให้
  renewal_by_fee       boolean NOT NULL DEFAULT true,
  -- ข้อกำหนดของท้องถิ่นที่รองรับ (ชื่อ + ปี) — แสดงในทะเบียน/ใบพิมพ์ ระบบไม่ตีความ
  ordinance_ref        text CHECK (ordinance_ref IS NULL OR length(ordinance_ref) <= 300),
  legal_basis          text CHECK (legal_basis IS NULL OR length(legal_basis) <= 200),   -- เช่น "ม.๓๓ พ.ร.บ.การสาธารณสุข"
  -- ยื่น/ชำระต่ออายุได้ล่วงหน้ากี่วัน ตามข้อบัญญัติของ อปท. (กทม. ๙๐ วัน) · NULL = ไม่จำกัด (แค่ต้องก่อนสิ้นอายุ)
  renewal_window_days  integer CHECK (renewal_window_days IS NULL OR renewal_window_days BETWEEN 1 AND 365),
  default_fee          numeric(12, 2) CHECK (default_fee IS NULL OR default_fee >= 0),
  -- ตัวเลือก Biz Portal / ระบบอื่นที่ อปท. ใช้อยู่ (ประชาชนกดออกไปยื่นที่นั่น ไม่รับซ้ำในระบบนี้) — https เท่านั้น
  external_url         text CHECK (external_url IS NULL OR (external_url ~ '^https://[^\s<>"]+$' AND length(external_url) <= 500)),
  external_label       text CHECK (external_label IS NULL OR length(external_label) <= 100),
  is_active            boolean NOT NULL DEFAULT true,
  sort_order           integer NOT NULL DEFAULT 0,
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licence_types_kind_validity CHECK (
    (doc_kind = 'licence' AND validity_months IS NOT NULL)
    OR (doc_kind = 'notice_certificate' AND validity_months IS NULL AND NOT renewal_by_fee)),
  CONSTRAINT licence_types_notice_category CHECK ((category = 'food_notice') = (doc_kind = 'notice_certificate')),
  CONSTRAINT licence_types_id_muni_unique UNIQUE (id, municipality_id),          -- ให้ตารางลูกอ้าง (id, อปท.) คู่กัน
  CONSTRAINT licence_types_name_unique UNIQUE (municipality_id, name)
);

-- ── 3) ทะเบียนใบอนุญาต ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licences (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id      uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  licence_type_id      uuid NOT NULL,
  licence_no           text CHECK (licence_no IS NULL OR length(btrim(licence_no)) BETWEEN 1 AND 60),
  business_name        text NOT NULL CHECK (length(btrim(business_name)) BETWEEN 1 AND 300),
  sub_type             text CHECK (sub_type IS NULL OR length(sub_type) <= 300),       -- ลำดับ/ประเภทย่อยตามข้อบัญญัติ เช่น "(๓) การฆ่าสัตว์ปีก"
  holder_name          text NOT NULL CHECK (length(btrim(holder_name)) BETWEEN 1 AND 200),
  holder_phone         text CHECK (holder_phone IS NULL OR holder_phone ~ '^[0-9+\- ]{6,20}$'),
  address              text CHECK (address IS NULL OR length(address) <= 500),
  village              text CHECK (village IS NULL OR length(village) <= 100),
  area_sqm             numeric(12, 2) CHECK (area_sqm IS NULL OR area_sqm >= 0),
  fee_amount           numeric(12, 2) CHECK (fee_amount IS NULL OR fee_amount >= 0),  -- ค่าธรรมเนียมต่อปีของใบนี้ (ตามข้อบัญญัติ)
  issued_on            date,
  expires_on           date,          -- วันสุดท้ายที่ใบยังใช้ได้ (ใบอนุญาต) · NULL สำหรับหนังสือรับรองการแจ้ง
  next_fee_due_on      date,          -- วันครบกำหนดค่าธรรมเนียมรายปี (หนังสือรับรองการแจ้ง ม.๖๕)
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked', 'closed')),
  status_from          date,
  status_until         date,          -- พักใช้ถึงวันที่ (ม.๕๙ ไม่เกิน ๑๕ วัน — ไฟล์ 2 ตรวจ)
  status_order_ref     text CHECK (status_order_ref IS NULL OR length(status_order_ref) <= 200),   -- เลขที่คำสั่งเจ้าพนักงานท้องถิ่น
  status_reason        text CHECK (status_reason IS NULL OR length(status_reason) <= 2000),
  note                 text CHECK (note IS NULL OR length(note) <= 2000),
  import_batch         uuid,          -- ชุดนำเข้าจาก Excel (ยกเลิกทั้งชุดได้ถ้ายังไม่มีการรับเงิน)
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licences_dates_ok CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on > issued_on),
  CONSTRAINT licences_suspend_dates CHECK (status <> 'suspended' OR (status_from IS NOT NULL AND status_until IS NOT NULL
                                                                     AND status_until >= status_from)),
  CONSTRAINT licences_status_has_order CHECK (status = 'active' OR status_reason IS NOT NULL),
  CONSTRAINT licences_id_muni_unique UNIQUE (id, municipality_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS licences_no_unique
  ON public.licences (municipality_id, licence_type_id, licence_no) WHERE licence_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS licences_expiry_idx ON public.licences (municipality_id, expires_on) WHERE status IN ('active', 'suspended');
CREATE INDEX IF NOT EXISTS licences_fee_due_idx ON public.licences (municipality_id, next_fee_due_on) WHERE status IN ('active', 'suspended');
CREATE INDEX IF NOT EXISTS licences_type_idx ON public.licences (licence_type_id);
CREATE INDEX IF NOT EXISTS licences_batch_idx ON public.licences (import_batch) WHERE import_batch IS NOT NULL;

-- ── 4) การรับค่าธรรมเนียม (เพิ่มผ่าน RPC เท่านั้น — ไฟล์ 2) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.licence_fee_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id      uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  licence_id           uuid NOT NULL,
  -- renewal = ชำระแทนยื่นคำขอต่ออายุ (พ.ร.ฎ. ๒๕๖๔) · annual = ค่าธรรมเนียมรายปีของหนังสือรับรองการแจ้ง (ม.๖๕)
  kind                 text NOT NULL CHECK (kind IN ('renewal', 'annual')),
  paid_on              date NOT NULL,
  amount               numeric(12, 2) NOT NULL CHECK (amount >= 0),
  surcharge            numeric(12, 2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),   -- ค่าปรับร้อยละ ๒๐ ตาม ม.๖๕ (เจ้าหน้าที่ยืนยันยอด)
  receipt_no           text NOT NULL CHECK (length(btrim(receipt_no)) BETWEEN 1 AND 60),   -- เลขใบเสร็จจาก e-LAAS
  period_from          date NOT NULL,
  period_to            date NOT NULL,
  -- ผู้ประกอบการรับรองว่าไม่เปลี่ยนแปลงสาระสำคัญ (เงื่อนไข พ.ร.ฎ. ๒๕๖๔) — ต้องเป็น true สำหรับ renewal
  no_material_change   boolean NOT NULL DEFAULT false,
  prev_expires_on      date,          -- ค่าเดิมก่อนรับเงิน (ใช้ย้อนเมื่อยกเลิกรายการที่บันทึกผิด)
  prev_fee_due_on      date,
  voided_at            timestamptz,
  voided_by            uuid,
  void_reason          text CHECK (void_reason IS NULL OR length(void_reason) <= 1000),
  recorded_by          uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licence_fee_payments_period_ok CHECK (period_to >= period_from),
  CONSTRAINT licence_fee_payments_renewal_cert CHECK (kind <> 'renewal' OR no_material_change),
  CONSTRAINT licence_fee_payments_void_reason CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
-- เลขใบเสร็จเดียวใช้ซ้ำไม่ได้ใน อปท. เดียวกัน (กันกดบันทึกซ้ำ) — รายการที่ยกเลิกแล้วไม่นับ
CREATE UNIQUE INDEX IF NOT EXISTS licence_fee_payments_receipt_unique
  ON public.licence_fee_payments (municipality_id, receipt_no) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS licence_fee_payments_licence_idx ON public.licence_fee_payments (licence_id, created_at);

-- ── 5) ประวัติ ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licence_events (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_id      uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  entity               text NOT NULL CHECK (entity IN ('settings', 'type', 'licence', 'payment')),
  entity_id            uuid NOT NULL,         -- ไม่ใส่ FK: ประวัติต้องอยู่ต่อแม้แถวถูกลบ
  licence_id           uuid,                  -- ใบที่เกี่ยวข้อง (ไว้ดูประวัติทั้งใบ)
  action               text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'status', 'renew', 'fee', 'void')),
  changes              jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason               text CHECK (reason IS NULL OR length(reason) <= 2000),
  actor                uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS licence_events_licence_idx ON public.licence_events (licence_id, created_at) WHERE licence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS licence_events_muni_idx ON public.licence_events (municipality_id, created_at);

-- ── FK ระหว่างตารางใหม่ (คู่ id + อปท. ⇒ แถวลูกอยู่ อปท. เดียวกับแม่เสมอ ไม่ต้องพึ่ง trigger) ─────────
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licences_type_fk') THEN
    ALTER TABLE public.licences ADD CONSTRAINT licences_type_fk
      FOREIGN KEY (licence_type_id, municipality_id) REFERENCES public.licence_types (id, municipality_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licence_fee_payments_licence_fk') THEN
    -- ใบที่มีประวัติรับเงิน ลบไม่ได้ (ต้องเปลี่ยนสถานะเป็นเลิกกิจการแทน)
    ALTER TABLE public.licence_fee_payments ADD CONSTRAINT licence_fee_payments_licence_fk
      FOREIGN KEY (licence_id, municipality_id) REFERENCES public.licences (id, municipality_id) ON DELETE RESTRICT;
  END IF;
END $fk$;

ALTER TABLE public.licence_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licence_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licence_fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licence_events       ENABLE ROW LEVEL SECURITY;

-- ปิด anon/PUBLIC ทั้งหมดตั้งแต่สร้าง (ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon ได้ ALL กับตารางใหม่)
REVOKE ALL ON public.licence_settings, public.licence_types, public.licences,
              public.licence_fee_payments, public.licence_events FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.licence_settings, public.licence_types, public.licences,
              public.licence_fee_payments, public.licence_events FROM authenticated;

COMMENT ON TABLE public.licence_settings IS 'ทะเบียนใบอนุญาต: ค่าตั้งราย อปท. (กองที่ถือเรื่อง · วันเตือนล่วงหน้า)';
COMMENT ON TABLE public.licence_types IS 'ประเภทใบอนุญาตที่ อปท. มีข้อกำหนดของท้องถิ่นรองรับ — แบบ/อัตรา/ช่วงต่ออายุ เป็นของ อปท. เอง (พ.ร.บ.การสาธารณสุข ม.๕๔ ม.๖๓)';
COMMENT ON TABLE public.licences IS 'ทะเบียนใบอนุญาต/หนังสือรับรองการแจ้ง — หมดอายุคำนวณจาก expires_on ไม่เก็บเป็นสถานะ';
COMMENT ON TABLE public.licence_fee_payments IS 'การรับค่าธรรมเนียมที่เจ้าหน้าที่ยืนยัน (เลขใบเสร็จ e-LAAS) — เพิ่ม/ยกเลิกผ่าน RPC เท่านั้น';
COMMENT ON TABLE public.licence_events IS 'ประวัติทะเบียนใบอนุญาต — trigger/RPC เขียนเอง ผู้ใช้อ่านได้อย่างเดียว';

COMMIT;
