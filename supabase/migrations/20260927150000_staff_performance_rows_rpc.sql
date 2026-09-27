-- 20260927150000_staff_performance_rows_rpc.sql
--
-- เมนู "ผลการปฏิบัติงาน" — รายการคำร้องของผู้รับผิดชอบ 1 คนในช่วงเวลาที่เลือก ใช้เป็นหลักฐาน
-- ประกอบการประเมินผลการปฏิบัติงาน (ระบบไม่ให้คะแนนและไม่จัดอันดับ — เป็นดุลพินิจของผู้ประเมิน)
--
-- ทำไมไม่ใช้ list_complaints_for_staff: ไม่มีตัวกรองช่วงเวลาและไม่แบ่งหน้า ส่วน PostgREST ตัดผลที่
-- max_rows = 1000 ผลงานรายปีจึงถูกนับขาดโดยไม่มีอะไรเตือน อีกทั้งยังส่งรายละเอียดและข้อมูลผู้ร้อง
-- ที่รายงานนี้ไม่ต้องใช้ ฟังก์ชันนี้คืนเฉพาะคอลัมน์ที่ไม่ใช่ข้อมูลส่วนบุคคลของผู้ร้อง
--
-- สิทธิ์: ตัวเอง (technician/staff/officer/admin) · admin ของ อปท. เดียวกัน · superadmin ·
-- officer ดูคนในกองเดียวกันได้ แต่เห็นเฉพาะคำร้องของกองตัวเอง เท่ากับที่เห็นในหน้าคำร้องทุกวันนี้
-- (ไม่เพิ่มสิทธิ์ใหม่) ฉบับที่นับครบทุกเรื่องคือฉบับที่เจ้าตัวเปิดเอง
--
-- Rollback: DROP FUNCTION IF EXISTS public.staff_performance_rows(uuid, date, date);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT prosecdef, proconfig FROM pg_proc
--    WHERE oid = 'public.staff_performance_rows(uuid,date,date)'::regprocedure;
--     → true, {search_path=""}
--   SELECT has_function_privilege('anon', 'public.staff_performance_rows(uuid,date,date)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.staff_performance_rows(uuid,date,date)', 'EXECUTE');
--     → false, true

DO $$
DECLARE
  v_missing text;
