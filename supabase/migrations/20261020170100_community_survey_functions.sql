-- 20261020170100_community_survey_functions.sql
--
-- [เฟสฟังก์ชัน] แบบสำรวจความเห็นประชาชน (เฟส 1) — ต้อง apply หลัง 20261020170000 (ตาราง)
--
-- ฟังก์ชันใหม่ล้วน ไม่มี CREATE OR REPLACE ทับของเดิม (docs/ai/NOTES.md ข้อ 5)
--   ตัวช่วยภายใน (ไม่เปิดให้ API): survey_voter_group · survey_can_manage · survey_mask_text · survey_comment_keep_days · survey_audit
--   ประชาชน/ผู้เข้าชม: list_surveys · get_survey (anon+authenticated) · cast_survey_vote (authenticated)
--   เจ้าหน้าที่: create_survey · close_survey_early · set_survey_comment_enabled · list_surveys_manage · get_survey_staff · delete_survey_comment
--   งานเบื้องหลัง: survey_comment_purge_tick (pg_cron วันละครั้ง ถอนสิทธิ์จาก API ทุก role)
--
-- ── ใครทำอะไรได้ ─────────────────────────────────────────────────────────────────────────────
-- ตอบ: ผู้ล็อกอินที่สังกัด อปท. ของแบบสำรวจ ทุกบทบาท 1 คน 1 เสียง · รายงานแยกกลุ่ม "ประชาชน" กับ "ผู้มีตำแหน่ง"
--   (official = role ชุดเดียวกับ OFFICIAL_ROLES ใน src/lib/serviceAudience.js เทสต์เทียบให้)
-- สร้าง/ปิด/ดูความเห็น: superadmin · admin/officer/staff ของ อปท. นั้น (ชุดเดียวกับผู้ที่สร้างโพสต์ข่าวได้ ไม่รวม viewer/council/technician)
--   ไม่มีขั้นอนุมัติเพิ่ม — ทุกการสร้าง/ปิด/เปิด-ปิดช่องความเห็น/ลบความเห็น ลง audit_logs (ไม่เก็บเนื้อความเห็นใน audit)
--
-- ── ใครเห็นอะไร ──────────────────────────────────────────────────────────────────────────────
-- ผลรายตัวเลือก: เห็นเมื่อแบบสำรวจปิดแล้ว (ทุกคนรวมผู้ไม่ล็อกอิน) หรือเมื่อผู้เรียกตอบแล้ว — ไม่ให้เห็นก่อนตอบ (กันเลือกตามเสียงส่วนใหญ่)
-- ความเห็นที่พิมพ์: เห็นเฉพาะเจ้าหน้าที่ที่จัดการได้ ไม่มีชื่อ/เวลา/บัญชี เรียงตาม uuid สุ่ม ไม่เรียงตามเวลา
--   ซ่อนเบอร์โทร/เลขบัตร 13 หลัก/อีเมลก่อนบันทึก · ลบทิ้งเองหลังแบบสำรวจปิด 90 วัน (survey_comment_keep_days)
--   และต่อให้ cron พลาด get_survey_staff ก็หยุดคืนความเห็นของแบบสำรวจที่ปิดเกิน 90 วัน
-- ⚠️ ระบบซ่อนได้เฉพาะรูปแบบที่จับได้ (เบอร์โทร เลขบัตร อีเมล) — ชื่อบุคคลหรือที่อยู่ในประโยคระบบไม่รู้ ป้ายบนหน้าตอบเตือนผู้พิมพ์แล้ว
--
-- ── การกันยิงรัว ─────────────────────────────────────────────────────────────────────────────
-- ตอบ 20 ครั้ง/5 นาที ต่อผู้เรียก (rpc_rate_limit_hit เดิม) · ฟังก์ชันอ่านเป็นยอดรวมสาธารณะ ไม่จำกัด (เหมือน RPC ข้อมูลสาธารณะอื่น)

