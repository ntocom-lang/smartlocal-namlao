-- 20261111100100_complaint_rate_invite_functions.sql
--
-- [เฟสฟังก์ชัน] ชวนผู้ยื่นประเมินความพึงพอใจจากหน้าแรกฝั่งเจ้าหน้าที่ — ต้อง apply หลัง 20261111100000 (rated_by_proxy)
--
-- ทำไมมี (นับจากฐานจริงน้ำเลา 2569-11-09): ปิดเรื่องแล้ว 68 ได้คะแนน 11 · ผ่านลิงก์ 0
--   สท. ยื่น 69/100 เรื่อง แต่ล็อกอินแล้วเข้าฝั่งเจ้าหน้าที่ — หน้าต่างชวนประเมินอยู่ที่ /my-complaints ฝั่งประชาชน จึงไม่เคยเห็น
--   และไม่มี สท. คนไหนสมัครรับ push ตอนปิดเรื่องจึงไปไม่ถึงใคร
--
-- ฟังก์ชันใหม่ล้วน ไม่ CREATE OR REPLACE ทับของเดิม (NOTES.md ข้อ 5) · rate_complaint() ไม่แตะ
--   my_complaints_to_rate(uuid)                     เรื่องที่ "ฉัน" ยื่นไว้ ดำเนินการแล้ว ยังไม่มีใครประเมิน (หน้าแรกเจ้าหน้าที่)
--   rate_complaint_on_behalf(uuid, int, text)       สท. ถามชาวบ้านแล้วบันทึกแทน (ชาวบ้านไม่มีมือถือ/LINE)
--
-- กติกาความสมบูรณ์ของข้อมูล (สตง. / ใบสมัครเลิศรัฐ):
--   - คะแนนของ สท. เอง ยังไปทาง rate_complaint() เดิม (verified, ลง complaints.rating)
--   - คะแนนบันทึกแทน = ช่อง unverified + rated_by_proxy=true + created_by=สท. ไม่ลง complaints.rating
--     ช่องเดียวกับลิงก์ ⇒ ชาวบ้านประเมินผ่านลิงก์แล้ว สท. บันทึกแทนซ้ำไม่ได้ (และกลับกัน)
--   - บันทึกแทนได้เฉพาะ "เจ้าของเรื่องที่เป็น สท." — เจ้าหน้าที่/admin ที่เห็นทุกเรื่องกดแทนไม่ได้ (กติกาเดียวกับ rate_complaint)
--   - หมวดเฉพาะกิจ (is_adhoc) ไม่ชวนและบันทึกแทนไม่ได้ — ตรงกับลิงก์ติดตามที่ไม่ให้ประเมินหมวดนี้
--
-- ย้อนกลับ: DROP FUNCTION public.rate_complaint_on_behalf(uuid, integer, text);
--          DROP FUNCTION public.my_complaints_to_rate(uuid);
--          policy INSERT: สร้างใหม่ด้วยเงื่อนไขเดิมของ 20260830150000 (ตัดบรรทัด rated_by_proxy = false ออก)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT has_function_privilege('anon', 'public.my_complaints_to_rate(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.my_complaints_to_rate(uuid)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.rate_complaint_on_behalf(uuid, integer, text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.rate_complaint_on_behalf(uuid, integer, text)', 'EXECUTE');
--   → false, true, false, true

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('satisfaction_ratings', 'rated_by_proxy'), ('satisfaction_ratings', 'via_link'),
    ('satisfaction_ratings', 'is_verified'), ('satisfaction_ratings', 'complaint_id'), ('satisfaction_ratings', 'created_by'),
    ('complaints', 'track_token'), ('complaints', 'closed_at'), ('complaints', 'rating'), ('complaints', 'user_id'),
    ('complaints', 'category_id'), ('complaints', 'village'), ('complaints', 'ref_no'),
    ('complaint_categories', 'label'), ('complaint_categories', 'is_adhoc')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'complaint_rate_invite: ไม่พบคอลัมน์ % (ต้อง apply 20261111100000 และ 20261020160000 ก่อน)', v_missing;
  END IF;
