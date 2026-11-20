-- 20261222100000_waste_fee_tables.sql
-- ขั้น 1B ทะเบียนลูกหนี้ค่าขยะ PR1 ไฟล์ 1/2 — ตารางใหม่ 4 ตาราง (RLS เปิด ยังไม่มี policy = ปฏิเสธทุกคน จนกว่าไฟล์ 2 วางสิทธิ์)
--   เจ้าของระบบอนุมัติ 2569-11-20 ("ตามแนะนำ"):
--     PR1 = ทะเบียนบัญชีผู้ชำระ + อัตราหลายรุ่นตามวันมีผล + ตัวคำนวณยอดรายเดือน (ยังไม่สร้างยอดค้าง ไม่แตะ payment_dues / ฟังก์ชัน 1C)
--     ลดค่ากำจัดกึ่งหนึ่งเมื่อคัดแยก = เจ้าหน้าที่ยืนยันรายบัญชี มีผลตั้งแต่เดือนที่ยืนยัน ไม่ย้อนหลัง (ไฟล์ 2: wfee_set_sorting)
--       เก็บเป็น "ช่วงเวลา" แยกตาราง — เปิด/เลิก/เปิดใหม่ ไม่ลบช่วงที่เคยได้ลด (ผลตรวจรอบ 1 ข้อ A1)
--     ยกเว้นเขตประสบสาธารณภัย = PR3 (กฎตามเลขประกาศเขต + หมู่ + ช่วงวันที่) ไม่ใช่ปุ่มยกเว้นหนี้รายคน
--     ไม่ใส่อัตราเริ่มต้นให้ อปท. จริง (ข้อบัญญัติแต่ละแห่งต่างกัน) — demo ได้แถวตัวอย่างที่ติดป้าย is_example
--
--   ตัวบทที่ใช้ออกแบบ (เทศบัญญัติ ทต.สาวร้องไห้ จ.อ่างทอง เรื่อง อัตราค่าธรรมเนียมฯ พ.ศ. ๒๕๖๘ + ประกาศขยายเวลาบังคับใช้
--   ลงวันที่ ๑๗ พ.ย. ๒๕๖๘ — เอกสาร อปท. ที่อ้างกฎกระทรวง ยังไม่ได้เปิดราชกิจจาฯ เอง ต้องยืนยันกับฉบับปัจจุบัน):
--     กฎกระทรวงกำหนดอัตราค่าธรรมเนียมและการยกเว้นค่าธรรมเนียมเกี่ยวกับการจัดการสิ่งปฏิกูลและมูลฝอย พ.ศ. ๒๕๖๗
--       (ราชกิจจาฯ เล่ม ๑๔๑ ตอน ๗๑ ก ๒๒ พ.ย. ๒๕๖๗) · ฉบับที่ ๒ พ.ศ. ๒๕๖๘ เลื่อนหมวดค่าเก็บขน/กำจัด/ลด/ยกเว้น เป็น ๑๗ พ.ย. ๒๕๖๙
--     รายเดือน (เทศบัญญัติข้อ ๖–๗): ค่าเก็บขน + ค่ากำจัด แยกสองส่วน · ≤๑๒๐ กก. (๖๐๐ ล.) อัตราเหมา
--       (ข) "ให้เก็บตาม (ก) สำหรับส่วนที่ไม่เกิน ๑๒๐ กก. และสำหรับส่วนที่เกิน … คิดเป็นหน่วย หน่วยละ ๑๒๐ กก." ⇒ อัตราหน่วยคิดเฉพาะส่วนเกิน
--       (ค) ส่วนเกิน ๓,๖๐๐ กก. (๓๐ หน่วย) อัตราต่อหน่วยอีกขั้น · อัตราขึ้นเป็นขั้นตามช่วงปีในข้อบัญญัติฉบับเดียว
--     ข้อ ๑๐ ปัดเศษ: เศษไม่เกินกึ่งหน่วย = กึ่งหน่วย · เกินกึ่ง = หนึ่งหน่วย ⇒ เก็บปริมาณเป็นหน่วย ทีละ 0.5 (ไฟล์ 2 ปัดขึ้นให้)
--     หมวด ๓ ลดค่ากำจัดกึ่งหนึ่งเมื่อคัดแยกครบตามประเภท · หมวด ๔ ยกเว้นเฉพาะเขตประสบสาธารณภัยธรรมชาติ (PR3)
--     ข้อบัญญัติเดิม (ก่อน ๑๗ พ.ย. ๒๕๖๙) มักเก็บเหมาตามประเภทสถานที่ ⇒ อัตรามี 2 แบบ basis = units / place_type
--
--   waste_fee_rates            อัตราราย อปท. หลายรุ่น — รุ่นที่ใช้กับเดือนใด = effective_from ล่าสุดที่ ≤ วันที่ 1 ของเดือนนั้น
--                              (สมมติฐาน: ไม่คิดตามสัดส่วนวัน — ต้องยืนยันกับหนังสือ สถ. มท ๐๘๒๑.๒/ว ๖๓๒๐)
--   waste_fee_accounts         บัญชีผู้ชำระค่าธรรมเนียมรายเดือน 1 แถว/สถานที่
--   waste_fee_sorting_periods  ช่วงเดือนที่ได้ลดค่ากำจัด (คัดแยก) — เขียนผ่าน wfee_set_sorting() เท่านั้น ไม่มีการลบช่วงที่เริ่มแล้ว
--   waste_fee_events           ประวัติ ระบบเขียนเอง เขียนเพิ่มอย่างเดียว
--
--   - ไม่เก็บเลขประจำตัวประชาชน (ไม่จำเป็นต่อการแจ้งหนี้ — PDPA เก็บเท่าที่จำเป็น)
--   - ยังไม่มีช่องผูกบัญชีประชาชน (PR2 เพิ่มพร้อม policy ฝั่งประชาชน — ห้ามค้นด้วยบ้านเลขที่/ชื่อ)
--   - created_by / updated_by / actor / confirmed_by / ended_by ไม่ใส่ FK โดยตั้งใจ (บัญชีที่ลาออก/ถูกรวมต้องลบได้ — บทเรียน #658)
--   - FK ระหว่างตารางใหม่อยู่ในไฟล์นี้ได้ เพราะไม่มีฟังก์ชัน/trigger อ้างตารางใหม่ (NOTES ข้อ 3)
--   - ก่อน PR2 ออกยอดจริง (ผลตรวจรอบ 1 ข้อ B10): ยอดต้องเก็บเป็น snapshot · ล็อกรุ่นอัตราที่ถูกใช้ (FK RESTRICT)
--     · กันแก้ service_from/closed_from ย้อนเข้าเดือนที่ออกยอดแล้ว · ปฏิเสธอัตรา is_example
--
-- ย้อนกลับ (ถ้ามีข้อมูลจริงแล้ว export ก่อน): DROP TABLE public.waste_fee_events, public.waste_fee_sorting_periods,
--           public.waste_fee_accounts, public.waste_fee_rates; แล้วลบแถว 20261222100000 ใน supabase_migrations.schema_migrations
--           (ไฟล์ 2 ต้องย้อนก่อน)
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.municipalities') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ municipalities';
  END IF;
  IF to_regclass('public.waste_fee_rates') IS NOT NULL OR to_regclass('public.waste_fee_accounts') IS NOT NULL
     OR to_regclass('public.waste_fee_sorting_periods') IS NOT NULL OR to_regclass('public.waste_fee_events') IS NOT NULL THEN
    RAISE EXCEPTION 'มีตาราง waste_fee_* อยู่แล้ว — อาจมี session อื่นรันไปก่อน ตรวจ npm run work:active';
  END IF;
END $guard$;

-- ── 1) อัตราหลายรุ่นตามวันมีผล ─────────────────────────────────────────────────────────
CREATE TABLE public.waste_fee_rates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id    uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  effective_from     date NOT NULL,
  -- ข้อบัญญัติที่ให้อำนาจ + ข้อ เช่น "เทศบัญญัติ … พ.ศ. ๒๕๖๘ ข้อ ๖–๗" (ย้อนตรวจได้ว่ายอดมาจากไหน)
  ordinance_ref      text NOT NULL CHECK (length(btrim(ordinance_ref)) BETWEEN 3 AND 300),
  -- units = ตามกฎกระทรวง ๒๕๖๗ (ค่าเก็บขน + ค่ากำจัด ตามหน่วย ๑๒๐ กก.) · place_type = เหมาตามประเภทสถานที่ (ข้อบัญญัติเดิม)
  basis              text NOT NULL CHECK (basis IN ('units', 'place_type')),
  base_collect       numeric(10, 2) CHECK (base_collect IS NULL OR base_collect BETWEEN 0 AND 100000),     -- ≤ ๑ หน่วย
  base_dispose       numeric(10, 2) CHECK (base_dispose IS NULL OR base_dispose BETWEEN 0 AND 100000),
  unit_collect       numeric(10, 2) CHECK (unit_collect IS NULL OR unit_collect BETWEEN 0 AND 100000),     -- ต่อหน่วยส่วนเกิน ๑–๓๐
  unit_dispose       numeric(10, 2) CHECK (unit_dispose IS NULL OR unit_dispose BETWEEN 0 AND 100000),
  big_unit_collect   numeric(10, 2) CHECK (big_unit_collect IS NULL OR big_unit_collect BETWEEN 0 AND 100000),  -- ต่อหน่วยส่วนเกิน ๓๐
  big_unit_dispose   numeric(10, 2) CHECK (big_unit_dispose IS NULL OR big_unit_dispose BETWEEN 0 AND 100000),
  -- เหมารายเดือนตามประเภทสถานที่ {"house": 20, "shop": 40, ...} (คีย์ตาม waste_fee_accounts.place_type)
  place_type_rates   jsonb,
  -- ข้อบัญญัติรุ่นนี้มีหมวดลดค่ากำจัดกึ่งหนึ่งเมื่อคัดแยก (หมวด ๓) หรือไม่
  sorting_discount   boolean NOT NULL DEFAULT false,
  is_example         boolean NOT NULL DEFAULT false,   -- แถวตัวอย่างของ demo — หน้าจอขึ้นป้ายเตือนให้แก้ตามข้อบัญญัติจริง
  note               text CHECK (note IS NULL OR length(note) <= 2000),
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waste_fee_rates_effective_unique UNIQUE (municipality_id, effective_from),
  CONSTRAINT waste_fee_rates_units_shape CHECK (basis <> 'units' OR (
    base_collect IS NOT NULL AND base_dispose IS NOT NULL AND place_type_rates IS NULL
    AND (unit_collect IS NULL) = (unit_dispose IS NULL)
    AND (big_unit_collect IS NULL) = (big_unit_dispose IS NULL)
    AND (big_unit_collect IS NULL OR unit_collect IS NOT NULL))),
  CONSTRAINT waste_fee_rates_place_shape CHECK (basis <> 'place_type' OR (
    place_type_rates IS NOT NULL AND jsonb_typeof(place_type_rates) = 'object'
    AND base_collect IS NULL AND base_dispose IS NULL AND unit_collect IS NULL AND unit_dispose IS NULL
    AND big_unit_collect IS NULL AND big_unit_dispose IS NULL
    AND NOT sorting_discount)),
  CONSTRAINT waste_fee_rates_id_muni_unique UNIQUE (id, municipality_id)
);

