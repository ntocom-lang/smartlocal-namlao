-- กิจกรรม: ให้ดาว + ความเห็น (ขั้น 1A) ไฟล์ 2/2 — RLS · GRANT · RPC
--
-- ใครทำอะไรได้
--   ทุกคน (anon ด้วย)  อ่านรีวิวที่ไม่ถูกซ่อนของกิจกรรมสาธารณะ (ไม่มี user_id) · อ่านสรุปดาวผ่าน event_review_summary
--                      (ค่าเฉลี่ยขึ้นเมื่อมีผู้ให้ดาว ≥3 คน — กันค่าเฉลี่ยจากคนเดียว)
--   ผู้ล็อกอิน         ให้ดาว/แก้/ลบรีวิวของตัวเอง ผ่าน RPC เท่านั้น (ไม่มีสิทธิ์ INSERT/UPDATE/DELETE ตรง)
--                      ให้ได้เฉพาะกิจกรรมสาธารณะที่ถึงวันเริ่มแล้ว (เวลาไทย) · 1 บัญชี = 1 รีวิวต่อกิจกรรม
--   เจ้าหน้าที่         คนที่แก้กิจกรรมนั้นได้ (ขอบเขตเท่า policy "staff update events" ของ 20260801220558):
--                      superadmin · admin อปท. เดียวกัน · ผู้สร้างกิจกรรม · หัวหน้ากองของกองที่ถือกิจกรรม
--                      ⇒ เห็นรีวิวที่ถูกซ่อน · ซ่อน/เลิกซ่อน (RPC บังคับเหตุผลตอนซ่อน) · อ่านสมุดบันทึก
--                      ไม่เห็น user_id ของผู้รีวิว (ไม่จำเป็นต่อการซ่อน · PDPA) · ไม่เห็น actor_id ในสมุด
--                      ⇒ ให้ดาวกิจกรรมที่ตัวเองดูแลไม่ได้ (กันผลประโยชน์ทับซ้อน)
-- ตัดสินโดยระบบ: ไม่มี — ระบบไม่ซ่อน/อนุมัติเอง แค่บังคับรูปแบบข้อมูล วันเริ่ม และ 1 คน 1 รีวิว (การซ่อนเป็นการกระทำของคน มีบันทึก)
--
-- ⚠️ รันซ้ำได้ (CREATE OR REPLACE / DROP POLICY IF EXISTS)
-- ⚠️ ขยายตัว: policy อ่านเรียก event_is_public / event_can_moderate ทีละแถว — รับได้ที่ปริมาณรีวิวต่อหน้า (หน้าเว็บดึงทีละกิจกรรม)
--    ถ้าวันหนึ่งต้องดึงรีวิวทั้ง อปท. ทีละหลายพันแถว ให้ทำ RPC สรุปแทนการ select ตาราง
--
-- ย้อนกลับ (หลัง DROP ตารางของไฟล์ 1):
--   DROP FUNCTION public.event_is_public(uuid), public.event_can_moderate(uuid), public.event_reviewer_display_name(text),
--     public.event_review_submit(uuid, integer, text), public.event_review_delete_mine(uuid), public.event_my_review(uuid),
--     public.event_review_summary(uuid[]), public.event_set_review_hidden(uuid, boolean, text);
BEGIN;
SET LOCAL lock_timeout = '5s'; -- รันซ้ำหลังเปิดใช้งาน CREATE POLICY ถือ AccessExclusive บน event_reviews — มี session ค้างให้ล้มเร็ว

