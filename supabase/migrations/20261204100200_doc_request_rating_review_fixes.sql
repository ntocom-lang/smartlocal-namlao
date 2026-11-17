-- 20261204100200_doc_request_rating_review_fixes.sql
--
-- [แก้ตามผลตรวจ migration-reviewer 2569-11-17] ต่อจาก 20261204100000 + 20261204100100 (รันบนฐานจริงแล้ว 2569-11-17)
-- ไฟล์ 2 ถูกรันก่อนผลตรวจกลับมา จึงแก้ด้วยไฟล์ต่อท้ายนี้ (ไฟล์ที่รันแล้วห้ามแก้ย้อน)
--
-- M1 document_request_withdrawn: นับเป็น "ผู้ยื่นถอนเอง" เฉพาะเมื่อผู้กดยกเลิกคือผู้ยื่นจริง
--    เดิมนับทุกใบที่สถานะลูกเป็น cancelled — แต่ cancel_patient_transport_request / cancel_asset_borrow_request
--    ให้เจ้าหน้าที่กดยกเลิกได้ด้วย ⇒ เจ้าหน้าที่กด "ยกเลิก" แทน "ไม่อนุมัติ" แล้วใบนั้นหลุดจากการประเมินและตัวหารในห้องผู้บริหาร
--    ขัดกติกาที่เจ้าของระบบเลือก (2569-11-17: "ใบที่ผู้ยื่นยกเลิกเองไม่ชวน") ⇒ ใบที่เจ้าหน้าที่ยกเลิก = ปฏิบัติแบบใบไม่อนุมัติ (ชวน + รายงานแยก)
--      รถรับ-ส่งผู้ป่วย: patient_transport_events (event 'cancelled') detail.by_owner = true — บันทึกตอนกด ไม่เปลี่ยนภายหลัง
--      ยืมพัสดุ:        asset_borrow_events.actor_id (event 'cancelled') = document_requests.user_id (ไม่มีธงแบบเดียวกันให้ใช้)
--    ⚠️ ยืมพัสดุ: ผู้ยื่นลบบัญชี (user_id + actor_id → NULL) = ไม่มีผู้ยื่นให้ประเมินอยู่แล้ว (no_requester)
--       แต่ผู้ยื่นถูก "รวมบัญชีซ้ำ" (merge_duplicate_profile ย้าย user_id ไปบัญชีหลัก ไม่ย้าย actor_id → NULL) = ใบที่ถอนเอง
--       กลายเป็น "เจ้าหน้าที่ยกเลิก" (ชวนประเมิน + กลุ่มไม่อนุมัติ) · ห้ามแก้ด้วย actor_id IS NULL = ถอนเอง (เจ้าหน้าที่ที่ลบบัญชีก็ NULL)
--       ทางแก้ถาวร = ให้ cancel_asset_borrow_request บันทึก by_owner แบบรถผู้ป่วย (งานแยก ยังไม่จำเป็น — ณ 2569-11-17 ยืมพัสดุไม่มีใบยกเลิก)
--    ⚠️ ข้อจำกัดที่เจ้าของรับทราบ (R1): รถรับ-ส่งผู้ป่วยหลังส่งต่อแล้ว ผู้ยื่นกดยกเลิกเองไม่ได้ ต้องให้เจ้าหน้าที่กดแทน
--       ใบนั้นจึงนับเป็น "เจ้าหน้าที่ยกเลิก" (ชวนประเมิน + อยู่กลุ่มไม่อนุมัติ) แยกจากข้อมูลไม่ได้ · ณ 2569-11-17 มี 0 ใบ (ยกเลิกทั้งหมด 3 ใบ ผู้ยื่นกดเองก่อนส่งต่อ)
--       ใบเคาน์เตอร์ (user_id = บัญชีเจ้าหน้าที่ผู้กรอก): ผู้กรอกกดยกเลิกเอง = นับ "ถอนเอง" · คนอื่นกด = นับ "ไม่อนุมัติ"
--       ไม่กระทบการชวน (ใบเคาน์เตอร์ไม่ชวนอยู่แล้ว) กระทบแค่ยอด finished/rejected/submitters.counter ในห้องผู้บริหาร
-- L2b ส่วน E-Service ล้ม → RAISE WARNING พร้อม SQLSTATE (ไม่ใส่ SQLERRM — กันข้อความ error พาข้อมูลออก log) แบบ executive_overview
-- L2 exec_summary_satisfaction: ส่วน E-Service ล้มด้วย error อื่นที่ไม่ใช่สิทธิ์ ต้องไม่ทำให้ส่วนคำร้องหายทั้งการ์ด
--    ครอบการเรียก exec_satisfaction_eservice ด้วย EXCEPTION — โยนต่อเฉพาะ insufficient_privilege (ด่านสิทธิ์ต้องปิดตายเสมอ)
--    ล้มอย่างอื่น = คีย์ eservice เป็น null (หน้าเว็บแสดง "โหลดไม่ได้" ไม่ใช่ศูนย์)
--    ส่วนอื่นของฟังก์ชันยกจากไฟล์ 20261204100100 มาทั้งตัว ไม่แตะ (md5 ตรวจที่ด่านต้นไฟล์)
-- H1 ด่านท้ายไฟล์: เจ้าของฟังก์ชันทุกตัวต้องตรงกับ executive_overview + สิทธิ์ EXECUTE ตรงแผน
--    (ตรวจฐานจริงหลังรันไฟล์ 2 แล้ว: เจ้าของ postgres ครบทุกตัว — ด่านนี้กันการรันซ้ำ/รันจากเครื่องมืออื่นในอนาคต)
-- L5 แก้คำอธิบายฟังก์ชัน exec_summary_satisfaction ให้ตรงว่ารวมคำขอ E-Service แล้ว
--
-- ไม่ทำ (บันทึกเหตุผล): L1 คอลัมน์ชนิดเรื่องกันป้ายเพี้ยนเมื่อ admin ลบคำขอ — ลบคำขอทำได้เฉพาะ admin และลง audit_logs ทุกครั้ง
--    ยอดรวมไม่หาย แค่ป้ายเปลี่ยน · L6 created_by_uid ≠ user_id — ใบเคาน์เตอร์สองค่านี้เท่ากัน (บัญชีเจ้าหน้าที่) จึงไม่ช่วย
-- รอเจ้าของตัดสิน: M2 ใครอ่านความเห็นของคำขอได้ (ตอนนี้ admin/officer/staff ทุกกองของ อปท. — แบบเดียวกับคำร้อง)
--
-- ย้อนกลับ: รัน CREATE OR REPLACE ของ document_request_withdrawn และ exec_summary_satisfaction จาก 20261204100100 มือ
--    (ด่าน md5 ของไฟล์นั้นไม่ยอมรับรุ่นนี้ จึงรันทั้งไฟล์ซ้ำไม่ได้)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'public.exec_summary_satisfaction(uuid,date,date)'::regprocedure;
--   → ค่าที่สองในรายการด่านต้นไฟล์ · ด่าน H1 ท้ายไฟล์ไม่ RAISE = เจ้าของ/สิทธิ์ถูกต้อง

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.exec_satisfaction_eservice(uuid, date, date)') IS NULL
     OR to_regprocedure('public.document_request_withdrawn(uuid)') IS NULL THEN
    RAISE EXCEPTION 'doc_request_rating_fix: ต้อง apply 20261204100100 ก่อน';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'patient_transport_events' AND column_name = 'detail')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'asset_borrow_events' AND column_name = 'actor_id') THEN
    RAISE EXCEPTION 'doc_request_rating_fix: ไม่พบ patient_transport_events.detail หรือ asset_borrow_events.actor_id';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_md5
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = 'public.exec_summary_satisfaction(uuid,date,date)'::regprocedure;
  -- รุ่นของไฟล์ 20261204100100 หรือรุ่นของไฟล์นี้เอง (รันซ้ำ)
  IF v_md5 IS DISTINCT FROM 'aa79266aace899379840386785a15738' AND v_md5 IS DISTINCT FROM 'fe73347388bcf3637c76f27126e1c433' THEN
    RAISE EXCEPTION 'Function drift: exec_summary_satisfaction บนฐาน (md5 %) ไม่ตรงรุ่น 20261204100100 — ห้ามเขียนทับ', v_md5;
  END IF;
