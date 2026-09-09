-- โมดูล "ขอยืมพัสดุ/ครุภัณฑ์" เฟส 1/3 — ตาราง + ข้อบังคับ (ยังไม่มีฟังก์ชัน/RPC/RLS)
-- ไฟล์ถัดไป 20260909100100 จึงจะสร้าง RLS + RPC ที่อ้างตารางเหล่านี้ได้ (กติกาแยกไฟล์ตามเฟส)
--
-- ที่มา: แบบ "ใบยืมพัสดุ/ครุภัณฑ์" (บย.) ที่ อปท. ใช้อยู่ — ผู้ยืมกรอกชื่อ/ตำแหน่ง/ที่อยู่
-- ระบุว่ายืมไปจากส่วนราชการใด เพื่ออะไร ตั้งแต่วันที่เท่าไร และจะนำส่งคืนวันที่เท่าไร
-- แล้วผ่านความเห็นปลัดฯ → อนุมัติโดยนายกฯ (ผู้ให้ยืม) → จ่ายของ → รับคืน
--
-- ⚠️ ทำไมไม่เก็บทั้งหมดใน document_requests.permit_form_data เหมือนคำร้องใบอื่น:
--   1) permit_form_data คือ snapshot ตอนยื่นที่ห้ามแก้ แต่ "กำหนดคืน" เจ้าหน้าที่ขยายเวลาได้
--      และต้อง index เพื่อไล่ของค้างคืน — สองอย่างนี้อยู่ใน jsonb ก้อนเดิมไม่ได้
--   2) จำนวนที่อนุมัติ/จ่าย/คืน ต้องคำนวณ "ของว่างพร้อมให้ยืม" ข้ามคำขอ ต้องเป็นแถวจริง
--
-- ⚠️ รุ่นแรกบังคับ 1 คำขอ = 1 กองเจ้าของพัสดุ — ใบ บย. ต้นฉบับมีช่อง "ไปจากส่วนราชการ"
-- ช่องเดียว และแต่ละกองออกเลข บย. ในทะเบียนของตัวเอง คำขอข้ามกองจึงต้องแยกใบอยู่ดี
-- (items ยังเก็บ department_id ไว้ เผื่อวันหนึ่งเปิดข้ามกองโดยไม่ต้อง migrate ใหม่)
--
-- ⚠️ ระเบียบ: การให้ยืมพัสดุของทางราชการต้องเป็นไปตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อ
-- จัดจ้างและการบริหารพัสดุภาครัฐ หมวดการยืม และหลักเกณฑ์ที่ อปท. กำหนดเอง — ยังไม่ได้เปิด
-- ตัวบทยืนยันรายข้อ ระบบนี้เป็นเพียงเครื่องมือบันทึกและออกแบบพิมพ์ ไม่ใช่ตัวตัดสินว่ายืมได้

BEGIN;

-- ===========================================================================
-- 1. ทะเบียนของที่เปิดให้ยืม
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.borrowable_assets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id      uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- กองเจ้าของพัสดุ = ช่อง "ไปจากส่วนราชการ" บนใบ บย. และเป็นกองที่ต้องจ่าย/รับของคืน
  department_id        uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  -- ช่อง "เลขที่หรือรหัส" บนใบ — ปล่อยว่างได้ ของบางอย่าง (เต็นท์ เก้าอี้) ไม่มีรหัสครุภัณฑ์รายชิ้น
  asset_code           text,
  name                 text NOT NULL,
  unit                 text NOT NULL DEFAULT 'ชิ้น',
  total_quantity       integer NOT NULL DEFAULT 1,
  -- ประชาชนทั่วไปเห็นและยืมได้เฉพาะแถวที่แอดมินติ๊กไว้ (เต็นท์ โต๊ะ เก้าอี้ เครื่องเสียง)
  -- ที่ไม่ติ๊กจะไม่ปรากฏในหน้าประชาชนเลย — ไม่ต้องเปิดเผยรหัสและจำนวนครุภัณฑ์มูลค่าสูง
  is_public_borrowable boolean NOT NULL DEFAULT false,
  notes                text,
  -- เวลาที่เจ้าหน้าที่กดยืนยันว่า "ปรับทะเบียนตามผลการจำหน่ายพัสดุแล้ว"
  -- ระบบไม่ตัดจำนวนของที่สูญหายออกจากทะเบียนให้เอง (ต้องผ่านการสอบข้อเท็จจริงตามระเบียบก่อน)
  -- จึงต้องมีหมุดเวลาไว้ ไม่งั้นแบนเนอร์เตือน "มีของสูญหาย" จะค้างอยู่ตลอดกาลแม้จัดการเสร็จแล้ว
  -- แจ้งเตือนเฉพาะการสูญหายที่บันทึกหลังเวลานี้เท่านั้น
  losses_adjusted_at   timestamptz,
  -- เลิกให้ยืมแล้วให้ปิด is_active ห้ามลบทิ้ง คำขอเก่ายังอ้าง asset_id อยู่
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.borrowable_assets IS
  'ทะเบียนพัสดุ/ครุภัณฑ์ที่ อปท. เปิดให้ยืม ใช้กับใบยืมพัสดุ/ครุภัณฑ์ (บย.)';
