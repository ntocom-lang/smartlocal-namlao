-- ผู้ช่วย/ที่ปรึกษา AI เฉพาะ Super Admin ไฟล์ 1/2 — สร้างตาราง + ปิดประตูทันที (เจ้าของระบบอนุมัติ 2569-11-08)
--   ไฟล์ 2 (20261109120100) ใส่ policy / GRANT / trigger / แถวตั้งค่าเริ่มต้น — แยกไฟล์ตามกติกา "1 ไฟล์ = 1 เฟส"
--
-- ที่มา: เจ้าของระบบให้นำ Gemini กลับมาใช้ (key เดิม GEMINI_API_KEY) แต่ใช้ได้เฉพาะ superadmin
--   • บอทประชาชน gemini-chat / gemini-extract-event ยังปิด (stub 410) ไม่เกี่ยวกับตารางนี้
--   • Gemini แบบไม่เสียเงิน: Google นำข้อความไปพัฒนาผลิตภัณฑ์ได้ + คนรีวิวได้ → เฟส 1 ไม่แนบข้อมูลจากระบบเลย
--     และ Edge Function ปิดบังเลขบัตร 13 หลัก/เบอร์โทรก่อนส่งทุกครั้ง ข้อความที่เก็บในตารางนี้คือฉบับที่ส่งออกไปจริง
--
-- advisor_settings  แถวเดียว (id = 1): เปิด/ปิด · ชื่อโมเดล · เพดานจำนวนคำถามต่อวันรวมทุกคน (Google คิดโควตาต่อ project)
-- advisor_messages  ประวัติแชตส่วนตัวของ superadmin แต่ละคน (เขียนได้เฉพาะ Edge Function ด้วย service_role)
--                   เจ้าของลบเรื่องของตัวเองได้ = ประวัติส่วนตัว ไม่ใช่บันทึกย้อนตรวจของหน่วยงาน
--
-- ⚠️ เปิด RLS + ถอนสิทธิ์ anon ในไฟล์นี้เลย (ข้อสังเกตผู้ตรวจ migration): หลัง COMMIT ไฟล์นี้ PostgREST เห็นตารางทันที
--    และ default privileges ยังให้ anon/authenticated SELECT/INSERT/UPDATE/DELETE — ถ้ายังไม่เปิด RLS ใครก็ INSERT แถวตั้งค่า/ข้อความปลอม
--    ค้างไว้ก่อนไฟล์ 2 รันได้ · ไม่ถอน S/I/U/D ของ authenticated ที่นี่ (รันไฟล์นี้ซ้ำหลังไฟล์ 2 จะลบสิทธิ์ที่ไฟล์ 2 ให้)
--    ช่วงที่ยังไม่มี policy RLS ปฏิเสธทุกแถวอยู่แล้ว
-- updated_by ไม่ใส่ FK โดยตั้งใจ (บทเรียน #658): FK ON DELETE SET NULL จะไปกระตุ้น trigger ประทับผู้แก้ ได้รอยตรวจสอบเท็จตอนลบบัญชี
--
-- ย้อนกลับ: BEGIN; SET LOCAL lock_timeout = '5s'; DROP TABLE public.advisor_messages, public.advisor_settings;
--           DROP FUNCTION IF EXISTS public.advisor_settings_touch(); COMMIT;  (เสียเฉพาะประวัติแชตของเมนูนี้)
BEGIN;
-- REFERENCES auth.users ถือล็อก auth.users จน COMMIT — รอเกิน 5 วิให้ล้มเอง ไม่ให้ login ทุก อปท. ต่อคิว
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.advisor_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  -- ชื่อโมเดลถูกต่อลง URL ของ Google ใน Edge Function — จำกัดตัวอักษรไว้ที่ฐานข้อมูลอีกชั้น
  model text NOT NULL DEFAULT 'gemini-3.5-flash' CHECK (model ~ '^[a-z0-9][a-z0-9.-]{1,62}$'),
  daily_cap integer NOT NULL DEFAULT 100 CHECK (daily_cap BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.advisor_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL,
  -- ลบบัญชีแล้วประวัติแชตของบัญชีนั้นหายตาม (ข้อมูลส่วนตัวของเจ้าของบัญชี ไม่ใช่เอกสารราชการ)
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'model')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 100000),
  model text,
  masked_count integer NOT NULL DEFAULT 0 CHECK (masked_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisor_messages_conversation_idx
  ON public.advisor_messages (user_id, conversation_id, created_at);
-- Edge Function นับคำถามของวันนี้รวมทุกคน (ไม่กรอง user_id)
CREATE INDEX IF NOT EXISTS advisor_messages_daily_idx
  ON public.advisor_messages (created_at) WHERE role = 'user';

ALTER TABLE public.advisor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisor_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.advisor_settings, public.advisor_messages FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.advisor_settings, public.advisor_messages FROM authenticated;

COMMIT;
