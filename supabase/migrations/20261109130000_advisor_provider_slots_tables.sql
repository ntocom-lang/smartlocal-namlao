-- ที่ปรึกษา AI เฉพาะ Super Admin รอบ 2 ไฟล์ 1/2 — ตาราง "ช่องผู้ให้บริการ" 3 ช่อง + คอลัมน์บันทึกการสลับ (เจ้าของระบบอนุมัติ 2569-11-08)
--   ไฟล์ 2 (20261109130100) ใส่ policy / GRANT / trigger / แถวเริ่มต้น / ฟังก์ชัน key ใน Vault — แยกไฟล์ตามกติกา "1 ไฟล์ = 1 เฟส"
--   ต้องรันหลัง 20261109120000 + 20261109120100 (รอบ 1 — เจ้าของยืนยันรันฐานจริงแล้ว 2569-11-08)
--
-- ที่มา: เจ้าของระบบ "ยกเว้นหลัก $0 เฉพาะเมนูนี้" ให้ใช้ Claude API และ Gemini แบบจ่ายเงินได้
--   ลำดับที่เจ้าของกำหนด: ช่อง 1 Claude → ช่อง 2 Gemini (จ่ายเงิน) → ช่อง 3 Gemini ฟรี
--   คำถามเดียวกัน ถ้าช่องหนึ่งหมด/ล่ม Edge Function สลับไปช่องถัดไปเอง และพักช่องที่หมดไว้จนพ้นเวลา (paused_until)
--
-- advisor_provider_slots  แถวละ 1 ช่อง (slot 1–3) — ตัว key ไม่อยู่ในตารางนี้ อยู่ใน Supabase Vault (เข้ารหัส)
--                         ตารางเก็บแค่ id ของ secret + เลข 4 ตัวท้ายไว้แสดง
--   enabled / model / daily_cap  superadmin ตั้งเอง (daily_cap ว่าง = ไม่จำกัด)
--   key_invalid_at               Edge Function ประทับเมื่อผู้ให้บริการตอบ 401/403 (key ผิด/ถูกเพิกถอน) → ข้ามจนกว่าจะใส่ key ใหม่
--   paused_until / pause_reason  Edge Function ประทับเมื่อเครดิตหมด/โควตาเต็ม → ข้ามจนพ้นเวลาแล้วลองเอง
--
-- advisor_messages เพิ่ม
--   slot / provider   ช่องที่ตอบจริง (แถวรอบ 1 ว่าง = Gemini ฟรีจาก GEMINI_API_KEY)
--   route_note        เหตุผลการสลับที่ระบบเขียนเอง เช่น "Claude: เครดิตหมด (พักถึง 14:30)" — ไม่มีข้อความผู้ใช้
--   context_snapshot  ภาพรวมระบบ (ตัวเลขรวม) ที่แนบออกไปกับคำถามนั้นจริง เก็บไว้ตรวจย้อนว่าส่งอะไรออกนอกระบบ
--
-- advisor_settings.model / daily_cap ของรอบ 1 เลิกใช้หลังรอบ 2 (Edge Function อ่านจากช่องแทน) — ไม่ DROP เพื่อย้อนกลับได้
--   advisor_settings.enabled ยังเป็นสวิตช์ปิดทั้งเมนู
--
-- ⚠️ เปิด RLS + ถอนสิทธิ์ anon ในไฟล์นี้เลย (บทเรียนรอบ 1): หลัง COMMIT PostgREST เห็นตารางทันที
--    ไม่ถอน S/I/U/D ของ authenticated ที่นี่ (รันไฟล์นี้ซ้ำหลังไฟล์ 2 จะลบสิทธิ์ที่ไฟล์ 2 ให้) — ช่วงยังไม่มี policy RLS ปฏิเสธทุกแถว
-- updated_by ไม่ใส่ FK โดยตั้งใจ (บทเรียน #658)
--
-- ย้อนกลับ: ใช้ชุดคำสั่งย้อนกลับในหัวไฟล์ 2 (ลบ key ใน Vault + ฟังก์ชันก่อน) หรือถ้ารันแค่ไฟล์นี้:
--   BEGIN; SET LOCAL lock_timeout = '5s';
--   DROP TABLE public.advisor_provider_slots;
--   ALTER TABLE public.advisor_messages DROP COLUMN slot, DROP COLUMN provider, DROP COLUMN route_note, DROP COLUMN context_snapshot;
--   COMMIT;
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.advisor_messages') IS NULL OR to_regclass('public.advisor_settings') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน migration รอบ 1 (20261109120000 + 20261109120100) ก่อน';
  END IF;
  -- IF NOT EXISTS ข้ามเงียบๆ ถ้ามีของชื่อชนแต่หน้าตาต่าง → ตรวจเองก่อน (ข้อสังเกตผู้ตรวจ migration)
  IF to_regclass('public.advisor_provider_slots') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'advisor_provider_slots' AND column_name = 'key_secret_id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'Schema drift: มีตาราง advisor_provider_slots อยู่แล้วแต่โครงสร้างไม่ตรง';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'advisor_messages'
               AND ((column_name = 'slot' AND data_type <> 'smallint')
                 OR (column_name IN ('provider', 'route_note') AND data_type <> 'text')
                 OR (column_name = 'context_snapshot' AND data_type <> 'jsonb'))) THEN
    RAISE EXCEPTION 'Schema drift: advisor_messages มีคอลัมน์ชื่อชนแต่ชนิดไม่ตรง';
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.advisor_provider_slots (
  slot smallint PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
  provider text NOT NULL CHECK (provider IN ('claude', 'gemini')),
  tier text NOT NULL CHECK (tier IN ('paid', 'free')),
  enabled boolean NOT NULL DEFAULT true,
  -- ชื่อโมเดลถูกต่อลง URL/ส่งเป็นพารามิเตอร์ใน Edge Function — จำกัดตัวอักษรที่ฐานข้อมูลอีกชั้น (แบบเดียวกับรอบ 1)
  model text NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9.-]{1,62}$'),
  daily_cap integer CHECK (daily_cap IS NULL OR daily_cap BETWEEN 1 AND 10000),
  key_secret_id uuid,
  key_last4 text CHECK (key_last4 IS NULL OR length(key_last4) = 4),
  key_set_at timestamptz,
  key_invalid_at timestamptz,
  paused_until timestamptz,
  pause_reason text CHECK (pause_reason IS NULL OR pause_reason IN ('billing', 'rate_limit', 'quota')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  -- มี key ต้องมีเลขท้าย และกลับกัน (กันแสดง ••••xxxx ของ key ที่ลบไปแล้ว)
  CONSTRAINT advisor_provider_slots_key_pair CHECK ((key_secret_id IS NULL) = (key_last4 IS NULL)),
  CONSTRAINT advisor_provider_slots_pause_pair CHECK ((paused_until IS NULL) = (pause_reason IS NULL))
);

ALTER TABLE public.advisor_messages
  ADD COLUMN IF NOT EXISTS slot smallint CHECK (slot IS NULL OR slot BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS provider text CHECK (provider IS NULL OR provider IN ('claude', 'gemini')),
  ADD COLUMN IF NOT EXISTS route_note text CHECK (route_note IS NULL OR length(route_note) <= 1000),
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb CHECK (context_snapshot IS NULL OR pg_column_size(context_snapshot) <= 200000);

-- index ของคอลัมน์ slot อยู่ไฟล์ 2 (กติกา: ADD COLUMN แล้วอ้างคอลัมน์นั้นในไฟล์เดียวกันไม่ได้ — NOTES ข้อ 3)

ALTER TABLE public.advisor_provider_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.advisor_provider_slots FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.advisor_provider_slots FROM authenticated;

COMMIT;
