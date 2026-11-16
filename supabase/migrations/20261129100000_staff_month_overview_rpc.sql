-- 20261129100000_staff_month_overview_rpc.sql
--
-- "ภาพรวมเดือนนี้" บนหน้าแรกเจ้าหน้าที่ (เฟส 2 ของหน้าแรกแบบพรีเมียม — เจ้าของระบบอนุมัติ 2569-11-16)
-- ตัวเลขคำร้องตั้งแต่วันที่ 1 ของเดือนนี้ถึงวันนี้ (เวลาไทย) ตามขอบเขตของผู้เรียก
--   officer (หัวหน้ากอง ที่สังกัดกอง)  → คำร้องของกองตัวเอง (กติกาเดียวกับ staff_dept_workload / staff_performance_rows)
--   admin                             → ทั้ง อปท. ของตัวเอง
--   superadmin                        → ทั้ง อปท. ที่ส่งมา (ข้าม อปท. ได้ เหมือน exec_assert_viewer)
--   บทบาทอื่น (staff/technician/viewer/council/citizen) → 42501
--     staff/technician มีแถบ "ของฉัน" อยู่แล้ว · viewer มีห้องผู้บริหาร (ตัวเลขชุดเดียวกันจาก exec_summary_complaints)
--
-- คืน (ตัวเลขล้วน ไม่มีชื่อ/เบอร์ผู้ร้อง เลขคำร้อง รายคน หรือข้อความอิสระ — PDPA):
--   scope            'department' | 'municipality'
--   department_name  ชื่อกอง (เฉพาะ scope department)
--   month_start, today (date เวลาไทย)
--   received         คำร้องที่แจ้งเข้ามาในเดือนนี้ทุกสถานะ (รวม rejected/parked — "เข้ามา" ไม่ใช่ "รับดำเนินการ") ไม่รวมเฉพาะกิจ/อ่อนไหว
--   completed        เสร็จในเดือนนี้ (วันเสร็จนิยามเดียวกับ exec_summary_complaints.on_time)
--   on_time / late / no_due   แยกจาก completed เทียบ due_date
--   open_past_due    ค้าง ณ วันนี้ที่เลยกำหนดแล้ว (received/in_progress และ due_date < วันนี้)
--   open_now         ค้างอยู่ตอนนี้ทั้งหมด (new/pending/received/in_progress)
--   % ตรงเวลา ให้หน้าเว็บคิดเอง = on_time ÷ (on_time + late + open_past_due) — สูตรเดียวกับเมนู "ผลการปฏิบัติงาน"
--     และห้องผู้บริหาร (นับค้างที่เลยกำหนดในตัวหาร ไม่งั้นการปล่อยเรื่องยากค้างไว้ทำให้ร้อยละดูดีขึ้น)
--
-- ขอบเขตที่ตัดออก (ชุดเดียวกับ exec_summary_complaints): หมวดเฉพาะกิจ (is_adhoc) + หมวดอ่อนไหว (requires_manual_intake)
--   + parked (ขึ้นทะเบียนรอดำเนินการ) ไม่นับเป็นค้าง/เลยกำหนด
--
-- ไฟล์นี้อ้างตาราง/คอลัมน์/ฟังก์ชันที่มีอยู่แล้วเท่านั้น (ไม่ ADD COLUMN/CREATE TABLE) · ฟังก์ชันใหม่ ไม่ทับของเดิม
-- ย้อนกลับ: DROP FUNCTION public.staff_month_overview(uuid);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT has_function_privilege('anon', 'public.staff_month_overview(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.staff_month_overview(uuid)', 'EXECUTE');   → false, true
--   SELECT p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig FROM pg_proc p WHERE p.oid = 'public.staff_month_overview(uuid)'::regprocedure;
--     → t, postgres, {search_path=""}

BEGIN;

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'id'), ('complaints', 'municipality_id'), ('complaints', 'status'), ('complaints', 'due_date'),
    ('complaints', 'department_id'), ('complaints', 'department'), ('complaints', 'category'),
    ('complaints', 'created_at'), ('complaints', 'closed_at'), ('complaints', 'resolved_by'),
    ('complaint_categories', 'municipality_id'), ('complaint_categories', 'value'),
    ('complaint_categories', 'is_adhoc'), ('complaint_categories', 'requires_manual_intake'),
    ('complaint_timeline', 'complaint_id'), ('complaint_timeline', 'status'), ('complaint_timeline', 'created_at'),
    ('profiles', 'role'), ('profiles', 'municipality_id'), ('profiles', 'department_id'),
    ('departments', 'name')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'staff_month_overview: ไม่พบคอลัมน์ %', v_missing;
  END IF;
  IF to_regprocedure('public.complaint_matches_my_department(text)') IS NULL THEN
    RAISE EXCEPTION 'staff_month_overview: ไม่พบฟังก์ชัน complaint_matches_my_department(text)';
  END IF;
  -- เช็กตามชื่อทุก overload (ไม่ใช่แค่ signature (uuid)) — มีชื่อซ้ำคนละพารามิเตอร์ PostgREST จะตอบ PGRST203
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'staff_month_overview') THEN
    RAISE EXCEPTION 'staff_month_overview: มีฟังก์ชันชื่อนี้อยู่แล้ว — ตรวจก่อนว่าเป็นของใคร ไฟล์นี้ไม่เขียนทับ';
  END IF;
