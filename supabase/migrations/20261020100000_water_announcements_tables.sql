-- สถานการณ์น้ำ-ฝน เฟส 2 (ประกาศของ อบต. ที่มีผู้ยืนยัน) PR 2.1 ไฟล์ 1/2 — ตาราง
-- (สิทธิ์/ฟังก์ชัน/cron อยู่ 20261020100100 · แยกไฟล์ตามกติกาแยก DDL ตามเฟส)
--
-- หลักการ (ห้ามข้ามเส้น): การประกาศเตือนภัยเป็นดุลพินิจและอำนาจของผู้บริหารท้องถิ่น
--   ระบบ "ร่าง" ข้อความจากค่าที่วัดได้ → คนที่มีสิทธิ์ "กดยืนยัน" ครั้งเดียว → จึงขึ้นหน้าประชาชน
--   ไม่มีคนกดยืนยัน = ไม่มีอะไรออก · ระบบไม่ประกาศแทน ไม่สั่งอพยพ ไม่ประเมินความเสียหาย
--   ⚠️ ผู้มีอำนาจประกาศตามกฎหมาย/แผนป้องกันและบรรเทาสาธารณภัยของ อบต. ต้องยืนยันกับตัวบทฉบับปัจจุบันก่อนเปิดใช้กับ อปท. จริง
--      (ไม่ได้อ้างเลขมาตราหรือชื่อกฎหมายไว้ในโค้ดนี้) — จึงปิดเป็นค่าเริ่มต้น เปิดทีละ อปท. ด้วย water_announcement_settings.enabled
--
-- ตาราง (ปิดสนิท ไม่มี policy — อ่าน/เขียนผ่านฟังก์ชัน SECURITY DEFINER เท่านั้น):
--   water_announcement_settings  1 แถวต่อ อปท. ที่เปิดใช้ (เปิด/ปิดได้ทันที = สวิตช์ตัดการแสดงประกาศ)
--   water_announcements          1 แถวต่อประกาศ: ข้อความที่ร่างให้ + สถานะ + เวลาเผยแพร่/หมดอายุ
--                                ข้อความที่ผู้มีสิทธิ์ยืนยันคือข้อความเดียวกับที่ระบบร่าง แก้ไม่ได้ (trigger ล็อก)
-- บันทึกย้อนตรวจ: การยืนยัน/ไม่ประกาศ/ยกเลิกของคน เขียนลง audit_logs เดิม (ทำในไฟล์ 2)
--
-- ไม่เก็บชื่อ เบอร์ หรือพิกัดของบุคคลใด (ข้อความมีแต่ค่าที่สถานีวัดได้ + ชื่อสถานี)
-- ไฟล์นี้สร้างของใหม่ล้วน ไม่แตะตาราง/ฟังก์ชันเดิม apply ก่อน deploy ได้ปลอดภัย
-- ย้อนได้ด้วย: DROP TABLE public.water_announcements; DROP TABLE public.water_announcement_settings;

DO $$
BEGIN
  IF to_regclass('public.municipalities') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง municipalities';
  END IF;
  IF to_regclass('public.water_events') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261016100000_water_events_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง profiles';
  END IF;
END;
$$;

BEGIN;

-- ตั้งค่าต่อ อปท. — ค่าเริ่มต้น "ปิด" ไม่มีแถว = ปิด · ไม่เพิ่มคอลัมน์ใน municipalities (กับดัก column-level GRANT)
CREATE TABLE IF NOT EXISTS public.water_announcement_settings (
  municipality_id      uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  enabled              boolean     NOT NULL DEFAULT false,
  -- อายุประกาศตอนกดยืนยัน (ชม.) — ลืมปิดต้องไม่ค้างหลอกคน · สูงสุด 72 ชม. ตามที่ออกแบบไว้
  default_expiry_hours integer     NOT NULL DEFAULT 24 CHECK (default_expiry_hours BETWEEN 1 AND 72),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.water_announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- เหตุการณ์ที่ระบบร่างให้ (water_events) — เหตุการณ์ถูกลบไม่ลบประกาศ (เก็บเป็นบันทึก)
  event_id        uuid        REFERENCES public.water_events(id) ON DELETE SET NULL,
  -- draft = ระบบร่างรอคนยืนยัน · published = ผู้มีสิทธิ์ยืนยันแล้ว (หมดอายุตาม expires_at — คำนวณจากเวลา ไม่ต้องรอ cron)
  -- declined = ผู้มีสิทธิ์เลือกไม่ประกาศ · cancelled = ยกเลิกหลังเผยแพร่ · superseded = ถูกฉบับใหม่แทน
  -- expired = เผยแพร่ครบอายุแล้ว (cron/ฟังก์ชันเก็บกวาดสถานะ — หน้าประชาชนตัดสินจาก expires_at เองไม่ต้องรอ)
  -- lapsed = ร่างที่ไม่ได้ใช้ (เก่าเกินอายุ/เหตุการณ์สิ้นสุดก่อนมีคนยืนยัน) — ไม่เคยขึ้นหน้าประชาชน
  status          text        NOT NULL CHECK (status IN ('draft', 'published', 'declined', 'cancelled', 'superseded', 'expired', 'lapsed')),
  body            text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1500),
  -- สิ่งที่ระบบใช้ร่าง: {"rule_version":1,"event_opened_at":…,"triggers":[…ตาม water_events.open_reason…]}
  facts           jsonb       NOT NULL,
  drafted_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  expires_at      timestamptz,
  published_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- เวลาที่ฉบับนี้เลิกเป็น "ฉบับปัจจุบัน" ด้วยการตัดสินของคนหรือระบบ (ไม่ใช่การหมดอายุตามเวลา)
  closed_at       timestamptz,
  closed_by       uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT water_announcements_shape CHECK (
    (status IN ('published', 'cancelled', 'superseded', 'expired')
       AND published_at IS NOT NULL AND expires_at IS NOT NULL
       AND expires_at > published_at AND expires_at <= published_at + interval '72 hours')
    OR (status IN ('draft', 'declined', 'lapsed') AND published_at IS NULL AND expires_at IS NULL)
  ),
  CONSTRAINT water_announcements_closed_shape CHECK (
    (status IN ('draft', 'published') AND closed_at IS NULL)
    OR (status IN ('declined', 'cancelled', 'superseded', 'expired', 'lapsed') AND closed_at IS NOT NULL)
  )
);

-- อปท. หนึ่งมีร่างรอยืนยันได้ทีละฉบับ และฉบับที่เผยแพร่ค้างอยู่ได้ทีละฉบับ
-- (ยืนยันฉบับใหม่ = ฉบับเก่าถูกแทนที่ในธุรกรรมเดียวกัน · คลิกซ้ำ/สองคนกดพร้อมกันชนที่นี่ ไม่ออกซ้ำ)
CREATE UNIQUE INDEX IF NOT EXISTS water_announcements_one_draft_idx
  ON public.water_announcements (municipality_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS water_announcements_one_published_idx
  ON public.water_announcements (municipality_id) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS water_announcements_muni_drafted_idx
  ON public.water_announcements (municipality_id, drafted_at DESC);

COMMIT;
