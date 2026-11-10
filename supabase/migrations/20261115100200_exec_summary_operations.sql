-- 20261115100200_exec_summary_operations.sql
--
-- ห้องผู้บริหาร เฟส E2 — ไฟล์ 3/3: เรื่องรอตัดสิน (①) + สัญญาณเตือน (③) + โครงการ/แผน (⑤)
--   exec_summary_fleet              ยานพาหนะ: เลยรอบซ่อมบำรุง + อุบัติเหตุ/สูญหายในช่วง
--   exec_summary_borrowable_assets  ใบยืมพัสดุ: รอพิจารณา / รอจ่าย / ยืมอยู่ / เกินกำหนดคืน / รอผลชดใช้
--   exec_summary_projects           โครงการก่อสร้าง: ตามขั้น / ขอเปลี่ยนแปลงรอพิจารณา / ช้ากว่าแผน / ใกล้หมด-เลยสัญญา / ระงับ
--   exec_summary_local_plan         แผนพัฒนา: ฉบับร่างรอประกาศ + แผนดำเนินงานปีงบนี้ประกาศแล้วหรือยัง
--   exec_summary_water              น้ำ-ฝน: ประกาศรอยืนยัน + เหตุการณ์ที่ยังเปิดอยู่
--
-- กติกาเดียวกับไฟล์ 2 (exec_assert_viewer บรรทัดแรก · ตัวเลขรวมเท่านั้น · เรียกผ่าน executive_overview() เท่านั้น)
-- ฟังก์ชันกลุ่มนี้เป็น "สถานะตอนนี้" ไม่ขึ้นกับช่วงที่เลือก ยกเว้น fleet.incidents (ตามวันที่เกิดเหตุในช่วง)
-- วันที่คืนเป็นวันที่ (ไม่ใช่จำนวนวัน) ให้หน้าเว็บคิด "รอมากี่วันทำการ" ด้วย workingDays.js เอง
--
-- จงใจไม่ทำในไฟล์นี้ (เหตุผลอยู่ในทะเบียน executiveRegistry.js)
--   - งบน้ำมันเกินวงเงิน: แท็บงบยานพาหนะยังซ่อนอยู่ (#501) ข้อมูล fleet_budgets ยังใช้ตัดสินไม่ได้
--   - งานซ่อมค้าง: infrastructure_works เป็นบันทึกงานหน้างาน (ค่าเริ่มต้น completed) ไม่ใช่คิวงานซ่อม
--   - % ดำเนินการตามแผนรายกอง: ผู้บริหารอ่านตารางแผนได้ตาม RLS อยู่แล้ว (local_plan_can_read) หน้าเว็บใช้
--     src/lib/localPlanProgress.js ตัวเดียวกับเมนูแผนพัฒนา — ไม่เขียนสูตรสายรายการ/ขั้นก่อสร้างซ้ำใน SQL
--   - ช้ากว่าแผน: อ่านป้ายที่ล็อกไว้ใน frozen ของรายงานรายสัปดาห์ฉบับ final ล่าสุด (คำนวณโดย constructionReport.js
--     ตอนล็อก) ไม่คำนวณใหม่
--
-- ไม่มี ADD COLUMN / CREATE TABLE (ข้อ 3 NOTES.md) — ฟังก์ชันใหม่ทั้งหมด ไม่ทับของเดิม
-- ย้อนกลับ: DROP FUNCTION public.exec_summary_fleet(uuid,date,date), public.exec_summary_borrowable_assets(uuid,date,date),
--   public.exec_summary_projects(uuid,date,date), public.exec_summary_local_plan(uuid,date,date), public.exec_summary_water(uuid,date,date);
--
-- ตรวจหลัง apply: คำสั่งเดียวกับหัวไฟล์ 2 (auth_exec=false, anon_exec=false, prosecdef=true ทุกแถว)

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'exec_summary_operations: ต้อง apply 20261115100000_exec_access_overview.sql ก่อน';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('fleet_vehicles', 'municipality_id'), ('fleet_vehicles', 'status'),
    ('fleet_maintenance', 'municipality_id'), ('fleet_maintenance', 'vehicle_id'), ('fleet_maintenance', 'service_date'),
    ('fleet_maintenance', 'next_service_date'), ('fleet_maintenance', 'created_at'),
    ('fleet_incidents', 'municipality_id'), ('fleet_incidents', 'incident_kind'), ('fleet_incidents', 'incident_date'),
    ('fleet_incidents', 'report_date'),
    ('asset_borrow_requests', 'municipality_id'), ('asset_borrow_requests', 'workflow_status'),
    ('asset_borrow_requests', 'created_at'), ('asset_borrow_requests', 'return_due_date'),
    ('civil_projects', 'municipality_id'), ('civil_projects', 'stage'), ('civil_projects', 'end_date'),
    ('civil_project_contracts', 'project_id'), ('civil_project_contracts', 'extended_until'),
    ('civil_project_contracts', 'notice_to_proceed_date'), ('civil_project_contracts', 'finish_within_days'),
    ('civil_project_changes', 'project_id'), ('civil_project_changes', 'kind'), ('civil_project_changes', 'decision'),
    ('civil_project_changes', 'new_end_date'), ('civil_project_changes', 'created_at'),
    ('civil_weekly_reports', 'project_id'), ('civil_weekly_reports', 'status'), ('civil_weekly_reports', 'frozen'),
    ('civil_weekly_reports', 'period_end'), ('civil_weekly_reports', 'week_no'),
    ('local_op_plans', 'municipality_id'), ('local_op_plans', 'status'), ('local_op_plans', 'kind'),
    ('local_op_plans', 'fiscal_year'), ('local_op_plans', 'published_on'),
    ('local_dev_plans', 'municipality_id'), ('local_dev_plans', 'status'),
    ('water_announcements', 'municipality_id'), ('water_announcements', 'status'), ('water_announcements', 'drafted_at'),
    ('water_announcements', 'event_id'),
    ('water_announcement_settings', 'municipality_id'), ('water_announcement_settings', 'enabled'),
    ('water_events', 'municipality_id'), ('water_events', 'opened_at'), ('water_events', 'closed_at')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_summary_operations: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ยานพาหนะ
-- ══════════════════════════════════════════════════════════════════════════════════
-- maintenance: เฉพาะรถ status active · "รอบถัดไป" = next_service_date ของบันทึกซ่อมบำรุงล่าสุดที่ตั้งรอบไว้
--   overdue  = รอบถัดไป < วันนี้ และยังไม่มีบันทึกซ่อมบำรุงใดลงวันที่ ≥ วันรอบนั้น
--   due_soon = รอบถัดไปอยู่ในวันนี้ถึงอีก 14 วัน และยังไม่มีบันทึกที่ลงวันที่ ≥ วันรอบนั้น
--   ใช้วันที่อย่างเดียว ไม่ใช้เลขไมล์ (เลขไมล์พิมพ์ผิดลามได้ #170 — ใช้ตัดสินเตือนไม่ได้)
-- incidents: เหตุที่เกิด (incident_date หรือวันรับแจ้งถ้าไม่ระบุวันเกิด) ในช่วงที่เลือก แยก damage (เสียหาย) / loss (สูญหาย)
CREATE OR REPLACE FUNCTION public.exec_summary_fleet(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_maint jsonb;
  v_inc   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  WITH plan AS (
    SELECT DISTINCT ON (m.vehicle_id) m.vehicle_id, m.next_service_date
    FROM public.fleet_maintenance AS m
    JOIN public.fleet_vehicles AS v ON v.id = m.vehicle_id
    WHERE m.municipality_id = _municipality_id
      AND v.municipality_id = _municipality_id
      AND v.status = 'active'
      AND m.next_service_date IS NOT NULL
    ORDER BY m.vehicle_id, m.service_date DESC, m.created_at DESC
  ), pending AS (
    SELECT p.vehicle_id, p.next_service_date
    FROM plan AS p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fleet_maintenance AS m2
      WHERE m2.vehicle_id = p.vehicle_id AND m2.service_date >= p.next_service_date
    )
  )
  SELECT jsonb_build_object(
           'overdue',        count(*) FILTER (WHERE p.next_service_date < v_today),
           'oldest_due_on',  min(p.next_service_date) FILTER (WHERE p.next_service_date < v_today),
           'due_soon',       count(*) FILTER (WHERE p.next_service_date BETWEEN v_today AND v_today + 14)
         )
    INTO v_maint
  FROM pending AS p;

  SELECT jsonb_build_object(
           'damage', count(*) FILTER (WHERE i.incident_kind = 'damage'),
           'loss',   count(*) FILTER (WHERE i.incident_kind = 'loss')
         )
    INTO v_inc
  FROM public.fleet_incidents AS i
  WHERE i.municipality_id = _municipality_id
    AND COALESCE(i.incident_date, i.report_date) BETWEEN _from AND _to;

  RETURN jsonb_build_object('maintenance', v_maint, 'incidents', v_inc);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ใบยืมพัสดุ (asset_borrow_requests)
-- ══════════════════════════════════════════════════════════════════════════════════
-- submitted = รอพิจารณา (+ วันที่ยื่นของใบที่รอนานสุด) · approved = อนุมัติแล้วรอจ่ายของ · issued = ยืมอยู่
-- overdue_return = issued และ return_due_date < วันนี้ (เกินกำหนดคืนไม่ได้เก็บเป็นสถานะ คำนวณสด — คอมเมนต์ในตารางเดิม)
-- settlement = คืนแล้วรอผลชดใช้
CREATE OR REPLACE FUNCTION public.exec_summary_borrowable_assets(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_out   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
           'submitted',           count(*) FILTER (WHERE a.workflow_status = 'submitted'),
           'oldest_submitted_on', min((a.created_at AT TIME ZONE 'Asia/Bangkok')::date) FILTER (WHERE a.workflow_status = 'submitted'),
           'approved',            count(*) FILTER (WHERE a.workflow_status = 'approved'),
           'issued',              count(*) FILTER (WHERE a.workflow_status = 'issued'),
           'overdue_return',      count(*) FILTER (WHERE a.workflow_status = 'issued' AND a.return_due_date < v_today),
           'oldest_return_due',   min(a.return_due_date) FILTER (WHERE a.workflow_status = 'issued' AND a.return_due_date < v_today),
           'settlement',          count(*) FILTER (WHERE a.workflow_status = 'settlement')
         )
    INTO v_out
  FROM public.asset_borrow_requests AS a
  WHERE a.municipality_id = _municipality_id;

  RETURN v_out;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- โครงการก่อสร้าง (civil_projects)
-- ══════════════════════════════════════════════════════════════════════════════════
-- by_stage        : โครงการที่ยังไม่จบ (stage ไม่ใช่ closed/cancelled/terminated) นับแยกขั้น
-- change_pending  : คำขอเปลี่ยนแปลง (ขยายเวลา/งด-ลดค่าปรับ/แก้สัญญา) ที่ decision ยังว่าง + วันที่ยื่นของรายการเก่าสุด
-- schedule        : โครงการขั้น contracted/started/construction — ป้ายของรายงานรายสัปดาห์ฉบับ final ล่าสุด
--                   (frozen.overall.label.key: behind/on_track/ahead/unknown) · no_report = ยังไม่มีฉบับ final
--                   stale_report = ฉบับ final ล่าสุดสิ้นช่วงก่อนวันนี้เกิน 14 วัน
-- contract        : ขั้นเดียวกัน — วันสิ้นสุดสัญญาที่มีผล = วันที่ช้ากว่าระหว่าง
--                   (end_date หรือ วันสั่งเริ่มงาน + จำนวนวันแล้วเสร็จ) กับ (extended_until หรือ new_end_date ของคำขอขยายเวลาที่อนุมัติ)
--                   ตรงกับ contractSchedule()/effectiveEndDate() ใน src/lib/constructionLifecycle.js
--                   ending_soon = เหลือ 0–15 วัน · past_end = เลยวันสิ้นสุดแล้วแต่ยังไม่เข้าขั้นตรวจรับ · no_end = ไม่มีวันสิ้นสุด
-- suspended       : stage = suspended
CREATE OR REPLACE FUNCTION public.exec_summary_projects(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today    date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_stage    jsonb;
  v_changes  jsonb;
  v_schedule jsonb;
  v_contract jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_object_agg(s.stage, s.n), '{}'::jsonb)
    INTO v_stage
  FROM (
    SELECT COALESCE(p.stage, 'unknown') AS stage, count(*)::int AS n
    FROM public.civil_projects AS p
    WHERE p.municipality_id = _municipality_id
      AND COALESCE(p.stage, 'unknown') NOT IN ('closed', 'cancelled', 'terminated')
    GROUP BY 1
  ) AS s;

  -- เฉพาะโครงการที่ยังไม่จบ — คำขอค้างของโครงการที่ปิด/ยกเลิก/บอกเลิกไปแล้วไม่ใช่เรื่องรอตัดสิน
  WITH pend AS (
    SELECT ch.kind, ch.created_at
    FROM public.civil_project_changes AS ch
    JOIN public.civil_projects AS p ON p.id = ch.project_id
    WHERE p.municipality_id = _municipality_id
      AND ch.decision IS NULL
      AND COALESCE(p.stage, 'unknown') NOT IN ('closed', 'cancelled', 'terminated')
  )
  SELECT jsonb_build_object(
           'n', (SELECT count(*) FROM pend),
           'by_kind', COALESCE((SELECT jsonb_object_agg(k.kind, k.n)
                                FROM (SELECT pend.kind, count(*)::int AS n FROM pend GROUP BY pend.kind) AS k), '{}'::jsonb),
           'oldest_on', (SELECT min((pend.created_at AT TIME ZONE 'Asia/Bangkok')::date) FROM pend)
         )
    INTO v_changes;

  WITH active AS (
    SELECT p.id
    FROM public.civil_projects AS p
    WHERE p.municipality_id = _municipality_id
      AND p.stage IN ('contracted', 'started', 'construction')
  ), latest AS (
    SELECT DISTINCT ON (r.project_id)
           r.project_id,
           r.frozen #>> '{overall,label,key}' AS label_key,
           r.period_end
    FROM public.civil_weekly_reports AS r
    JOIN active AS a ON a.id = r.project_id
    WHERE r.status = 'final'
    ORDER BY r.project_id, r.period_end DESC NULLS LAST, r.week_no DESC
  )
  SELECT jsonb_build_object(
           'projects',     count(*),
           'behind',       count(*) FILTER (WHERE l.label_key = 'behind'),
           'on_track',     count(*) FILTER (WHERE l.label_key = 'on_track'),
           'ahead',        count(*) FILTER (WHERE l.label_key = 'ahead'),
           'unknown',      count(*) FILTER (WHERE l.project_id IS NOT NULL
                                              AND (l.label_key IS NULL OR l.label_key NOT IN ('behind', 'on_track', 'ahead'))),
           'no_report',    count(*) FILTER (WHERE l.project_id IS NULL),
           'stale_report', count(*) FILTER (WHERE l.period_end < v_today - 14)
         )
    INTO v_schedule
  FROM active AS a
  LEFT JOIN latest AS l ON l.project_id = a.id;

  WITH ends AS (
    SELECT p.id,
           GREATEST(
             COALESCE(p.end_date, c.notice_to_proceed_date + c.finish_within_days),
             GREATEST(
               c.extended_until,
               (SELECT max(ch.new_end_date) FROM public.civil_project_changes AS ch
                 WHERE ch.project_id = p.id AND ch.kind = 'extend_time' AND ch.decision = 'approved')
             )
           ) AS effective_end
    FROM public.civil_projects AS p
    LEFT JOIN public.civil_project_contracts AS c ON c.project_id = p.id
    WHERE p.municipality_id = _municipality_id
      AND p.stage IN ('contracted', 'started', 'construction')
  )
  SELECT jsonb_build_object(
           'ending_soon', count(*) FILTER (WHERE e.effective_end BETWEEN v_today AND v_today + 15),
           'past_end',    count(*) FILTER (WHERE e.effective_end < v_today),
           'no_end',      count(*) FILTER (WHERE e.effective_end IS NULL)
         )
    INTO v_contract
  FROM ends AS e;

  RETURN jsonb_build_object(
    'by_stage',       v_stage,
    'suspended',      COALESCE((v_stage ->> 'suspended')::int, 0),
    'change_pending', v_changes,
    'schedule',       v_schedule,
    'contract',       v_contract
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- แผนพัฒนาท้องถิ่น / แผนการดำเนินงาน
-- ══════════════════════════════════════════════════════════════════════════════════
-- op_drafts  : แผนการดำเนินงานฉบับร่าง (status draft) แยกชนิด main/supplement/amendment — รอเสนอผู้บริหารประกาศ
-- dev_drafts : แผนพัฒนาท้องถิ่นฉบับร่าง
-- current_fy : ปีงบประมาณปัจจุบัน (พ.ศ. — ต.ค. ขึ้นปีใหม่) + มีแผนการดำเนินงานฉบับหลัก/แก้ไขที่ประกาศแล้วหรือยัง + วันประกาศล่าสุด
-- ⚠️ ไม่ตัดสินว่า "ประกาศทันกำหนดตามระเบียบหรือไม่" — วันกำหนดต้องยืนยันกับระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนาของ อปท.
--    ฉบับปัจจุบันก่อน (หน้าเมนูแผนพัฒนามีตัวคำนวณ localPlanDeadlines.js อยู่แล้ว)
CREATE OR REPLACE FUNCTION public.exec_summary_local_plan(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_fy    int;
  v_op    jsonb;
  v_dev   int;
  v_cur   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  v_fy := extract(year FROM v_today)::int + 543 + CASE WHEN extract(month FROM v_today) >= 10 THEN 1 ELSE 0 END;

  SELECT jsonb_build_object(
           'n', COALESCE(sum(k.n), 0)::int,
           'by_kind', COALESCE(jsonb_object_agg(COALESCE(k.kind, 'unknown'), k.n), '{}'::jsonb)
         )
    INTO v_op
  FROM (
    SELECT o.kind, count(*)::int AS n
    FROM public.local_op_plans AS o
    WHERE o.municipality_id = _municipality_id AND o.status = 'draft'
    GROUP BY o.kind
  ) AS k;

  SELECT count(*)::int INTO v_dev
  FROM public.local_dev_plans AS d
  WHERE d.municipality_id = _municipality_id AND d.status = 'draft';

  SELECT jsonb_build_object(
           'fiscal_year',        v_fy,
           'published_main',     count(*) > 0,
           'latest_published_on', max(o.published_on)
         )
    INTO v_cur
  FROM public.local_op_plans AS o
  WHERE o.municipality_id = _municipality_id
    AND o.fiscal_year = v_fy
    AND o.status = 'published'
    AND o.kind IN ('main', 'amendment');

  RETURN jsonb_build_object('op_drafts', v_op, 'dev_drafts', v_dev, 'current_fy', v_cur);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- น้ำ-ฝน
-- ══════════════════════════════════════════════════════════════════════════════════
-- announce_pending : ประกาศที่ระบบร่างแล้วรอผู้มีอำนาจยืนยัน — เงื่อนไขเดียวกับ water_announcement_todo() (20261020130100):
--                    status draft + ร่างไม่เกิน 3 ชม. (⚠️ ต้องตรงกับ c_draft_life ใน water_announcement_tick/approve) +
--                    เหตุการณ์ของประกาศยังเปิด + อปท. เปิดใช้ประกาศ (water_announcement_settings.enabled)
--                    ร่างที่เลย 3 ชม. แต่รอบ tick ยังไม่เปลี่ยนเป็น lapsed จะไม่ค้างเป็น "รอยืนยัน"
-- open_events      : เหตุการณ์น้ำ-ฝนที่ระบบเปิดตามเกณฑ์ที่ล็อกไว้ (open_reason.rule_version) และยังไม่ปิด + เวลาเปิดของเหตุการณ์เก่าสุด
--                    ใช้เกณฑ์ของระบบเอง ไม่แปลความระดับวิกฤตจากค่าดิบ ThaiWater ซ้ำ
CREATE OR REPLACE FUNCTION public.exec_summary_water(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ann jsonb;
  v_evt jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('n', count(*), 'drafted_at', min(a.drafted_at))
    INTO v_ann
  FROM public.water_announcements AS a
  JOIN public.water_events AS e ON e.id = a.event_id AND e.closed_at IS NULL
  JOIN public.water_announcement_settings AS s ON s.municipality_id = a.municipality_id AND s.enabled
  WHERE a.municipality_id = _municipality_id
    AND a.status = 'draft'
    AND a.drafted_at > now() - interval '3 hours';

  SELECT jsonb_build_object('n', count(*), 'oldest_opened_at', min(e.opened_at))
    INTO v_evt
  FROM public.water_events AS e
  WHERE e.municipality_id = _municipality_id AND e.closed_at IS NULL;

  RETURN jsonb_build_object('announce_pending', v_ann, 'open_events', v_evt);
END;
$$;

-- ── สิทธิ์: เรียกผ่าน executive_overview() เท่านั้น (ข้อ 5 NOTES.md) ──────────────────────
REVOKE ALL ON FUNCTION public.exec_summary_fleet(uuid, date, date)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_borrowable_assets(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_projects(uuid, date, date)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_local_plan(uuid, date, date)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_water(uuid, date, date)             FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_summary_fleet(uuid, date, date) IS
  'ห้องผู้บริหาร: ยานพาหนะ — เลยรอบซ่อมบำรุง (ตามวันที่) + เหตุเสียหาย/สูญหายในช่วง · ไม่มีงบน้ำมัน (#501)';
COMMENT ON FUNCTION public.exec_summary_borrowable_assets(uuid, date, date) IS
  'ห้องผู้บริหาร: ใบยืมพัสดุ — รอพิจารณา/รอจ่าย/ยืมอยู่/เกินกำหนดคืน/รอผลชดใช้';
COMMENT ON FUNCTION public.exec_summary_projects(uuid, date, date) IS
  'ห้องผู้บริหาร: โครงการก่อสร้าง — ตามขั้น/ขอเปลี่ยนแปลงรอพิจารณา/ป้ายรายงานรายสัปดาห์ final ล่าสุด/วันสิ้นสุดสัญญา';
COMMENT ON FUNCTION public.exec_summary_local_plan(uuid, date, date) IS
  'ห้องผู้บริหาร: แผนพัฒนา — ฉบับร่างรอประกาศ + แผนดำเนินงานปีงบปัจจุบันประกาศแล้วหรือยัง (% ดำเนินการคิดฝั่งหน้าเว็บ)';
COMMENT ON FUNCTION public.exec_summary_water(uuid, date, date) IS
  'ห้องผู้บริหาร: น้ำ-ฝน — ประกาศรอยืนยัน (เงื่อนไขเดียวกับ water_announcement_todo) + เหตุการณ์ที่ยังเปิด';

-- ด่านท้ายไฟล์: เจ้าของต้องเดียวกับ executive_overview (เหตุผลดูท้ายไฟล์ 2)
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
    RAISE EXCEPTION 'exec_summary_operations: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
