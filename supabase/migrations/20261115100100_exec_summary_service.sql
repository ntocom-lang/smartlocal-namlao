-- 20261115100100_exec_summary_service.sql
--
-- ห้องผู้บริหาร เฟส E2 — ไฟล์ 2/3: สรุปงานบริการประชาชน (โซน ② + ⑥)
--   exec_summary_complaints        คำร้อง: ช่องทาง / หมู่บ้าน / ทันกำหนด / คอขวด / รอดำเนินการ / ปัญหาซ้ำซาก
--   exec_summary_doc_requests      คำขอ E-Service: แยกประเภท / ทันกำหนด / คอขวด / ใครเป็นผู้กรอก
--   exec_summary_satisfaction      ความพึงพอใจ: อัตราตอบ + คะแนนแยกที่มา (สูตรเดียวกับรายงาน #681) + คะแนนต่ำ + รายกอง
--   exec_summary_departments       รายกอง: ค้าง / เลยกำหนด / เสร็จในช่วงนี้
--   exec_summary_patient_transport รถรับ-ส่งผู้ป่วย/ชุมชน: ยอดจอง + เที่ยวที่ออกรถจริง (ยอดรวมเท่านั้น — ข้อมูลสุขภาพ)
--
-- กติกาทุกฟังก์ชัน
--   - เรียก exec_assert_viewer() เป็นบรรทัดแรก (ไฟล์ 1) — ไม่ผ่าน = 42501
--   - คืนตัวเลขรวม + รหัสกอง/ประเภท/หมวด/ชื่อหมู่บ้านเท่านั้น ไม่คืนชื่อคน เลขบัตร เบอร์ ที่อยู่ ข้อความที่ผู้ร้องพิมพ์ หรือ id รายเรื่อง
--   - หมวดเฉพาะกิจ (complaint_categories.is_adhoc — ค้าง pending ตลอดโดยออกแบบ) ไม่นับในตัวเลขผลงาน
--     ตรงกับ staff_performance_rows / รายงานอัตราตอบ #681
--   - หมวดอ่อนไหว (requires_manual_intake เช่น ร้องเรียนเจ้าหน้าที่) นับเป็นยอดรวมเท่านั้น ไม่แตกหมู่บ้าน/ปัญหาซ้ำซาก
--     (ข้อ ②-8 ของแผน · staff_performance_rows ซ่อนหมู่บ้าน/เลขที่ของหมวดนี้อยู่แล้ว)
--   - วันทำการไม่คำนวณใน SQL (หลักเดียวกับ staff_home_summary): คืนยอดจัดกลุ่มตาม due_date/วันที่แจ้ง
--     ให้หน้าเว็บคิดด้วย src/lib/workingDays.js สูตรเดียวทั้งระบบ · "เลยกำหนด" = due_date < วันนี้ (ไม่ต้องใช้วันทำการ)
--   - ช่วงวันที่ = วันปฏิทินไทย _from.._to รวมสองปลาย (เหมือน complaint_stats_fy) · ยาวไม่เกิน 400 วัน
--   - ฟังก์ชันย่อย "ไม่" GRANT ให้ authenticated — เรียกผ่าน executive_overview() เท่านั้น
--
-- ไม่มี ADD COLUMN / CREATE TABLE (ข้อ 3 NOTES.md) — ฟังก์ชันใหม่ทั้งหมด ไม่ทับของเดิม
-- ย้อนกลับ: DROP FUNCTION public.exec_summary_complaints(uuid,date,date), public.exec_summary_doc_requests(uuid,date,date),
--   public.exec_summary_satisfaction(uuid,date,date), public.exec_summary_departments(uuid,date,date),
--   public.exec_summary_patient_transport(uuid,date,date);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE 'exec\_summary\_%';      → auth_exec=false, anon_exec=false, prosecdef=true ทุกแถว

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'exec_summary_service: ต้อง apply 20261115100000_exec_access_overview.sql ก่อน';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'municipality_id'), ('complaints', 'status'), ('complaints', 'created_at'), ('complaints', 'closed_at'),
    ('complaints', 'due_date'), ('complaints', 'assigned_to'), ('complaints', 'resolved_by'), ('complaints', 'department_id'),
    ('complaints', 'channel'), ('complaints', 'village'), ('complaints', 'category'), ('complaints', 'parked_reason'),
    ('complaints', 'rating'), ('complaints', 'user_id'), ('complaints', 'department'),
    ('locations', 'municipality_id'), ('locations', 'name'),
    ('departments', 'code'), ('patient_bookings', 'id'), ('patient_booking_trips', 'booking_ids'),
    ('complaint_categories', 'municipality_id'), ('complaint_categories', 'value'), ('complaint_categories', 'label'),
    ('complaint_categories', 'is_adhoc'), ('complaint_categories', 'requires_manual_intake'),
    ('complaint_timeline', 'complaint_id'), ('complaint_timeline', 'status'), ('complaint_timeline', 'created_at'),
    ('document_requests', 'municipality_id'), ('document_requests', 'document_type'), ('document_requests', 'status'),
    ('document_requests', 'created_at'), ('document_requests', 'issued_at'), ('document_requests', 'due_date'),
    ('document_requests', 'department_id'), ('document_requests', 'created_by_uid'),
    ('satisfaction_ratings', 'municipality_id'), ('satisfaction_ratings', 'complaint_id'), ('satisfaction_ratings', 'rating'),
    ('satisfaction_ratings', 'is_verified'), ('satisfaction_ratings', 'via_link'), ('satisfaction_ratings', 'rated_by_proxy'),
    ('satisfaction_ratings', 'created_at'),
    ('departments', 'municipality_id'), ('departments', 'name'), ('departments', 'short_name'),
    ('departments', 'sort_order'), ('departments', 'is_active'),
    ('patient_bookings', 'municipality_id'), ('patient_bookings', 'service_type'), ('patient_bookings', 'status'),
    ('patient_bookings', 'appointment_at'), ('patient_bookings', 'trip_id'),
    ('patient_booking_trips', 'municipality_id'), ('patient_booking_trips', 'state'),
    ('profiles', 'role')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_summary_service: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ตัวช่วยภายใน (SECURITY INVOKER — เรียกจากฟังก์ชัน exec_summary_* ซึ่งรันเป็นเจ้าของอยู่แล้ว · ไม่ให้ผู้ใช้เรียกตรง)