BEGIN
  -- ตัวฟังก์ชันเป็น plpgsql ซึ่งไม่ตรวจคอลัมน์ตอน CREATE — ถ้าขาดคอลัมน์จะพังตอนเรียกจริง จึงตรวจก่อน
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'assigned_to'), ('complaints', 'resolved_by'), ('complaints', 'closed_at'),
    ('complaints', 'due_date'), ('complaints', 'department_id'), ('complaints', 'department'),
    ('complaints', 'issue_type'), ('complaints', 'village'), ('complaints', 'channel'),
    ('complaints', 'rating'), ('complaints', 'ref_no'), ('complaints', 'extra_data'),
    ('complaint_categories', 'requires_manual_intake'),
    ('complaint_timeline', 'complaint_id'), ('complaint_timeline', 'status'),
    ('profiles', 'department_id')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'staff_performance_rows: ไม่พบคอลัมน์ %', v_missing;
  END IF;
  IF to_regprocedure('public.complaint_category_is_adhoc(uuid,text)') IS NULL
     OR to_regprocedure('public.complaint_matches_my_department(text)') IS NULL THEN
    RAISE EXCEPTION 'staff_performance_rows: ไม่พบฟังก์ชันตรวจหมวดหรือกองของคำร้อง';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_performance_rows(
  p_person_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  id uuid,
  ref_no text,
  category text,
  issue_type text,
  village text,
  channel text,
  status text,
  is_confidential boolean,
  created_at timestamptz,
  received_at timestamptz,
  first_done_at timestamptz,
  closed_at timestamptz,
  finish_recorded boolean,
  due_date date,
  resolved_by_name text,
  rating smallint,
  reopen_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_actor_role text;
  v_actor_muni uuid;
  v_actor_dept uuid;
  v_person_muni uuid;
  v_person_dept uuid;
  v_dept_only uuid;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_person_id IS NULL OR p_from IS NULL OR p_to IS NULL
     OR p_from > p_to OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ของรายงานไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  SELECT p.role, p.municipality_id, p.department_id
    INTO v_actor_role, v_actor_muni, v_actor_dept
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  SELECT p.municipality_id, p.department_id
    INTO v_person_muni, v_person_dept
  FROM public.profiles AS p
  WHERE p.id = p_person_id;

  -- ข้อความเดียวกันทั้ง "ไม่พบบุคคล" และ "ไม่มีสิทธิ์" เพื่อไม่ให้ใช้ไล่เดาว่า id ไหนมีอยู่จริง
  IF v_uid IS NULL OR v_actor_role IS NULL OR v_person_muni IS NULL OR NOT (
    v_actor_role = 'superadmin'
    OR (
      v_actor_muni = v_person_muni
      AND (
        (v_uid = p_person_id AND v_actor_role IN ('technician', 'staff', 'officer', 'admin'))
        OR v_actor_role = 'admin'
        OR (v_actor_role = 'officer' AND v_actor_dept IS NOT NULL AND v_actor_dept = v_person_dept)
      )
    )
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูผลการปฏิบัติงานของบุคคลนี้' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'officer' AND v_uid <> p_person_id THEN
    v_dept_only := v_actor_dept;
  END IF;

  v_start := p_from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_end := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  RETURN QUERY
  WITH mine AS (
    SELECT c.id, c.ref_no, c.category, c.issue_type, c.village, c.channel, c.status,
           c.created_at, c.closed_at, c.due_date, c.rating, c.resolved_by, c.assigned_to,
           c.municipality_id, c.extra_data,
           (SELECT min(t.created_at) FROM public.complaint_timeline AS t
             WHERE t.complaint_id = c.id AND t.status = 'received') AS received_at,
           (SELECT min(t.created_at) FROM public.complaint_timeline AS t
             WHERE t.complaint_id = c.id AND t.status IN ('done', 'closed', 'completed')) AS first_done_at
    FROM public.complaints AS c
    WHERE c.assigned_to = p_person_id
      AND c.municipality_id = v_person_muni
      AND c.status NOT IN ('pending', 'new')
      AND c.created_at < v_end
      AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
      AND (
        v_dept_only IS NULL
        OR c.department_id = v_dept_only
        OR (c.department_id IS NULL AND public.complaint_matches_my_department(c.department))
      )
  )
  SELECT m.id,
         CASE WHEN cat.requires_manual_intake THEN NULL ELSE m.ref_no END,
         m.category,
         CASE WHEN cat.requires_manual_intake THEN NULL ELSE m.issue_type END,
         CASE WHEN cat.requires_manual_intake THEN NULL ELSE m.village END,
         m.channel,
         m.status,
         COALESCE(cat.requires_manual_intake, false),
         m.created_at,
         m.received_at,
         m.first_done_at,
         m.closed_at,
         m.resolved_by IS NOT NULL,
         m.due_date,
         CASE WHEN m.resolved_by IS DISTINCT FROM m.assigned_to THEN rb.full_name END,
         m.rating,
         CASE WHEN (m.extra_data ->> 'reopen_count') ~ '^[0-9]{1,6}$'
              THEN (m.extra_data ->> 'reopen_count')::integer
              ELSE 0 END
  FROM mine AS m
  LEFT JOIN public.complaint_categories AS cat
    ON cat.municipality_id = m.municipality_id AND cat.value = m.category
  LEFT JOIN public.profiles AS rb
    ON rb.id = m.resolved_by
  -- ตัดสินตามสถานะ ไม่ใช่ตามวันปิดอย่างเดียว: ผู้ร้องเปิดเรื่องกลับแล้ว closed_at ถูกล้าง แต่ยังเป็นงานค้าง
  -- ของคนนี้อยู่ · แถวก่อนปุ่ม "ดำเนินการแล้ว" (resolved_by ว่าง) closed_at คือเวลาที่แอดมินรับงาน
  -- ถ้ามีแถว timeline done ที่เก่ากว่าให้ใช้ตัวนั้น · เรื่องเสร็จที่ไม่มีวันที่เลยส่งกลับไปให้แสดงแยก
  WHERE m.status IN ('received', 'in_progress')
     OR (
       m.status IN ('done', 'closed', 'completed')
       AND (
         CASE WHEN m.resolved_by IS NOT NULL THEN m.closed_at
              ELSE LEAST(m.closed_at, m.first_done_at) END >= v_start
         OR (m.closed_at IS NULL AND m.first_done_at IS NULL)
       )
     )
     OR (m.status = 'rejected' AND m.created_at >= v_start)
  ORDER BY m.created_at, m.id;
END;
$$;

COMMENT ON FUNCTION public.staff_performance_rows(uuid, date, date) IS
  'ผลการปฏิบัติงานรายคนจากคำร้อง (เมนู ผลการปฏิบัติงาน) — ตรวจสิทธิ์ในตัว คืนเฉพาะคอลัมน์ที่ไม่ใช่ข้อมูลผู้ร้อง หมวด requires_manual_intake ถูกปิดบัง';

REVOKE ALL ON FUNCTION public.staff_performance_rows(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_performance_rows(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