END $$;

-- ── 0) policy INSERT สาธารณะ: เพิ่มด่าน rated_by_proxy = false ────────────────────────────────
-- เงื่อนไขเดิม (ตรวจ live 2569-11-09) คงไว้ทุกข้อ เพิ่มข้อเดียว — แบบประเมินรวมหน้า /satisfaction ไม่ส่งคอลัมน์นี้ ได้ false จาก DEFAULT
DROP POLICY IF EXISTS "anyone can insert general satisfaction" ON public.satisfaction_ratings;
CREATE POLICY "anyone can insert general satisfaction"
  ON public.satisfaction_ratings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    complaint_id IS NULL
    AND is_verified = false
    AND rated_by_proxy = false
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- ── 1) เรื่องที่ฉันยื่นไว้ ดำเนินการแล้ว ยังไม่มีใครประเมิน ─────────────────────────────────────
-- ชื่อพารามิเตอร์ p_muni ตามแบบ useHomeRpc (src/lib/staffHomeData.js ส่ง { p_muni } ให้เอง)
-- ช่วง 30 วันตรงกับ SAT_PROMPT_WINDOW_DAYS ใน MyComplaints.jsx — เรื่องเก่ากว่านั้นถามแล้วได้คะแนนที่ไม่สะท้อนอะไร
-- เรื่องหายจากรายการเมื่อมีคะแนน "ช่องใดช่องหนึ่ง" (สท. ประเมินเอง หรือชาวบ้าน/บันทึกแทน) — ไม่ทวงซ้ำให้เป็นงานเพิ่ม
CREATE OR REPLACE FUNCTION public.my_complaints_to_rate(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_muni  uuid;
  v_items jsonb;
BEGIN
  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  -- หน้าแรกฝั่งเจ้าหน้าที่เท่านั้น (ชุดเดียวกับ STAFF_PORTAL_ROLES) — ประชาชนมีหน้าต่างชวนประเมินใน /my-complaints อยู่แล้ว
  IF v_uid IS NULL OR p_muni IS NULL OR v_role IS NULL
     OR v_role NOT IN ('superadmin', 'admin', 'officer', 'viewer', 'council', 'staff', 'technician')
     OR (v_role <> 'superadmin' AND v_muni IS DISTINCT FROM p_muni) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูรายการนี้' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',             x.id,
           'ref_no',         x.ref_no,
           'category_label', x.category_label,
           'village',        x.village,
           'closed_at',      x.closed_at,
           'track_token',    x.track_token
         ) ORDER BY x.closed_at DESC), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT c.id, c.ref_no, c.village, c.closed_at, c.track_token,
           COALESCE((
             SELECT cc.label FROM public.complaint_categories AS cc
             WHERE cc.municipality_id = c.municipality_id
               AND (cc.id = c.category_id OR cc.value = c.category)
             ORDER BY (cc.id = c.category_id) DESC NULLS LAST, cc.is_active DESC, cc.sort_order
             LIMIT 1
           ), c.category) AS category_label
    FROM public.complaints AS c
    WHERE c.user_id = v_uid                       -- เฉพาะเรื่องที่ฉันยื่นเอง ไม่มีทางเห็นเรื่องของคนอื่น
      AND c.municipality_id = p_muni
      AND c.status IN ('closed', 'completed')
      AND c.closed_at IS NOT NULL
      AND c.closed_at >= now() - interval '30 days'
      AND c.rating IS NULL
      AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
      AND NOT EXISTS (SELECT 1 FROM public.satisfaction_ratings AS sr WHERE sr.complaint_id = c.id)
    ORDER BY c.closed_at DESC
    LIMIT 20
  ) AS x;

  RETURN jsonb_build_object(
    'items',      v_items,
    -- ปุ่ม "บันทึกแทนชาวบ้าน" ขึ้นเฉพาะ สท. (rate_complaint_on_behalf ตรวจซ้ำอีกชั้น)
    'can_proxy',  v_role = 'council',
    'server_now', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_complaints_to_rate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_complaints_to_rate(uuid) TO authenticated;

COMMENT ON FUNCTION public.my_complaints_to_rate(uuid) IS
  'หน้าแรกเจ้าหน้าที่: เรื่องที่ผู้เรียกยื่นเอง ดำเนินการแล้วภายใน 30 วัน และยังไม่มีคะแนนช่องใดเลย (คืนไม่เกิน 20 เรื่อง) '
  'คืน track_token ของเรื่องตัวเองได้ เพราะ get_complaint_track_token() ให้เจ้าของอยู่แล้ว';

-- ── 2) สท. บันทึกคะแนนแทนชาวบ้าน ────────────────────────────────────────────────────────────
-- คืน {ok, code?} รูปแบบเดียวกับ rate_complaint() — code: invalid_rating / not_found / not_closed / not_rateable /
-- not_owner / not_council / expired (ปิดเกิน 30 วัน) / self_rated (สท. ประเมินเองแล้ว) /
-- already_rated (ช่องชาวบ้านมีคะแนนแล้ว — ผ่านลิงก์ บันทึกแทน หรือค้นด้วยเลขอ้างอิง)
CREATE OR REPLACE FUNCTION public.rate_complaint_on_behalf(
  p_complaint_id uuid,
  p_rating       int,
  p_comment      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_c        public.complaints%ROWTYPE;
  v_role     text;
  v_comment  text;
  v_inserted uuid;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_rating');
  END IF;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owner');
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- เช็กเจ้าของก่อนสถานะ: คนที่ไม่ใช่เจ้าของต้องไม่ได้เบาะแสว่าเรื่องนั้นปิดแล้วหรือยัง
  IF v_c.user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owner');
  END IF;

  SELECT p.role INTO v_role FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_role IS DISTINCT FROM 'council' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_council');
  END IF;

  IF v_c.status NOT IN ('closed', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_closed');
  END IF;

  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_rateable');
  END IF;

  -- กรอบเวลาเดียวกับรายการชวน (30 วัน) — ไม่งั้น สท. ยิง RPC ตรงเติมคะแนนย้อนหลังทุกเรื่องได้
  IF v_c.closed_at IS NULL OR v_c.closed_at < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  -- สท. ประเมินเองไปแล้ว = เรื่องนี้มีคะแนนแล้ว ไม่ให้คนเดียวกันได้ 2 คะแนน (ทางกลับกันผ่าน rate_complaint() ยังเปิดอยู่
  -- เพราะไม่แตะฟังก์ชันเดิม — รายงานจึงต้องถือ complaints.rating ของเรื่องที่ สท. ยื่นว่าเป็น "สท. ประเมิน")
  -- ใช้ code แยกจาก already_rated เพราะหน้าเว็บถือว่า already_rated = สำเร็จ
  IF v_c.rating IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.satisfaction_ratings AS sr WHERE sr.complaint_id = v_c.id AND sr.is_verified
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'self_rated');
  END IF;

  v_comment := left(nullif(btrim(coalesce(p_comment, '')), ''), 500);

  INSERT INTO public.satisfaction_ratings
    (municipality_id, rating, comment, complaint_id, is_verified, created_by, via_link, rated_by_proxy)
  VALUES
    (v_c.municipality_id, p_rating::smallint, v_comment, v_c.id, false, v_uid, false, true)
  ON CONFLICT (complaint_id, is_verified) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_rated');
  END IF;

  RETURN jsonb_build_object('ok', true, 'verified', false, 'proxy', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rate_complaint_on_behalf(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_complaint_on_behalf(uuid, int, text) TO authenticated;

COMMENT ON FUNCTION public.rate_complaint_on_behalf(uuid, int, text) IS
  'สท. ที่เป็นเจ้าของเรื่อง ถามชาวบ้านแล้วบันทึกคะแนนแทน — ช่อง unverified + rated_by_proxy ไม่ลง complaints.rating';

NOTIFY pgrst, 'reload schema';