-- ══════════════════════════════════════════════════════════════════════════════════

-- ชื่อหมู่บ้านที่ "ปลอดภัยพอจะแสดง" ของคำร้อง — complaints.village เป็นข้อความที่ผู้แจ้งพิมพ์เองได้ถึง 250 ตัวอักษร
-- (CitizenForm.jsx: อปท. ที่ยังไม่ตั้งทะเบียนสถานที่ หรือผู้แจ้งเลือก "ไม่อยู่ในรายการ") อาจมีชื่อคน/บ้านเลขที่/เบอร์
--   คืน ชื่อในทะเบียน locations ที่แอดมินตั้ง (ตรงกันหลังตัดช่องว่าง)
--      หรือ 'หมู่ N' เมื่อข้อความทั้งช่องเป็นรูปแบบเลขหมู่ล้วน (หมู่ 3 / หมู่ที่ ๓ / ม.3) — ไม่มีข้อความอื่นปน จึงไม่มีข้อมูลส่วนบุคคล
--   คืน '' = มีข้อความแต่ไม่เข้าเงื่อนไข (หน้าจอนับเป็น "ไม่อยู่ในทะเบียน" เป็นตัวเลขอย่างเดียว) · NULL = ว่าง
CREATE OR REPLACE FUNCTION public.exec_village_label(_municipality_id uuid, _village text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(_village), '') IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.locations AS l
      WHERE l.municipality_id = _municipality_id AND btrim(l.name) = btrim(_village)
    ) THEN btrim(_village)
    WHEN btrim(_village) ~ '^(หมู่(ที่)?|ม\.)\s*[0-9๐-๙]{1,2}$' THEN
      -- ::int::text ให้ "หมู่ 03" กับ "หมู่ 3" เป็นกลุ่มเดียวกัน (ตัวเลข 1–2 หลักตาม regex ข้างบน แปลงได้เสมอ)
      'หมู่ ' || translate(regexp_replace(btrim(_village), '^(หมู่(ที่)?|ม\.)\s*', ''), '๐๑๒๓๔๕๖๗๘๙', '0123456789')::int::text
    ELSE ''
  END
$$;