END $guard$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- M1) ผู้ยื่นถอนคำขอเอง = ผู้กดยกเลิกคือผู้ยื่นจริง (ชื่อและ signature เดิม — ผู้เรียก 3 ตัวไม่ต้องแก้)
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.document_request_withdrawn(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- รถรับ-ส่งผู้ป่วย: ธง by_owner ที่ cancel_patient_transport_request บันทึกไว้ตอนกด (ไม่เปลี่ยนภายหลัง)
  -- ไม่ใช้ cancelled_by = user_id เพราะรวมบัญชีซ้ำ (merge_duplicate_profile) แล้ว cancelled_by กลายเป็น NULL (FK SET NULL)
  SELECT EXISTS (
           SELECT 1
           FROM public.patient_transport_requests AS pt
           JOIN public.patient_transport_events AS ev ON ev.request_id = pt.request_id
           WHERE pt.request_id = p_request_id
             AND pt.workflow_status = 'cancelled'
             AND ev.event_type = 'cancelled'
             AND ev.detail->>'by_owner' = 'true'
         )
      OR EXISTS (
           SELECT 1
           FROM public.asset_borrow_events AS ev
           JOIN public.document_requests AS r ON r.id = ev.request_id
           WHERE ev.request_id = p_request_id
             AND ev.event_type = 'cancelled'
             AND ev.actor_id IS NOT NULL
             AND ev.actor_id = r.user_id
         );
$$;
REVOKE ALL ON FUNCTION public.document_request_withdrawn(uuid) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- L2) exec_summary_satisfaction — ยกจาก 20261204100100 ทั้งตัว แก้เฉพาะท้ายฟังก์ชัน [1.2-ง]
-- ══════════════════════════════════════════════════════════════════════════════════
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
  v_es     jsonb;
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
    AND s.document_request_id IS NULL                       -- [1.2-ก] คะแนนคำขอ E-Service ไม่ใช่แบบประเมินรวม
    AND NOT COALESCE(s.is_verified, false)                  -- [1.2-ก] แถว verified ที่ผูกอะไรไม่ได้ = เรื่องถูกลบ (FK SET NULL) ไม่ใช่แบบประเมินรวม
    AND NOT COALESCE(s.rated_by_proxy, false)
    AND s.created_at >= v_from AND s.created_at < v_to;

  SELECT COALESCE(jsonb_object_agg(x.source, x.n), '{}'::jsonb)
    INTO v_low
  FROM (
    SELECT CASE
             WHEN COALESCE(s.rated_by_proxy, false) THEN 'proxy'
             WHEN s.document_request_id IS NOT NULL THEN 'eservice'   -- [1.2-ข] ต้องมาก่อน 'general'
             WHEN s.complaint_id IS NULL AND NOT COALESCE(s.is_verified, false) THEN 'general'   -- [1.2-ข] verified ไม่มีเรื่อง = เรื่องถูกลบ → ตกไป 'verified'
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

  -- [1.2-ง] ส่วน E-Service ล้ม (ที่ไม่ใช่เรื่องสิทธิ์) ต้องไม่ลากส่วนคำร้องล้มไปด้วย · ด่านสิทธิ์โยนต่อเสมอ
  BEGIN
    v_es := public.exec_satisfaction_eservice(_municipality_id, _from, _to);
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE;
    WHEN OTHERS THEN
      RAISE WARNING 'exec_summary_satisfaction: eservice ล้ม (SQLSTATE %)', SQLSTATE;
      v_es := NULL;
  END;

  RETURN v_main || jsonb_build_object(
    'general', v_gen,
    'low', v_low,
    'eservice', v_es   -- [1.2-ค]
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exec_summary_satisfaction(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- L5) คำอธิบายให้ตรงกับเนื้อหาปัจจุบัน
COMMENT ON FUNCTION public.exec_summary_satisfaction(uuid, date, date) IS
  'ห้องผู้บริหาร: ความพึงพอใจของคำร้องที่ปิดในช่วง (อัตราตอบ + คะแนนแยกที่มา + รายกอง) + แบบประเมินภาพรวม + คะแนนต่ำ '
  '+ คำขอ E-Service (คีย์ eservice จาก exec_satisfaction_eservice — null = ส่วนนั้นโหลดไม่ได้) · เรียกผ่าน executive_overview() เท่านั้น';

-- ══════════════════════════════════════════════════════════════════════════════════
-- H1) ด่านท้ายไฟล์: เจ้าของ + สิทธิ์ EXECUTE (ไม่ผ่าน = ROLLBACK ทั้งไฟล์)
--     เจ้าของต่าง role = exec_summary_satisfaction เรียกตัวช่วยไม่ได้ (42501) → executive_overview ล้มทั้งหน้าทุก อปท.
-- ══════════════════════════════════════════════════════════════════════════════════
DO $owner$
DECLARE
  v_owner oid := (SELECT o.proowner FROM pg_catalog.pg_proc AS o
                  WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure);
  v_bad   text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || ' (' || p.proowner::regrole::text || ')', ', ') INTO v_bad
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid IN ('public.exec_summary_satisfaction(uuid,date,date)'::regprocedure,
                  'public.exec_satisfaction_eservice(uuid,date,date)'::regprocedure,
                  'public.document_request_withdrawn(uuid)'::regprocedure,
                  'public.document_request_rating_block(uuid)'::regprocedure,
                  'public.rate_document_request(uuid,integer,text)'::regprocedure,
                  'public.my_document_request_ratings(uuid)'::regprocedure,
                  'public.stamp_document_request_finished_at()'::regprocedure)
    AND p.proowner <> v_owner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'doc_request_rating_fix: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;

  SELECT string_agg(x.fn || ':' || x.rol, ', ') INTO v_bad
  FROM (VALUES
    ('public.rate_document_request(uuid,integer,text)', 'anon', false),
    ('public.rate_document_request(uuid,integer,text)', 'authenticated', true),
    ('public.my_document_request_ratings(uuid)', 'anon', false),
    ('public.my_document_request_ratings(uuid)', 'authenticated', true),
    ('public.exec_satisfaction_eservice(uuid,date,date)', 'anon', false),
    ('public.exec_satisfaction_eservice(uuid,date,date)', 'authenticated', false),
    ('public.exec_summary_satisfaction(uuid,date,date)', 'anon', false),
    ('public.exec_summary_satisfaction(uuid,date,date)', 'authenticated', false),
    ('public.document_request_rating_block(uuid)', 'anon', false),
    ('public.document_request_rating_block(uuid)', 'authenticated', false),
    ('public.document_request_withdrawn(uuid)', 'anon', false),
    ('public.document_request_withdrawn(uuid)', 'authenticated', false),
    ('public.stamp_document_request_finished_at()', 'anon', false),
    ('public.stamp_document_request_finished_at()', 'authenticated', false)
  ) AS x(fn, rol, want)
  WHERE has_function_privilege(x.rol, x.fn, 'EXECUTE') IS DISTINCT FROM x.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'doc_request_rating_fix: สิทธิ์ EXECUTE ไม่ตรงแผน: %', v_bad;
  END IF;
END $owner$;

NOTIFY pgrst, 'reload schema';

COMMIT;
