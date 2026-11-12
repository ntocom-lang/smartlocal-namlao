-- โหมดขั้นตอนขอใช้รถราย อปท. (P1) — ตาราง/คอลัมน์ (ฟังก์ชันอยู่ไฟล์ถัดไป 20261121100100 ตามกติกาแยก DDL)
--
-- เจ้าของระบบตัดสิน 2026-11-12:
--   queue      = แบบเดิมทุกอย่าง (คิวรถอนุมัติอัตโนมัติ #168/#169 ออกรถได้ก่อนลงนาม) — ค่าเริ่มต้นของทุก อปท.
--   regulation = บังคับ "ได้รับอนุญาตก่อน" ตามระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙ ข้อ ๑๒ วรรคสาม
--                ระบบไม่ให้บันทึกออกรถจนกว่าผู้มีอำนาจ (หรือ ผอ.สำนัก/กองที่ได้รับมอบตามข้อ ๑๒ วรรคสี่) จะอนุญาต
--
-- "คิวรถ" กับ "การอนุญาต" แยกจากกัน: ไฟล์นี้ไม่แตะ status / approved_by / approval_method ของ fleet_trips
-- ไม่มีแถวตั้งค่า = queue ⇒ apply แล้ว อปท. ทุกแห่งทำงานเหมือนเดิมทุกอย่าง

-- ALTER TABLE fleet_trips ต้องได้ ACCESS EXCLUSIVE ชั่วครู่ — รอไม่เกิน 5 วินาที ไม่ให้คิวคำขอค้างหลัง lock
SET lock_timeout = '5s';

-- ── 1) ค่าตั้งราย อปท. (อ่าน/เขียนผ่าน RPC เท่านั้น) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_permit_settings (
  municipality_id      uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  permit_mode          text NOT NULL DEFAULT 'queue' CHECK (permit_mode IN ('queue', 'regulation')),
  -- ข้อ ๑๒ วรรคสี่: ผู้บริหารท้องถิ่นมอบหมายให้หัวหน้าหน่วยงาน (ข้อ ๕: หัวหน้าสำนัก/กอง) เป็นผู้อนุมัติ
  -- เปิดแล้วต้องมีเลขที่และวันที่คำสั่งมอบหมาย (หลักฐานให้ผู้ตรวจ)
  delegate_dept_heads  boolean NOT NULL DEFAULT false,
  delegation_ref       text CHECK (delegation_ref IS NULL OR char_length(delegation_ref) <= 200),
  delegation_date      date,
  updated_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_permit_settings_delegation_evidence CHECK (
    NOT delegate_dept_heads
    OR (NULLIF(btrim(delegation_ref), '') IS NOT NULL AND delegation_date IS NOT NULL)
  )
);

ALTER TABLE public.fleet_permit_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fleet_permit_settings FROM PUBLIC, anon, authenticated;

-- ── 2) บันทึกการอนุญาตจากใบกระดาษ (เพิ่มได้อย่างเดียว) ──────────────────────────────────────────
-- granted = ผู้ดูแลรถบันทึกว่าผู้มีอำนาจลงนามอนุญาตบนแบบ ๓ แล้ว (ชื่อ/ฐานะดึงจากทะเบียนผู้ลงนามที่ฝั่งเซิร์ฟเวอร์)
-- voided  = ยกเลิกแถว granted ที่บันทึกผิด พร้อมเหตุผล (แถวเดิมยังอยู่ให้ตรวจย้อน)
-- ไม่มี FK ไป fleet_trips โดยเจตนา (แบบเดียวกับ esign_signatures): ลบทริปแล้วหลักฐานยังอยู่
CREATE TABLE IF NOT EXISTS public.fleet_trip_permits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  trip_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('granted', 'voided')),
  basis            text CHECK (basis IN ('authority', 'delegated_dept_head')),
  signer_name      text CHECK (signer_name IS NULL OR char_length(signer_name) <= 250),
  signer_title     text CHECK (signer_title IS NULL OR char_length(signer_title) <= 300),
  registry_id      uuid,
  delegation_ref   text CHECK (delegation_ref IS NULL OR char_length(delegation_ref) <= 200),
  delegation_date  date,
  signed_on        date,
  -- เนื้อหาคำขอที่ผู้มีอำนาจอนุญาตบนกระดาษ (esign_content_hash(esign_fleet_trip_payload(trip)) ตอนบันทึก)
  -- แก้ปลายทาง/เวลา/วัตถุประสงค์ทีหลัง = hash ไม่ตรง = การอนุญาตนี้ไม่นับ ต้องขออนุญาตใหม่
  content_hash     text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  voids_id         uuid UNIQUE REFERENCES public.fleet_trip_permits(id) ON DELETE RESTRICT,
  reason           text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500),
  recorded_by      uuid,
  recorded_by_name text NOT NULL DEFAULT '',
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_trip_permits_shape CHECK (
    (kind = 'granted' AND basis IS NOT NULL AND NULLIF(btrim(signer_name), '') IS NOT NULL
       AND signed_on IS NOT NULL AND content_hash IS NOT NULL AND voids_id IS NULL AND reason IS NULL)
    OR (kind = 'voided' AND voids_id IS NOT NULL AND reason IS NOT NULL AND basis IS NULL)
  ),
  CONSTRAINT fleet_trip_permits_delegation_evidence CHECK (
    basis IS DISTINCT FROM 'delegated_dept_head'
    OR (NULLIF(btrim(delegation_ref), '') IS NOT NULL AND delegation_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fleet_trip_permits_trip ON public.fleet_trip_permits (trip_id, seq DESC);

ALTER TABLE public.fleet_trip_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fleet_trip_permits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.fleet_trip_permits_seq_seq FROM PUBLIC, anon, authenticated;

-- ── 3) โหมดตรึงต่อใบตอนยื่นคำขอ ──────────────────────────────────────────────────────────────
-- ค่าคงที่ + NOT NULL บน PG11 ขึ้นไปเป็นการแก้เมตาดาต้า ไม่เขียนแถวใหม่ทั้งตาราง · ใบเดิมทุกใบได้ queue
-- trigger ในไฟล์ถัดไปเป็นผู้ตั้งค่าเองตอน INSERT และห้ามแก้ทีหลัง (client ส่งมาก็ไม่รับ)
-- คอลัมน์ + CHECK ในคำสั่งเดียว (NOTES ข้อ 3: ADD CONSTRAINT ที่อ้างคอลัมน์ใหม่คนละคำสั่งเคยพัง 42703)
ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS permit_mode text NOT NULL DEFAULT 'queue'
    CONSTRAINT fleet_trips_permit_mode_check CHECK (permit_mode IN ('queue', 'regulation'));

COMMENT ON COLUMN public.fleet_trips.permit_mode IS
  'โหมดขั้นตอนอนุญาตที่ตรึงตอนยื่นคำขอ (queue = แบบเดิม, regulation = ต้องได้รับอนุญาตก่อนออกรถ) ตั้งโดย trigger เท่านั้น';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) from public.fleet_permit_settings;                         → 0
--   select permit_mode, count(*) from public.fleet_trips group by 1;           → queue เท่านั้น

RESET lock_timeout;