END $$;

CREATE FUNCTION public.staff_month_overview(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_role      text;
  v_muni      uuid;
  v_dept      uuid;
  v_dept_name text;
  v_scope     text;
  v_ok        boolean;
  v_today     date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_month     date := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  v_from      timestamptz;
  v_result    jsonb;
BEGIN
  SELECT p.role, p.municipality_id, p.department_id
    INTO v_role, v_muni, v_dept
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  -- ⚠️ ปิดตายเมื่อไม่แน่ใจ: ตัดสินด้วย IS NOT TRUE (NULL ใดๆ = ไม่ผ่าน) แบบเดียวกับ exec_assert_viewer
  v_ok := v_uid IS NOT NULL
          AND p_muni IS NOT NULL
          AND (
            v_role = 'superadmin'
            OR (v_role = 'admin' AND v_muni IS NOT DISTINCT FROM p_muni)
            OR (v_role = 'officer' AND v_dept IS NOT NULL AND v_muni IS NOT DISTINCT FROM p_muni)
          );
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูภาพรวมเดือนนี้' USING ERRCODE = '42501';
  END IF;

  v_scope := CASE WHEN v_role = 'officer' THEN 'department' ELSE 'municipality' END;
  IF v_scope = 'department' THEN
    SELECT d.name INTO v_dept_name FROM public.departments AS d WHERE d.id = v_dept;
  END IF;
  v_from := v_month::timestamp AT TIME ZONE 'Asia/Bangkok';

  -- c = คำร้องในขอบเขต (อปท. + กองถ้าเป็นหัวหน้ากอง) ที่เกี่ยวกับเดือนนี้: แจ้งในเดือนนี้ / ยังค้าง / ปิดในเดือนนี้
  --     ตัดเรื่องที่ปิดก่อนต้นเดือนทิ้งก่อนไล่ timeline (วันเสร็จ ≤ closed_at เสมอ จึงไม่มีทางตกในเดือนนี้)
  WITH c AS (
    SELECT cm.id, cm.status, cm.due_date, cm.created_at, cm.closed_at, cm.resolved_by
    FROM public.complaints AS cm
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = cm.municipality_id AND cat.value = cm.category
    WHERE cm.municipality_id = p_muni
      AND NOT COALESCE(cat.is_adhoc, false)
      AND NOT COALESCE(cat.requires_manual_intake, false)
      AND (
        v_scope = 'municipality'
        OR cm.department_id = v_dept
        OR (cm.department_id IS NULL AND public.complaint_matches_my_department(cm.department))
      )
      AND (
        cm.created_at >= v_from
        OR cm.status IN ('new', 'pending', 'received', 'in_progress')
        OR (cm.status IN ('done', 'closed', 'completed') AND (cm.closed_at IS NULL OR cm.closed_at >= v_from))
      )
  ), d AS (
    SELECT c.status,
           c.due_date,
           (c.created_at AT TIME ZONE 'Asia/Bangkok')::date AS created_date,
           (CASE
              WHEN c.status NOT IN ('done', 'closed', 'completed') THEN NULL
              WHEN c.resolved_by IS NOT NULL THEN c.closed_at
              ELSE LEAST(c.closed_at,
                         (SELECT min(t.created_at) FROM public.complaint_timeline AS t
                           WHERE t.complaint_id = c.id AND t.status IN ('done', 'closed', 'completed')))
            END AT TIME ZONE 'Asia/Bangkok')::date AS completed_date
    FROM c
  )
  SELECT jsonb_build_object(
           'scope',           v_scope,
           'department_name', v_dept_name,
           'month_start',     v_month,
           'today',           v_today,
           'received',        count(*) FILTER (WHERE d.created_date >= v_month),
           'completed',       count(*) FILTER (WHERE d.completed_date >= v_month),
           'on_time',         count(*) FILTER (WHERE d.completed_date >= v_month AND d.due_date IS NOT NULL AND d.completed_date <= d.due_date),
           'late',            count(*) FILTER (WHERE d.completed_date >= v_month AND d.due_date IS NOT NULL AND d.completed_date > d.due_date),
           'no_due',          count(*) FILTER (WHERE d.completed_date >= v_month AND d.due_date IS NULL),
           'open_past_due',   count(*) FILTER (WHERE d.status IN ('received', 'in_progress') AND d.due_date IS NOT NULL AND d.due_date < v_today),
           'open_now',        count(*) FILTER (WHERE d.status IN ('new', 'pending', 'received', 'in_progress'))
         )
    INTO v_result
  FROM d;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_month_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_month_overview(uuid) TO authenticated;

COMMENT ON FUNCTION public.staff_month_overview(uuid) IS
  'ภาพรวมคำร้องเดือนนี้บนหน้าแรกเจ้าหน้าที่ — หัวหน้ากอง=กองตัวเอง, admin=ทั้ง อปท., superadmin=อปท.ที่ส่งมา · ตัวเลขล้วน '
  'สูตรตรงเวลาเดียวกับ exec_summary_complaints/ผลการปฏิบัติงาน';

NOTIFY pgrst, 'reload schema';

COMMIT;
