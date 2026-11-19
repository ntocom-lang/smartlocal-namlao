-- กิจกรรม: ให้ดาว + ความเห็น (แผนเทียบคู่แข่ง ขั้น 1A) ไฟล์ 1/2 — สร้างตาราง + ปิดประตูทันที
--   ไฟล์ 2 (20261220100100) ใส่ RLS / GRANT / RPC — แยกไฟล์ตามกติกา "1 ไฟล์ = 1 เฟส"
--
-- event_reviews                  ดาว 1–5 + ความเห็น ≤300 ตัวอักษร ของกิจกรรมสาธารณะ (audiences มี 'public')
--                                1 บัญชี = 1 รีวิวต่อกิจกรรม (แก้ได้) · ให้ได้เมื่อกิจกรรมเริ่มแล้วเท่านั้น (กันดาวล่วงหน้า)
--                                ขึ้นทันที เจ้าหน้าที่ซ่อนทีหลังได้ (เจ้าของระบบเลือก 2026-11-19 "ตามแนะนำ")
--                                reviewer_name ระบบตั้งเองจาก profiles = "ชื่อ + อักษรแรกนามสกุล" (ผู้ใช้พิมพ์เองไม่ได้ · PDPA)
--                                ⚠️ user_id ไม่เปิดให้ใครอ่านผ่านตาราง (ไม่ GRANT คอลัมน์นี้) — ของตัวเองอ่านผ่าน RPC event_my_review
-- event_review_moderation_log    สมุดบันทึกการซ่อน/เลิกซ่อนของเจ้าหน้าที่ + ผู้เขียนลบรีวิวที่ถูกซ่อน (ระบบเขียนเองใน RPC)
--                                เก็บสำเนาดาว/ข้อความ ณ ตอนนั้น เพราะผู้เขียนแก้ข้อความทีหลังได้ (ย้อนตรวจได้ว่าซ่อนเพราะอะไร)
--
-- ตาราง events ไม่มี CREATE TABLE ใน migrations ของ repo (สร้างก่อนยุค migration) ⇒ ด่านตรวจโครงก่อนอ้าง FK
-- ทำทีหลัง (จดไว้): merge_duplicate_profile ยังไม่ย้าย event_reviews.user_id (ปัญหาเดิม ~60 คอลัมน์ · backlog)
--   รวมบัญชีแล้วรีวิวของบัญชีที่ถูกรวมหายตามบัญชี (ON DELETE CASCADE) — ไม่กระทบสิทธิ์ใคร
--
-- ⚠️ ห้ามรันไฟล์นี้ซ้ำหลังไฟล์ 2: REVOKE ท้ายไฟล์จะถอนสิทธิ์ที่ไฟล์ 2 ให้ไว้ทั้งหมด (ต้องรันไฟล์ 2 ซ้ำตาม)
-- ⚠️ CREATE TABLE IF NOT EXISTS: ถ้ามีตารางชื่อนี้อยู่ก่อนจะข้ามเงียบ — ตรวจด้วย SELECT ก่อนรัน (ต้องไม่มี 2 ชื่อนี้)
--
-- ย้อนกลับ (ไม่มีตารางเดิมถูกแก้โครง · ข้อมูลที่หายมีแค่ของใหม่):
--   DROP TABLE public.event_reviews, public.event_review_moderation_log CASCADE;  แล้วรันส่วนย้อนกลับของไฟล์ 2
BEGIN;
SET LOCAL lock_timeout = '5s'; -- FK ไป events / auth.users ถือ lock จน COMMIT — มี session ค้างให้ล้มเร็ว

DO $guard$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง events';
  END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
      WHERE a.attrelid = 'public.events'::regclass AND a.attname = 'id' AND NOT a.attisdropped) IS DISTINCT FROM 'uuid'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
         WHERE a.attrelid = 'public.events'::regclass AND a.attname = 'audiences' AND NOT a.attisdropped) IS DISTINCT FROM 'text[]'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
         WHERE a.attrelid = 'public.events'::regclass AND a.attname = 'event_date' AND NOT a.attisdropped) IS DISTINCT FROM 'date'
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.events'::regclass AND NOT a.attisdropped
           AND a.attname IN ('municipality_id', 'department_id', 'created_by')) <> 3 THEN
    RAISE EXCEPTION 'events ไม่ตรงโครงที่คาด (id uuid, audiences text[], event_date date + municipality_id/department_id/created_by)';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
      WHERE a.attrelid = 'public.profiles'::regclass AND NOT a.attisdropped AND a.attname = 'full_name') <> 1 THEN
    RAISE EXCEPTION 'profiles ไม่มีคอลัมน์ full_name';
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.event_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE, -- ระบบตั้งจากกิจกรรม
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          text CHECK (comment IS NULL OR length(comment) BETWEEN 1 AND 300),
  reviewer_name    text NOT NULL CHECK (length(reviewer_name) BETWEEN 1 AND 60),
  is_hidden        boolean NOT NULL DEFAULT false, -- เจ้าหน้าที่ซ่อน (ผ่าน RPC เท่านั้น · ใครซ่อนเมื่อไรอยู่ในสมุดบันทึก)
  hidden_reason    text CHECK (hidden_reason IS NULL OR length(hidden_reason) <= 300), -- ผู้เขียนเห็น จะได้รู้ว่าทำไม
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS event_reviews_event_idx ON public.event_reviews (event_id, created_at DESC) WHERE NOT is_hidden;
CREATE INDEX IF NOT EXISTS event_reviews_muni_idx ON public.event_reviews (municipality_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_reviews_user_idx ON public.event_reviews (user_id);

-- ไม่มี FK ไปรีวิว/กิจกรรม เพื่อให้บันทึกอยู่ต่อหลังลบ
CREATE TABLE IF NOT EXISTS public.event_review_moderation_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL,
  review_id        uuid NOT NULL,
  action           text NOT NULL CHECK (action IN ('hide', 'unhide', 'author_delete_hidden')),
  rating_snapshot  smallint,
  comment_snapshot text,
  reason           text,
  actor_id         uuid, -- รอยตรวจสอบ ไม่ใส่ FK (บทเรียน #658)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_review_moderation_log_event_idx ON public.event_review_moderation_log (event_id);
CREATE INDEX IF NOT EXISTS event_review_moderation_log_muni_idx ON public.event_review_moderation_log (municipality_id, created_at DESC);

-- ปิดประตูทันที: ไฟล์ 2 ค่อยเปิดทีละสิทธิ์ (ช่วงระหว่างไฟล์ 1 กับ 2 ไม่มีใครอ่าน/เขียนได้)
ALTER TABLE public.event_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_review_moderation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_reviews, public.event_review_moderation_log FROM PUBLIC, anon, authenticated;

COMMIT;
