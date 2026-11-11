-- 20261117100100_exec_follow_nudge_functions.sql
--
-- ห้องผู้บริหาร เฟส E3-2 — ไฟล์ 2/2: ฟังก์ชัน "เรื่องเลยกำหนด" / ติดตาม / เร่งรัด
-- ต้อง apply หลัง 20261117100000_exec_follow_nudge_tables.sql (guard หัวไฟล์ตรวจให้)
--
-- ฟังก์ชันที่ authenticated เรียกได้ (ทุกตัวตรวจสิทธิ์เองบรรทัดแรก):
--   exec_overdue_items(m)        รายการเรื่องเลยกำหนด — ด่าน exec_assert_viewer (ชุดเดียวกับ E2)
--   exec_my_follows(m)           เรื่องที่ฉันติดตาม — ด่าน exec_assert_viewer
--   exec_follow(m, kind, id)     ⭐ ติดตาม — ด่าน exec_assert_viewer
--   exec_unfollow(m, kind, id)   เลิกติดตาม — ด่าน exec_assert_viewer
--   exec_nudge(m, kind, id)      ส่งให้กองเร่งรัด — ด่าน exec_assert_actor (แคบกว่า: ไม่รวม admin)
-- ฟังก์ชันที่ service_role เท่านั้นเรียกได้:
--   exec_nudge_payload(nudge_id) ข้อมูลสำหรับ Edge Function ส่ง Telegram (ผอ.กอง + ข้อมูลเรื่องแบบไม่มีชื่อคน)
-- ภายในเท่านั้น (ไม่ให้ใครเรียกตรง):
--   exec_assert_actor(m), exec_item_snapshot(m, kind, id)
--
-- นิยามที่ต้องตรงกับ E2 (exec_summary_departments ใน 20261115100100) — ตัวเลขบนการ์ด = จำนวนแถวในรายการนี้
--   คำร้องค้าง = new/pending/received/in_progress · คำขอค้าง = pending/processing
--   เลยกำหนด = ค้าง และ due_date < วันนี้ (เวลาไทย) · ไม่รวมหมวดเฉพาะกิจ (is_adhoc)
--   กองของคำร้อง = exec_complaint_dept() · กองของคำขอ = document_requests.department_id
--   วันทำการที่เลยมาไม่คำนวณใน SQL — คืน due_date ให้หน้าเว็บคิดด้วย src/lib/workingDays.js (หลักเดียวกับ E2)
--
-- PDPA / เรื่องอ่อนไหว:
--   - คืนเฉพาะ ประเภท/id/เลขที่/หมวด/กอง/สถานะ/วันกำหนด/วันที่แจ้ง ไม่มีชื่อผู้ร้อง รายละเอียด ที่อยู่ เบอร์ หรือผู้รับผิดชอบ
--   - หมวดอ่อนไหว (complaint_categories.requires_manual_intake เช่น ร้องเรียนเจ้าหน้าที่) = ยอดรวมรายกองเท่านั้น
--     ไม่มีเลขที่ · ติดตาม/เร่งรายเรื่องไม่ได้ (เลขที่ + กอง เข้ากลุ่ม Telegram ก็บอกได้ว่าใครถูกร้อง)
--   - เลขที่คำขอ = 8 ตัวแรกของ id ตัวพิมพ์ใหญ่ (รูปแบบเดียวกับหน้าเจ้าหน้าที่ StaffDashboard.jsx)
--
-- การเร่งรัด (exec_nudge):
--   - วันละครั้งต่อเรื่อง นับรวมทุกคน (UNIQUE item_kind,item_id,nudged_on) · ส่งพลาด (failed) หรือค้าง pending
--     เกิน 10 นาที (หน้าเว็บปิดไปก่อนเรียก Edge Function) กดซ้ำได้ ไม่เกิน 5 ครั้ง/วัน/เรื่อง
--   - เพดานรายคน 30 เรื่อง/วัน กันกดรัวจนกลุ่ม Telegram ท่วม
--   - เร่งได้เฉพาะเรื่องที่เลยกำหนดตามนิยามเดียวกับรายการ (ไม่รวมหมวดเฉพาะกิจ) — เรียก RPC ตรงก็ข้ามไม่ได้
--   - เรื่องที่ "ขึ้นทะเบียนรอดำเนินการ" (parked ส่วนใหญ่รองบประมาณ) ติดตามได้ แต่เร่งไม่ได้ — กองเร่งเองไม่ได้
--   - กดซ้ำหลังส่งพลาด: คงผู้เร่งคนแรก (nudged_by) จดคนกดซ้ำที่ last_retry_by
--   - superadmin เร่งได้เฉพาะสนามซ้อม slug 'demo' ป้าย "ผู้ดูแลระบบ (ทดสอบ)" เสมอ (กันแอบอ้างใน อปท. จริง)
--   - ท้ายไฟล์มีด่านเจ้าของฟังก์ชัน + สิทธิ์ EXECUTE ไม่ตรงแผน = ย้อนกลับทั้งไฟล์
--   - ไม่แตะ complaints/document_requests/complaint_timeline เลย (ไม่สร้างสถานะ ไม่ลง timeline)
--   - ฟังก์ชันนี้แค่ "จดคำสั่งเร่ง" ส่วนการส่งเป็นงานของ Edge Function (service_role) ซึ่งเขียนผล delivery กลับ
--
-- ย้อนกลับ:
--   DROP FUNCTION public.exec_nudge_payload(uuid), public.exec_nudge(uuid,text,uuid),
--     public.exec_unfollow(uuid,text,uuid), public.exec_follow(uuid,text,uuid), public.exec_my_follows(uuid),
--     public.exec_overdue_items(uuid), public.exec_item_snapshot(uuid,text,uuid), public.exec_assert_actor(uuid);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว) — คาด: f,t,t,t,t,t,f,f,f,t
--   SELECT has_function_privilege('anon',          'public.exec_overdue_items(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_overdue_items(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_my_follows(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_follow(uuid,text,uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_unfollow(uuid,text,uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_nudge(uuid,text,uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_nudge_payload(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_item_snapshot(uuid,text,uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_assert_actor(uuid)', 'EXECUTE'),
--          has_function_privilege('service_role',  'public.exec_nudge_payload(uuid)', 'EXECUTE');

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.exec_follows') IS NULL OR to_regclass('public.exec_nudges') IS NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_functions: ต้อง apply 20261117100000_exec_follow_nudge_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL
     OR to_regprocedure('public.exec_complaint_dept(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_functions: ต้อง apply ไฟล์เฟส E2 (20261115100000/100100) ก่อน';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'ref_no'), ('complaints', 'status'), ('complaints', 'due_date'), ('complaints', 'category'),
    ('complaints', 'department_id'), ('complaints', 'department'), ('complaints', 'created_at'),
    ('complaint_categories', 'label'), ('complaint_categories', 'is_adhoc'),
    ('complaint_categories', 'requires_manual_intake'),
    ('document_requests', 'status'), ('document_requests', 'due_date'), ('document_requests', 'document_type'),
    ('document_requests', 'department_id'), ('document_requests', 'created_at'),
    ('departments', 'name'), ('departments', 'short_name'),
    ('positions', 'name'), ('positions', 'category'), ('municipalities', 'slug'),
    ('exec_nudges', 'last_retry_by'), ('exec_nudges', 'last_retry_at'),
    ('profiles', 'role'), ('profiles', 'position_id'), ('profiles', 'municipality_id')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_functions: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ด่านสิทธิ์ "ผู้สั่งเร่ง" — แคบกว่า exec_assert_viewer
