-- 20261120100000_exec_overdue_items_owner.sql
--
-- ห้องผู้บริหาร: รายการ "เรื่องเลยกำหนด" แสดงผู้รับผิดชอบ (เจ้าของระบบสั่ง 2026-11-11)
--   เหตุผล: นายกเห็นแค่เลขที่ + กอง สั่งการไม่ถูกคน — ต้องรู้ว่าเรื่องค้างอยู่ที่ใคร หรือยังไม่มีใครรับ
--
-- เปลี่ยนเฉพาะ exec_overdue_items(uuid) — CREATE OR REPLACE ทั้งฟังก์ชัน (คัดจาก 20261117100100 ทุกบรรทัด)
-- แล้วเพิ่ม 3 คีย์ต่อแถวใน items:
--   assigned  boolean  complaints.assigned_to / document_requests.assigned_to มีค่าหรือไม่
--   owner     text     profiles.full_name ของผู้รับผิดชอบ (NULL = ไม่มีผู้รับผิดชอบ / บัญชีนอก อปท. นี้ / บัญชีถูกลดเป็นประชาชนแล้ว)
--   owner_pos text     positions.name ของผู้รับผิดชอบ (NULL = ไม่ได้ตั้งตำแหน่ง หรือตำแหน่งเป็นของ อปท. อื่น)
-- นิยามเลยกำหนด / ลำดับ / เพดาน 300 / สิทธิ์ / ด่าน exec_assert_viewer เหมือนเดิมทุกอย่าง
--
-- PDPA:
--   - ชื่อที่เพิ่มคือ "เจ้าหน้าที่ผู้ปฏิบัติหน้าที่" ไม่ใช่ผู้ร้อง — เห็นได้เฉพาะผู้ผ่าน exec_assert_viewer
--     (viewer/admin/superadmin/ตำแหน่ง top_admin) เพื่อกำกับงาน
--   - ⚠️ หมวดอ่อนไหว (requires_manual_intake เช่น ร้องเรียนเจ้าหน้าที่) ยังเป็นยอดรวมรายกองเท่านั้น
--     ไม่มีชื่อผู้รับผิดชอบ — ชื่อผู้สอบเรื่อง + กอง พอจะชี้ได้ว่าใครถูกร้อง (sens CTE ไม่แตะ)
--   - ชื่อผู้รับผิดชอบดึงเฉพาะบัญชีที่ municipality_id = อปท. นี้ (กันชื่อข้าม อปท. เช่น superadmin ที่ถูกมอบงานในสนามซ้อม)
--     และ role ไม่ใช่ citizen (เจ้าหน้าที่ลาออก/ถูกลดสิทธิ์ แต่เรื่องยังผูกอยู่ = ไม่มีคนถืองานจริง)
--     สองกรณีนี้ได้ assigned = true แต่ owner = NULL — หน้าเว็บขึ้น "ควรมอบหมายใหม่" ไม่ใช่ "ยังไม่มอบหมาย"
--   - สรุปเช้า Telegram (exec_digest_for ใน 20261118100100) เลือกคีย์ทีละตัว (k/ref/cat/cat_label/dept/due)
--     คีย์ใหม่ไม่ไหลไป Telegram — ถ้าวันหน้าจะส่งชื่อผู้รับผิดชอบไปด้วย ต้องเปิดงานแยกและทบทวน PDPA ก่อน
--
-- ย้อนกลับ: apply ฟังก์ชัน exec_overdue_items จาก 20261117100100_exec_follow_nudge_functions.sql ซ้ำ
--   (เฉพาะบล็อก CREATE OR REPLACE ... ถึง COMMENT ของ exec_overdue_items) — หน้าเว็บรองรับแถวที่ไม่มีคีย์ใหม่อยู่แล้ว
--
-- ด่านก่อน apply (ในไฟล์นี้เอง ล้ม = ย้อนทั้งไฟล์ — ทั้งไฟล์อยู่ใน BEGIN/COMMIT):
--   1) ไฟล์ E2/E3-2 ต้อง apply แล้ว  2) คอลัมน์ครบ และคอลัมน์ที่ JOIN เป็น uuid ทุกตัว
--      (plpgsql ตรวจชนิดตอนเรียกครั้งแรก ไม่ใช่ตอน CREATE — ชนิดเพี้ยนจะ apply ผ่านแล้วไปพังทั้งห้องผู้บริหาร + สรุปเช้า)
--   3) เนื้อฟังก์ชันบนฐานจริงต้องเป็นรุ่นที่รู้จัก (20261117100100 หรือรุ่นของไฟล์นี้เอง = รันซ้ำได้)
--      เทียบ md5 ของ prosrc หลังตัดคอมเมนต์และช่องว่าง — ไม่ตรง = มีคนแก้บนฐานจริงนอกรีโป ห้ามเขียนทับ
--      ค่า md5 ล็อกด้วยเทสต์ tests/exec-follow-nudge-db.test.mjs (แก้เนื้อฟังก์ชันแล้วต้องอัปเดตค่าในไฟล์นี้)
--   ใช้ chr(45)||chr(45) แทนเครื่องหมายคอมเมนต์ในโค้ด (SQL Editor อาจตัดคอมเมนต์โดยไม่ดูว่าอยู่ในสตริง)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว) — คาด: f,t
--   SELECT has_function_privilege('anon',          'public.exec_overdue_items(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_overdue_items(uuid)', 'EXECUTE');

