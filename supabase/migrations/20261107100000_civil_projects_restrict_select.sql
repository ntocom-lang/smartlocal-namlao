-- civil_projects: ปิดช่องอ่านสาธารณะ (policy "civil_projects_select" เดิมเป็น USING (true))
--
-- [ช่องโหว่] migration 046 ตั้ง SELECT USING (true) ให้ทุกคน และไม่มี migration ใดแทนที่ — ตรวจฐานจริง 2569-11-07
-- ด้วยคีย์ anon (ไม่ล็อกอิน) ได้ HTTP 206 + นับแถวได้ ⇒ ใครถือคีย์ anon (ฝังในเว็บอยู่แล้ว) ก็อ่านทะเบียนโครงการ
-- ของ "ทุก อปท." ได้ทั้งแถว (ชื่อโครงการ ผู้รับจ้าง วงเงิน เลขสัญญา note พิกัด ผู้สร้าง) รวมโครงการร่างที่ยังไม่ประกาศ
--
-- [ที่แก้] อ่านได้เฉพาะคนที่มีสิทธิ์ตามโมดูลโครงการก่อสร้าง (เมทริกซ์เดียวกับ civil_can_read_project ในไฟล์
-- 20261106100100) = superadmin · admin ของ อปท. · officer กองที่ถือโครงการ · staff/technician ที่กองเดียวกัน/
-- เป็นผู้สร้าง/ถูกระบุชื่อในโครงการ · ที่เหลือ (viewer/council/citizen/anon) อ่านไม่ได้
--
-- ⚠️ ทำไม policy นี้เขียนเงื่อนไขตรงๆ ไม่เรียก civil_can_read_project(id): ฟังก์ชันนั้นไปค้น civil_projects ซ้ำด้วย id
-- ซึ่ง "มองไม่เห็นแถวที่กำลังถูก INSERT ในคำสั่งเดียวกัน" (STABLE ใช้ snapshot ก่อนคำสั่ง) ⇒ INSERT ... RETURNING
-- (supabase-js .insert().select() ที่ฟอร์มสร้างโครงการใช้) จะล้มด้วย "violates row-level security policy" —
-- เจอตอนเขียนเทสต์ PGlite ก่อนส่ง ไม่ใช่ตอนใช้งานจริง · เทสต์ civil-projects-restrict-select ตรวจว่าผลตรงกับ civil_can_read_project ทุกคู่ (ผู้ใช้ x โครงการ)
-- + ถอนสิทธิ์ทั้งหมดของ anon บนตารางนี้ (กันซ้ำชั้นที่สอง ต่อให้มี policy หลุดมาในอนาคต)
--
-- ✅ ไม่กระทบสิ่งที่ใช้งานอยู่ (ตรวจโค้ดทั้งรีโป 2569-11-07):
--   - แผนที่ศูนย์ข้อมูล: data_center_unified_pins() เป็น SECURITY DEFINER ข้าม RLS ทุกตาราง ไม่ผ่าน policy นี้ (และหน้าเว็บตัดหมุด civil_projects ทิ้งอยู่แล้ว)
--   - เมนู "โครงการก่อสร้าง" (#648) ใช้ .eq(municipality_id) + สิทธิ์เดียวกับฟังก์ชันนี้ · หน้าช่าง (TechnicianDashboard) อ่านเฉพาะที่ตัวเองสร้าง ซึ่งผ่าน
--   - policy เขียน (insert/update/delete ของ 20260802060000) เป็นเซตย่อยของสิทธิ์อ่านใหม่ — ไม่มีบทบาทที่เขียนได้แต่อ่านไม่ได้
--   - ไม่มี edge function / หน้าประชาชนอ่านตารางนี้ตรงๆ
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: ประชาชน/ผู้บริหาร(viewer)/สมาชิกสภา(council) ที่เคยอ่านทะเบียนนี้ได้โดยตรงจะอ่านไม่ได้ —
--   ถ้าต้องการเปิดข้อมูลโครงการให้สาธารณะ (เช่น ITA) ให้ทำเป็นหน้า/RPC ที่เลือกคอลัมน์ที่เปิดได้ ไม่ใช่เปิดตารางทั้งแถว
--
-- ย้อนกลับฉุกเฉิน (ไม่แนะนำ — ช่องโหว่กลับมา):
--   DROP POLICY "civil_projects_select" ON public.civil_projects;
--   CREATE POLICY "civil_projects_select" ON public.civil_projects FOR SELECT USING (true);
--   GRANT SELECT ON public.civil_projects TO anon;
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.civil_projects') IS NULL OR to_regclass('public.civil_project_people') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261106100000_civil_reports_tables.sql ก่อน (ไม่พบ civil_projects / civil_project_people)';
  END IF;
  IF to_regprocedure('public.civil_can_read_project(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261106100100_civil_reports_rls_triggers.sql ก่อน (ไม่พบ civil_can_read_project)';
  END IF;
  IF to_regprocedure('public.is_my_department(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.get_my_municipality_id()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชันสิทธิ์พื้นฐาน (get_my_role / get_my_municipality_id / is_my_department)';
  END IF;
END $guard$;

ALTER TABLE public.civil_projects ENABLE ROW LEVEL SECURITY;

-- "ฉันถูกระบุชื่อในโครงการนี้ไหม" — SECURITY DEFINER เพื่อไม่ให้ policy ของ civil_projects ไปชน RLS ของ civil_project_people ซ้อนกัน
CREATE OR REPLACE FUNCTION public.civil_is_listed_on_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.civil_project_people AS pp
    WHERE pp.project_id = p_project_id AND pp.profile_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.civil_is_listed_on_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.civil_is_listed_on_project(uuid) TO authenticated;

DROP POLICY IF EXISTS "civil_projects_select" ON public.civil_projects;
CREATE POLICY "civil_projects_select" ON public.civil_projects
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      public.get_my_role() IN ('staff', 'technician')
      AND municipality_id = public.get_my_municipality_id()
      AND (
        public.is_my_department(municipality_id, department_id)
        OR created_by = auth.uid()
        OR public.civil_is_listed_on_project(id)
      )
    )
  );

REVOKE ALL ON public.civil_projects FROM anon;

-- ด่านตรวจท้ายไฟล์: policy แบบ permissive หลายตัวรวมกันด้วย OR — ถ้าในฐานจริงมี policy อ่านตัวอื่นที่ไม่ได้อยู่ในรีโป
-- (แก้นอก migration) ที่เปิดกว้าง ช่องโหว่จะยังอยู่ทั้งที่ไฟล์นี้ผ่าน จึงให้พังดังๆ แล้วย้อนกลับทั้งก้อน แทนที่จะเงียบ
DO $verify$
DECLARE
  v_other text;
BEGIN
  SELECT string_agg(policyname || ' (' || cmd || ' → ' || array_to_string(roles, ',') || ')', ', ')
    INTO v_other
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'civil_projects'
    AND cmd IN ('SELECT', 'ALL') AND policyname <> 'civil_projects_select';
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'civil_projects ยังมี policy อ่านตัวอื่น ซึ่งรวมกับตัวใหม่แบบ OR และอาจเปิดกว้างอยู่: % — ตรวจเงื่อนไขของมันก่อน แล้วค่อยลบ/แก้ (ไฟล์นี้ย้อนกลับทั้งก้อนแล้ว)', v_other;
  END IF;
  IF has_table_privilege('anon', 'public.civil_projects', 'SELECT') THEN
    RAISE EXCEPTION 'anon ยังมีสิทธิ์ SELECT บน civil_projects (อาจรับสิทธิ์ผ่านสิทธิ์ของ PUBLIC) — ตรวจ GRANT ... TO PUBLIC';
  END IF;
END $verify$;

COMMIT;
