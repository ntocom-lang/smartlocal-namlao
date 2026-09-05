-- เฟส 2 (ส่วนที่ 1/2 — DDL ล้วน): ตารางตั้งค่า "กอง + ผู้รับผิดชอบ + SLA" รายประเภทคำขอ
--
-- ล้อโครงเดียวกับ category_assignments ของเรื่องร้องเรียน (migration 015 + 078) เพื่อให้
-- เจ้าหน้าที่เจอแพตเทิร์นเดียวกันทั้งสองงาน: ตั้งค่าที่หน้าแอดมิน → trigger มอบหมายให้ตอนคำขอเข้า
--
-- ทำไมไม่เก็บใน municipalities.fee_schedule (jsonb) ที่หน้าตั้งค่าใช้อยู่แล้ว:
--   1) jsonb ไม่มี FK — ลบผู้ใช้ทิ้งแล้ว UUID ค้างชี้ไปหาคนที่ไม่มีตัวตน ระบบจะมอบหมายงาน
--      ให้ผีต่อไปเรื่อยๆ โดยไม่มีใครเห็น ตารางนี้ใช้ ON DELETE SET NULL แล้วขึ้นเตือนแทน
--   2) migration reassign_staff_workload (20260827110000) ที่ใช้ตอนย้าย/ลบเจ้าหน้าที่
--      มองไม่เห็นค่าที่ฝังอยู่ใน jsonb
--   3) fee_schedule เขียนทับทั้งก้อนทุกครั้งที่กดบันทึกค่าธรรมเนียม เสี่ยงลบค่ามอบหมายทิ้ง
--
-- ⚠️ แยกเป็น 2 ไฟล์ตามกติกาโปรเจกต์ — ไฟล์นี้ CREATE TABLE/ADD COLUMN อย่างเดียว
-- ส่วนฟังก์ชันที่อ้างถึงตารางและคอลัมน์ใหม่อยู่ใน 20260907120000 (ไฟล์เดียวกันจะได้ 42P01/42703)

BEGIN;

CREATE TABLE IF NOT EXISTS public.document_type_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- ค่าเดียวกับ document_requests.document_type รวมประเภทเฉพาะของ อปท. (custom_<timestamp>)
  -- จึงเป็น text ไม่ใช่ enum — อปท. เพิ่มประเภทเองได้จากหน้าตั้งค่าโดยไม่ต้อง migrate
  document_type   text NOT NULL,
  department_id   uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  assignee_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sla_days        int  NOT NULL DEFAULT 3 CHECK (sla_days BETWEEN 1 AND 90),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (municipality_id, document_type)
);

CREATE INDEX IF NOT EXISTS document_type_assignments_muni_idx
  ON public.document_type_assignments(municipality_id);

-- กำหนดส่งของแต่ละคำขอ คิดจาก sla_days ตอนที่คำขอเข้ามา (เก็บค่าที่คำนวณแล้ว ไม่คำนวณสดทีหลัง
-- เพราะ อปท. แก้ sla_days ได้ตลอด ถ้าคิดสดงานเก่าจะเลื่อนกำหนดตามไปด้วยทั้งกอง = รายงาน
-- "งานเกินกำหนด" ย้อนหลังเปลี่ยนค่าเอง ซึ่งเป็นประเด็นตรวจสอบ)
ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS due_date date;

CREATE INDEX IF NOT EXISTS document_requests_due_date_idx
  ON public.document_requests(municipality_id, due_date)
  WHERE due_date IS NOT NULL;

ALTER TABLE public.document_type_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read document_type_assignments" ON public.document_type_assignments;
DROP POLICY IF EXISTS "admin manage document_type_assignments" ON public.document_type_assignments;

-- อ่านได้ทุกบทบาทภายใน อปท. ตัวเอง (หัวหน้ากองต้องรู้ว่าประเภทไหนตกมาที่กองตัวเอง)
-- ไม่มีข้อมูลส่วนบุคคลของประชาชนในตารางนี้ มีแต่ผังงานภายใน
CREATE POLICY "read document_type_assignments" ON public.document_type_assignments
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR municipality_id = public.get_my_municipality_id()
  );

-- แก้ผังงานได้เฉพาะแอดมินของ อปท. นั้น — เป็นการกำหนดว่าใครจะเห็นข้อมูลผู้ยื่นคำขอบ้าง
CREATE POLICY "admin manage document_type_assignments" ON public.document_type_assignments
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

-- default privileges ของ schema public ใน Supabase แจก grant ให้ anon ด้วย ต้องถอนเองทุกตาราง
-- (ดู 20260905200000_revoke_anon_write_grants.sql) ประชาชนไม่ต้องรู้ผังงานภายในของ อปท.
REVOKE ALL ON TABLE public.document_type_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_type_assignments TO authenticated;

COMMIT;