-- ── 0) ตัวช่วยภายใน ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_voter_group()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN COALESCE(public.get_my_role() IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council'), false)
    THEN 'official' ELSE 'citizen'
  END
$$;

CREATE OR REPLACE FUNCTION public.survey_can_manage(_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() IN ('admin', 'officer', 'staff') AND public.get_my_municipality_id() = _municipality_id),
    false)
$$;

-- จำนวนวันที่เก็บความเห็นหลังแบบสำรวจปิด (ค่าเดียวใช้ทั้งงานลบและตัวกรองตอนอ่าน — แก้ที่นี่ที่เดียว)
CREATE OR REPLACE FUNCTION public.survey_comment_keep_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT 90 $$;

-- ซ่อนข้อมูลส่วนบุคคลที่จับรูปแบบได้ในความเห็น: อีเมล → เลขบัตร 13 หลัก → เบอร์โทร (ลำดับสำคัญ: เลขบัตรขึ้นต้น 0 ต้องเป็นเลขบัตร ไม่ใช่เบอร์)
-- รับทั้งเลขไทย ๐-๙ ตัวคั่นเดี่ยว ช่องว่าง . - ได้ · จับเฉพาะชุดตัวเลขที่ยืนเดี่ยว (ไม่ติดตัวเลขอื่นหน้า-หลัง) กันไปทับตัวเลขในจำนวนเงินยาวๆ
CREATE OR REPLACE FUNCTION public.survey_mask_text(_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v text := _text;
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[ซ่อนอีเมล]', 'g');
  v := regexp_replace(v, '(?<![0-9๐-๙])[0-9๐-๙]([ .-]?[0-9๐-๙]){12}(?![0-9๐-๙])', '[ซ่อนเลขบัตร]', 'g');
  v := regexp_replace(v, '(?<![0-9๐-๙])(\+?(66|๖๖)|0|๐)[ .-]?[0-9๐-๙]([ .-]?[0-9๐-๙]){7,}(?![0-9๐-๙])', '[ซ่อนเบอร์โทร]', 'g');
  RETURN v;
END;
$$;

-- บันทึกประวัติ (audit_logs) — เนื้อความเห็นไม่ลงที่นี่ ลงแค่ว่าใครทำอะไรกับแบบสำรวจไหน
CREATE OR REPLACE FUNCTION public.survey_audit(
  _municipality_id uuid,
  _action          text,
  _survey_id       uuid,
  _label           text,
  _metadata        jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
  v_role text;
BEGIN
  SELECT COALESCE(full_name, email, id::text), role INTO v_name, v_role FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (municipality_id, actor_id, actor_name, actor_role, action, resource_type, resource_id, resource_label, metadata)
  VALUES (_municipality_id, auth.uid(), v_name, v_role, _action, 'survey', _survey_id::text, left(_label, 200), _metadata);
END;
$$;

REVOKE ALL ON FUNCTION public.survey_voter_group()                                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.survey_can_manage(uuid)                                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.survey_comment_keep_days()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.survey_mask_text(text)                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.survey_audit(uuid, text, uuid, text, jsonb)                   FROM PUBLIC, anon, authenticated;

-- ── 1) ผู้เข้าชม: รายการและรายละเอียด ─────────────────────────────────────────────────────────
-- เปิดอยู่ทั้งหมด + ที่ปิดแล้วและมีคนตอบอย่างน้อย 1 คน (ปิดก่อนกำหนดโดยไม่มีใครตอบ = สร้างผิด ไม่โชว์) ล่าสุด 20 รายการ
CREATE OR REPLACE FUNCTION public.list_surveys(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH s AS (
    SELECT sv.id, sv.question, sv.allow_comment,
           LEAST(sv.closes_at, COALESCE(sv.closed_early_at, sv.closes_at)) AS eff_close,
           (SELECT count(*) FROM public.survey_ballots b WHERE b.survey_id = sv.id)::int AS total,
           (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.survey_voters v WHERE v.survey_id = sv.id AND v.user_id = auth.uid())) AS has_voted
      FROM public.surveys sv
     WHERE sv.municipality_id = _municipality_id AND sv.opens_at <= now()
  ), shown AS (
    SELECT s.*, (now() < s.eff_close) AS is_open FROM s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'question', question,
           'status', CASE WHEN is_open THEN 'open' ELSE 'closed' END,
           'closes_at', eff_close, 'total', total, 'has_voted', has_voted, 'allow_comment', allow_comment
         ) ORDER BY is_open DESC, CASE WHEN is_open THEN eff_close END ASC, eff_close DESC), '[]'::jsonb)
    FROM (SELECT * FROM shown WHERE is_open OR total > 0 ORDER BY is_open DESC, eff_close DESC LIMIT 23) shown_limited
