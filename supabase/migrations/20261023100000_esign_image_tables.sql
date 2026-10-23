-- ลงนามออนไลน์รายเรื่อง — ชุด S1 (1/2): ตารางเก็บ "ภาพลายเซ็น" (เจ้าของระบบสั่ง 2026-10-23 ให้ทำแบบ Smart E-Office)
-- ไฟล์นี้ CREATE TABLE เปล่าๆ อย่างเดียว (ดัชนี/trigger/RLS/ฟังก์ชันอยู่ไฟล์ 2/2) ตาม docs/ai/NOTES.md ข้อ 3
--
-- ภาพลายเซ็น = ข้อมูลส่วนบุคคล (PDPA) จึงออกแบบให้เปิดเผยน้อยที่สุด:
--   - ไม่มี GRANT/policy ให้ใครอ่านตารางตรงๆ ทุกอย่างผ่านฟังก์ชัน SECURITY DEFINER ในไฟล์ 2/2
--   - เก็บเฉพาะ PNG เล็กๆ ที่ตรวจโครงสร้างแล้ว (≤ 50,000 ไบต์ ≤ 640×320 px) เบราว์เซอร์แปลงผ่าน canvas จึงไม่มี metadata (EXIF ฯลฯ)
--   - ภาพที่ใช้ลงนามไปแล้วเป็นหลักฐาน ลบไม่ได้ (esign_signature_stamps แก้/ลบไม่ได้) ภาพที่ยังไม่เคยใช้ผู้ใช้ลบเองได้
--   - เก็บแบบ content-addressed (ตาม sha256) ภาพเดียวกันเก็บครั้งเดียวไม่ว่าถูกอ้างกี่ใบ — กันฐานข้อมูลโตตามจำนวนใบที่ลงนาม
--     (แผนฟรี 500 MB — docs/ai/NOTES.md และความจำ project_db_capacity)

DO $guard$
BEGIN
  IF to_regclass('public.esign_signatures') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261022100100_esign_tables.sql ก่อน';
  END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.esign_image_blobs (
  sha256     text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  png        bytea NOT NULL CHECK (octet_length(png) BETWEEN 67 AND 50000),
  width      integer NOT NULL CHECK (width BETWEEN 1 AND 640),
  height     integer NOT NULL CHECK (height BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- คลังลายเซ็นของแต่ละคน (แก้ไข/ลบได้) — ไม่ผูก อปท. เพราะเป็นของส่วนตัวของผู้ใช้ย้ายหน่วยงานแล้วยังเป็นของเขา
CREATE TABLE IF NOT EXISTS public.esign_signature_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  sha256     text NOT NULL REFERENCES public.esign_image_blobs(sha256) ON DELETE RESTRICT,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ภาพที่ใช้กับลายเซ็นแต่ละรายการ (สำเนา ณ วันที่ลงนาม) — ผู้ลงนามเปลี่ยน/ลบภาพในคลังทีหลัง ใบที่ลงนามไปแล้วยังแสดงภาพเดิม
CREATE TABLE IF NOT EXISTS public.esign_signature_stamps (
  signature_id    uuid PRIMARY KEY REFERENCES public.esign_signatures(id) ON DELETE RESTRICT,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  sha256          text NOT NULL REFERENCES public.esign_image_blobs(sha256) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) from public.esign_signature_images;   → 0
--   select count(*) from public.esign_signature_stamps;   → 0
