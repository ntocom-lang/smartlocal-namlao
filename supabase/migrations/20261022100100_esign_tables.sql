-- 20261022100100_esign_tables.sql
--
-- [เฟสตาราง] ลงนามออนไลน์รายเรื่อง (ชุด A เฟส ๑) — CREATE TABLE เปล่าๆ ของตารางใหม่ทั้งหมด
-- ต้อง apply หลัง 20261022100000 (คอลัมน์ esign_*) ดัชนี/RLS/ฟังก์ชันอยู่ไฟล์สุดท้าย (NOTES.md ข้อ 3)
-- ออกแบบตามหน้า "ลงนามออนไลน์รายเรื่อง" (artifact 4kbW3jv53DK1veXQ8eJeQD) — อ่านตัวบทประกอบหัวข้อ 2 ของหน้านั้น
--
-- ── ตารางที่เพิ่ม ────────────────────────────────────────────────────────────────────────────
-- esign_tenant_policy        ประตูของ อปท. (G1 ประกาศ + หนังสือให้ความเห็นชอบ, G4 ยืนยันว่าทดลองแล้ว) ๑ แถวต่อ อปท.
-- esign_doc_type_settings    สวิตช์ อปท. × เรื่อง × ช่อง · ไม่มีแถว = เซ็นสดเหมือนเดิม
-- esign_signers              รหัสลงนาม (hash) + การรับทราบหน้าที่ + สถานะระงับ ของผู้ลงนามแต่ละคน
-- esign_signatures           ลายเซ็น — เพิ่มแถวอย่างเดียว (trigger ในไฟล์ที่ ๓ ห้ามแก้/ลบ/TRUNCATE)
-- esign_revocations          การถอนลายเซ็น — เพิ่มแถวอย่างเดียวเช่นกัน (ลายเซ็นที่ใช้ได้ = ไม่มีแถวถอน)
--
-- ── ทำไมไม่มี FK ไปโปรไฟล์ในตารางลายเซ็น ─────────────────────────────────────────────────────
-- signatures/revocations แก้ไม่ได้ จึงใช้ FK แบบ ON DELETE SET NULL/CASCADE ไม่ได้ (มันคือ UPDATE/DELETE แถวลายเซ็น)
-- และ ON DELETE RESTRICT ที่โปรไฟล์จะบล็อกการลบบุคลากรที่เคยลงนามไปตลอดกาล
-- จึงเก็บ signer_id เป็น uuid เปล่า คู่กับ "ภาพถ่าย" ชื่อ/ตำแหน่ง ณ ตอนลงนาม (signer_name, signer_position)
-- ส่วน municipality_id ใช้ ON DELETE RESTRICT: ลบ อปท. ที่มีลายเซ็นไม่ได้ ซึ่งตั้งใจ (หลักฐานราชการ)
--
-- ── ข้อมูลส่วนบุคคล ───────────────────────────────────────────────────────────────────────────
-- เก็บ: ชื่อ ตำแหน่ง ฐานะ เวลา hash และสำเนาเนื้อหาของคำขอ (เฉพาะฟิลด์ "คำขอ" ของแบบ ๓ ซึ่งไม่มีข้อมูลประชาชน)
-- ไม่เก็บ: ภาพลายเซ็น, IP, อุปกรณ์ — เฟส ๑ ใช้บัญชี + รหัสลงนาม + เวลาเซิร์ฟเวอร์เป็นหลักฐานตัวตน (ให้ DPO ยืนยัน)

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fleet_trips' AND column_name = 'esign_verify_code'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261022100000_esign_columns.sql ก่อน';
  END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.esign_tenant_policy (
  municipality_id    uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  announcement_no    text NOT NULL CHECK (char_length(btrim(announcement_no)) BETWEEN 1 AND 200),
  announcement_date  date NOT NULL,
  -- หนังสือให้ความเห็นชอบตาม พ.ร.ฎ.ธุรกรรมอิเล็กทรอนิกส์ภาครัฐ ม.๗ หรือคำชี้แจงว่าไม่ต้องขอ — บังคับกรอกเพื่อไม่ให้ข้ามเงียบๆ
  approval_ref       text NOT NULL CHECK (char_length(btrim(approval_ref)) BETWEEN 3 AND 500),
  announcement_url   text CHECK (announcement_url IS NULL OR char_length(announcement_url) <= 1000),
  trial_confirmed_at timestamptz,
  adopted_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  adopted_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.esign_doc_type_settings (
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  doc_type        text NOT NULL CHECK (doc_type IN ('fleet_trip_request')),
  -- {"requester":"online|wet","dept_head":...,"authority":...,"sk1":...} — ครบทุกช่อง ค่าเดียวที่อนุญาตคือ online/wet
  slot_modes      jsonb NOT NULL CHECK (jsonb_typeof(slot_modes) = 'object'),
  enabled_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  enabled_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipality_id, doc_type)
);

CREATE TABLE IF NOT EXISTS public.esign_signers (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash          text,
  pin_set_at        timestamptz,
  failed_count      integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until      timestamptz,
  duty_ack_at       timestamptz,
  duty_ack_version  text,
  suspended_at      timestamptz,
  suspended_reason  text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 500),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.esign_signatures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id       uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  doc_type              text NOT NULL CHECK (doc_type IN ('fleet_trip_request')),
  doc_id                uuid NOT NULL,
  slot                  text NOT NULL CHECK (slot IN ('requester', 'dept_head', 'authority', 'sk1')),
  signer_id             uuid NOT NULL,
  signer_name           text NOT NULL,
  signer_position       text NOT NULL DEFAULT '',
  -- ฐานะที่ลงนาม เช่น "รักษาราชการแทนผู้อำนวยการกองช่าง" จากทะเบียนผู้ลงนามกลาง (ไม่ให้ผู้ลงนามพิมพ์เอง)
  signed_as             text NOT NULL DEFAULT '',
  decision              text NOT NULL DEFAULT 'sign' CHECK (decision IN ('sign', 'approve')),
  registry_signatory_id uuid,
  content_hash          text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  content_snapshot      jsonb NOT NULL,
  template_version      text NOT NULL,
  signed_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.esign_revocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id    uuid NOT NULL UNIQUE REFERENCES public.esign_signatures(id) ON DELETE RESTRICT,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  revoked_by      uuid,
  revoked_by_name text NOT NULL DEFAULT '',
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  revoked_at      timestamptz NOT NULL DEFAULT now()
);

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) from public.esign_signatures;          → 0
--   select count(*) from public.esign_doc_type_settings;   → 0   (ไม่มีแถว = ทุก อปท. ยังเซ็นสดเหมือนเดิม)