$$;

CREATE OR REPLACE FUNCTION public.get_survey(_survey_id uuid, _municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_s       public.surveys%ROWTYPE;
  v_close   timestamptz;
  v_open    boolean;
  v_voted   boolean := false;
  v_block   text := NULL;
  v_visible boolean;
  v_total   integer;
  v_options jsonb;
  v_split   jsonb := NULL;
BEGIN
  SELECT * INTO v_s FROM public.surveys WHERE id = _survey_id AND municipality_id = _municipality_id AND opens_at <= now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_close := LEAST(v_s.closes_at, COALESCE(v_s.closed_early_at, v_s.closes_at));
  v_open  := now() < v_close;
  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.survey_voters WHERE survey_id = v_s.id AND user_id = v_uid) INTO v_voted;
  END IF;

  IF NOT v_open THEN
    v_block := 'closed';
  ELSIF v_uid IS NULL THEN
    v_block := 'login_required';
  ELSIF public.get_my_municipality_id() IS DISTINCT FROM v_s.municipality_id THEN
    v_block := 'other_municipality';
  ELSIF v_voted THEN
    v_block := 'already_voted';
  END IF;

  v_visible := (NOT v_open) OR v_voted;
  SELECT count(*)::int INTO v_total FROM public.survey_ballots WHERE survey_id = v_s.id;

  SELECT jsonb_agg(jsonb_build_object(
           'id', o.id, 'label', o.label, 'position', o.position,
           'count', CASE WHEN v_visible THEN COALESCE(c.n, 0) ELSE NULL END
         ) ORDER BY o.position)
    INTO v_options
    FROM public.survey_options o
    LEFT JOIN (SELECT option_id, count(*)::int AS n FROM public.survey_ballots WHERE survey_id = v_s.id GROUP BY option_id) c ON c.option_id = o.id
   WHERE o.survey_id = v_s.id;

  IF v_visible THEN
    SELECT jsonb_build_object(
             'citizen',  count(*) FILTER (WHERE voter_group = 'citizen'),
             'official', count(*) FILTER (WHERE voter_group = 'official'))
      INTO v_split FROM public.survey_ballots WHERE survey_id = v_s.id;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_s.id,
    'question', v_s.question,
    'status', CASE WHEN v_open THEN 'open' ELSE 'closed' END,
    'closes_at', v_close,
    'allow_comment', v_s.allow_comment,
    'options', COALESCE(v_options, '[]'::jsonb),
    'total', v_total,
    'split', v_split,
    'results_visible', v_visible,
    'has_voted', v_voted,
    'can_vote', v_block IS NULL,
    'vote_block', v_block,
    'server_now', now()
  );
END;
$$;