BEGIN;

DO $$
DECLARE
  v_missing text;
  v_md5     text;
BEGIN
  IF to_regprocedure('public.exec_overdue_items(uuid)') IS NULL
     OR to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL
     OR to_regprocedure('public.exec_complaint_dept(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'exec_overdue_items_owner: ต้อง apply 20261115100000/100100 และ 20261117100000/100100 ก่อน';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'assigned_to', 'uuid'), ('document_requests', 'assigned_to', 'uuid'),
    ('profiles', 'id', 'uuid'), ('profiles', 'position_id', 'uuid'), ('profiles', 'municipality_id', 'uuid'),
    ('profiles', 'full_name', NULL), ('profiles', 'role', NULL),
    ('positions', 'id', 'uuid'), ('positions', 'municipality_id', 'uuid'), ('positions', 'name', NULL)
  ) AS need(tbl, col, udt)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
      AND (need.udt IS NULL OR c.udt_name = need.udt)
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_overdue_items_owner: ไม่พบคอลัมน์ หรือชนิดไม่ใช่ uuid: %', v_missing;
  END IF;

  SELECT md5(regexp_replace(regexp_replace(p.prosrc, chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', '', 'g'))
    INTO v_md5
  FROM pg_proc AS p
  WHERE p.oid = 'public.exec_overdue_items(uuid)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '9e7fee9183b7bb51c2fc91fa76757259' AND v_md5 IS DISTINCT FROM '6cf1b92ea93d2c22a8c71f75becbbe7e' THEN
    RAISE EXCEPTION 'exec_overdue_items_owner: เนื้อ exec_overdue_items บนฐานจริงไม่ตรงรุ่นที่รู้จัก (md5 %) — มีการแก้นอกรีโป หยุดก่อนเขียนทับ', v_md5;
  END IF;
END $$;

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
           COALESCE(cat.requires_manual_intake, false) AS sensitive,
           c.assigned_to AS assignee
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
           r.document_type, NULL::text, r.department_id, false,
           r.assigned_to
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
             'assigned', b.assignee IS NOT NULL,
             'owner', NULLIF(btrim(pr.full_name), ''),
             'owner_pos', NULLIF(btrim(pos.name), ''),
             'followed', fl.id IS NOT NULL,
             'nudge', CASE WHEN nd.id IS NULL THEN NULL
                           ELSE jsonb_build_object('at', nd.nudged_at, 'by', nd.nudged_by_position, 'delivery', nd.delivery) END,
             'nudged_today', COALESCE(nd.nudged_on = v_today, false)
           ) ORDER BY b.due, b.c, b.ref), '[]'::jsonb) AS j
    FROM shown AS b
    LEFT JOIN public.departments AS dp ON dp.id = b.dept_id AND dp.municipality_id = _municipality_id
    -- ผู้รับผิดชอบ: เฉพาะบัญชีใน อปท. นี้ที่ยังไม่ใช่ประชาชน (ดูหัวไฟล์ — ไม่ผ่าน = assigned true, owner NULL)
    LEFT JOIN public.profiles AS pr
      ON pr.id = b.assignee AND pr.municipality_id = _municipality_id AND pr.role <> 'citizen'
    LEFT JOIN public.positions AS pos ON pos.id = pr.position_id AND pos.municipality_id = _municipality_id
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
  'ห้องผู้บริหาร E3-2: เรื่องเลยกำหนด (คำร้อง+คำขอ) นิยามเดียวกับ exec_summary_departments — ไม่มีชื่อผู้ร้อง/รายละเอียด · มีชื่อ+ตำแหน่งเจ้าหน้าที่ผู้รับผิดชอบ (20261120100000) · หมวดอ่อนไหวเป็นยอดรวมรายกอง ไม่มีชื่อใคร';

-- ── ด่านท้ายไฟล์ (ล้ม = ย้อนกลับทั้งไฟล์) ──────────────────────────────────────────────
-- 1) เจ้าของต้องเดียวกับ executive_overview (apply คนละ role แล้ว exec_assert_viewer เรียกไม่ได้ → 42501 ทั้งหน้า)
-- 2) สิทธิ์ EXECUTE ต้องตรงแผน (REVOKE ที่ grantor ไม่ตรงผ่านเงียบๆ แต่สิทธิ์ยังอยู่)
DO $$
DECLARE
  v_bad text;
BEGIN
  IF (SELECT p.proowner FROM pg_proc AS p WHERE p.oid = 'public.exec_overdue_items(uuid)'::regprocedure)
     IS DISTINCT FROM
     (SELECT o.proowner FROM pg_proc AS o WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure) THEN
    RAISE EXCEPTION 'exec_overdue_items_owner: เจ้าของ exec_overdue_items ไม่ตรงกับ executive_overview';
  END IF;

  SELECT string_agg(x.fn || ':' || x.rol, ', ')
    INTO v_bad
  FROM (VALUES
    ('public.exec_overdue_items(uuid)', 'anon',          false),
    ('public.exec_overdue_items(uuid)', 'authenticated', true)
  ) AS x(fn, rol, want)
  WHERE has_function_privilege(x.rol, x.fn, 'EXECUTE') IS DISTINCT FROM x.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_overdue_items_owner: สิทธิ์ EXECUTE ไม่ตรงแผน: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