-- กองของคำร้อง: department_id ก่อน · แถวเก่าที่มีแต่ชื่อกองเป็นข้อความ จับคู่ name/short_name/code แบบเดียวกับ
-- complaint_matches_my_department() (150_complaint_pii_role_access) ที่ staff_performance_rows/staff_dept_workload ใช้
CREATE OR REPLACE FUNCTION public.exec_complaint_dept(_municipality_id uuid, _department_id uuid, _department text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(_department_id, (
    SELECT d.id
    FROM public.departments AS d
    WHERE d.municipality_id = _municipality_id
      AND NULLIF(btrim(_department), '') IS NOT NULL
      AND lower(btrim(_department)) IN (
        lower(btrim(d.name)), lower(btrim(COALESCE(d.short_name, ''))), lower(btrim(COALESCE(d.code, '')))
      )
    ORDER BY d.sort_order NULLS LAST, d.id
    LIMIT 1
  ))
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- คำร้อง
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน
--   period   : ตามวันที่แจ้งในช่วง (ชุดเดียวกับ complaint_stats_fy) — total, citizen_online, oss_counter, confidential, adhoc
--   villages : [{village, n}] เรื่องที่แจ้งในช่วง แยกหมู่บ้าน (ไม่รวมหมวดเฉพาะกิจ/อ่อนไหว/ไม่ระบุหมู่) สูงสุด 50 แถว
--              ชื่อหมู่ผ่าน exec_village_label() เท่านั้น (ทะเบียน locations หรือรูปแบบ "หมู่ N" ล้วน) — ห้ามคืนข้อความที่ผู้แจ้งพิมพ์เอง
--   villages_unlisted : จำนวนเรื่องที่ระบุสถานที่ แต่ไม่อยู่ในทะเบียนและไม่ใช่รูปแบบเลขหมู่ (ตัวเลขอย่างเดียว)
--   on_time  : สูตรเดียวกับเมนู "ผลการปฏิบัติงาน" (src/lib/staffPerformance.js summarizePerformance) ระดับทั้ง อปท.
--              completed/on_time/late/no_due = เรื่องที่ "เสร็จในช่วงนี้" (วันเสร็จ = closed_at ถ้ากดปุ่มดำเนินการแล้ว
--              ไม่งั้นวันที่เก่ากว่าระหว่าง closed_at กับแถว timeline done แรก — เหมือน staff_performance_rows)
--              open_past_due = ค้าง ณ สิ้นช่วง และ due_date < min(วันนี้, _to) · % = on_time ÷ (on_time + late + open_past_due)
--              (นับค้างที่เลยกำหนดในตัวหาร ไม่งั้นการปล่อยเรื่องยากค้างไว้ทำให้ร้อยละดูดีขึ้น)
--              ไม่รวม pending/new/parked/rejected/เฉพาะกิจ/อ่อนไหว (ชุดเดียวกับรายงานผลการปฏิบัติงาน)
--   backlog  : ค้างอยู่ "ตอนนี้" (ไม่ขึ้นกับช่วงที่เลือก) [{s, due, c, u, n}] s = new (ยังไม่รับเรื่อง: new/pending) | received | in_progress
--              due = due_date · c = วันที่แจ้ง (ไทย) · u = ยังไม่มีผู้รับผิดชอบ · ไม่รวม parked/เฉพาะกิจ
--   parked   : ขึ้นทะเบียนรอดำเนินการตอนนี้ {n, by_reason}
--   repeat   : ปัญหาซ้ำซาก 90 วันล่าสุด (นับถึงวันนี้) หมวดเดียวกัน + หมู่เดียวกัน ≥ 3 เรื่อง สูงสุด 30 กลุ่ม
--              ไม่รวม rejected/เฉพาะกิจ/อ่อนไหว/ไม่ระบุหมู่ · ระบบแค่ชี้ ผู้บริหารตัดสินเอง ไม่สร้างโครงการให้
CREATE OR REPLACE FUNCTION public.exec_summary_complaints(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today    date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_from     timestamptz;
  v_to       timestamptz;
  v_asof     date;
  v_period   jsonb;
  v_villages jsonb;
  v_on_time  jsonb;
  v_backlog  jsonb;
  v_parked   jsonb;
  v_repeat   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  v_from := _from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_to   := (_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_asof := LEAST(v_today, _to);

  -- ช่องทาง + ยอดหมวดพิเศษ (ตามวันที่แจ้ง)
  SELECT jsonb_build_object(
           'total',          count(*),
           'citizen_online', count(*) FILTER (WHERE c.channel = 'citizen_online'),
           'oss_counter',    count(*) FILTER (WHERE c.channel = 'oss_counter'),
           'confidential',   count(*) FILTER (WHERE COALESCE(cat.requires_manual_intake, false)),
           'adhoc',          count(*) FILTER (WHERE COALESCE(cat.is_adhoc, false))
         )
    INTO v_period
  FROM public.complaints AS c
  LEFT JOIN public.complaint_categories AS cat
    ON cat.municipality_id = c.municipality_id AND cat.value = c.category
  WHERE c.municipality_id = _municipality_id
    AND c.created_at >= v_from AND c.created_at < v_to;

  -- แยกหมู่บ้าน (ยอดรวมต่อหมู่ ไม่แตกหมวด — ไม่มีรายเรื่อง) · ชื่อที่ไม่ผ่าน exec_village_label นับเป็นตัวเลขอย่างเดียว
  WITH lv AS (
    SELECT public.exec_village_label(c.municipality_id, c.village) AS label
    FROM public.complaints AS c
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    WHERE c.municipality_id = _municipality_id
      AND c.created_at >= v_from AND c.created_at < v_to
      AND NOT COALESCE(cat.is_adhoc, false)
      AND NOT COALESCE(cat.requires_manual_intake, false)
  ), grouped AS (
    SELECT lv.label AS village, count(*)::int AS n
    FROM lv
    WHERE lv.label <> ''
    GROUP BY lv.label
    ORDER BY count(*) DESC, lv.label
    LIMIT 50
  )
  SELECT jsonb_build_object(
           'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('village', g.village, 'n', g.n) ORDER BY g.n DESC, g.village)
                               FROM grouped AS g), '[]'::jsonb),
           'unlisted', (SELECT count(*) FROM lv WHERE lv.label = '')
         )
    INTO v_villages;

  -- ทันกำหนด (สูตรผลการปฏิบัติงาน ระดับทั้ง อปท.)
  WITH perf AS (
    SELECT c.status, c.due_date, c.created_at,
           COALESCE(
             (SELECT min(t.created_at) FROM public.complaint_timeline AS t
               WHERE t.complaint_id = c.id AND t.status = 'received'),
             c.created_at
           ) AS received_at,
           CASE
             WHEN c.status NOT IN ('done', 'closed', 'completed') THEN NULL
             WHEN c.resolved_by IS NOT NULL THEN c.closed_at
             ELSE LEAST(c.closed_at,
                        (SELECT min(t.created_at) FROM public.complaint_timeline AS t
                          WHERE t.complaint_id = c.id AND t.status IN ('done', 'closed', 'completed')))
           END AS completed_at
    FROM public.complaints AS c
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    WHERE c.municipality_id = _municipality_id
      AND c.status IN ('received', 'in_progress', 'done', 'closed', 'completed')
      AND c.created_at < v_to
      -- ตัดเรื่องที่ปิดก่อนต้นช่วงทิ้งก่อนไล่ timeline (วันเสร็จ ≤ closed_at เสมอ จึงไม่มีทางตกในช่วง/ค้าง ณ สิ้นช่วง)
      AND (c.status IN ('received', 'in_progress') OR c.closed_at IS NULL OR c.closed_at >= v_from)
      AND NOT COALESCE(cat.is_adhoc, false)
      AND NOT COALESCE(cat.requires_manual_intake, false)
  ), d AS (
    SELECT p.status IN ('done', 'closed', 'completed') AS finished,
           p.status IN ('received', 'in_progress')     AS is_open,
           p.due_date,
           (p.received_at  AT TIME ZONE 'Asia/Bangkok')::date AS received_date,
           (p.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS completed_date
    FROM perf AS p
  )
  SELECT jsonb_build_object(
           'completed',     count(*) FILTER (WHERE d.finished AND d.completed_date BETWEEN _from AND _to),
           'on_time',       count(*) FILTER (WHERE d.finished AND d.completed_date BETWEEN _from AND _to
                                               AND d.due_date IS NOT NULL AND d.completed_date <= d.due_date),
           'late',          count(*) FILTER (WHERE d.finished AND d.completed_date BETWEEN _from AND _to
                                               AND d.due_date IS NOT NULL AND d.completed_date > d.due_date),
           'no_due',        count(*) FILTER (WHERE d.finished AND d.completed_date BETWEEN _from AND _to
                                               AND d.due_date IS NULL),
           'open_past_due', count(*) FILTER (WHERE d.received_date <= _to
                                               AND (d.is_open OR (d.finished AND d.completed_date > _to))
                                               AND d.due_date IS NOT NULL AND d.due_date < v_asof),
           'undated',       count(*) FILTER (WHERE d.finished AND d.completed_date IS NULL),
           'as_of',         v_asof
         )
    INTO v_on_time
  FROM d;

  -- ค้างตอนนี้ (คอขวด + เลยกำหนด + ยังไม่มีผู้รับผิดชอบ) — จัดกลุ่มให้หน้าเว็บคิดวันทำการเอง
  SELECT COALESCE(jsonb_agg(jsonb_build_object('s', b.s, 'due', b.due_date, 'c', b.created_date, 'u', b.unassigned, 'n', b.n)
                            ORDER BY b.s, b.due_date NULLS LAST, b.created_date, b.unassigned), '[]'::jsonb)
    INTO v_backlog
  FROM (
    SELECT CASE WHEN c.status IN ('new', 'pending') THEN 'new' ELSE c.status END AS s,
           c.due_date,
           (c.created_at AT TIME ZONE 'Asia/Bangkok')::date AS created_date,
           (c.assigned_to IS NULL) AS unassigned,
           count(*)::int AS n
    FROM public.complaints AS c
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    WHERE c.municipality_id = _municipality_id
      AND c.status IN ('new', 'pending', 'received', 'in_progress')
      AND NOT COALESCE(cat.is_adhoc, false)
    GROUP BY 1, 2, 3, 4
  ) AS b;

  -- ขึ้นทะเบียนรอดำเนินการ (#584) แยกการ์ด — ไม่นับเป็นเลยกำหนด
  SELECT jsonb_build_object(
           'n', COALESCE(sum(x.n), 0)::int,
           'by_reason', COALESCE(jsonb_object_agg(x.reason, x.n), '{}'::jsonb)
         )
    INTO v_parked
  FROM (
    SELECT COALESCE(c.parked_reason, 'other') AS reason, count(*)::int AS n
    FROM public.complaints AS c
    WHERE c.municipality_id = _municipality_id
      AND c.status = 'parked'
    GROUP BY 1
  ) AS x;

  -- ปัญหาซ้ำซาก: หมวด + หมู่เดียวกัน ≥ 3 เรื่องใน 90 วัน
  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', r.category, 'label', r.label, 'village', r.village, 'n', r.n)
                            ORDER BY r.n DESC, r.village, r.category), '[]'::jsonb)
    INTO v_repeat
  FROM (
    SELECT x.category, max(x.cat_label) AS label, x.village, count(*)::int AS n
    FROM (
      SELECT c.category, cat.label AS cat_label, public.exec_village_label(c.municipality_id, c.village) AS village
      FROM public.complaints AS c
      LEFT JOIN public.complaint_categories AS cat
        ON cat.municipality_id = c.municipality_id AND cat.value = c.category
      WHERE c.municipality_id = _municipality_id
        AND c.created_at >= ((v_today - 89)::timestamp AT TIME ZONE 'Asia/Bangkok')
        AND c.status <> 'rejected'
        AND c.category IS NOT NULL
        AND NOT COALESCE(cat.is_adhoc, false)
        AND NOT COALESCE(cat.requires_manual_intake, false)
    ) AS x
    WHERE x.village <> ''
    GROUP BY x.category, x.village
    HAVING count(*) >= 3
    ORDER BY count(*) DESC, x.village, x.category
    LIMIT 30
  ) AS r;

  RETURN jsonb_build_object(
    'period',            v_period,
    'villages',          v_villages -> 'groups',
    'villages_unlisted', (v_villages ->> 'unlisted')::int,
    'on_time',  v_on_time,
    'backlog',  v_backlog,
    'parked',   v_parked,
    'repeat',   jsonb_build_object('days', 90, 'min', 3, 'groups', v_repeat)
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- คำขอ E-Service (document_requests)
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน
--   by_type : แยก document_type ตามวันที่ยื่นในช่วง — total/pending/processing/completed/rejected/avg_days
--             avg_days = ค่าเฉลี่ย (issued_at − created_at) วันปฏิทิน ทศนิยม 1 เฉพาะ completed (นิยามเดียวกับ doc_request_stats_fy)
--             นับในฐานข้อมูลครบทุกแถว (แทนการนับจากรายการรายเรื่องที่ถูกตัด 1,000 แถวใน E1)
--   on_time : แยก document_type — completed/on_time/late/no_due = คำขอที่ออกผล (issued_at) ในช่วงนี้ เทียบ due_date
--             open_past_due = ค้าง ณ สิ้นช่วง และ due_date < min(วันนี้, _to) · ไม่รวม rejected
--             ⚠️ due_date ของคำขอเป็น "วันปฏิทิน" (route_document_request_department: วันยื่น + sla_days) ต่างจากคำร้อง
--   backlog : ค้างอยู่ตอนนี้ [{t, s, due, c, n}] t = ประเภท · s = pending|processing · c = วันที่ยื่น (ไทย)
--   entered : ใครเป็นผู้กรอกคำขอที่ยื่นในช่วงนี้ ตาม role ปัจจุบันของบัญชีผู้กรอก (created_by_uid ประทับโดย trigger แก้ไม่ได้)
--             citizen = ประชาชนยื่นเอง · council = สท. · staff = เจ้าหน้าที่กรอกแทน (เคาน์เตอร์) · unknown = แถวก่อนมีตราประทับ (#646)
CREATE OR REPLACE FUNCTION public.exec_summary_doc_requests(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_from    timestamptz;
  v_to      timestamptz;
  v_asof    date;
  v_by_type jsonb;
  v_on_time jsonb;
  v_backlog jsonb;
  v_entered jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  v_from := _from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_to   := (_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_asof := LEAST(v_today, _to);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           't', x.t, 'total', x.total, 'pending', x.pending, 'processing', x.processing,
           'completed', x.completed, 'rejected', x.rejected, 'avg_days', x.avg_days
         ) ORDER BY x.total DESC, x.t), '[]'::jsonb)
    INTO v_by_type
  FROM (
    SELECT r.document_type AS t,
           count(*)::int                                            AS total,
           count(*) FILTER (WHERE r.status = 'pending')::int        AS pending,
           count(*) FILTER (WHERE r.status = 'processing')::int     AS processing,
           count(*) FILTER (WHERE r.status = 'completed')::int      AS completed,
           count(*) FILTER (WHERE r.status = 'rejected')::int       AS rejected,
           round(avg(extract(epoch FROM (r.issued_at - r.created_at)) / 86400.0)
                   FILTER (WHERE r.status = 'completed' AND r.issued_at IS NOT NULL), 1) AS avg_days
    FROM public.document_requests AS r
    WHERE r.municipality_id = _municipality_id
      AND r.created_at >= v_from AND r.created_at < v_to
    GROUP BY r.document_type
  ) AS x;

  WITH d AS (
    SELECT r.document_type AS t, r.status, r.due_date,
           (r.created_at AT TIME ZONE 'Asia/Bangkok')::date AS created_date,
           (r.issued_at  AT TIME ZONE 'Asia/Bangkok')::date AS done_date
    FROM public.document_requests AS r
    WHERE r.municipality_id = _municipality_id
      AND r.status IN ('pending', 'processing', 'completed')
      AND r.created_at < v_to
      AND (r.status <> 'completed' OR r.issued_at IS NULL OR r.issued_at >= v_from)
  ), g AS (
    SELECT d.t,
           count(*) FILTER (WHERE d.status = 'completed' AND d.done_date BETWEEN _from AND _to)::int AS completed,
           count(*) FILTER (WHERE d.status = 'completed' AND d.done_date BETWEEN _from AND _to
                              AND d.due_date IS NOT NULL AND d.done_date <= d.due_date)::int AS on_time,
           count(*) FILTER (WHERE d.status = 'completed' AND d.done_date BETWEEN _from AND _to
                              AND d.due_date IS NOT NULL AND d.done_date > d.due_date)::int AS late,
           count(*) FILTER (WHERE d.status = 'completed' AND d.done_date BETWEEN _from AND _to
                              AND d.due_date IS NULL)::int AS no_due,
           count(*) FILTER (WHERE d.created_date <= _to
                              AND (d.status IN ('pending', 'processing') OR (d.status = 'completed' AND d.done_date > _to))
                              AND d.due_date IS NOT NULL AND d.due_date < v_asof)::int AS open_past_due,
           count(*) FILTER (WHERE d.status = 'completed' AND d.done_date IS NULL)::int AS undated
    FROM d
    GROUP BY d.t
  )
  SELECT jsonb_build_object(
           'as_of', v_asof,
           'by_type', COALESCE(jsonb_agg(jsonb_build_object(
             't', g.t, 'completed', g.completed, 'on_time', g.on_time, 'late', g.late,
             'no_due', g.no_due, 'open_past_due', g.open_past_due, 'undated', g.undated
           ) ORDER BY g.t) FILTER (WHERE g.completed + g.open_past_due + g.undated > 0), '[]'::jsonb)
         )
    INTO v_on_time
  FROM g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', b.t, 's', b.status, 'due', b.due_date, 'c', b.created_date, 'n', b.n)
                            ORDER BY b.t, b.status, b.due_date NULLS LAST, b.created_date), '[]'::jsonb)
    INTO v_backlog
  FROM (
    SELECT r.document_type AS t, r.status, r.due_date,
           (r.created_at AT TIME ZONE 'Asia/Bangkok')::date AS created_date,
           count(*)::int AS n
    FROM public.document_requests AS r
    WHERE r.municipality_id = _municipality_id
      AND r.status IN ('pending', 'processing')
    GROUP BY 1, 2, 3, 4
  ) AS b;

  SELECT jsonb_build_object(
           'citizen', count(*) FILTER (WHERE pr.role = 'citizen'),
           'council', count(*) FILTER (WHERE pr.role = 'council'),
           'staff',   count(*) FILTER (WHERE pr.role IN ('superadmin', 'admin', 'officer', 'viewer', 'staff', 'technician')),
           'unknown', count(*) FILTER (WHERE pr.role IS NULL
                                         OR pr.role NOT IN ('citizen', 'council', 'superadmin', 'admin', 'officer',
                                                            'viewer', 'staff', 'technician'))
         )
    INTO v_entered
  FROM public.document_requests AS r
  LEFT JOIN public.profiles AS pr ON pr.id = r.created_by_uid
  WHERE r.municipality_id = _municipality_id
    AND r.created_at >= v_from AND r.created_at < v_to;

  RETURN jsonb_build_object(
    'by_type', v_by_type,
    'on_time', v_on_time,
    'backlog', v_backlog,
    'entered', v_entered
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ความพึงพอใจ (คำร้อง)
-- ══════════════════════════════════════════════════════════════════════════════════
-- สูตรเดียวกับรายงานอัตราตอบ #681 (src/lib/complaintRatingResponseRate.js buildMonthlyResponseRate) แต่รวมทั้งช่วง ไม่แยกเดือน
--   ตัวหาร (closed)  = คำร้อง status closed/completed ที่ closed_at อยู่ในช่วง ไม่ใช่หมวดเฉพาะกิจ
--   submitters       = ผู้ยื่นของเรื่องในตัวหาร ตาม role ปัจจุบัน (council/citizen/anonymous/staff/unknown — submitterGroup)
--   sources          = ที่มาคะแนน (ratingSource): proxy → verified → via_link → linked_anon
--                      complaints = จำนวนเรื่องไม่ซ้ำที่มีคะแนนจากที่มานั้น · sum/cnt = ผลรวม/จำนวนคะแนน (หน้าเว็บหารเอง)
--                      legacy: complaints.rating เดิมที่ไม่มีแถว verified ในตาราง นับเป็น verified
--   genuine          = เสียงผู้รับบริการตัวจริง: via_link หรือ (verified และผู้ยื่นเป็น citizen)
--   any_rated        = เรื่องไม่ซ้ำที่มีคะแนนจากที่มาใดก็ได้
--   general          = แบบประเมินภาพรวม (/satisfaction ไม่ผูกคำร้อง) ที่ให้ในช่วงนี้ {n, sum}
--   low              = คะแนน 1–2 ที่ "ให้ในช่วงนี้" (created_at) แยกที่มา รวมแบบภาพรวม — ไม่รวม complaints.rating เดิม
--   by_dept          = ต่อกอง (department_id ของคำร้อง): closed, genuine_sum/cnt, all_sum/cnt
-- ไม่คืนความเห็น (comment) — เป็นข้อความที่ผู้ประเมินพิมพ์เอง อ่านได้ที่เมนูความพึงพอใจตามสิทธิ์เดิม
CREATE OR REPLACE FUNCTION public.exec_summary_satisfaction(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from   timestamptz;
  v_to     timestamptz;
  v_main   jsonb;
  v_dept   jsonb;
  v_gen    jsonb;
  v_low    jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  v_from := _from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_to   := (_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  WITH closed AS (
    SELECT c.id, c.rating AS legacy_rating, public.exec_complaint_dept(c.municipality_id, c.department_id, c.department) AS dept,
           CASE
             WHEN c.user_id IS NULL THEN 'anonymous'
             WHEN pr.role IS NULL THEN 'unknown'
             WHEN pr.role = 'council' THEN 'council'
             WHEN pr.role = 'citizen' THEN 'citizen'
             WHEN pr.role IN ('superadmin', 'admin', 'officer', 'viewer', 'staff', 'technician') THEN 'staff'
             ELSE 'unknown'
           END AS grp
    FROM public.complaints AS c
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    LEFT JOIN public.profiles AS pr ON pr.id = c.user_id
    WHERE c.municipality_id = _municipality_id
      AND c.status IN ('closed', 'completed')
      AND c.closed_at >= v_from AND c.closed_at < v_to
      AND NOT (c.category IS NOT NULL AND COALESCE(cat.is_adhoc, false))
  ), rated AS (
    SELECT s.complaint_id AS id, s.rating::numeric AS rating,
           CASE
             WHEN COALESCE(s.rated_by_proxy, false) THEN 'proxy'
             WHEN COALESCE(s.is_verified, false) THEN 'verified'
             WHEN COALESCE(s.via_link, false) THEN 'via_link'
             ELSE 'linked_anon'
           END AS source
    FROM public.satisfaction_ratings AS s
    JOIN closed AS c ON c.id = s.complaint_id
    UNION ALL
    -- legacy: คะแนนเดิมใน complaints.rating (ก่อนมีตาราง) ที่ไม่มีแถว verified → นับเป็น verified
    SELECT c.id, c.legacy_rating::numeric, 'verified'
    FROM closed AS c
    WHERE c.legacy_rating IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.satisfaction_ratings AS s
        WHERE s.complaint_id = c.id
          AND COALESCE(s.is_verified, false)
          AND NOT COALESCE(s.rated_by_proxy, false)
      )
  ), r2 AS (
    SELECT r.id, r.source, r.rating, c.grp, c.dept,
           (r.source = 'via_link' OR (r.source = 'verified' AND c.grp = 'citizen')) AS genuine
    FROM rated AS r
    JOIN closed AS c ON c.id = r.id
  ), src AS (
    SELECT s.source, count(DISTINCT s.id)::int AS complaints, COALESCE(sum(s.rating), 0) AS sum, count(s.rating)::int AS cnt
    FROM r2 AS s
    GROUP BY s.source
  ), dept_closed AS (
    SELECT c.dept, count(*)::int AS closed FROM closed AS c GROUP BY c.dept
  ), dept_rated AS (
    SELECT r.dept,
           COALESCE(sum(r.rating) FILTER (WHERE r.genuine), 0) AS genuine_sum,
           count(r.rating) FILTER (WHERE r.genuine)::int         AS genuine_cnt,
           COALESCE(sum(r.rating), 0)                            AS all_sum,
           count(r.rating)::int                                  AS all_cnt
    FROM r2 AS r
    GROUP BY r.dept
  )
  SELECT jsonb_build_object(
           'closed', (SELECT count(*) FROM closed),
           'submitters', (SELECT COALESCE(jsonb_object_agg(g.grp, g.n), '{}'::jsonb)
                          FROM (SELECT c.grp, count(*)::int AS n FROM closed AS c GROUP BY c.grp) AS g),
           'sources', (SELECT COALESCE(jsonb_object_agg(s.source, jsonb_build_object('complaints', s.complaints, 'sum', s.sum, 'cnt', s.cnt)), '{}'::jsonb)
                       FROM src AS s),
           'genuine', (SELECT jsonb_build_object('complaints', count(DISTINCT r.id), 'sum', COALESCE(sum(r.rating), 0), 'cnt', count(r.rating))
                       FROM r2 AS r WHERE r.genuine),
           'any_rated', (SELECT count(DISTINCT r.id) FROM r2 AS r),
           'by_dept', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                 'dept', d.dept, 'closed', d.closed,
                                 'genuine_sum', COALESCE(x.genuine_sum, 0), 'genuine_cnt', COALESCE(x.genuine_cnt, 0),
                                 'all_sum', COALESCE(x.all_sum, 0), 'all_cnt', COALESCE(x.all_cnt, 0)
                               ) ORDER BY d.closed DESC, d.dept NULLS LAST), '[]'::jsonb)
                       FROM dept_closed AS d
                       LEFT JOIN dept_rated AS x ON x.dept IS NOT DISTINCT FROM d.dept)
         )
    INTO v_main;

  SELECT jsonb_build_object('n', count(*), 'sum', COALESCE(sum(s.rating), 0))
    INTO v_gen
  FROM public.satisfaction_ratings AS s
  WHERE s.municipality_id = _municipality_id
    AND s.complaint_id IS NULL
    AND NOT COALESCE(s.rated_by_proxy, false)
    AND s.created_at >= v_from AND s.created_at < v_to;

  SELECT COALESCE(jsonb_object_agg(x.source, x.n), '{}'::jsonb)
    INTO v_low
  FROM (
    SELECT CASE
             WHEN COALESCE(s.rated_by_proxy, false) THEN 'proxy'
             WHEN s.complaint_id IS NULL THEN 'general'
             WHEN COALESCE(s.is_verified, false) THEN 'verified'
             WHEN COALESCE(s.via_link, false) THEN 'via_link'
             ELSE 'linked_anon'
           END AS source,
           count(*)::int AS n
    FROM public.satisfaction_ratings AS s
    WHERE s.municipality_id = _municipality_id
      AND s.created_at >= v_from AND s.created_at < v_to
      AND s.rating <= 2
    GROUP BY 1
  ) AS x;

  RETURN v_main || jsonb_build_object('general', v_gen, 'low', v_low);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- รายกอง (⑥)