-- ── 2) บัญชีผู้ชำระ ───────────────────────────────────────────────────────────────────
CREATE TABLE public.waste_fee_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id        uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  account_no             text CHECK (account_no IS NULL OR length(btrim(account_no)) BETWEEN 1 AND 40),  -- เลขทะเบียนเดิมของ อปท.
  payer_name             text NOT NULL CHECK (length(btrim(payer_name)) BETWEEN 1 AND 200),
  payer_phone            text CHECK (payer_phone IS NULL OR payer_phone ~ '^[0-9+\- ]{6,20}$'),
  house_no               text CHECK (house_no IS NULL OR length(btrim(house_no)) BETWEEN 1 AND 50),
  village                text CHECK (village IS NULL OR length(village) <= 100),
  address                text CHECK (address IS NULL OR length(address) <= 500),
  place_type             text NOT NULL DEFAULT 'house'
                           CHECK (place_type IN ('house', 'shop', 'business', 'agency', 'other')),
  -- ปริมาณต่อเดือนเป็นหน่วย ๑๒๐ กก. ทีละกึ่งหน่วย (ข้อ ๑๐) · 1 = ไม่เกิน ๑๒๐ กก.
  -- numeric ไม่กำหนด scale โดยตั้งใจ: numeric(7,1) ปัด 1.04 → 1.0 เงียบก่อน trigger (ผลตรวจรอบ 1 ข้อ A3) — ไฟล์ 2 ปัดขึ้นตามข้อ ๑๐
  monthly_units          numeric NOT NULL DEFAULT 1
                           CHECK (monthly_units > 0 AND monthly_units <= 10000 AND monthly_units * 2 = trunc(monthly_units * 2)),
  service_from           date NOT NULL,      -- เดือนแรกที่เก็บค่าธรรมเนียม (วันที่ 1 ของเดือน — ไฟล์ 2 ปัดให้)
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closed_from            date,               -- เดือนแรกที่ไม่เก็บแล้ว (วันที่ 1 ของเดือน)
  closed_reason          text CHECK (closed_reason IS NULL OR length(closed_reason) <= 1000),
  note                   text CHECK (note IS NULL OR length(note) <= 2000),
  import_batch           uuid,               -- ชุดนำเข้าจาก Excel
  created_by             uuid,
  updated_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waste_fee_accounts_closed_shape CHECK ((status = 'closed') = (closed_from IS NOT NULL)
                                                   AND (status <> 'closed' OR closed_reason IS NOT NULL)),
  CONSTRAINT waste_fee_accounts_closed_after CHECK (closed_from IS NULL OR closed_from > service_from),
  CONSTRAINT waste_fee_accounts_id_muni_unique UNIQUE (id, municipality_id)
);
CREATE UNIQUE INDEX waste_fee_accounts_no_unique
  ON public.waste_fee_accounts (municipality_id, account_no) WHERE account_no IS NOT NULL;