COMMENT ON COLUMN public.borrowable_assets.is_public_borrowable IS
  'true = ประชาชนทั่วไปเห็นและยื่นขอยืมออนไลน์ได้ / false = เฉพาะบุคลากรและเจ้าหน้าที่รับเรื่องแทน';
COMMENT ON COLUMN public.borrowable_assets.total_quantity IS
  'จำนวนทั้งหมดที่มี ใช้ตั้งต้นคำนวณของว่าง ไม่ใช่ยอดคงเหลือ ณ ปัจจุบัน';

ALTER TABLE public.borrowable_assets
  DROP CONSTRAINT IF EXISTS borrowable_assets_name_length_check;
ALTER TABLE public.borrowable_assets
  ADD CONSTRAINT borrowable_assets_name_length_check
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);

ALTER TABLE public.borrowable_assets
  DROP CONSTRAINT IF EXISTS borrowable_assets_unit_length_check;
ALTER TABLE public.borrowable_assets
  ADD CONSTRAINT borrowable_assets_unit_length_check
  CHECK (char_length(btrim(unit)) BETWEEN 1 AND 30);

ALTER TABLE public.borrowable_assets
  DROP CONSTRAINT IF EXISTS borrowable_assets_code_length_check;
ALTER TABLE public.borrowable_assets
  ADD CONSTRAINT borrowable_assets_code_length_check
  CHECK (asset_code IS NULL OR char_length(btrim(asset_code)) BETWEEN 1 AND 60);

-- เพดาน 9999 กันพิมพ์ผิดหลักแล้วได้ยอดว่างเพี้ยนทั้งทะเบียน (เก้าอี้ 500 ตัวคือมากสุดที่พบจริง)
ALTER TABLE public.borrowable_assets
  DROP CONSTRAINT IF EXISTS borrowable_assets_total_quantity_check;
ALTER TABLE public.borrowable_assets
  ADD CONSTRAINT borrowable_assets_total_quantity_check
  CHECK (total_quantity BETWEEN 1 AND 9999);

-- รหัสครุภัณฑ์ห้ามซ้ำใน อปท. เดียวกัน — ซ้ำแล้วเจ้าหน้าที่แยกไม่ออกว่าจ่ายตัวไหนไป
CREATE UNIQUE INDEX IF NOT EXISTS borrowable_assets_tenant_code_key
  ON public.borrowable_assets (municipality_id, btrim(asset_code))
  WHERE asset_code IS NOT NULL AND btrim(asset_code) <> '';

CREATE INDEX IF NOT EXISTS borrowable_assets_tenant_dept_idx
  ON public.borrowable_assets (municipality_id, department_id, is_active, name);

CREATE INDEX IF NOT EXISTS borrowable_assets_public_idx
  ON public.borrowable_assets (municipality_id, name)
  WHERE is_public_borrowable AND is_active;