-- ══════════════════════════════════════════════════════════════════════════════════
-- 1 แถวต่อกอง (กองที่ปิดใช้งานแสดงเฉพาะเมื่อยังมีเรื่อง) + แถวกอง null = "ไม่ระบุกอง"
--   กองของคำร้อง = exec_complaint_dept() (department_id หรือชื่อกองข้อความเดิม — ชุดเดียวกับเมนูผลการปฏิบัติงาน)
--   complaints: open = new/pending/received/in_progress (⚠️ รวมเรื่องที่ยังไม่รับ ต่างจาก "กองของฉัน" ที่นับแค่ received/in_progress)
--               overdue = open และ due_date < วันนี้ · parked
--               done = เสร็จ (done/closed/completed) ที่วันเสร็จอยู่ในช่วง (วันเสร็จนิยามเดียวกับ on_time ของคำร้อง)
--               ไม่รวมหมวดเฉพาะกิจ
--   docs:       open = pending/processing · overdue = open และ due_date < วันนี้ · done = completed ที่ issued_at อยู่ในช่วง
-- ไม่จัดอันดับรายคน (ดูรายคนที่เมนู "ผลการปฏิบัติงาน" ตามสิทธิ์เดิม)
CREATE OR REPLACE FUNCTION public.exec_summary_departments(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_from  timestamptz;
  v_to    timestamptz;
  v_rows  jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  v_from := _from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_to   := (_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  WITH dept AS (
    SELECT dp.id, dp.name, dp.short_name, dp.sort_order, dp.is_active
    FROM public.departments AS dp
    WHERE dp.municipality_id = _municipality_id
  ), comp_base AS (
    SELECT public.exec_complaint_dept(c.municipality_id, c.department_id, c.department) AS department_id, c.status, c.due_date,
           CASE
             WHEN c.status NOT IN ('done', 'closed', 'completed') THEN NULL
             WHEN c.resolved_by IS NOT NULL THEN c.closed_at
             ELSE LEAST(c.closed_at,
                        (SELECT min(t.created_at) FROM public.complaint_timeline AS t
                          WHERE t.complaint_id = c.id AND t.status IN ('done', 'closed', 'completed')))
           END AS completed_at
    FROM public.complaints AS c
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    WHERE c.municipality_id = _municipality_id
      AND NOT COALESCE(cat.is_adhoc, false)
      AND (
        c.status IN ('new', 'pending', 'received', 'in_progress', 'parked')
        OR (c.status IN ('done', 'closed', 'completed') AND (c.closed_at IS NULL OR c.closed_at >= v_from))
      )
  ), comp AS (
    SELECT b.department_id AS dept_id,
           count(*) FILTER (WHERE b.status IN ('new', 'pending', 'received', 'in_progress'))::int AS open,
           count(*) FILTER (WHERE b.status IN ('new', 'pending', 'received', 'in_progress')
                              AND b.due_date < v_today)::int AS overdue,
           count(*) FILTER (WHERE b.status = 'parked')::int AS parked,
           count(*) FILTER (WHERE b.completed_at >= v_from AND b.completed_at < v_to)::int AS done
    FROM comp_base AS b
    GROUP BY b.department_id
  ), docs AS (
    SELECT r.department_id AS dept_id,
           count(*) FILTER (WHERE r.status IN ('pending', 'processing'))::int AS open,
           count(*) FILTER (WHERE r.status IN ('pending', 'processing') AND r.due_date < v_today)::int AS overdue,
           count(*) FILTER (WHERE r.status = 'completed' AND r.issued_at >= v_from AND r.issued_at < v_to)::int AS done
    FROM public.document_requests AS r
    WHERE r.municipality_id = _municipality_id
    GROUP BY r.department_id
  ), k AS (
    SELECT dept.id AS dept_id FROM dept
    UNION
    SELECT comp.dept_id FROM comp
    UNION
    SELECT docs.dept_id FROM docs
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', k.dept_id,
           'name', dept.name,
           'short_name', dept.short_name,
           'complaints', jsonb_build_object('open', COALESCE(comp.open, 0), 'overdue', COALESCE(comp.overdue, 0),
                                            'parked', COALESCE(comp.parked, 0), 'done', COALESCE(comp.done, 0)),
           'docs', jsonb_build_object('open', COALESCE(docs.open, 0), 'overdue', COALESCE(docs.overdue, 0),
                                      'done', COALESCE(docs.done, 0))
         ) ORDER BY (k.dept_id IS NULL), dept.sort_order NULLS LAST, dept.name), '[]'::jsonb)
    INTO v_rows
  FROM k
  LEFT JOIN dept ON dept.id = k.dept_id
  LEFT JOIN comp ON comp.dept_id IS NOT DISTINCT FROM k.dept_id
  LEFT JOIN docs ON docs.dept_id IS NOT DISTINCT FROM k.dept_id
  WHERE COALESCE(dept.is_active, false)
     OR COALESCE(comp.open, 0) + COALESCE(comp.parked, 0) + COALESCE(comp.done, 0)
        + COALESCE(docs.open, 0) + COALESCE(docs.done, 0) > 0;

  RETURN jsonb_build_object('departments', v_rows);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- รถรับ-ส่งผู้ป่วย / รถรับ-ส่งชุมชน (ข้อมูลสุขภาพ ⇒ ยอดรวมเท่านั้น)