CREATE INDEX waste_fee_accounts_muni_idx ON public.waste_fee_accounts (municipality_id, status, village);
CREATE INDEX waste_fee_accounts_batch_idx ON public.waste_fee_accounts (import_batch) WHERE import_batch IS NOT NULL;

-- ── 3) ช่วงที่ได้ลดค่ากำจัด (คัดแยก หมวด ๓) ────────────────────────────────────────────
-- ได้ลดในเดือน m ⇔ starts_on ≤ m และ (ends_on ว่าง หรือ m < ends_on) · ยังลดอยู่ได้ไม่เกิน 1 ช่วงต่อบัญชี
CREATE TABLE public.waste_fee_sorting_periods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL,
  starts_on        date NOT NULL,            -- เดือนแรกที่ได้ลด (วันที่ 1)
  ends_on          date,                     -- เดือนแรกที่ไม่ลดแล้ว (วันที่ 1) · NULL = ยังลดอยู่
  note             text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 1000),   -- เหตุผล/หลักฐานการคัดแยก
  confirmed_by     uuid,
  confirmed_at     timestamptz NOT NULL DEFAULT now(),
  ended_by         uuid,
  ended_at         timestamptz,
  end_note         text CHECK (end_note IS NULL OR length(end_note) <= 1000),
  CONSTRAINT waste_fee_sorting_periods_order CHECK (ends_on IS NULL OR ends_on > starts_on),
  CONSTRAINT waste_fee_sorting_periods_month CHECK (starts_on = date_trunc('month', starts_on::timestamp)::date
                                                    AND (ends_on IS NULL OR ends_on = date_trunc('month', ends_on::timestamp)::date)),
  CONSTRAINT waste_fee_sorting_periods_end_shape CHECK ((ends_on IS NULL) = (ended_at IS NULL))
);
CREATE UNIQUE INDEX waste_fee_sorting_periods_one_open
  ON public.waste_fee_sorting_periods (account_id) WHERE ends_on IS NULL;
