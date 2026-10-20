-- 20261020160100_complaint_track_token_functions.sql
--
-- [เฟสฟังก์ชัน] ลิงก์ติดตามเรื่องของผู้แจ้ง (เฟส 1) — ต้อง apply หลัง 20261020160000 (คอลัมน์ track_token, via_link)
--
-- ฟังก์ชันใหม่ล้วน ไม่มี CREATE OR REPLACE ทับของเดิม (NOTES.md ข้อ 5):
--   complaint_track_caller_is_staff()      ตัวช่วยภายใน — ผู้เรียกเป็นผู้มีตำแหน่งหรือไม่ (ไม่เปิดให้ API)
--   get_complaint_track_token(uuid)        ผู้ยื่น/เจ้าหน้าที่ อปท. เดียวกัน ขอโทเคนไปแชร์ — authenticated เท่านั้น
--   get_complaint_by_track_token(text, uuid)        ผู้ถือลิงก์เปิดดู
--   rate_complaint_by_track_token(text, uuid, int, text)   ผู้ถือลิงก์ให้คะแนน
--   reopen_complaint_by_track_token(text, uuid, text)      ผู้ถือลิงก์แจ้งว่ายังไม่เรียบร้อย
--
-- ── ผู้ถือลิงก์เห็นอะไร (PDPA) ───────────────────────────────────────────────────────────────
-- เห็น: เลขที่อ้างอิง หมวด หมู่บ้าน สถานะ+เวลา กำหนดเสร็จ บันทึกผลของเจ้าหน้าที่ (เมื่อดำเนินการแล้ว)
-- ไม่เห็น: ชื่อ เบอร์โทร พิกัด รายละเอียดที่ผู้แจ้งพิมพ์ ชื่อเจ้าหน้าที่ และหมายเหตุในไทม์ไลน์ (ส่งแต่สถานะ+เวลา)
-- ไม่ส่ง id (uuid) ของคำร้องออกไปด้วย — ลิงก์เป็นกุญแจเดียว
-- รูปหลังดำเนินการยังไม่อยู่ในเฟสนี้: รูปคำร้องเก็บบน Google Drive แบบส่วนตัว (drive_files.is_public = false)
-- ต้องแก้ Edge Function drive-file แยกเป็นเฟส 2
--
-- ── ใครทำอะไรผ่านลิงก์ได้ ────────────────────────────────────────────────────────────────────
-- ผู้มีตำแหน่ง (role ชุดเดียวกับ OFFICIAL_ROLES ใน src/lib/serviceAudience.js ซึ่งเทสต์เทียบให้) เปิดดูได้อย่างเดียว
-- ให้คะแนนหรือแจ้งกลับแทนผู้แจ้งไม่ได้ — กติกาเดียวกับ rate_complaint() ที่กัน admin กดให้ 5 ดาวย้อนหลัง
-- ผู้ถือลิงก์ที่ไม่ได้ล็อกอิน หรือล็อกอินเป็นประชาชนคนอื่น: คะแนนเป็น is_verified=false + via_link=true
-- เจ้าของเรื่องที่ล็อกอินแล้วเปิดลิงก์ตัวเอง: คะแนนส่งต่อ rate_complaint() ตามเดิม (verified และลง complaints.rating)
--
-- ── แจ้งกลับ ─────────────────────────────────────────────────────────────────────────────────
-- เงื่อนไขเหมือน reopen_complaint() ทุกข้อ (ภายใน 7 วันหลังดำเนินการแล้ว · 1 ครั้ง · เหตุผล 5–500 ตัวอักษร ·
-- เรื่องกลับไปผู้รับผิดชอบเดิม) ต่างกันแค่ไม่ต้องล็อกอินและเขียนในไทม์ไลน์ว่า "ผ่านลิงก์ติดตาม"
-- ไม่เพิ่มคีย์ใหม่ใน extra_data (เผื่อมี trigger ตรวจรูปร่าง) — UI อ่าน reopened_at/reopen_count ชุดเดิมได้ต่อ
-- ⚠️ ถ้าแก้เงื่อนไขของ reopen_complaint() (20260915110100) ต้องแก้ตัวนี้ให้ตรงกัน — tests/complaint-track-db.test.mjs ตรวจพฤติกรรม
--
-- ── การกันยิงรัว ─────────────────────────────────────────────────────────────────────────────
-- ใช้ rpc_rate_limit_hit() เดิม (20260905170000): ดู 30 ครั้ง/5 นาที · ให้คะแนน/แจ้งกลับ 20 ครั้ง/5 นาที ต่อผู้เรียก
-- โทเคนสุ่ม 122 บิต เดาไม่ได้อยู่แล้ว ด่านนี้กันแค่การยิงรัวและการกดซ้ำ
-- ตอบ "ไม่พบ" แบบเดียวกันทุกกรณี (โทเคนผิดรูป/ไม่มี/ไม่ตรง อปท.) ไม่ใบ้ว่าใกล้เคียง