-- ── 2) ตอบแบบสำรวจ ───────────────────────────────────────────────────────────────────────────
-- ลงทะเบียนผู้ใช้สิทธิ์ + หย่อนบัตรในฟังก์ชันเดียว (ทรานแซกชันเดียว) — บัตรไม่มี user_id ไม่มีเวลา
CREATE OR REPLACE FUNCTION public.cast_survey_vote(
  _survey_id       uuid,
  _municipality_id uuid,
  p_option_id      uuid,
  p_comment        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_s       public.surveys%ROWTYPE;
  v_comment text := NULL;
  v_masked  text := NULL;
  v_rows    integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'login_required');
  END IF;

  IF NOT public.rpc_rate_limit_hit('survey_vote', 20, interval '5 minutes') THEN
    RAISE EXCEPTION 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  SELECT * INTO v_s FROM public.surveys WHERE id = _survey_id AND municipality_id = _municipality_id AND opens_at <= now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF public.get_my_municipality_id() IS DISTINCT FROM v_s.municipality_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'other_municipality');
  END IF;
  IF now() >= LEAST(v_s.closes_at, COALESCE(v_s.closed_early_at, v_s.closes_at)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_open');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.survey_options WHERE id = p_option_id AND survey_id = v_s.id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_option');
  END IF;

  v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');
  IF v_comment IS NOT NULL AND char_length(v_comment) > 300 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'comment_too_long');
  END IF;
  -- เจ้าหน้าที่ปิดช่องความเห็นระหว่างที่ผู้ตอบกำลังพิมพ์ → นับคะแนนตามปกติ ทิ้งความเห็น (comment_saved = false)
  IF NOT v_s.allow_comment THEN
    v_comment := NULL;
  END IF;
  IF v_comment IS NOT NULL THEN
    v_masked := left(public.survey_mask_text(v_comment), 300);
  END IF;

  INSERT INTO public.survey_voters (survey_id, user_id) VALUES (v_s.id, v_uid) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_voted');
  END IF;

  INSERT INTO public.survey_ballots (survey_id, option_id, voter_group, comment)
  VALUES (v_s.id, p_option_id, public.survey_voter_group(), v_masked);

  RETURN jsonb_build_object(
    'ok', true,
    'comment_saved', v_masked IS NOT NULL,
    'comment_masked', v_masked IS NOT NULL AND v_masked IS DISTINCT FROM left(v_comment, 300)
  );
END;
$$;