CREATE INDEX waste_fee_sorting_periods_account_idx ON public.waste_fee_sorting_periods (account_id, starts_on);

-- ── 4) ประวัติ ────────────────────────────────────────────────────────────────────────
CREATE TABLE public.waste_fee_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  entity           text NOT NULL CHECK (entity IN ('rate', 'account')),
  entity_id        uuid NOT NULL,            -- ไม่ใส่ FK: ประวัติต้องอยู่ต่อแม้แถวถูกลบ
  action           text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'sorting')),
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason           text CHECK (reason IS NULL OR length(reason) <= 2000),
  actor            uuid,                     -- NULL = ระบบ / SQL ของผู้ดูแล
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waste_fee_events_entity_idx ON public.waste_fee_events (entity_id, created_at);
CREATE INDEX waste_fee_events_muni_idx ON public.waste_fee_events (municipality_id, created_at);

-- ── FK ระหว่างตารางใหม่ (คู่ id + อปท. ⇒ ช่วงส่วนลดอยู่ อปท. เดียวกับบัญชีเสมอ) ─────────────────
ALTER TABLE public.waste_fee_sorting_periods ADD CONSTRAINT waste_fee_sorting_periods_account_fk
  FOREIGN KEY (account_id, municipality_id) REFERENCES public.waste_fee_accounts (id, municipality_id) ON DELETE CASCADE;

ALTER TABLE public.waste_fee_rates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_fee_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_fee_sorting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waste_fee_events          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.waste_fee_rates, public.waste_fee_accounts, public.waste_fee_sorting_periods, public.waste_fee_events
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.waste_fee_events_id_seq FROM PUBLIC, anon, authenticated;

COMMIT;