-- ── 0) ตัวช่วยภายใน ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complaint_track_caller_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    public.get_my_role() IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council'),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.complaint_track_caller_is_staff() FROM PUBLIC, anon, authenticated;

-- ── 1) ขอโทเคนไปแชร์ ─────────────────────────────────────────────────────────────────────────
-- ผู้ยื่น (user_id) หรือผู้มีตำแหน่งใน อปท. เดียวกับคำร้อง — ไม่ตรง/ไม่ล็อกอิน/ไม่พบ = NULL ไม่ raise
CREATE OR REPLACE FUNCTION public.get_complaint_track_token(p_complaint_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c   public.complaints%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_c.user_id = v_uid
     OR (public.complaint_track_caller_is_staff()
         AND public.get_my_municipality_id() = v_c.municipality_id)
  THEN
    RETURN v_c.track_token;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_complaint_track_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_complaint_track_token(uuid) TO authenticated;

-- ── 2) ผู้ถือลิงก์เปิดดู ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_complaint_by_track_token(_token text, _municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_c          public.complaints%ROWTYPE;
  v_staff      boolean;
  v_owner      boolean;
  v_adhoc      boolean;
  v_shown_done boolean;
  v_actionable boolean;
  v_label      text;
  v_timeline   jsonb;
  v_rated      boolean;
  v_reopened   int;
  v_can_rate   boolean;
  v_can_reopen boolean;
  v_days_left  int := 0;
BEGIN
  IF NOT public.rpc_rate_limit_hit('complaint_track_get', 30, interval '5 minutes') THEN
    RAISE EXCEPTION 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  IF _token IS NULL OR _token !~ '^[0-9a-f]{32}$' OR _municipality_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_c
  FROM public.complaints
  WHERE track_token = _token AND municipality_id = _municipality_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_staff := public.complaint_track_caller_is_staff();
  v_owner := v_uid IS NOT NULL AND v_c.user_id = v_uid;
  v_adhoc := public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category);
  -- 'done' = ขั้นเก่า "รอแอดมินปิด" แสดงเป็นดำเนินการแล้วเหมือนหน้าคำร้องของฉัน แต่ให้คะแนน/แจ้งกลับยังไม่ได้ (ตรง rate_complaint)
  v_shown_done := v_c.status IN ('closed', 'completed', 'done');
  v_actionable := v_c.status IN ('closed', 'completed') AND NOT v_adhoc;

  SELECT cc.label INTO v_label
  FROM public.complaint_categories cc
  WHERE cc.municipality_id = v_c.municipality_id
    AND (cc.id = v_c.category_id OR cc.value = v_c.category)
  ORDER BY (cc.id = v_c.category_id) DESC NULLS LAST, cc.is_active DESC, cc.sort_order
  LIMIT 1;

  -- ส่งเฉพาะสถานะ+เวลา ไม่ส่ง note/actor_name (อาจมีชื่อเจ้าหน้าที่ เหตุผลที่ผู้แจ้งพิมพ์ หรือหมายเหตุภายใน)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', t.status, 'at', t.created_at) ORDER BY t.created_at), '[]'::jsonb)
  INTO v_timeline
  FROM (
    SELECT status, created_at
    FROM public.complaint_timeline
    WHERE complaint_id = v_c.id
    ORDER BY created_at DESC
    LIMIT 50
  ) t;

  -- ช่องคะแนนเดียวกับ rate_complaint(): เจ้าของที่ล็อกอิน = verified, นอกนั้น = unverified
  v_rated := EXISTS (
    SELECT 1 FROM public.satisfaction_ratings sr
    WHERE sr.complaint_id = v_c.id AND sr.is_verified = v_owner
  ) OR (v_owner AND v_c.rating IS NOT NULL);

  v_reopened := COALESCE((v_c.extra_data ->> 'reopen_count')::int, 0);
  v_can_rate := v_actionable AND NOT v_staff AND NOT v_rated;
  v_can_reopen := v_actionable AND NOT v_staff
                  AND v_c.closed_at IS NOT NULL
                  AND v_reopened < 1
                  AND v_c.closed_at >= now() - interval '7 days';
  IF v_can_reopen THEN
    v_days_left := GREATEST(1, ceil(extract(epoch FROM (v_c.closed_at + interval '7 days' - now())) / 86400.0)::int);
  END IF;

  RETURN jsonb_build_object(
    'found',            true,
    'ref_no',           v_c.ref_no,
    'category',         v_c.category,
    'category_label',   COALESCE(v_label, v_c.category),
    'village',          v_c.village,
    'status',           v_c.status,
    'created_at',       v_c.created_at,
    'due_date',         v_c.due_date,
    'closed_at',        v_c.closed_at,
    'is_adhoc',         v_adhoc,
    'result_note',      CASE WHEN v_shown_done THEN v_c.technician_note END,
    'reject_reason',    CASE WHEN v_c.status = 'rejected' THEN v_c.rejection_reason END,
    'timeline',         v_timeline,
    'rated',            v_rated,
    'can_rate',         v_can_rate,
    'can_reopen',       v_can_reopen,
    'reopen_days_left', v_days_left,
    'reopened',         v_reopened >= 1,
    'viewer',           CASE WHEN v_staff THEN 'staff' WHEN v_owner THEN 'owner' ELSE 'link' END,
    'server_now',       now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_complaint_by_track_token(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_complaint_by_track_token(text, uuid) TO anon, authenticated;

-- ── 3) ผู้ถือลิงก์ให้คะแนน ───────────────────────────────────────────────────────────────────
-- คืน {ok, code?, verified?} แบบเดียวกับ rate_complaint() — หน้าเว็บแยกแยะได้ว่าควรให้ลองใหม่หรือปิดหน้าต่าง
CREATE OR REPLACE FUNCTION public.rate_complaint_by_track_token(
  _token           text,
  _municipality_id uuid,
  p_rating         int,
  p_comment        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_c        public.complaints%ROWTYPE;
  v_comment  text;
  v_inserted uuid;
BEGIN
  IF NOT public.rpc_rate_limit_hit('complaint_track_act', 20, interval '5 minutes') THEN
    RAISE EXCEPTION 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_rating');
  END IF;

  IF _token IS NULL OR _token !~ '^[0-9a-f]{32}$' OR _municipality_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT * INTO v_c
  FROM public.complaints
  WHERE track_token = _token AND municipality_id = _municipality_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF public.complaint_track_caller_is_staff() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'staff_cannot_rate');
  END IF;

  IF v_c.status NOT IN ('closed', 'completed')
     OR public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_closed');
  END IF;

  -- เจ้าของเรื่องที่ล็อกอินอยู่ = verified ตามเดิม ใช้ฟังก์ชันเดิมทั้งตัวเพื่อไม่ให้กติกาเพี้ยนเป็นสองชุด
  IF v_uid IS NOT NULL AND v_c.user_id = v_uid THEN
    RETURN public.rate_complaint(v_c.id, p_rating, p_comment);
  END IF;

  v_comment := left(nullif(btrim(coalesce(p_comment, '')), ''), 500);

  INSERT INTO public.satisfaction_ratings
    (municipality_id, rating, comment, complaint_id, is_verified, created_by, via_link)
  VALUES
    (v_c.municipality_id, p_rating::smallint, v_comment, v_c.id, false, v_uid, true)
  ON CONFLICT (complaint_id, is_verified) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_rated');
  END IF;

  RETURN jsonb_build_object('ok', true, 'verified', false);
END;
$$;

REVOKE ALL ON FUNCTION public.rate_complaint_by_track_token(text, uuid, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_complaint_by_track_token(text, uuid, int, text) TO anon, authenticated;

-- ── 4) ผู้ถือลิงก์แจ้งว่ายังไม่เรียบร้อย ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_complaint_by_track_token(
  _token           text,
  _municipality_id uuid,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_c      public.complaints%ROWTYPE;
  v_count  int;
  v_keep   boolean;
  v_status text;
BEGIN
  IF NOT public.rpc_rate_limit_hit('complaint_track_act', 20, interval '5 minutes') THEN
    RAISE EXCEPTION 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reason');
  END IF;

  IF _token IS NULL OR _token !~ '^[0-9a-f]{32}$' OR _municipality_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT * INTO v_c
  FROM public.complaints
  WHERE track_token = _token AND municipality_id = _municipality_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF public.complaint_track_caller_is_staff() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'staff_cannot_reopen');
  END IF;

  IF v_c.status NOT IN ('closed', 'completed') OR v_c.closed_at IS NULL
     OR public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_finished');
  END IF;

  IF v_c.closed_at < now() - interval '7 days' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  v_count := COALESCE((v_c.extra_data ->> 'reopen_count')::int, 0);
  IF v_count >= 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_reopened');
  END IF;

  -- เหมือน reopen_complaint(): ผู้รับผิดชอบเดิมยังอยู่ใน อปท. เดียวกัน → กลับไปรับเรื่องต่อ ไม่งั้นกลับคิวแอดมิน
  v_keep := v_c.assigned_to IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_c.assigned_to AND p.municipality_id = v_c.municipality_id
  );
  v_status := CASE WHEN v_keep THEN 'received' ELSE 'pending' END;

  PERFORM set_config('app.complaint_workflow', '1', true);
  UPDATE public.complaints
  SET status             = v_status,
      assigned_to        = CASE WHEN v_keep THEN assigned_to ELSE NULL END,
      closed_at          = NULL,
      resolved_latitude  = NULL,
      resolved_longitude = NULL,
      resolved_by        = NULL,
      extra_data         = COALESCE(extra_data, '{}'::jsonb) || jsonb_build_object(
                             'reopened_at', to_jsonb(now()),
                             'reopen_reason', to_jsonb(v_reason),
                             'reopen_count', v_count + 1
                           )
  WHERE id = v_c.id;
  PERFORM set_config('app.complaint_workflow', '', true);

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (v_c.id, v_status, 'ผู้ร้องแจ้งว่ายังไม่เรียบร้อย (ผ่านลิงก์ติดตาม): ' || v_reason, 'ผู้ร้อง (ผ่านลิงก์)');

  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_complaint_by_track_token(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_complaint_by_track_token(text, uuid, text) TO anon, authenticated;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select has_function_privilege('anon', 'public.get_complaint_track_token(uuid)', 'execute');                       → false
--   select has_function_privilege('anon', 'public.get_complaint_by_track_token(text,uuid)', 'execute');               → true
--   select has_function_privilege('anon', 'public.complaint_track_caller_is_staff()', 'execute');                     → false
--   select public.get_complaint_by_track_token('ไม่ใช่โทเคน', '00000000-0000-0000-0000-000000000000');                → {"found": false}
