-- สถานการณ์น้ำ-ฝน เฟส 2 (ประกาศของ อบต. ที่มีผู้ยืนยัน) PR 2.2 ไฟล์ 1/2 — ตาราง "ผู้มีสิทธิ์ยืนยันประกาศ"
-- (สิทธิ์/ฟังก์ชันอยู่ 20261020130100 · แยกไฟล์ตามกติกาแยก DDL ตามเฟส)
--
-- ทำไมต้องมี: PR 2.1 ให้ผู้ยืนยัน = นายก/ปลัดในทะเบียนผู้ลงนามกลางที่ "มีบัญชี" แต่ตรวจ production (2026-10-19) แล้ว
-- ผู้ลงนามนายก/ปลัดที่ active ของทุก อปท. (น้ำเลา/ทุ่งแค้ว/demo) เป็น "ชื่อกรอกเอง" ไม่มีบัญชีเลย (0 ราย) → ไม่มีใครกดยืนยันได้
-- เจ้าของระบบเลือกทางแก้ (2026-10-19): ให้ admin ของ อปท. เลือกบัญชีเจ้าหน้าที่ 1–5 คนเป็นผู้มีสิทธิ์ยืนยัน (ตั้งครั้งเดียว)
-- พร้อมช่อง "อ้างอิงอำนาจ" ที่ อบต. กรอกเอง — ผู้มีอำนาจประกาศจริงเป็นไปตามกฎหมาย/แผนป้องกันและบรรเทาสาธารณภัยของ อบต.
-- (ไม่ได้อ้างเลขมาตราหรือชื่อกฎหมายไว้ในโค้ดนี้ · ต้องยืนยันกับตัวบทฉบับปัจจุบันก่อนเปิดกับ อปท. จริง)
--
-- ตารางปิดสนิท (RLS เปิด ไม่มี policy ถอนสิทธิ์ anon/authenticated ทั้งหมด) อ่าน/เขียนผ่านฟังก์ชัน SECURITY DEFINER ในไฟล์ 2 เท่านั้น
-- ไม่เพิ่มคอลัมน์สิทธิ์ใน profiles · ไม่แตะตาราง/ฟังก์ชันเดิม · apply ก่อน deploy ได้ปลอดภัย (ยังไม่มีอะไรอ่านตารางนี้จนกว่าไฟล์ 2 จะ apply)
-- authority_note เป็นข้อความที่ อบต. กรอกเอง เห็นเฉพาะ admin/superadmin ของ อปท. นั้น ไม่ขึ้นหน้าประชาชน
-- ย้อนได้ด้วย: DROP TABLE public.water_announcement_approvers;

DO $$
BEGIN
  IF to_regclass('public.water_announcements') IS NULL OR to_regclass('public.water_announcement_settings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261020100000_water_announcements_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.municipalities') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง profiles/municipalities';
  END IF;
END;
$$;

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_announcement_approvers (
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- "ตามคำสั่ง/แผนฯ ที่ อบต. กำหนด" — ข้อความที่ อบต. กรอกเอง ผู้พัฒนาไม่ได้เติมให้
  authority_note  text        CHECK (authority_note IS NULL OR char_length(authority_note) <= 300),
  added_by        uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipality_id, profile_id)
);

-- ตารางใหม่ได้ ALL ให้ anon/authenticated อัตโนมัติจาก default privileges ของ Supabase — ถอนก่อน
REVOKE ALL ON public.water_announcement_approvers FROM anon, authenticated, PUBLIC;
ALTER TABLE public.water_announcement_approvers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.water_announcement_approvers IS
  'ผู้มีสิทธิ์ยืนยันประกาศน้ำ-ฝนของ อปท. (admin ของ อปท. ตั้ง 1–5 คน) — ปิดสนิท อ่าน/เขียนผ่านฟังก์ชันเท่านั้น · authority_note = ข้อความอ้างอิงอำนาจที่ อบต. กรอกเอง';

COMMIT;