-- ── 3) เจ้าหน้าที่ ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_survey(
  _municipality_id uuid,
  p_question       text,
  p_options        text[],
  p_allow_comment  boolean DEFAULT true,
  p_closes_at      timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_question text := btrim(COALESCE(p_question, ''));
  v_labels   text[];
  v_closes   timestamptz := COALESCE(p_closes_at, now() + interval '14 days');
  v_id       uuid;
  i          integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.survey_can_manage(_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  IF NOT public.rpc_rate_limit_hit('survey_manage', 20, interval '5 minutes') THEN
    RAISE EXCEPTION 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  IF char_length(v_question) < 5 OR char_length(v_question) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_question');
  END IF;

  SELECT COALESCE(array_agg(btrim(x) ORDER BY ord), ARRAY[]::text[]) INTO v_labels
    FROM unnest(COALESCE(p_options, ARRAY[]::text[])) WITH ORDINALITY AS t(x, ord);
  IF cardinality(v_labels) < 2 OR cardinality(v_labels) > 5
     OR EXISTS (SELECT 1 FROM unnest(v_labels) l WHERE char_length(l) < 1 OR char_length(l) > 100)
     OR (SELECT count(DISTINCT lower(l)) FROM unnest(v_labels) l) <> cardinality(v_labels)
  THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_options');
  END IF;

  IF v_closes < now() + interval '1 hour' OR v_closes > now() + interval '90 days' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_closes_at');
  END IF;

  -- เปิดพร้อมกันได้ไม่เกิน 3 เรื่องต่อ อปท. (กันหน้าแรกท่วมและกันกดซ้ำ)
  IF (SELECT count(*) FROM public.surveys s
       WHERE s.municipality_id = _municipality_id AND s.opens_at <= now()
         AND now() < LEAST(s.closes_at, COALESCE(s.closed_early_at, s.closes_at))) >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many_open');
  END IF;
  IF EXISTS (SELECT 1 FROM public.surveys s
              WHERE s.municipality_id = _municipality_id AND lower(btrim(s.question)) = lower(v_question)
                AND now() < LEAST(s.closes_at, COALESCE(s.closed_early_at, s.closes_at))) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate');
  END IF;

  INSERT INTO public.surveys (municipality_id, question, allow_comment, closes_at, created_by)
  VALUES (_municipality_id, v_question, COALESCE(p_allow_comment, true), v_closes, auth.uid())
  RETURNING id INTO v_id;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    INSERT INTO public.survey_options (survey_id, position, label) VALUES (v_id, i, v_labels[i]);
  END LOOP;

  PERFORM public.survey_audit(_municipality_id, 'create', v_id, v_question,
    jsonb_build_object('options', cardinality(v_labels), 'allow_comment', COALESCE(p_allow_comment, true), 'closes_at', v_closes));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_survey_early(_survey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s public.surveys%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public.surveys WHERE id = _survey_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF auth.uid() IS NULL OR NOT public.survey_can_manage(v_s.municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF now() >= LEAST(v_s.closes_at, COALESCE(v_s.closed_early_at, v_s.closes_at)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_open');
  END IF;

  UPDATE public.surveys SET closed_early_at = now(), closed_early_by = auth.uid() WHERE id = v_s.id;
  PERFORM public.survey_audit(v_s.municipality_id, 'close', v_s.id, v_s.question, NULL);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_survey_comment_enabled(_survey_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s public.surveys%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public.surveys WHERE id = _survey_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF auth.uid() IS NULL OR NOT public.survey_can_manage(v_s.municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF now() >= LEAST(v_s.closes_at, COALESCE(v_s.closed_early_at, v_s.closes_at)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_open');
  END IF;

  UPDATE public.surveys SET allow_comment = COALESCE(p_enabled, true) WHERE id = v_s.id;
  PERFORM public.survey_audit(v_s.municipality_id, CASE WHEN COALESCE(p_enabled, true) THEN 'comment_on' ELSE 'comment_off' END, v_s.id, v_s.question, NULL);
  RETURN jsonb_build_object('ok', true, 'allow_comment', COALESCE(p_enabled, true));
END;
$$;

CREATE OR REPLACE FUNCTION public.list_surveys_manage(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.survey_can_manage(_municipality_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json_obj ORDER BY created_at DESC)
      FROM (
        SELECT s.created_at,
               jsonb_build_object(
                 'id', s.id, 'question', s.question,
                 'status', CASE WHEN now() < LEAST(s.closes_at, COALESCE(s.closed_early_at, s.closes_at)) THEN 'open' ELSE 'closed' END,
                 'closes_at', LEAST(s.closes_at, COALESCE(s.closed_early_at, s.closes_at)),
                 'allow_comment', s.allow_comment,
                 'total', (SELECT count(*) FROM public.survey_ballots b WHERE b.survey_id = s.id)::int,
                 'comment_count', (SELECT count(*) FROM public.survey_ballots b WHERE b.survey_id = s.id AND b.comment IS NOT NULL)::int
               ) AS row_to_json_obj
          FROM public.surveys s
         WHERE s.municipality_id = _municipality_id AND s.opens_at <= now()
         ORDER BY s.created_at DESC
         LIMIT 50
      ) q
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_survey_staff(_survey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s        public.surveys%ROWTYPE;
  v_close    timestamptz;
  v_options  jsonb;
  v_split    jsonb;
  v_comments jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_s FROM public.surveys WHERE id = _survey_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.survey_can_manage(v_s.municipality_id) THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  v_close := LEAST(v_s.closes_at, COALESCE(v_s.closed_early_at, v_s.closes_at));

  SELECT jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'position', o.position, 'count', COALESCE(c.n, 0)) ORDER BY o.position)
    INTO v_options
    FROM public.survey_options o
    LEFT JOIN (SELECT option_id, count(*)::int AS n FROM public.survey_ballots WHERE survey_id = v_s.id GROUP BY option_id) c ON c.option_id = o.id
   WHERE o.survey_id = v_s.id;

  SELECT jsonb_build_object(
           'total',    count(*),
           'citizen',  count(*) FILTER (WHERE voter_group = 'citizen'),
           'official', count(*) FILTER (WHERE voter_group = 'official'))
    INTO v_split FROM public.survey_ballots WHERE survey_id = v_s.id;

  -- ความเห็นหมดอายุตามกติกาเก็บ 90 วันหลังปิด — ต่อให้งานลบพลาด ก็ไม่คืนให้อีก
  IF now() < v_close + make_interval(days => public.survey_comment_keep_days()) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'option_id', b.option_id, 'text', b.comment) ORDER BY b.id), '[]'::jsonb)
      INTO v_comments
      FROM public.survey_ballots b
     WHERE b.survey_id = v_s.id AND b.comment IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_s.id,
    'question', v_s.question,
    'status', CASE WHEN now() < v_close THEN 'open' ELSE 'closed' END,
    'closes_at', v_close,
    'allow_comment', v_s.allow_comment,
    'options', COALESCE(v_options, '[]'::jsonb),
    'split', v_split,
    'comments', v_comments,
    'comment_keep_days', public.survey_comment_keep_days()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_survey_comment(_ballot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_survey_id uuid;
  v_muni      uuid;
  v_question  text;
BEGIN
  SELECT s.id, s.municipality_id, s.question INTO v_survey_id, v_muni, v_question
    FROM public.survey_ballots b JOIN public.surveys s ON s.id = b.survey_id
   WHERE b.id = _ballot_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF auth.uid() IS NULL OR NOT public.survey_can_manage(v_muni) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  -- ลบเฉพาะข้อความ — บัตรยังอยู่ ยอดโหวตไม่เปลี่ยน
  UPDATE public.survey_ballots SET comment = NULL WHERE id = _ballot_id;
  PERFORM public.survey_audit(v_muni, 'delete_comment', v_survey_id, v_question, NULL);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 4) ลบความเห็นที่ครบกำหนด (วันละครั้ง) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_comment_purge_tick(_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_job CONSTANT text := 'survey-comment-purge';
  v_n   integer;
BEGIN
  UPDATE public.survey_ballots b
     SET comment = NULL
    FROM public.surveys s
   WHERE s.id = b.survey_id
     AND b.comment IS NOT NULL
     AND LEAST(s.closes_at, COALESCE(s.closed_early_at, s.closes_at)) < _now - make_interval(days => public.survey_comment_keep_days());
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- สมุดลงเวลา (ไม่ได้อยู่ในรายการที่ thaiwater-watchdog เฝ้า — ดูผลได้จากตารางนี้) · เขียนไม่สำเร็จไม่ทำให้งานย้อนกลับ
  BEGIN
    INSERT INTO public.job_heartbeats (job_name, last_ok_at, updated_at)
    VALUES (c_job, now(), now())
    ON CONFLICT (job_name) DO UPDATE SET last_ok_at = EXCLUDED.last_ok_at, updated_at = EXCLUDED.updated_at;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'purged', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.survey_comment_purge_tick(timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 5) สิทธิ์เรียก ──────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.list_surveys(uuid)                                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_survey(uuid, uuid)                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cast_survey_vote(uuid, uuid, uuid, text)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_survey(uuid, text, text[], boolean, timestamptz)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_survey_early(uuid)                                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_survey_comment_enabled(uuid, boolean)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_surveys_manage(uuid)                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_survey_staff(uuid)                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_survey_comment(uuid)                                   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_surveys(uuid)                                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_survey(uuid, uuid)                                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_survey_vote(uuid, uuid, uuid, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_survey(uuid, text, text[], boolean, timestamptz)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_survey_early(uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_survey_comment_enabled(uuid, boolean)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_surveys_manage(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_survey_staff(uuid)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_survey_comment(uuid)                                TO authenticated;

-- ── 6) งานลบความเห็นที่ครบกำหนด: ทุกวัน 03:15 เวลาไทย (20:15 UTC) ────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ pg_cron — เปิดที่ Database → Extensions ก่อน (20260918150500 เปิดไว้แล้วบน production)';
  END IF;
  IF to_regclass('public.job_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260928140000_job_heartbeats_table.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

SELECT cron.unschedule('survey-comment-purge-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'survey-comment-purge-daily');

SELECT cron.schedule(
  'survey-comment-purge-daily',
  '15 20 * * *',
  $cron$SELECT public.survey_comment_purge_tick();$cron$
);

NOTIFY pgrst, 'reload schema';