-- ══════════════════════════════════════════════════════════════════════════════════
-- viewer (นายก/รองนายก/ที่ปรึกษา/เลขาฯ) · ตำแหน่ง top_admin (ปลัด/รองปลัด)
-- superadmin (เจ้าของระบบ) ผ่านเฉพาะ อปท. slug 'demo' (สนามซ้อม) และขึ้นป้าย "ผู้ดูแลระบบ (ทดสอบ)" เสมอ
--   ไม่งั้น ผอ.กองของ อปท. จริงได้ข้อความ "<ตำแหน่งของบัญชีเจ้าของระบบ> ขอให้เร่งรัด" = แอบอ้างอำนาจผู้บังคับบัญชา
-- ไม่รวม admin: ผู้ดูแลระบบไอทีไม่ใช่ผู้บังคับบัญชา ข้อความ "ผู้บริหารขอให้เร่งรัด" ที่มาจาก admin = แอบอ้าง
-- คืน "ตำแหน่ง" ของผู้เร่งเป็นข้อความ (ใช้ในข้อความ Telegram และ snapshot ลงประวัติ)
CREATE OR REPLACE FUNCTION public.exec_assert_actor(_municipality_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_muni uuid;
  v_cat  text;
  v_pos  text;
  v_slug text;
  v_ok   boolean;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  SELECT p.role, p.municipality_id, pos.category, NULLIF(btrim(pos.name), '')
    INTO v_role, v_muni, v_cat, v_pos
  FROM public.profiles AS p
  LEFT JOIN public.positions AS pos ON pos.id = p.position_id
  WHERE p.id = v_uid;

  SELECT m.slug INTO v_slug FROM public.municipalities AS m WHERE m.id = _municipality_id;

  -- ปิดตายเมื่อไม่แน่ใจ (IS NOT TRUE) — บทเรียนเดียวกับ exec_assert_viewer
  v_ok := v_uid IS NOT NULL
          AND v_role IS NOT NULL
          AND (
            (v_role = 'viewer' AND v_muni IS NOT DISTINCT FROM _municipality_id)
            OR (v_role = 'superadmin' AND v_slug IS NOT DISTINCT FROM 'demo')
            OR (v_cat IS NOT DISTINCT FROM 'top_admin'
                AND v_role IN ('officer', 'staff', 'council', 'technician', 'admin')
                AND v_muni IS NOT DISTINCT FROM _municipality_id)
          );
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ส่งให้กองเร่งรัดได้เฉพาะคณะผู้บริหารและปลัด' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'superadmin' THEN
    RETURN 'ผู้ดูแลระบบ (ทดสอบ)';
  END IF;
  RETURN left(COALESCE(v_pos, 'ผู้บริหาร'), 120);
END;
$$;

REVOKE ALL ON FUNCTION public.exec_assert_actor(uuid) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ภาพเรื่องเดียว (ใช้ภายใน) — ไม่มีชื่อคน/รายละเอียด
-- ══════════════════════════════════════════════════════════════════════════════════
-- ไม่พบ หรือคนละ อปท. = ไม่มีแถว (ผู้เรียกตัดสินเอง ไม่บอกว่าเรื่องมีอยู่ใน อปท. อื่น)
--   is_open   = ค้าง (คำร้อง new/pending/received/in_progress/parked · คำขอ pending/processing)
--   is_parked = ขึ้นทะเบียนรอดำเนินการ (คำร้องเท่านั้น)
--   is_adhoc  = หมวดเฉพาะกิจ (ไม่อยู่ในนิยาม "เลยกำหนด" ของ E2 — ค้าง pending ตลอดโดยออกแบบ)
--   ⚠️ สถานะ NULL ⇒ is_open/is_parked เป็น NULL — ผู้เรียกต้องเช็กด้วย IS TRUE / IS NOT TRUE เสมอ
CREATE OR REPLACE FUNCTION public.exec_item_snapshot(_municipality_id uuid, _kind text, _id uuid)
RETURNS TABLE (
  item_ref      text,
  status        text,
  is_open       boolean,
  is_parked     boolean,
  is_sensitive  boolean,
  is_adhoc      boolean,
  due_date      date,
  created_date  date,
  cat           text,
  cat_label     text,
  department_id uuid
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(NULLIF(btrim(c.ref_no), ''), upper(left(c.id::text, 8))),
         c.status,
         c.status IN ('new', 'pending', 'received', 'in_progress', 'parked'),
         c.status = 'parked',
         COALESCE(cat.requires_manual_intake, false),
         COALESCE(cat.is_adhoc, false),
         c.due_date::date,
         (c.created_at AT TIME ZONE 'Asia/Bangkok')::date,
         c.category,
         cat.label,
         public.exec_complaint_dept(c.municipality_id, c.department_id, c.department)
  FROM public.complaints AS c
  LEFT JOIN public.complaint_categories AS cat
    ON cat.municipality_id = c.municipality_id AND cat.value = c.category
  WHERE _kind = 'complaint' AND c.id = _id AND c.municipality_id = _municipality_id
  UNION ALL
  SELECT upper(left(r.id::text, 8)),
         r.status,
         r.status IN ('pending', 'processing'),
         false,
         false,
         false,
         r.due_date::date,
         (r.created_at AT TIME ZONE 'Asia/Bangkok')::date,
         r.document_type,
         NULL::text,                    -- ชื่อประเภทคำขอ หน้าเว็บแปลงจาก documentTypes.js (รวมประเภทที่ อปท. เพิ่มเอง)
         r.department_id
  FROM public.document_requests AS r
  WHERE _kind = 'document_request' AND r.id = _id AND r.municipality_id = _municipality_id
$$;

REVOKE ALL ON FUNCTION public.exec_item_snapshot(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- รายการเรื่องเลยกำหนด
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน {
--   as_of, total (ไม่รวมหมวดอ่อนไหว), truncated, limit,
--   items: [{k, id, ref, s, due, c, cat, cat_label, dept_id, dept, followed, nudge:{at, by, delivery}|null, nudged_today}]
--          เรียง due_date เก่าสุดก่อน สูงสุด 300 แถว
--   sensitive: [{dept_id, dept, n}]  หมวดอ่อนไหวที่เลยกำหนด ยอดรวมรายกองเท่านั้น
-- }
-- nudge = การเร่งครั้งล่าสุดของเรื่องนั้น (by = ตำแหน่ง ไม่ใช่ชื่อ) · followed = ฉันติดตามอยู่
CREATE OR REPLACE FUNCTION public.exec_overdue_items(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_today  date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_limit  int  := 300;
  v_out    jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  -- คำสั่งเดียวด้วย CTE (ฟังก์ชัน STABLE เขียนตารางชั่วคราวไม่ได้)
  WITH base AS (
    SELECT 'complaint'::text AS k, c.id,
           COALESCE(NULLIF(btrim(c.ref_no), ''), upper(left(c.id::text, 8))) AS ref,
           c.status AS s, c.due_date AS due,
           (c.created_at AT TIME ZONE 'Asia/Bangkok')::date AS c,
           c.category AS cat, cat.label AS cat_label,
           public.exec_complaint_dept(c.municipality_id, c.department_id, c.department) AS dept_id,
           COALESCE(cat.requires_manual_intake, false) AS sensitive
    FROM public.complaints AS c
    LEFT JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    WHERE c.municipality_id = _municipality_id
      AND NOT COALESCE(cat.is_adhoc, false)
      AND c.status IN ('new', 'pending', 'received', 'in_progress')
      AND c.due_date < v_today
    UNION ALL
    SELECT 'document_request'::text, r.id, upper(left(r.id::text, 8)),
           r.status, r.due_date,
           (r.created_at AT TIME ZONE 'Asia/Bangkok')::date,
           r.document_type, NULL::text, r.department_id, false
    FROM public.document_requests AS r
    WHERE r.municipality_id = _municipality_id
      AND r.status IN ('pending', 'processing')
      AND r.due_date < v_today
  ), shown AS (
    SELECT b.*
    FROM base AS b
    WHERE NOT b.sensitive
    ORDER BY b.due, b.c, b.ref
    LIMIT v_limit
  ), items AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'k', b.k, 'id', b.id, 'ref', b.ref, 's', b.s, 'due', b.due, 'c', b.c,
             'cat', b.cat, 'cat_label', b.cat_label,
             'dept_id', b.dept_id, 'dept', COALESCE(NULLIF(btrim(dp.short_name), ''), dp.name),
             'followed', fl.id IS NOT NULL,
             'nudge', CASE WHEN nd.id IS NULL THEN NULL
                           ELSE jsonb_build_object('at', nd.nudged_at, 'by', nd.nudged_by_position, 'delivery', nd.delivery) END,
             'nudged_today', COALESCE(nd.nudged_on = v_today, false)
           ) ORDER BY b.due, b.c, b.ref), '[]'::jsonb) AS j
    FROM shown AS b
    LEFT JOIN public.departments AS dp ON dp.id = b.dept_id AND dp.municipality_id = _municipality_id
    LEFT JOIN public.exec_follows AS fl
      ON fl.user_id = v_uid AND fl.item_kind = b.k AND fl.item_id = b.id AND fl.ended_at IS NULL
    LEFT JOIN LATERAL (
      SELECT n.id, n.nudged_at, n.nudged_on, n.nudged_by_position, n.delivery
      FROM public.exec_nudges AS n
      WHERE n.municipality_id = _municipality_id AND n.item_kind = b.k AND n.item_id = b.id
      ORDER BY n.nudged_at DESC
      LIMIT 1
    ) AS nd ON true
  ), sens AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'dept_id', s.dept_id, 'dept', COALESCE(NULLIF(btrim(dp.short_name), ''), dp.name), 'n', s.n
           ) ORDER BY (s.dept_id IS NULL), dp.sort_order NULLS LAST, dp.name), '[]'::jsonb) AS j
    FROM (
      SELECT b.dept_id, count(*)::int AS n
      FROM base AS b
      WHERE b.sensitive
      GROUP BY b.dept_id
    ) AS s
    LEFT JOIN public.departments AS dp ON dp.id = s.dept_id AND dp.municipality_id = _municipality_id
  ), tot AS (
    SELECT count(*)::int AS n FROM base AS b WHERE NOT b.sensitive
  )
  SELECT jsonb_build_object(
           'as_of', v_today,
           'total', tot.n,
           'limit', v_limit,
           'truncated', tot.n > v_limit,
           'items', items.j,
           'sensitive', sens.j)
    INTO v_out
  FROM tot, items, sens;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_overdue_items(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_overdue_items(uuid) TO authenticated;

COMMENT ON FUNCTION public.exec_overdue_items(uuid) IS
  'ห้องผู้บริหาร E3-2: เรื่องเลยกำหนด (คำร้อง+คำขอ) นิยามเดียวกับ exec_summary_departments — ไม่มีชื่อคน/รายละเอียด หมวดอ่อนไหวเป็นยอดรวมรายกอง';

-- ══════════════════════════════════════════════════════════════════════════════════
-- ติดตามเรื่อง
-- ══════════════════════════════════════════════════════════════════════════════════
-- เพดาน 50 เรื่องที่ติดตามพร้อมกันต่อคน (สรุปเช้าต้องอ่านจบในจอเดียว)
CREATE OR REPLACE FUNCTION public.exec_follow(_municipality_id uuid, _kind text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_item   record;
  v_active int;
  v_id     uuid;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _kind IS NULL OR _kind NOT IN ('complaint', 'document_request') OR _id IS NULL THEN
    RAISE EXCEPTION 'ประเภทเรื่องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.exec_item_snapshot(_municipality_id, _kind, _id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบเรื่องนี้' USING ERRCODE = 'P0002';
  END IF;
  -- ปิดตายเมื่อค่าเป็น NULL (IS NOT FALSE / IS NOT TRUE) — บทเรียนเดียวกับ exec_assert_viewer
  IF v_item.is_sensitive IS NOT FALSE THEN
    RAISE EXCEPTION 'เรื่องหมวดนี้ติดตามรายเรื่องไม่ได้ (คุ้มครองผู้ร้อง)' USING ERRCODE = '22023';
  END IF;
  IF v_item.is_open IS NOT TRUE THEN
    RAISE EXCEPTION 'เรื่องนี้เสร็จหรือปิดแล้ว ไม่ต้องติดตาม' USING ERRCODE = '22023';
  END IF;

  SELECT f.id INTO v_id
  FROM public.exec_follows AS f
  WHERE f.user_id = v_uid AND f.item_kind = _kind AND f.item_id = _id AND f.ended_at IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'follow_id', v_id, 'already', true);
  END IF;

  SELECT count(*)::int INTO v_active
  FROM public.exec_follows AS f
  WHERE f.user_id = v_uid AND f.ended_at IS NULL;
  IF v_active >= 50 THEN
    RAISE EXCEPTION 'ติดตามได้พร้อมกันไม่เกิน 50 เรื่อง — เลิกติดตามเรื่องเก่าก่อน' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.exec_follows (municipality_id, user_id, item_kind, item_id, item_ref, last_seen_status, last_seen_at)
  VALUES (_municipality_id, v_uid, _kind, _id, v_item.item_ref, v_item.status, now())
  ON CONFLICT (user_id, item_kind, item_id) WHERE ended_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN  -- กดพร้อมกันสองแท็บ
    SELECT f.id INTO v_id FROM public.exec_follows AS f
    WHERE f.user_id = v_uid AND f.item_kind = _kind AND f.item_id = _id AND f.ended_at IS NULL;
    RETURN jsonb_build_object('ok', true, 'follow_id', v_id, 'already', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'follow_id', v_id, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.exec_follow(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_follow(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.exec_unfollow(_municipality_id uuid, _kind text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n int;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _kind IS NULL OR _kind NOT IN ('complaint', 'document_request') OR _id IS NULL THEN
    RAISE EXCEPTION 'ประเภทเรื่องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  UPDATE public.exec_follows AS f
     SET ended_at = now(), ended_reason = 'unfollowed'
   WHERE f.user_id = auth.uid()
     AND f.municipality_id = _municipality_id
     AND f.item_kind = _kind AND f.item_id = _id
     AND f.ended_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'ended', v_n > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.exec_unfollow(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_unfollow(uuid, text, uuid) TO authenticated;

-- เรื่องที่ฉันติดตามอยู่ — [{k, id, ref, s, open, parked, due, c, cat, cat_label, dept_id, dept, since, changed}]
--   changed = สถานะเปลี่ยนไปจากที่แจ้งล่าสุด (last_seen_status) · เรื่องที่หายไปแล้ว = gone:true
--   เรื่องที่ถูกย้ายเข้าหมวดอ่อนไหวหลังกดติดตาม = hidden:true ไม่มีเลขที่ (id ไว้กดเลิกติดตามเท่านั้น)
--   ใช้ป้ายเดียวกับ "เรื่องหายไป" ไม่ได้ เพราะยังต้องเลิกติดตามได้ แต่ไม่บอกเลขที่ซ้ำให้จับคู่กับหมวดอ่อนไหว
--   การปิดแถวเมื่อเรื่องเสร็จ (ended_reason='done') เป็นงานของสรุปเช้า E3-3 หลังแจ้งผู้ติดตามแล้ว
CREATE OR REPLACE FUNCTION public.exec_my_follows(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  SELECT COALESCE(jsonb_agg(
           CASE
             WHEN s.item_ref IS NULL THEN
               jsonb_build_object('k', f.item_kind, 'id', f.item_id, 'ref', f.item_ref, 'since', f.created_at, 'gone', true)
             WHEN s.is_sensitive IS NOT FALSE THEN
               jsonb_build_object('k', f.item_kind, 'id', f.item_id, 'since', f.created_at, 'hidden', true)
             ELSE jsonb_build_object(
               'k', f.item_kind, 'id', f.item_id, 'ref', s.item_ref, 's', s.status,
               'open', s.is_open, 'parked', s.is_parked, 'due', s.due_date, 'c', s.created_date,
               'cat', s.cat, 'cat_label', s.cat_label,
               'dept_id', s.department_id, 'dept', COALESCE(NULLIF(btrim(dp.short_name), ''), dp.name),
               'since', f.created_at,
               'changed', s.status IS DISTINCT FROM f.last_seen_status)
           END
           ORDER BY f.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM public.exec_follows AS f
  LEFT JOIN LATERAL public.exec_item_snapshot(_municipality_id, f.item_kind, f.item_id) AS s ON true
  LEFT JOIN public.departments AS dp ON dp.id = s.department_id AND dp.municipality_id = _municipality_id
  WHERE f.user_id = auth.uid()
    AND f.municipality_id = _municipality_id
    AND f.ended_at IS NULL;

  RETURN jsonb_build_object('follows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.exec_my_follows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_my_follows(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ส่งให้กองเร่งรัด (จดคำสั่ง — Edge Function เป็นคนส่ง)
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน {ok:true, nudge_id, retry} → หน้าเว็บเรียก Edge Function ต่อด้วย nudge_id แล้วแสดงผลการส่งบนจอ
--    {ok:false, reason:'already_today', nudge:{at, by, delivery}} → วันนี้มีคนเร่งเรื่องนี้แล้ว
CREATE OR REPLACE FUNCTION public.exec_nudge(_municipality_id uuid, _kind text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_today    date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_position text;
  v_item     record;
  v_mine     int;
  v_nid      uuid;
  v_attempt  int;
  v_prev     record;
BEGIN
  v_position := public.exec_assert_actor(_municipality_id);
  IF _kind IS NULL OR _kind NOT IN ('complaint', 'document_request') OR _id IS NULL THEN
    RAISE EXCEPTION 'ประเภทเรื่องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.exec_item_snapshot(_municipality_id, _kind, _id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบเรื่องนี้' USING ERRCODE = 'P0002';
  END IF;
  -- ปิดตายเมื่อค่าเป็น NULL — ทุกเช็กใช้ IS NOT FALSE / IS NOT TRUE / IS TRUE
  IF v_item.is_sensitive IS NOT FALSE THEN
    RAISE EXCEPTION 'เรื่องหมวดนี้เร่งรายเรื่องผ่านระบบไม่ได้ (คุ้มครองผู้ร้อง)' USING ERRCODE = '22023';
  END IF;
  IF v_item.is_open IS NOT TRUE THEN
    RAISE EXCEPTION 'เรื่องนี้เสร็จหรือปิดแล้ว' USING ERRCODE = '22023';
  END IF;
  IF v_item.is_parked IS NOT FALSE THEN
    RAISE EXCEPTION 'เรื่องนี้ขึ้นทะเบียนรอดำเนินการ (ส่วนใหญ่รองบประมาณ) — กดติดตามแทนได้' USING ERRCODE = '22023';
  END IF;
  -- เร่งได้เฉพาะเรื่องที่ "เลยกำหนด" ตามนิยามเดียวกับรายการ (เรียก RPC ตรงก็ข้ามไม่ได้)
  -- หมวดเฉพาะกิจค้าง pending ตลอดโดยออกแบบ ไม่ใช่งานค้างจริง ⇒ ไม่เพิ่มงานกอง
  IF v_item.is_adhoc IS NOT FALSE OR v_item.due_date IS NULL OR v_item.due_date >= v_today THEN
    RAISE EXCEPTION 'เร่งรัดได้เฉพาะเรื่องที่เลยกำหนดแล้ว — เรื่องนี้กดติดตามแทนได้' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::int INTO v_mine
  FROM public.exec_nudges AS n
  WHERE n.nudged_by = v_uid AND n.nudged_on = v_today;
  IF v_mine >= 30 THEN
    RAISE EXCEPTION 'วันนี้ส่งเร่งรัดครบ 30 เรื่องแล้ว' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.exec_nudges AS n (
    municipality_id, item_kind, item_id, item_ref, department_id, nudged_by, nudged_by_position, nudged_on
  )
  VALUES (_municipality_id, _kind, _id, v_item.item_ref, v_item.department_id, v_uid, v_position, v_today)
  ON CONFLICT ON CONSTRAINT exec_nudges_once_per_day DO UPDATE
     SET delivery           = 'pending',
         delivered_count    = 0,
         delivery_note      = NULL,
         delivered_at       = NULL,
         department_id      = EXCLUDED.department_id,
         -- คง nudged_by / nudged_by_position / nudged_at ของผู้เร่งคนแรกไว้ (ประวัติ "ใครเร่ง" ต้องไม่หาย)
         last_retry_by      = EXCLUDED.nudged_by,
         last_retry_at      = now(),
         attempt_count      = n.attempt_count + 1
   WHERE n.municipality_id = EXCLUDED.municipality_id
     AND n.attempt_count < 5
     AND (n.delivery = 'failed'
          -- ค้าง pending/sending เกิน 10 นาที = หน้าเว็บปิดก่อนเรียก Edge Function หรือ Edge Function ตายกลางทาง
          OR (n.delivery IN ('pending', 'sending')
              AND COALESCE(n.last_retry_at, n.nudged_at) < now() - interval '10 minutes'))
  RETURNING n.id, n.attempt_count INTO v_nid, v_attempt;

  -- ⚠️ ไม่ใช้ตัวแปร record รับ RETURNING — ไม่มีแถวคืน (เงื่อนไข DO UPDATE ไม่ผ่าน) แล้วอ่าน .id จะ error
  IF v_nid IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'nudge_id', v_nid, 'retry', v_attempt > 1);
  END IF;

  SELECT n.nudged_at, n.nudged_by_position, n.delivery INTO v_prev
  FROM public.exec_nudges AS n
  WHERE n.item_kind = _kind AND n.item_id = _id AND n.nudged_on = v_today;

  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'already_today',
    'nudge', jsonb_build_object('at', v_prev.nudged_at, 'by', v_prev.nudged_by_position, 'delivery', v_prev.delivery)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exec_nudge(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_nudge(uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.exec_nudge(uuid, text, uuid) IS
  'ห้องผู้บริหาร E3-2: จดคำสั่งเร่งรัด วันละครั้งต่อเรื่อง (ส่งพลาดกดซ้ำได้ ≤5/วัน) — ไม่แตะตัวเรื่อง ไม่ลง timeline · ส่งจริงโดย Edge Function';

-- ══════════════════════════════════════════════════════════════════════════════════
-- ข้อมูลสำหรับ Edge Function (service_role เท่านั้น)
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน null ถ้าไม่พบแถวเร่ง · heads = ผอ.กองของกองที่ถือเรื่อง (is_dept_head, อปท. เดียวกัน, role เจ้าหน้าที่)
--   ตัดผู้สั่งเร่งออกจาก heads (ปลัดที่ตั้ง is_dept_head ไว้จะได้ไม่ได้ DM ถึงตัวเอง)
-- sendable = false (และ item = null) เมื่อเรื่องอ่อนไหว/ปิดแล้ว/parked/หายไป — ด่านชั้นที่สอง
--   Edge Function มีบั๊กก็ไม่มีข้อมูลเรื่องอ่อนไหวให้หลุดเข้ากลุ่ม Telegram
-- requested_by = ผู้กดครั้งล่าสุด (last_retry_by ถ้ามี ไม่งั้น nudged_by) — Edge Function ต้องจองแถวด้วย
--   UPDATE exec_nudges SET delivery='sending' WHERE id=$1 AND delivery='pending'
--     AND COALESCE(last_retry_by, nudged_by) = <ผู้เรียก> RETURNING id   (0 แถว = หยุด ไม่ส่ง)
-- ไม่มีชื่อผู้ร้อง/รายละเอียด/ผู้รับผิดชอบ — ข้อความ Telegram ประกอบจากฟิลด์ชุดนี้เท่านั้น
CREATE OR REPLACE FUNCTION public.exec_nudge_payload(_nudge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n     public.exec_nudges%ROWTYPE;
  v_item  record;
  v_dept  record;
  v_heads jsonb;
  v_send  boolean;
BEGIN
  SELECT * INTO v_n FROM public.exec_nudges WHERE id = _nudge_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_item FROM public.exec_item_snapshot(v_n.municipality_id, v_n.item_kind, v_n.item_id);
  v_send := v_item.item_ref IS NOT NULL
            AND v_item.is_sensitive IS FALSE
            AND v_item.is_open IS TRUE
            AND v_item.is_parked IS FALSE;

  SELECT dp.id, dp.name, dp.short_name INTO v_dept
  FROM public.departments AS dp
  WHERE dp.id = COALESCE(v_item.department_id, v_n.department_id) AND dp.municipality_id = v_n.municipality_id;

  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id), '[]'::jsonb) INTO v_heads
  FROM public.profiles AS p
  WHERE v_dept.id IS NOT NULL
    AND p.department_id = v_dept.id
    AND p.municipality_id = v_n.municipality_id
    AND p.is_dept_head IS TRUE
    AND p.role IN ('officer', 'staff', 'admin', 'technician')
    AND p.id IS DISTINCT FROM v_n.nudged_by
    AND p.id IS DISTINCT FROM v_n.last_retry_by;

  RETURN jsonb_build_object(
    'sendable', v_send IS TRUE,
    'nudge', jsonb_build_object(
      'id', v_n.id, 'municipality_id', v_n.municipality_id, 'item_kind', v_n.item_kind, 'item_id', v_n.item_id,
      'item_ref', CASE WHEN v_send IS TRUE THEN v_n.item_ref END,
      'delivery', v_n.delivery, 'nudged_by', v_n.nudged_by,
      'requested_by', COALESCE(v_n.last_retry_by, v_n.nudged_by),
      'nudged_by_position', v_n.nudged_by_position, 'nudged_at', v_n.nudged_at, 'attempt_count', v_n.attempt_count),
    'item', CASE WHEN v_send IS NOT TRUE THEN NULL ELSE jsonb_build_object(
      'ref', v_item.item_ref, 'status', v_item.status, 'due', v_item.due_date, 'created', v_item.created_date,
      'cat', v_item.cat, 'cat_label', v_item.cat_label) END,
    'department', CASE WHEN v_send IS NOT TRUE OR v_dept.id IS NULL THEN NULL
                       ELSE jsonb_build_object('id', v_dept.id, 'name', v_dept.name, 'short_name', v_dept.short_name) END,
    'heads', CASE WHEN v_send IS TRUE THEN v_heads ELSE '[]'::jsonb END,
    -- ผู้สั่งเร่งเป็น ผอ.กองของกองนั้นเอง (เช่น ปลัดเป็นหัวหน้าสำนักปลัด) — heads อาจว่างเพราะตัดผู้สั่งออก
    -- Edge Function ต้องลงผล 'none' ไม่ใช่ตกไปส่งเข้ากลุ่ม อปท. (ไม่ใช่กรณี "ผอ.กองไม่ได้ผูก Telegram")
    'requester_is_head', EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE v_dept.id IS NOT NULL
        AND p.id = COALESCE(v_n.last_retry_by, v_n.nudged_by)
        AND p.department_id = v_dept.id
        AND p.is_dept_head IS TRUE)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exec_nudge_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_nudge_payload(uuid) TO service_role;

-- ── ด่านท้ายไฟล์ (ล้ม = ย้อนกลับทั้งไฟล์) ──────────────────────────────────────────────
-- 1) เจ้าของต้องเดียวกับ executive_overview — ฟังก์ชัน DEFINER รันในนามเจ้าของ ถ้า apply คนละ role (CLI กับ MCP)
--    จะเรียก exec_assert_viewer / exec_complaint_dept / exec_item_snapshot ไม่ได้ (ถอน PUBLIC แล้ว) ทุก RPC ได้ 42501
-- 2) สิทธิ์ EXECUTE ต้องตรงตามแผน — REVOKE ที่ grantor ไม่ตรงผ่านเงียบๆ แต่สิทธิ์ยังอยู่ (แบบเดียวกับ 20261114100000)
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
    RAISE EXCEPTION 'exec_follow_nudge_functions: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;

  SELECT string_agg(x.fn || ':' || x.rol, ', ')
    INTO v_bad
  FROM (VALUES
    ('public.exec_overdue_items(uuid)',           'anon',          false),
    ('public.exec_overdue_items(uuid)',           'authenticated', true),
    ('public.exec_my_follows(uuid)',              'anon',          false),
    ('public.exec_my_follows(uuid)',              'authenticated', true),
    ('public.exec_follow(uuid,text,uuid)',        'anon',          false),
    ('public.exec_follow(uuid,text,uuid)',        'authenticated', true),
    ('public.exec_unfollow(uuid,text,uuid)',      'anon',          false),
    ('public.exec_unfollow(uuid,text,uuid)',      'authenticated', true),
    ('public.exec_nudge(uuid,text,uuid)',         'anon',          false),
    ('public.exec_nudge(uuid,text,uuid)',         'authenticated', true),
    ('public.exec_nudge_payload(uuid)',           'anon',          false),
    ('public.exec_nudge_payload(uuid)',           'authenticated', false),
    ('public.exec_nudge_payload(uuid)',           'service_role',  true),
    ('public.exec_item_snapshot(uuid,text,uuid)', 'anon',          false),
    ('public.exec_item_snapshot(uuid,text,uuid)', 'authenticated', false),
    ('public.exec_assert_actor(uuid)',            'anon',          false),
    ('public.exec_assert_actor(uuid)',            'authenticated', false)
  ) AS x(fn, rol, want)
  WHERE has_function_privilege(x.rol, x.fn, 'EXECUTE') IS DISTINCT FROM x.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_functions: สิทธิ์ EXECUTE ไม่ตรงแผน: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