-- ===========================================================================
-- 2. หัวคำขอ — 1:1 กับ document_requests (parent ที่ Inbox/สถิติ/ประวัติใช้อยู่แล้ว)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.asset_borrow_requests (
  -- ใช้ id ของ document_requests เป็น PK ตรงๆ บังคับ 1:1 โดยไม่ต้องมี unique index เพิ่ม
  request_id        uuid PRIMARY KEY REFERENCES public.document_requests(id) ON DELETE CASCADE,
  municipality_id   uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- กองเจ้าของพัสดุ (1 คำขอ = 1 กอง) ต่างจาก document_requests.department_id ซึ่งเป็น
  -- "กองที่รับเรื่อง" ตาม document_type_assignments — รุ่นแรกสองค่านี้ตรงกัน แต่แยกคอลัมน์ไว้
  -- เพราะ อปท. ย้ายกองผู้รับเรื่องได้โดยที่เจ้าของพัสดุไม่เปลี่ยน
  department_id     uuid REFERENCES public.departments(id) ON DELETE SET NULL,

  -- ช่องบนใบ บย. -----------------------------------------------------------
  borrower_type     text NOT NULL DEFAULT 'citizen',
  borrower_position text,          -- ช่อง "ตำแหน่ง"
  borrower_org      text,          -- สังกัด/หน่วยงานต้นสังกัด (ไม่มีบนใบ ใช้ประกอบการพิจารณา)
  purpose           text NOT NULL, -- ช่อง "เพื่อ"
  place_of_use      text,          -- สถานที่ใช้งาน (ไม่มีบนใบ เจ้าหน้าที่ต้องรู้เพื่อประเมินความเสี่ยง)
  borrow_start_date date NOT NULL, -- ช่อง "ตั้งแต่วันที่"
  return_due_date   date NOT NULL, -- ช่อง "ข้าพเจ้าจะนำส่งวันที่...เดือน...พ.ศ..."
  -- เลข "บย......../........" มุมขวาบนของใบ ออกโดยกองเจ้าของพัสดุตอนอนุมัติ
  -- ว่างอยู่ = ใบร่าง ให้พิมพ์เป็นเส้นจุดไว้เขียนมือ
  form_no           text,

  -- สถานะงาน --------------------------------------------------------------
  -- ⚠️ overdue ไม่ใช่สถานะที่เก็บ — คำนวณสดจาก return_due_date < วันนี้ AND status='issued'
  -- เก็บเป็นสถานะเมื่อไหร่ต้องมี cron มาเลื่อนสถานะ และจะเพี้ยนทันทีที่ cron ล่ม
  workflow_status   text NOT NULL DEFAULT 'submitted',

  acknowledged_terms boolean NOT NULL DEFAULT false,
  staff_note        text,
  reject_reason     text,

  approved_at       timestamptz,
  approved_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_at         timestamptz,
  issued_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  returned_at       timestamptz,
  received_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  settled_at        timestamptz,
  settled_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.asset_borrow_requests IS
  'หัวคำขอยืมพัสดุ/ครุภัณฑ์ 1:1 กับ document_requests (document_type = asset_borrow_request)';
COMMENT ON COLUMN public.asset_borrow_requests.return_due_date IS
  'วันกำหนดคืนของ — คนละเรื่องกับ document_requests.due_date ซึ่งเป็น SLA การพิจารณาคำขอ';

ALTER TABLE public.asset_borrow_requests
  DROP CONSTRAINT IF EXISTS asset_borrow_requests_borrower_type_check;
ALTER TABLE public.asset_borrow_requests
  ADD CONSTRAINT asset_borrow_requests_borrower_type_check
  CHECK (borrower_type IN ('internal', 'government', 'citizen'));

-- 6 สถานะเท่านั้น ตัดจาก 12 สถานะในสเปกตั้งต้น — ทุกตัวมีปุ่มจริงบนหน้าจอเจ้าหน้าที่
--   submitted  ยื่นแล้ว รอกองพิจารณา
--   approved   อนุมัติ (เต็ม/บางส่วน) รอมารับของ
--   issued     จ่ายของแล้ว อยู่ระหว่างยืม (เกินกำหนดคืนคำนวณสดจากสถานะนี้)
--   settlement คืนแล้วแต่มีชำรุด/สูญหาย รอผลชดใช้
--   returned   คืนครบและเคลียร์เรียบร้อย = งานเสร็จ
--   rejected   ไม่อนุมัติ หรือยกเลิกก่อนจ่ายของ
ALTER TABLE public.asset_borrow_requests
  DROP CONSTRAINT IF EXISTS asset_borrow_requests_workflow_status_check;
ALTER TABLE public.asset_borrow_requests
  ADD CONSTRAINT asset_borrow_requests_workflow_status_check
  CHECK (workflow_status IN ('submitted', 'approved', 'issued', 'settlement', 'returned', 'rejected'));

ALTER TABLE public.asset_borrow_requests
  DROP CONSTRAINT IF EXISTS asset_borrow_requests_date_order_check;
ALTER TABLE public.asset_borrow_requests
  ADD CONSTRAINT asset_borrow_requests_date_order_check
  CHECK (return_due_date >= borrow_start_date);

-- ยืมยาวเกิน 1 ปีไม่ใช่การยืม เป็นการโอนการครอบครองซึ่งต้องทำตามระเบียบคนละหมวด
ALTER TABLE public.asset_borrow_requests
  DROP CONSTRAINT IF EXISTS asset_borrow_requests_duration_check;
ALTER TABLE public.asset_borrow_requests
  ADD CONSTRAINT asset_borrow_requests_duration_check
  CHECK (return_due_date - borrow_start_date <= 365);

ALTER TABLE public.asset_borrow_requests
  DROP CONSTRAINT IF EXISTS asset_borrow_requests_purpose_length_check;
ALTER TABLE public.asset_borrow_requests
  ADD CONSTRAINT asset_borrow_requests_purpose_length_check
  CHECK (char_length(btrim(purpose)) BETWEEN 1 AND 500);

ALTER TABLE public.asset_borrow_requests
  DROP CONSTRAINT IF EXISTS asset_borrow_requests_form_no_length_check;
ALTER TABLE public.asset_borrow_requests
  ADD CONSTRAINT asset_borrow_requests_form_no_length_check
  CHECK (form_no IS NULL OR char_length(btrim(form_no)) BETWEEN 1 AND 40);

CREATE INDEX IF NOT EXISTS asset_borrow_requests_tenant_status_idx
  ON public.asset_borrow_requests (municipality_id, department_id, workflow_status);

-- ไล่ของค้างคืน: เฉพาะใบที่จ่ายของไปแล้วเท่านั้นที่เกินกำหนดได้
CREATE INDEX IF NOT EXISTS asset_borrow_requests_overdue_idx
  ON public.asset_borrow_requests (municipality_id, return_due_date)
  WHERE workflow_status = 'issued';

-- ===========================================================================
-- 3. รายการที่ขอยืม — หนึ่งแถวต่อหนึ่งบรรทัดในตารางบนใบ บย.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.asset_borrow_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES public.asset_borrow_requests(request_id) ON DELETE CASCADE,
  municipality_id    uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT: ห้ามลบของที่ยังมีประวัติการยืม ต้องปิด is_active แทน
  asset_id           uuid NOT NULL REFERENCES public.borrowable_assets(id) ON DELETE RESTRICT,
  department_id      uuid REFERENCES public.departments(id) ON DELETE SET NULL,

  -- snapshot ณ วันยื่น — ทะเบียนของแก้ชื่อ/รหัสได้ตลอด แต่ใบที่พิมพ์ไปแล้วต้องพิมพ์ซ้ำได้เหมือนเดิม
  asset_code_snapshot text,
  asset_name_snapshot text NOT NULL,
  unit_snapshot       text NOT NULL,

  requested_qty      integer NOT NULL,
  approved_qty       integer,                      -- NULL = ยังไม่พิจารณา, 0 = ไม่อนุมัติรายการนี้
  issued_qty         integer NOT NULL DEFAULT 0,
  returned_qty       integer NOT NULL DEFAULT 0,   -- คืนในสภาพใช้การได้
  damaged_qty        integer NOT NULL DEFAULT 0,   -- คืนแล้วชำรุด
  lost_qty           integer NOT NULL DEFAULT 0,   -- สูญหาย ไม่ได้คืน
  settlement_note    text,                         -- ผลการซ่อมแซม/ชดใช้ ต้องมีก่อนปิดงาน
  item_note          text,                         -- ช่อง "หมายเหตุ" บนใบ
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.asset_borrow_items.approved_qty IS
  'NULL = ยังไม่พิจารณา / 0 = พิจารณาแล้วไม่อนุมัติรายการนี้ — สองค่านี้ต่างกัน ห้ามยุบรวม';

ALTER TABLE public.asset_borrow_items
  DROP CONSTRAINT IF EXISTS asset_borrow_items_requested_qty_check;
ALTER TABLE public.asset_borrow_items
  ADD CONSTRAINT asset_borrow_items_requested_qty_check
  CHECK (requested_qty BETWEEN 1 AND 9999);

-- อนุมัติเกินที่ขอไม่ได้ (เจ้าหน้าที่จะให้เพิ่มต้องให้ผู้ยืมยื่นใหม่ ไม่ใช่แก้ตัวเลขในใบเดิม)
ALTER TABLE public.asset_borrow_items
  DROP CONSTRAINT IF EXISTS asset_borrow_items_approved_qty_check;
ALTER TABLE public.asset_borrow_items
  ADD CONSTRAINT asset_borrow_items_approved_qty_check
  CHECK (approved_qty IS NULL OR (approved_qty BETWEEN 0 AND requested_qty));

-- จ่ายเกินที่อนุมัติไม่ได้ และจ่ายก่อนอนุมัติไม่ได้
ALTER TABLE public.asset_borrow_items
  DROP CONSTRAINT IF EXISTS asset_borrow_items_issued_qty_check;
ALTER TABLE public.asset_borrow_items
  ADD CONSTRAINT asset_borrow_items_issued_qty_check
  CHECK (issued_qty >= 0 AND issued_qty <= COALESCE(approved_qty, 0));

-- ยอดคืน+ชำรุด+สูญหาย ต้องไม่เกินที่จ่ายไป — กันตัวเลขที่ทำให้ของว่างติดลบ
ALTER TABLE public.asset_borrow_items
  DROP CONSTRAINT IF EXISTS asset_borrow_items_settle_qty_check;
ALTER TABLE public.asset_borrow_items
  ADD CONSTRAINT asset_borrow_items_settle_qty_check
  CHECK (
    returned_qty >= 0 AND damaged_qty >= 0 AND lost_qty >= 0
    AND returned_qty + damaged_qty + lost_qty <= issued_qty
  );

CREATE INDEX IF NOT EXISTS asset_borrow_items_request_idx
  ON public.asset_borrow_items (request_id, sort_order);

-- ⚠️ ของชิ้นเดียวกันซ้ำสองบรรทัดในใบเดียวไม่ได้ — ตอนอนุมัติ ระบบคิด "ของว่าง" ทีละบรรทัด
-- โดยกันคำขอใบนี้ออกจากยอดจอง ถ้ามีสองบรรทัดของ asset เดียวกัน บรรทัดที่สองจะมองไม่เห็น
-- ว่าบรรทัดแรกเพิ่งกินของไป แล้วอนุมัติรวมกันเกินจำนวนที่มีจริง
-- (ผู้ใช้ที่อยากได้เพิ่มให้แก้จำนวนในบรรทัดเดิม ไม่ใช่เพิ่มบรรทัด)
CREATE UNIQUE INDEX IF NOT EXISTS asset_borrow_items_request_asset_key
  ON public.asset_borrow_items (request_id, asset_id);

-- ใช้คำนวณ "ของว่างพร้อมให้ยืม" — ต้องกวาดเฉพาะแถวที่ยังกันของอยู่จริง
CREATE INDEX IF NOT EXISTS asset_borrow_items_asset_idx
  ON public.asset_borrow_items (asset_id, request_id);

-- ===========================================================================
-- 4. Audit trail — เขียนใน transaction เดียวกับทุก action ห้ามพึ่ง log ฝั่ง client
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.asset_borrow_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES public.asset_borrow_requests(request_id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- ชื่อผู้ทำ ณ ขณะนั้น — actor_id เป็น NULL ได้เมื่อลบบัญชี แต่ประวัติต้องยังอ่านออก
  actor_name      text,
  event_type      text NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.asset_borrow_events
  DROP CONSTRAINT IF EXISTS asset_borrow_events_type_check;
ALTER TABLE public.asset_borrow_events
  ADD CONSTRAINT asset_borrow_events_type_check
  CHECK (event_type IN (
    'created', 'approved', 'rejected', 'issued', 'returned',
    'settlement_opened', 'settled', 'due_date_extended', 'overdue_notified', 'cancelled'
  ));

CREATE INDEX IF NOT EXISTS asset_borrow_events_request_idx
  ON public.asset_borrow_events (request_id, created_at DESC);

COMMIT;
