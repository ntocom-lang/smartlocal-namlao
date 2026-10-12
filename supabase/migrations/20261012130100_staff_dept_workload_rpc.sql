-- 20261012130100_staff_dept_workload_rpc.sql
--
-- มุมมอง "กองของฉัน" บนหน้าแรกเจ้าหน้าที่ — เฉพาะหัวหน้ากอง (role officer ที่สังกัดกอง) เห็นภาระงานรายคนในกองตัวเอง
-- เจ้าของระบบเลือกให้เห็นรายคน (2569-10-12)
--
-- สิ่งที่คืน: ต่อคนในกอง = จำนวนคำร้องที่ถืออยู่ / ยังไม่เริ่มดำเนินการ / เลยวันกำหนด + จำนวนคำร้องของกองที่ยังไม่มอบหมาย
-- สิ่งที่ "ไม่คืนโดยเจตนา": ชื่อ/เบอร์/ที่อยู่ผู้ร้อง, เลขคำร้อง, ผลงานที่เสร็จแล้ว, คะแนน, อันดับ
--   → นี่คือ "ภาระงานที่ยังถืออยู่ ณ ตอนนี้" ไม่ใช่การประเมินบุคคล · การประเมินอยู่ที่เมนู "ผลการปฏิบัติงาน" ซึ่งมีสิทธิ์/ถ้อยคำของมันเอง
--   หน้าจอเรียงตามชื่อ ไม่เรียงตามภาระ เพื่อไม่ให้ตารางนี้กลายเป็นอันดับคะแนนโดยปริยาย
--
-- ขอบเขตของ "คำร้องของกอง" ใช้กติกาเดียวกับ staff_performance_rows (20260927200000): c.department_id = กองผู้เรียก
-- หรือ (department_id ว่างและข้อความ department ตรงชื่อ/ชื่อย่อ/รหัสกอง) — ตัดหมวดเฉพาะกิจ (is_adhoc) ออกเหมือนกัน
-- เพราะหมวดนั้นออกแบบให้ส่งตรงถึงผู้รับผิดชอบโดยไม่ผ่านกอง
--
-- สิทธิ์: officer + สังกัดกอง + อปท. เดียวกับ p_muni เท่านั้น ที่เหลือ (รวม admin/viewer/superadmin) ได้ 42501
--   ทำไมไม่เปิดให้ admin: แอดมินมีกล่องคำร้องทั้ง อปท. อยู่แล้ว และไม่มี "กองของตัวเอง" ให้ตัดขอบเขต
--   ถ้าวันหน้าอยากให้ผู้บริหารเห็นรายกอง ให้เจ้าของตัดสินแยก (เป็นเรื่องการเปิดข้อมูลบุคคลต่อผู้บริหาร)
--
-- ไฟล์นี้ต่อจาก 20261012130000 (อ้างตาราง/ฟังก์ชันที่มีอยู่แล้วเท่านั้น ไม่ ADD COLUMN/CREATE TABLE) ฟังก์ชันใหม่ ไม่ทับของเดิม
-- ย้อนกลับ: DROP FUNCTION public.staff_dept_workload(uuid);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT has_function_privilege('anon', 'public.staff_dept_workload(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.staff_dept_workload(uuid)', 'EXECUTE');   → false, true

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'municipality_id'), ('complaints', 'assigned_to'), ('complaints', 'status'), ('complaints', 'due_date'),
    ('complaints', 'department_id'), ('complaints', 'department'), ('complaints', 'category'),
    ('profiles', 'role'), ('profiles', 'municipality_id'), ('profiles', 'department_id'), ('profiles', 'full_name'),
    ('departments', 'name')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'staff_dept_workload: ไม่พบคอลัมน์ %', v_missing;
  END IF;
  IF to_regprocedure('public.complaint_category_is_adhoc(uuid,text)') IS NULL
     OR to_regprocedure('public.complaint_matches_my_department(text)') IS NULL THEN
    RAISE EXCEPTION 'staff_dept_workload: ไม่พบฟังก์ชันตรวจหมวดหรือกองของคำร้อง';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_dept_workload(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_muni    uuid;
  v_dept    uuid;
  v_dept_name text;
  v_today   date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_members jsonb;
  v_unassigned integer;
BEGIN
  SELECT p.role, p.municipality_id, p.department_id
    INTO v_role, v_muni, v_dept
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  IF v_uid IS NULL OR p_muni IS NULL OR v_role IS DISTINCT FROM 'officer'
     OR v_dept IS NULL OR v_muni IS DISTINCT FROM p_muni THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูภาระงานของกอง' USING ERRCODE = '42501';
  END IF;

  SELECT d.name INTO v_dept_name FROM public.departments AS d WHERE d.id = v_dept;

  -- ชุดคำร้องที่ยังเปิดอยู่ของกองนี้ ใช้ทั้งนับรายคนและนับที่ยังไม่มอบหมาย (CTE เดียว ไม่ใช้ตารางชั่วคราว
  -- เพราะฟังก์ชัน STABLE สร้างตารางไม่ได้) · ทุกคนในกองที่รับงานได้ต้องออกมาแม้ไม่มีงานค้าง (0 ก็ต้องเห็น:
  -- หัวหน้าจะได้รู้ว่าใครว่าง) จึง LEFT JOIN จากรายชื่อคนไปหาจำนวนงาน
  WITH o AS (
    SELECT c.assigned_to, c.status, c.due_date
    FROM public.complaints AS c
    WHERE c.municipality_id = p_muni
      AND c.status IN ('pending', 'received', 'in_progress')
      AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
      AND (
        c.department_id = v_dept
        OR (c.department_id IS NULL AND public.complaint_matches_my_department(c.department))
      )
  ), w AS (
    SELECT o.assigned_to,
           count(*) FILTER (WHERE o.status IN ('received', 'in_progress'))::int AS open_n,
           count(*) FILTER (WHERE o.status = 'received')::int AS unstarted_n,
           count(*) FILTER (WHERE o.status IN ('received', 'in_progress') AND o.due_date < v_today)::int AS overdue_n
    FROM o
    WHERE o.assigned_to IS NOT NULL
    GROUP BY o.assigned_to
  ), m AS (
    SELECT p.id, p.full_name
    FROM public.profiles AS p
    WHERE p.municipality_id = p_muni
      AND p.department_id = v_dept
      AND p.role IN ('staff', 'technician', 'officer')
    ORDER BY lower(btrim(COALESCE(p.full_name, ''))), p.id
    LIMIT 60
  )
  SELECT
    (SELECT count(*)::int FROM o WHERE o.assigned_to IS NULL AND o.status IN ('pending', 'received')),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id,
               'name', NULLIF(btrim(m.full_name), ''),
               'open', COALESCE(w.open_n, 0),
               'unstarted', COALESCE(w.unstarted_n, 0),
               'overdue', COALESCE(w.overdue_n, 0)
             ) ORDER BY lower(btrim(COALESCE(m.full_name, ''))), m.id)
      FROM m LEFT JOIN w ON w.assigned_to = m.id
    ), '[]'::jsonb)
    INTO v_unassigned, v_members;

  RETURN jsonb_build_object(
    'today', v_today,
    'department_name', v_dept_name,
    'unassigned', v_unassigned,
    'members', v_members
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_dept_workload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_dept_workload(uuid) TO authenticated;

COMMENT ON FUNCTION public.staff_dept_workload(uuid) IS
  'ภาระงานคำร้องที่ยังถืออยู่รายคนในกองของหัวหน้ากอง (officer) — นับอย่างเดียว ไม่คืนข้อมูลผู้ร้อง/เลขคำร้อง/ผลงาน/อันดับ '
  'ขอบเขตคำร้องของกองเหมือน staff_performance_rows';

NOTIFY pgrst, 'reload schema';
