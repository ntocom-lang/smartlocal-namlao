-- ค้นหาบริการ + คำถามที่พบบ่อย + คลังแบบฟอร์มดาวน์โหลด (แผนเทียบคู่แข่ง ขั้น 1A — เจ้าของระบบอนุมัติ 2569-11-17)
-- เฟส 1/3: CREATE TABLE เปล่า (RLS/สิทธิ์/trigger อยู่ไฟล์ 20261203100100 ตามกติกาแยก DDL ใน docs/ai/NOTES.md ข้อ 3)
--
-- เนื้อหาเป็นของสาธารณะ (แบบฟอร์มเปล่า + คำถามคำตอบ) ⇒ ประชาชนอ่านได้เฉพาะแถวที่เผยแพร่
-- เจ้าหน้าที่จัดการรายกองแบบเดียวกับข่าวสาร (posts) · ⚠️ ห้ามเก็บข้อมูลส่วนบุคคลในตารางเหล่านี้
-- ไฟล์จริงอยู่บน Google Drive (bucket สาธารณะ 'municipality-assets') ตารางเก็บแค่ลิงก์ + file id ไว้ลบ
--
-- created_by / updated_by เป็น "รอยตรวจสอบ" ไม่ผูก FK ไป profiles โดยเจตนา (ผลตรวจ migration-reviewer M2 2569-11-17
-- แนวเดียวกับ 20261108100100): FK แบบ SET NULL ทำให้ลบบัญชีแล้ว trigger touch เขียนทับผู้แก้ล่าสุดเป็นแอดมินที่กดลบ
-- และทำ embed profiles(...) กำกวม (PGRST201) · ⚠️ merge_duplicate_profile ยังไม่ย้าย 2 ตารางนี้ (ช่องโหว่เดิมของฟังก์ชันนั้น
-- ที่ค้างอยู่ ~60 คอลัมน์) ผลคือ staff ที่ถูกรวมบัญชีแก้แถวเก่าของตัวเองไม่ได้ แต่ officer/admin ของกองยังแก้ได้
--
-- ไม่มีแถวใด = หน้าค้นหายังทำงาน (ค้นจากประเภทคำขอ/หมวดคำร้องที่มีอยู่แล้ว) แค่ไม่มีแบบฟอร์ม/คำถาม

BEGIN;
-- FK ไป municipalities/departments ต้องได้ SHARE ROW EXCLUSIVE ชั่วครู่ — รอไม่เกิน 5 วินาที ไม่ให้งานเขียนอื่นต่อคิว
SET LOCAL lock_timeout = '5s';

-- ── 1) คลังแบบฟอร์มดาวน์โหลด ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_forms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id    uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  -- ความยาวรวมจำกัดที่ค่าดิบ (กันช่องว่างนำ/ท้ายไม่จำกัด) ส่วนขั้นต่ำวัดหลังตัดช่องว่าง
  title            text NOT NULL CHECK (char_length(title) <= 200 AND char_length(btrim(title)) >= 3),
  description      text CHECK (description IS NULL OR char_length(description) <= 500),
  -- ลิงก์สาธารณะจาก drive-upload เท่านั้น (https://) — กัน javascript:/data: ที่จะกลายเป็น XSS ตอนกดเปิด
  file_url         text NOT NULL CHECK (file_url ~ '^https://' AND char_length(file_url) <= 500),
  drive_file_id    text CHECK (drive_file_id IS NULL OR drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  file_name        text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  content_type     text CHECK (content_type IS NULL OR char_length(content_type) <= 120),
  -- คำค้นเพิ่ม คั่นด้วยจุลภาค เช่น "ขออนุญาตสร้างบ้าน, ข.1" — ใช้จับคำพ้องราย อปท.
  keywords         text CHECK (keywords IS NULL OR char_length(keywords) <= 300),
  is_published     boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_forms_muni ON public.service_forms (municipality_id, is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_service_forms_department ON public.service_forms (department_id);

ALTER TABLE public.service_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_forms FROM PUBLIC, anon, authenticated;

-- ── 2) คำถามที่พบบ่อย ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_faqs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id    uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  question         text NOT NULL CHECK (char_length(question) <= 300 AND char_length(btrim(question)) >= 5),
  answer           text NOT NULL CHECK (char_length(answer) <= 3000 AND char_length(btrim(answer)) >= 1),
  keywords         text CHECK (keywords IS NULL OR char_length(keywords) <= 300),
  -- ปุ่ม "ไปยื่นเรื่อง" ใต้คำตอบ: path ภายในเว็บ (/...) หรือ https:// เท่านั้น
  -- ตัวที่สองห้ามเป็น "/" — "//โดเมน" เบราว์เซอร์ตีความเป็นลิงก์ออกนอกเว็บ (เทสต์จับได้ 2569-11-17)
  link_url         text CHECK (link_url IS NULL OR (
                     char_length(link_url) <= 300
                     AND (link_url ~ '^/([A-Za-z0-9_?=&%.#~+-][A-Za-z0-9/_?=&%.#~+-]*)?$' OR link_url ~ '^https://')
                   )),
  link_label       text CHECK (link_label IS NULL OR char_length(link_label) <= 60),
  is_published     boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_faqs_muni ON public.service_faqs (municipality_id, is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_service_faqs_department ON public.service_faqs (department_id);

ALTER TABLE public.service_faqs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_faqs FROM PUBLIC, anon, authenticated;

COMMIT;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) from public.service_forms;  → 0
--   select count(*) from public.service_faqs;   → 0