-- ══════════════════════════════════════════════════════════════════════════════════
-- bookings : ใบจองที่ "วันนัด" (appointment_at เวลาไทย) อยู่ในช่วง แยก service_type (patient/community) และสถานะ
-- trips    : เที่ยวรถ (patient_booking_trips) ที่มีใบจองซึ่งวันนัดอยู่ในช่วง แยก service_type
--            หาใบจองจาก booking_ids ของเที่ยว (ไม่ใช่ patient_bookings.trip_id — การคืนคิว/เปิดใหม่ล้าง trip_id ทิ้ง
--            เที่ยวที่ยกเลิกจะหายจากการนับ)
--            ran = ออกรถแล้ว (outbound/hospital/returning/completed) · completed · waiting (confirmed) · issue · cancelled
-- ไม่มีชื่อผู้ป่วย จุดรับ โรงพยาบาลปลายทาง หรือคนขับ
CREATE OR REPLACE FUNCTION public.exec_summary_patient_transport(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from     timestamptz;
  v_to       timestamptz;
  v_bookings jsonb;
  v_trips    jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  v_from := _from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_to   := (_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  SELECT COALESCE(jsonb_object_agg(x.service_type, x.counts), '{}'::jsonb)
    INTO v_bookings
  FROM (
    SELECT b.service_type,
           jsonb_build_object(
             'total',     count(*),
             'submitted', count(*) FILTER (WHERE b.status = 'submitted'),
             'confirmed', count(*) FILTER (WHERE b.status = 'confirmed'),
             'completed', count(*) FILTER (WHERE b.status = 'completed'),
             'cancelled', count(*) FILTER (WHERE b.status = 'cancelled')
           ) AS counts
    FROM public.patient_bookings AS b
    WHERE b.municipality_id = _municipality_id
      AND b.appointment_at >= v_from AND b.appointment_at < v_to
    GROUP BY b.service_type
  ) AS x;

  SELECT COALESCE(jsonb_object_agg(y.service_type, y.counts), '{}'::jsonb)
    INTO v_trips
  FROM (
    SELECT t.service_type,
           jsonb_build_object(
             'ran',       count(*) FILTER (WHERE t.state IN ('outbound', 'hospital', 'returning', 'completed')),
             'completed', count(*) FILTER (WHERE t.state = 'completed'),
             'waiting',   count(*) FILTER (WHERE t.state = 'confirmed'),
             'issue',     count(*) FILTER (WHERE t.state = 'issue'),
             'cancelled', count(*) FILTER (WHERE t.state = 'cancelled')
           ) AS counts
    FROM (
      SELECT DISTINCT tr.id, tr.state, b.service_type
      FROM public.patient_booking_trips AS tr
      JOIN public.patient_bookings AS b
        ON b.id = ANY (tr.booking_ids) AND b.municipality_id = _municipality_id
      WHERE tr.municipality_id = _municipality_id
        AND b.appointment_at >= v_from AND b.appointment_at < v_to
    ) AS t
    GROUP BY t.service_type
  ) AS y;

  RETURN jsonb_build_object('bookings', v_bookings, 'trips', v_trips);
END;
$$;

-- ── สิทธิ์: ฟังก์ชันย่อยเรียกผ่าน executive_overview() เท่านั้น ─────────────────────────
-- Supabase แจก EXECUTE ให้ anon/authenticated อัตโนมัติกับฟังก์ชันใหม่ใน public (ข้อ 5 NOTES.md) — ถอนทั้งหมด
REVOKE ALL ON FUNCTION public.exec_summary_complaints(uuid, date, date)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_doc_requests(uuid, date, date)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_satisfaction(uuid, date, date)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_departments(uuid, date, date)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_patient_transport(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_village_label(uuid, text)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_complaint_dept(uuid, uuid, text)            FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_summary_complaints(uuid, date, date) IS
  'ห้องผู้บริหาร: คำร้อง — ช่องทาง/หมู่บ้าน/ทันกำหนด (สูตรผลการปฏิบัติงาน)/ค้างตอนนี้/รอดำเนินการ/ปัญหาซ้ำซาก · ตัวเลขรวมเท่านั้น';
COMMENT ON FUNCTION public.exec_summary_doc_requests(uuid, date, date) IS
  'ห้องผู้บริหาร: คำขอ E-Service — แยกประเภท/ทันกำหนด/ค้างตอนนี้/ผู้กรอก · ตัวเลขรวมเท่านั้น';
COMMENT ON FUNCTION public.exec_summary_satisfaction(uuid, date, date) IS
  'ห้องผู้บริหาร: ความพึงพอใจคำร้อง — สูตรเดียวกับรายงานอัตราตอบ #681 รวมทั้งช่วง + คะแนนต่ำ + รายกอง · ไม่คืนความเห็น';
COMMENT ON FUNCTION public.exec_summary_departments(uuid, date, date) IS
  'ห้องผู้บริหาร: รายกอง — คำร้อง/คำขอ ค้าง เลยกำหนด เสร็จในช่วง · ไม่จัดอันดับรายคน';
COMMENT ON FUNCTION public.exec_summary_patient_transport(uuid, date, date) IS
  'ห้องผู้บริหาร: รถรับ-ส่งผู้ป่วย/ชุมชน — ยอดจอง + เที่ยวที่ออกรถจริง · ข้อมูลสุขภาพ ยอดรวมเท่านั้น';
COMMENT ON FUNCTION public.exec_village_label(uuid, text) IS
  'ห้องผู้บริหาร (ภายใน): ชื่อหมู่บ้านที่แสดงได้ — ทะเบียน locations หรือ "หมู่ N" ล้วน · อื่นๆ คืน '''' (นับเป็นตัวเลข ไม่คืนข้อความผู้แจ้ง)';
COMMENT ON FUNCTION public.exec_complaint_dept(uuid, uuid, text) IS
  'ห้องผู้บริหาร (ภายใน): กองของคำร้อง — department_id หรือจับคู่ชื่อกองข้อความเดิม (ชุดเดียวกับ complaint_matches_my_department)';

-- ด่านท้ายไฟล์: ตัวรวบเรียกเฉพาะฟังก์ชันที่ "เจ้าของเดียวกับตัวรวบ" — ถ้าไฟล์นี้กับไฟล์ 1 ถูกรันด้วย role ต่างกัน
-- (เช่น CLI กับ MCP) การ์ดทั้งหน้าจะว่างเงียบๆ จึงล้มทั้งไฟล์ (transaction เดียว) แทน
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname || ' (' || p.proowner::regrole::text || ')', ', ')
    INTO v_bad
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'exec\_%'
    AND p.proowner <> (SELECT o.proowner FROM pg_proc AS o
                       WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_summary_service: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;
END $$;