DO $guard$
BEGIN
  IF to_regclass('public.event_reviews') IS NULL OR to_regclass('public.event_review_moderation_log') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261220100000_event_reviews_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.get_my_role()') IS NULL OR to_regprocedure('public.get_my_municipality_id()') IS NULL
     OR to_regprocedure('public.can_manage_event_department(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชันสิทธิ์เดิม get_my_role / get_my_municipality_id / can_manage_event_department';
  END IF;
END $guard$;

-- ── ตัวช่วย ────────────────────────────────────────────────────────────────────────
-- กิจกรรมนี้เป็นกิจกรรมสาธารณะไหม — คืนแค่ boolean (ข้อมูลเดียวกับที่ policy อ่าน events ของ anon เปิดอยู่แล้ว)
CREATE OR REPLACE FUNCTION public.event_is_public(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND 'public' = ANY (e.audiences));
$$;
REVOKE ALL ON FUNCTION public.event_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_is_public(uuid) TO anon, authenticated;

-- ผู้เรียกดูแลรีวิวของกิจกรรมนี้ได้ไหม — เงื่อนไขเดียวกับ USING ของ policy "staff update events" (20260801220558)
-- ⚠️ ถ้าแก้ policy นั้น ต้องแก้ที่นี่ตาม (ไม่ได้อ้างถึงกันอัตโนมัติ)
CREATE OR REPLACE FUNCTION public.event_can_moderate(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_event_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND (
        public.get_my_role() = 'superadmin'
        OR (public.get_my_role() = 'admin' AND e.municipality_id = public.get_my_municipality_id())
        OR (
          public.get_my_role() IN ('viewer', 'council', 'officer', 'staff', 'technician', 'kamnan')
          AND e.municipality_id = public.get_my_municipality_id()
          AND (e.created_by = auth.uid() OR public.can_manage_event_department(e.municipality_id, e.department_id))
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.event_can_moderate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_can_moderate(uuid) TO authenticated;

-- ชื่อที่แสดงบนหน้าสาธารณะ: ตัดคำนำหน้า → "ชื่อ อักษรแรกนามสกุล." (เช่น "นางมาลี ศรีสุข" → "มาลี ศ.")
-- สระหน้า (เ แ โ ใ ไ) เอา 2 ตัวอักษร ให้ยังอ่านออก ("นายสมชาย ใจดี" → "สมชาย ใจ.") · ไม่มีชื่อ = "ผู้ใช้งาน"
-- ⚠️ ชื่อจริงที่ขึ้นต้นด้วยตัวอักษรชุดเดียวกับคำนำหน้า (เช่น "นายิกา") จะถูกตัดหัวผิด — รับได้ (แสดงผลเท่านั้น ไม่ใช่ข้อมูลทางทะเบียน)
CREATE OR REPLACE FUNCTION public.event_reviewer_display_name(p_full_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v text;
  parts text[];
BEGIN
  v := btrim(regexp_replace(COALESCE(p_full_name, ''), '^[[:space:]]*(นางสาว|น\.ส\.|นาย|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)[[:space:]]*', ''));
  -- ชื่อที่มีตัวเลข (อารบิก/ไทย) หรือ @ = น่าจะเป็นเบอร์โทร/อีเมลที่ผู้ใช้ตั้งเป็นชื่อ — ห้ามขึ้นหน้าสาธารณะ (PDPA)
  IF v = '' OR v ~ '[0-9๐-๙@]' THEN
    RETURN 'ผู้ใช้งาน';
  END IF;
  parts := regexp_split_to_array(v, '[[:space:]]+');
  IF array_length(parts, 1) = 1 THEN
    RETURN left(parts[1], 40);
  END IF;
  RETURN left(parts[1], 40) || ' '
         || left(parts[2], CASE WHEN left(parts[2], 1) IN ('เ', 'แ', 'โ', 'ใ', 'ไ') THEN 2 ELSE 1 END) || '.';
END;
$$;
REVOKE ALL ON FUNCTION public.event_reviewer_display_name(text) FROM PUBLIC, anon, authenticated;

-- ── สิทธิ์ตาราง ────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.event_reviews, public.event_review_moderation_log FROM PUBLIC, anon, authenticated;
-- ไม่มี user_id ในรายการ ⇒ ไม่มีใครอ่าน uuid ผู้รีวิวผ่าน REST ได้ (ของตัวเองใช้ event_my_review)
GRANT SELECT (id, event_id, municipality_id, rating, comment, reviewer_name, created_at, updated_at)
  ON public.event_reviews TO anon, authenticated;
GRANT SELECT (is_hidden, hidden_reason) ON public.event_reviews TO authenticated; -- เจ้าหน้าที่ใช้ในหน้าดูแล
-- สมุดบันทึก: ไม่มี actor_id ในรายการ — แถว author_delete_hidden เก็บ uuid ของ "ผู้รีวิว" เอง
-- ถ้าเปิดคอลัมน์นี้ ผู้ดูแลกิจกรรม/แอดมินเอา uuid ไปหาชื่อ-เบอร์ใน profiles ได้ = รู้ตัวคนวิจารณ์ (PDPA · ผลตรวจ migration-reviewer 2026-11-19)
-- uuid ยังเก็บไว้เป็นหลักฐาน (เปิดดูได้เฉพาะ postgres/service_role เมื่อมีคำขอทางกฎหมาย)
GRANT SELECT (id, municipality_id, event_id, review_id, action, rating_snapshot, comment_snapshot, reason, created_at)
  ON public.event_review_moderation_log TO authenticated;                          -- ระบบเขียนเอง

-- ── RLS ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "event reviews public read" ON public.event_reviews;
CREATE POLICY "event reviews public read" ON public.event_reviews
  FOR SELECT TO anon, authenticated
  USING (NOT is_hidden AND public.event_is_public(event_id));

DROP POLICY IF EXISTS "event reviews moderator read" ON public.event_reviews;
CREATE POLICY "event reviews moderator read" ON public.event_reviews
  FOR SELECT TO authenticated
  USING (public.event_can_moderate(event_id));

-- สมุดบันทึก: ผู้ดูแลกิจกรรม + แอดมิน อปท. (กิจกรรมที่ลบไปแล้ว event_can_moderate = false แอดมินยังเห็น)
DROP POLICY IF EXISTS "event review log staff read" ON public.event_review_moderation_log;
CREATE POLICY "event review log staff read" ON public.event_review_moderation_log
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin'
         OR ((SELECT public.get_my_role()) = 'admin' AND municipality_id = (SELECT public.get_my_municipality_id()))
         OR public.event_can_moderate(event_id));

-- ── RPC: ให้ดาว/แก้รีวิวของตัวเอง ────────────────────────────────────────────────────────
-- แก้รีวิวที่ถูกซ่อน = ยังซ่อนอยู่ (เจ้าหน้าที่ต้องเลิกซ่อนเอง) ⇒ แก้ข้อความไม่ใช่ทางหลบการซ่อน
CREATE OR REPLACE FUNCTION public.event_review_submit(p_event_id uuid, p_rating integer, p_comment text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  e record;
  v_comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  v_name text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'กรุณาเลือกดาว 1–5 ดวง' USING ERRCODE = '22023';
  END IF;
  IF v_comment IS NOT NULL AND length(v_comment) > 300 THEN
    RAISE EXCEPTION 'ความเห็นยาวเกิน 300 ตัวอักษร' USING ERRCODE = 'P0001';
  END IF;

  SELECT ev.id, ev.municipality_id, ev.event_date INTO e
  FROM public.events ev
  WHERE ev.id = p_event_id AND 'public' = ANY (ev.audiences)
    AND ev.municipality_id IS NOT NULL; -- กิจกรรมเก่าไม่มี อปท. = ไม่รับ (ไม่งั้นชน NOT NULL ได้ error อังกฤษ)
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบกิจกรรมนี้' USING ERRCODE = 'P0001';
  END IF;
  IF e.event_date IS NULL OR e.event_date > (now() AT TIME ZONE 'Asia/Bangkok')::date THEN
    RAISE EXCEPTION 'ให้ดาวได้ตั้งแต่วันที่กิจกรรมเริ่ม' USING ERRCODE = 'P0001';
  END IF;
  -- กันผลประโยชน์ทับซ้อน: ผู้ที่ซ่อนความเห็นของกิจกรรมนี้ได้ (ผู้สร้าง/หัวหน้ากองที่ถือ/แอดมิน อปท./superadmin)
  -- ให้ดาวงานตัวเองไม่ได้ (เจ้าของระบบเลือก 2026-11-19 ตามผลตรวจ migration-reviewer)
  -- ⚠️ เดิมให้ดาวไว้แล้วแล้วภายหลังได้สิทธิ์ดูแล = แก้ไม่ได้ แต่ลบของตัวเองได้ (event_review_delete_mine ไม่ตรวจข้อนี้)
  IF public.event_can_moderate(e.id) THEN
    RAISE EXCEPTION 'ผู้ดูแลกิจกรรมนี้ให้ดาวงานของตัวเองไม่ได้' USING ERRCODE = 'P0001';
  END IF;

  SELECT public.event_reviewer_display_name(p.full_name) INTO v_name FROM public.profiles p WHERE p.id = v_uid;
  v_name := COALESCE(v_name, 'ผู้ใช้งาน');

  INSERT INTO public.event_reviews AS r (event_id, municipality_id, user_id, rating, comment, reviewer_name)
  VALUES (e.id, e.municipality_id, v_uid, p_rating, v_comment, v_name)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, reviewer_name = EXCLUDED.reviewer_name, updated_at = now()
  RETURNING r.id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.event_review_submit(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_review_submit(uuid, integer, text) TO authenticated;

-- ── RPC: ลบรีวิวของตัวเอง (สิทธิ์ลบข้อมูลของตน) — ลบรีวิวที่ถูกซ่อนอยู่ = ลงสมุดพร้อมสำเนา ─────────────
CREATE OR REPLACE FUNCTION public.event_review_delete_mine(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.event_reviews%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.event_reviews WHERE event_id = p_event_id AND user_id = auth.uid() RETURNING * INTO r;
  IF FOUND AND r.is_hidden THEN
    INSERT INTO public.event_review_moderation_log
      (municipality_id, event_id, review_id, action, rating_snapshot, comment_snapshot, reason, actor_id)
    VALUES (r.municipality_id, r.event_id, r.id, 'author_delete_hidden', r.rating, r.comment, r.hidden_reason, auth.uid());
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.event_review_delete_mine(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_review_delete_mine(uuid) TO authenticated;

-- ── RPC: รีวิวของฉันในกิจกรรมนี้ (รวมสถานะถูกซ่อน + เหตุผล) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.event_my_review(p_event_id uuid)
RETURNS TABLE (id uuid, rating smallint, comment text, reviewer_name text, is_hidden boolean, hidden_reason text,
               created_at timestamptz, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r.id, r.rating, r.comment, r.reviewer_name, r.is_hidden, r.hidden_reason, r.created_at, r.updated_at
  FROM public.event_reviews r
  WHERE r.event_id = p_event_id AND r.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.event_my_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_review(uuid) TO authenticated;

-- ── RPC: สรุปดาวรายกิจกรรม (ตัวเลขล้วน ไม่มี PII · เฉพาะกิจกรรมสาธารณะ · ไม่นับที่ถูกซ่อน) ─────────
-- avg_rating = NULL เมื่อผู้ให้ดาว < 3 คน (หน้าเว็บขึ้น "ยังไม่พอคำนวณค่าเฉลี่ย") · ขอได้ครั้งละ ≤500 กิจกรรม
CREATE OR REPLACE FUNCTION public.event_review_summary(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, review_count integer, avg_rating numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(cardinality(p_event_ids), 0) > 500 THEN
    RAISE EXCEPTION 'ขอสรุปได้ครั้งละไม่เกิน 500 กิจกรรม' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT r.event_id, count(*)::integer,
         CASE WHEN count(*) >= 3 THEN round(avg(r.rating)::numeric, 1) END
  FROM public.event_reviews r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.event_id = ANY (p_event_ids) AND NOT r.is_hidden AND 'public' = ANY (e.audiences)
  GROUP BY r.event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.event_review_summary(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_review_summary(uuid[]) TO anon, authenticated;

-- ── RPC: เจ้าหน้าที่ซ่อน/เลิกซ่อนรีวิว (บังคับเหตุผลตอนซ่อน · ลงสมุดพร้อมสำเนาทุกครั้ง) ───────────
CREATE OR REPLACE FUNCTION public.event_set_review_hidden(p_review_id uuid, p_hidden boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.event_reviews%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_review_id IS NULL OR p_hidden IS NULL THEN
    RAISE EXCEPTION 'ข้อมูลไม่ครบ' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.event_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND OR NOT public.event_can_moderate(r.event_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จัดการรีวิวนี้' USING ERRCODE = '42501';
  END IF;
  IF p_hidden AND v_reason IS NULL THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผลที่ซ่อน (ผู้เขียนจะเห็นเหตุผลนี้)' USING ERRCODE = 'P0001';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 300 THEN
    RAISE EXCEPTION 'เหตุผลยาวเกิน 300 ตัวอักษร' USING ERRCODE = 'P0001';
  END IF;
  IF r.is_hidden = p_hidden THEN
    RETURN; -- กดซ้ำไม่ลงบันทึกซ้ำ
  END IF;

  UPDATE public.event_reviews
     SET is_hidden = p_hidden,
         hidden_reason = CASE WHEN p_hidden THEN v_reason ELSE NULL END
   WHERE id = r.id;

  INSERT INTO public.event_review_moderation_log
    (municipality_id, event_id, review_id, action, rating_snapshot, comment_snapshot, reason, actor_id)
  VALUES (r.municipality_id, r.event_id, r.id, CASE WHEN p_hidden THEN 'hide' ELSE 'unhide' END,
          r.rating, r.comment, v_reason, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.event_set_review_hidden(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_set_review_hidden(uuid, boolean, text) TO authenticated;

-- ── ด่านท้ายไฟล์: ผู้รันไม่ใช่เจ้าของตาราง REVOKE จะไม่ error แต่ไม่มีผล (บทเรียน #657) ──
DO $verify$
DECLARE
  r regclass := 'public.event_reviews'; l regclass := 'public.event_review_moderation_log';
BEGIN
  IF (SELECT bool_or(NOT relrowsecurity) FROM pg_class WHERE oid IN (r, l))
     OR has_table_privilege('anon', r, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', r, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('anon', r, 'INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('authenticated', r, 'INSERT,UPDATE,REFERENCES')
     OR has_column_privilege('anon', r, 'user_id', 'SELECT')
     OR has_column_privilege('authenticated', r, 'user_id', 'SELECT')
     OR has_column_privilege('anon', r, 'is_hidden', 'SELECT')
     OR has_column_privilege('anon', r, 'hidden_reason', 'SELECT')
     OR NOT has_column_privilege('anon', r, 'rating', 'SELECT')
     OR has_any_column_privilege('anon', l, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('anon', l, 'DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('authenticated', l, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('authenticated', l, 'INSERT,UPDATE')
     OR has_column_privilege('authenticated', l, 'actor_id', 'SELECT')
     OR has_table_privilege('authenticated', l, 'SELECT')
     OR NOT has_column_privilege('authenticated', l, 'reason', 'SELECT')
     OR NOT has_column_privilege('authenticated', r, 'is_hidden', 'SELECT')
     OR NOT has_function_privilege('authenticated', 'public.event_review_submit(uuid, integer, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.event_review_delete_mine(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.event_my_review(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.event_set_review_hidden(uuid, boolean, text)', 'EXECUTE')
     -- ตรวจราย signature (ไม่นับตามชื่อ — ฐานจริงมี overload ชื่อซ้ำก็ไม่ล้มผิด)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (
          'public.event_is_public(uuid)'::regprocedure, 'public.event_can_moderate(uuid)'::regprocedure,
          'public.event_review_submit(uuid, integer, text)'::regprocedure, 'public.event_review_delete_mine(uuid)'::regprocedure,
          'public.event_my_review(uuid)'::regprocedure, 'public.event_review_summary(uuid[])'::regprocedure,
          'public.event_set_review_hidden(uuid, boolean, text)'::regprocedure)
        AND (NOT prosecdef OR NOT ('search_path=pg_catalog, public' = ANY (COALESCE(proconfig, '{}')))))
     OR has_function_privilege('anon', 'public.event_review_submit(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.event_review_delete_mine(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.event_my_review(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.event_set_review_hidden(uuid, boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.event_can_moderate(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.event_reviewer_display_name(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.event_review_summary(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.event_is_public(uuid)', 'EXECUTE')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid IN (r, l)) <> 3 THEN
    RAISE EXCEPTION 'event_reviews: RLS/สิทธิ์ไม่ตรงตามที่ออกแบบ (ผู้รันต้องเป็นเจ้าของตาราง เช่น postgres)';
  END IF;
END $verify$;

COMMIT;
