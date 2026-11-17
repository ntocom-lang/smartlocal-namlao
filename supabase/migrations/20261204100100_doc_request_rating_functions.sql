-- 20261204100100_doc_request_rating_functions.sql
--
-- [เฟสฟังก์ชัน 2/2] ประเมินความพึงพอใจรายเรื่องของคำขอ E-Service — ต้อง apply หลัง 20261204100000 (คอลัมน์)
-- แผนเทียบคู่แข่ง ข้อ 1.2 · เจ้าของระบบอนุมัติ 2569-11-17 "ตามแนะนำ" ทั้ง 3 ข้อ:
--   (1) คำขอที่เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ ไม่ชวนประเมิน — นับแยกให้เห็นว่าประเมินไม่ได้กี่เรื่อง
--       (เจ้าหน้าที่บันทึกแทน = ผู้ให้บริการให้คะแนนตัวเอง ขัดกันแห่งผลประโยชน์)
--   (2) ใบที่ไม่อนุมัติ ชวนประเมินด้วย แต่รายงานแยกจากใบที่เสร็จ · ใบที่ผู้ยื่นยกเลิกเองไม่ชวน
--   (3) คำถามข้อเดียว 5 ระดับ + ความเห็น (ชุดเดียวกับคำร้อง)
--
-- ในไฟล์นี้
--   0) policy INSERT สาธารณะ: เพิ่มด่าน document_request_id IS NULL — ไม่งั้นใครก็ยิงคะแนนปลอมผูกคำขอได้ตรงๆ ข้าม RPC
--   1) stamp_document_request_finished_at (trigger ใหม่)          ประทับ finished_at เอง ไม่เชื่อค่าจากเบราว์เซอร์
--   2) document_request_withdrawn(uuid)        (ภายใน)           ผู้ยื่นถอนคำขอเอง? — status เป็น 'rejected' เหมือนใบไม่อนุมัติ
--   3) document_request_rating_block(uuid)     (ภายใน)           เหตุที่คำขอนี้ประเมินไม่ได้ (NULL = ประเมินได้)
--   4) rate_document_request(uuid, int, text)                     ผู้ยื่นให้คะแนน
--   5) my_document_request_ratings(uuid)                          หน้า "คำขอของฉัน": คะแนนของฉัน + ยังประเมินได้ไหม
--   6) exec_satisfaction_eservice(uuid, date, date)  (ภายใน)    ตัวเลขห้องผู้บริหาร
--   7) exec_summary_satisfaction — CREATE OR REPLACE ยกตัวเดิมจาก 20261115100100 มาทั้งตัว แก้ 3 จุด (ดูหัวข้อ 7)
--
-- ฟังก์ชัน/trigger เดิมของ document_requests ไม่แตะสักตัว (route_/protect_/stamp_creator/keep_creator/guard_cctv)
--
-- กติกาความสมบูรณ์ของข้อมูล (สตง. / ใบสมัครเลิศรัฐ)
--   - เขียนคะแนนคำขอได้ทางเดียวคือ rate_document_request() — policy INSERT ปิดทางตรง, ไม่มี UPDATE/DELETE policy ให้ใคร
--   - ให้คะแนนได้เฉพาะ "ผู้ยื่นเองที่เป็น role citizen" — ใบที่เจ้าหน้าที่/สท. กรอกแทนผูก user_id เป็นบัญชีเจ้าหน้าที่
--     (วิซาร์ดโหมดเคาน์เตอร์ใส่ session ของเจ้าหน้าที่) จึงตัดด้วย role ไม่ใช่ด้วย user_id อย่างเดียว
--     และตัดซ้ำด้วย permit_form_data.signed_by.channel = 'counter' (ค่าจากเบราว์เซอร์ — ใช้เป็นด่านเสริม ไม่ใช่ด่านหลัก)
--   - คะแนนคำขอ = is_verified true ทุกแถว (ผ่านการล็อกอินเจ้าของคำขอ) · ไม่มีช่องลิงก์/บันทึกแทน
--
-- ย้อนกลับ (ลำดับนี้):
--   1. รันส่วนที่ 7 ของ 20261115100100_exec_summary_service.sql ซ้ำ (คืน exec_summary_satisfaction ตัวเดิม)
--   2. DROP FUNCTION public.exec_satisfaction_eservice(uuid, date, date);
--      DROP FUNCTION public.my_document_request_ratings(uuid);
--      DROP FUNCTION public.rate_document_request(uuid, integer, text);
--      DROP FUNCTION public.document_request_rating_block(uuid);
--      DROP FUNCTION public.document_request_withdrawn(uuid);
--      DROP TRIGGER stamp_document_request_finished_at_trigger ON public.document_requests;
--      DROP FUNCTION public.stamp_document_request_finished_at();
--   3. policy INSERT: สร้างใหม่ด้วยเงื่อนไขของ 20261111100100 (ตัดบรรทัด document_request_id IS NULL)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec, p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('rate_document_request', 'my_document_request_ratings', 'document_request_withdrawn',
--                       'document_request_rating_block', 'exec_satisfaction_eservice', 'exec_summary_satisfaction',
--                       'stamp_document_request_finished_at')
--   ORDER BY 1;
--   → rate_document_request / my_document_request_ratings: anon=false auth=true · ที่เหลือ: anon=false auth=false · prosecdef=true ทุกแถว
--   SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
--   WHERE polname = 'anyone can insert general satisfaction';               → มี document_request_id IS NULL
--   SELECT tgname FROM pg_trigger WHERE tgname = 'stamp_document_request_finished_at_trigger';   → 1 แถว

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_missing text;
  v_md5     text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('satisfaction_ratings', 'document_request_id'), ('satisfaction_ratings', 'complaint_id'),
    ('satisfaction_ratings', 'is_verified'), ('satisfaction_ratings', 'via_link'), ('satisfaction_ratings', 'rated_by_proxy'),
    ('satisfaction_ratings', 'created_by'), ('satisfaction_ratings', 'comment'), ('satisfaction_ratings', 'created_at'),
    ('satisfaction_ratings', 'municipality_id'), ('satisfaction_ratings', 'rating'),
    ('document_requests', 'finished_at'), ('document_requests', 'status'), ('document_requests', 'user_id'),
    ('document_requests', 'municipality_id'), ('document_requests', 'document_type'), ('document_requests', 'permit_form_data'),
    ('patient_transport_requests', 'request_id'), ('patient_transport_requests', 'workflow_status'),
    ('asset_borrow_events', 'request_id'), ('asset_borrow_events', 'event_type'),
    ('profiles', 'role')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'doc_request_rating: ไม่พบคอลัมน์ % (ต้อง apply 20261204100000 ก่อน)', v_missing;
  END IF;

  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'doc_request_rating: ต้องมี exec_assert_viewer (20261115100000) ก่อน';
  END IF;

  -- NOTES.md ข้อ 5: CREATE OR REPLACE ต้องตั้งต้นจากตัวที่อยู่บนฐานจริง — ตัวบนฐานต้องตรงกับรุ่นในรีโปทุกตัวอักษร
  -- (ไม่นับ \r เพราะ apply จาก Windows ได้ CRLF) หรือเป็นรุ่นของไฟล์นี้เอง (รันซ้ำ) ไม่ตรงทั้งคู่ = หยุด ห้ามเขียนทับ
  SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_md5
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = to_regprocedure('public.exec_summary_satisfaction(uuid, date, date)');
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'doc_request_rating: ไม่พบ exec_summary_satisfaction(uuid, date, date) (ต้อง apply 20261115100100 ก่อน)';
  END IF;
  IF v_md5 NOT IN ('8331afbb8a86cead888d7ec35483d5ed', 'aa79266aace899379840386785a15738') THEN
    RAISE EXCEPTION 'Function drift: exec_summary_satisfaction บนฐาน (md5 %) ไม่ตรงกับรุ่นในรีโป — เทียบ pg_get_functiondef ก่อน ห้ามเขียนทับ', v_md5;
  END IF;

  -- ชื่อฟังก์ชันใหม่ห้ามชนของที่มีอยู่ก่อนและไม่ใช่ของไฟล์นี้ (ทุกตัวของเรามีคำว่า finished_at หรือ request_id ในตัวบท)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
             WHERE p.oid IN (to_regprocedure('public.stamp_document_request_finished_at()'),
                             to_regprocedure('public.document_request_withdrawn(uuid)'),
                             to_regprocedure('public.document_request_rating_block(uuid)'),
                             to_regprocedure('public.rate_document_request(uuid, integer, text)'),
                             to_regprocedure('public.my_document_request_ratings(uuid)'),
                             to_regprocedure('public.exec_satisfaction_eservice(uuid, date, date)'))
               AND p.prosrc NOT LIKE '%finished_at%'
               AND p.prosrc NOT LIKE '%request_id%') THEN
    RAISE EXCEPTION 'Function drift: มีฟังก์ชันชื่อซ้ำที่ไม่ใช่ของไฟล์นี้';
  END IF;
END $guard$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 0) policy INSERT สาธารณะ — เงื่อนไขเดิมของ 20261111100100 ครบทุกข้อ + document_request_id IS NULL
--    แบบประเมินรวมหน้า /satisfaction ไม่ส่งคอลัมน์นี้ ได้ NULL อยู่แล้ว ไม่กระทบ
-- ══════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "anyone can insert general satisfaction" ON public.satisfaction_ratings;
CREATE POLICY "anyone can insert general satisfaction"
  ON public.satisfaction_ratings
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    complaint_id IS NULL
    AND document_request_id IS NULL
    AND is_verified = false
    AND rated_by_proxy = false
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- ══════════════════════════════════════════════════════════════════════════════════
-- 1) ประทับเวลาปิดคำขอ
--    INSERT: สร้างมาเป็นสถานะปิดเลย (เคาน์เตอร์) = now() · อื่นๆ = NULL
--    UPDATE: สถานะเปลี่ยน → เข้า completed/rejected = now(), ออกไปสถานะอื่น = NULL
--            สถานะไม่เปลี่ยน → คงค่าเดิมเสมอ (ใครส่ง finished_at มาเองก็ไม่มีผล รวมถึง admin)
--    ไม่ RAISE เลย — เส้นทางเดิมที่ UPDATE ทั้งแถวจะได้ไม่พัง (หลักเดียวกับ keep_document_request_creator)
--    trigger ทุกเส้นทางมี RETURN NEW (NOTES.md ข้อ 5)
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.stamp_document_request_finished_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.finished_at := CASE WHEN NEW.status IN ('completed', 'rejected') THEN now() END;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.finished_at := CASE WHEN NEW.status IN ('completed', 'rejected') THEN now() END;
  ELSE
    NEW.finished_at := OLD.finished_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_document_request_finished_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_document_request_finished_at_trigger ON public.document_requests;
CREATE TRIGGER stamp_document_request_finished_at_trigger
  BEFORE INSERT OR UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_document_request_finished_at();

-- ══════════════════════════════════════════════════════════════════════════════════
-- 2) ผู้ยื่นถอนคำขอเองหรือไม่ — document_requests.status มีแค่ 4 ค่า การยกเลิกจึงลงเป็น 'rejected' เหมือนใบไม่อนุมัติ
--    ความต่างอยู่ที่ตารางลูก (ชุดเดียวกับ displayDocStatus ใน src/lib/documentTypes.js + ยืมพัสดุ)
--      รถรับ-ส่งผู้ป่วย: patient_transport_requests.workflow_status = 'cancelled' (cancel_patient_transport_request)
--      ยืมพัสดุ:        asset_borrow_events.event_type = 'cancelled' (cancel_asset_borrow_request ลงเหตุการณ์นี้)
--    ⚠️ ประเภทคำขอใหม่ที่มีปุ่ม "ยกเลิก" ของตัวเอง ต้องเพิ่มที่นี่ ไม่งั้นใบที่ถอนเองจะถูกชวนประเมินเหมือนใบไม่อนุมัติ
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.document_request_withdrawn(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.patient_transport_requests AS pt
           WHERE pt.request_id = p_request_id AND pt.workflow_status = 'cancelled'
         )
      OR EXISTS (
           SELECT 1 FROM public.asset_borrow_events AS ev
           WHERE ev.request_id = p_request_id AND ev.event_type = 'cancelled'
         );
$$;
REVOKE ALL ON FUNCTION public.document_request_withdrawn(uuid) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 3) เหตุที่คำขอนี้ "ไม่เปิดให้ประเมิน" ไม่ว่าใครเรียก (ส่วนเช็กเจ้าของอยู่ที่ผู้เรียก)
--    NULL = ประเมินได้ · not_found / not_finished / withdrawn / no_requester / counter / not_citizen
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.document_request_rating_block(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req  public.document_requests%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO v_req FROM public.document_requests AS r WHERE r.id = p_request_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_req.status IS NULL OR v_req.status NOT IN ('completed', 'rejected') THEN
    RETURN 'not_finished';
  END IF;
  IF v_req.status = 'rejected' AND public.document_request_withdrawn(v_req.id) THEN
    RETURN 'withdrawn';
  END IF;
  IF v_req.user_id IS NULL THEN
    RETURN 'no_requester';
  END IF;
  IF COALESCE(v_req.permit_form_data #>> '{signed_by,channel}', '') = 'counter' THEN
    RETURN 'counter';
  END IF;
  SELECT p.role INTO v_role FROM public.profiles AS p WHERE p.id = v_req.user_id;
  IF v_role IS DISTINCT FROM 'citizen' THEN
    RETURN 'not_citizen';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.document_request_rating_block(uuid) FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- 4) ผู้ยื่นให้คะแนน — คืน {ok, code} ไม่ RAISE ในเคสธุรกิจปกติ (แบบเดียวกับ rate_complaint ให้หน้าเว็บแยกข้อความได้)
--    ไม่มีช่วงเวลาหมดอายุ: ช่วง 30 วันเป็นแค่ช่วง "เด้งชวน" ที่หน้าเว็บ ปุ่มที่การ์ดยังกดได้เสมอ (หลักเดียวกับคำร้อง)
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rate_document_request(
  p_request_id uuid,
  p_rating     integer,
  p_comment    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_req      public.document_requests%ROWTYPE;
  v_block    text;
  v_comment  text;
  v_inserted uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_logged_in');
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_rating');
  END IF;

  SELECT * INTO v_req FROM public.document_requests AS r WHERE r.id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  -- คนล็อกอินที่ไม่ใช่ผู้ยื่น (รวมเจ้าหน้าที่ทุก role) ให้คะแนนแทนไม่ได้
  IF v_req.user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owner');
  END IF;

  v_block := public.document_request_rating_block(v_req.id);
  IF v_block IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', v_block);
  END IF;

  v_comment := left(nullif(btrim(coalesce(p_comment, '')), ''), 500);

  INSERT INTO public.satisfaction_ratings
    (municipality_id, rating, comment, document_request_id, is_verified, via_link, rated_by_proxy, created_by)
  VALUES
    (v_req.municipality_id, p_rating::smallint, v_comment, v_req.id, true, false, false, v_uid)
  ON CONFLICT (document_request_id, is_verified) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_rated');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.rate_document_request(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_document_request(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.rate_document_request(uuid, integer, text) IS
  'ผู้ยื่นคำขอ E-Service (role citizen ที่ล็อกอิน) ให้คะแนน 1-5 หลังคำขอเสร็จสิ้นหรือไม่อนุมัติ ครั้งเดียวต่อคำขอ '
  'ใบกรอกแทนที่เคาน์เตอร์ / ใบที่ผู้ยื่นถอนเอง ประเมินไม่ได้ · คืน {ok, code}';

-- ══════════════════════════════════════════════════════════════════════════════════
-- 5) หน้า "คำขอของฉัน" — ประชาชนอ่าน satisfaction_ratings ตรงไม่ได้ (RLS ให้เฉพาะเจ้าหน้าที่) จึงคืนผ่านฟังก์ชันนี้
--    เฉพาะคำขอที่ปิดแล้วของผู้เรียกเอง · ไม่คืนข้อความความเห็น (หน้าเว็บไม่ต้องใช้)
--    finished_at คืนไปให้หน้าเว็บตัดสินช่วงเด้งชวน 30 วัน · server_now กันนาฬิกาเครื่องผู้ใช้เพี้ยน
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_document_request_ratings(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_items jsonb;
BEGIN
  IF v_uid IS NULL OR p_muni IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',          x.id,
           'rating',      x.rating,
           'can_rate',    x.rating IS NULL AND x.block IS NULL,
           'finished_at', x.finished_at
         ) ORDER BY x.sort_at DESC), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT r.id, r.finished_at,
           COALESCE(r.finished_at, r.created_at) AS sort_at,
           (SELECT s.rating FROM public.satisfaction_ratings AS s
            WHERE s.document_request_id = r.id AND s.is_verified
            LIMIT 1) AS rating,
           public.document_request_rating_block(r.id) AS block
    FROM public.document_requests AS r
    WHERE r.user_id = v_uid                         -- เฉพาะคำขอของผู้เรียกเอง
      AND r.municipality_id = p_muni
      AND r.status IN ('completed', 'rejected')
    ORDER BY COALESCE(r.finished_at, r.created_at) DESC
    LIMIT 200
  ) AS x;

  RETURN jsonb_build_object('items', v_items, 'server_now', now());
END;
$$;
REVOKE ALL ON FUNCTION public.my_document_request_ratings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_document_request_ratings(uuid) TO authenticated;

COMMENT ON FUNCTION public.my_document_request_ratings(uuid) IS
  'หน้า "คำขอของฉัน": คำขอที่ปิดแล้วของผู้เรียก (สูงสุด 200) พร้อมคะแนนที่ให้ไว้ และยังประเมินได้หรือไม่ (can_rate)';

-- ══════════════════════════════════════════════════════════════════════════════════
-- 6) ตัวเลขห้องผู้บริหาร — เรียกจาก exec_summary_satisfaction เท่านั้น (ไม่ GRANT ให้ใคร) แต่ตรวจสิทธิ์ซ้ำเองอีกชั้น
--    ฐาน = คำขอที่ปิด (finished_at) ในช่วง ไม่รวมใบที่ผู้ยื่นถอนเอง · คะแนนนับจากคำขอชุดนั้น (สูตรเดียวกับคำร้อง: ตามวันที่ปิด)
--    คืนตัวเลข + รหัสประเภทคำขอเท่านั้น ไม่มีชื่อ/ความเห็น/id รายเรื่อง (PDPA)
--    submitters: citizen = ประเมินได้ · counter = กรอกแทนที่เคาน์เตอร์ · staff = บัญชีเจ้าหน้าที่/สท. ยื่นเอง
--                anonymous = ไม่มีบัญชีผู้ยื่น · unknown = หา role ไม่เจอ
-- ══════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.exec_satisfaction_eservice(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from timestamptz;
  v_to   timestamptz;
  v_out  jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  v_from := _from::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_to   := (_to + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  WITH fin AS (
    SELECT r.id, r.document_type AS t, r.status,
           CASE
             WHEN r.user_id IS NULL THEN 'anonymous'
             WHEN COALESCE(r.permit_form_data #>> '{signed_by,channel}', '') = 'counter' THEN 'counter'
             WHEN pr.role IS NULL THEN 'unknown'
             WHEN pr.role = 'citizen' THEN 'citizen'
             ELSE 'staff'
           END AS grp
    FROM public.document_requests AS r
    LEFT JOIN public.profiles AS pr ON pr.id = r.user_id
    WHERE r.municipality_id = _municipality_id
      AND r.status IN ('completed', 'rejected')
      AND r.finished_at >= v_from AND r.finished_at < v_to
      AND NOT (r.status = 'rejected' AND public.document_request_withdrawn(r.id))
  ), rated AS (
    SELECT f.id, f.t, f.status, s.rating::numeric AS rating
    FROM fin AS f
    JOIN public.satisfaction_ratings AS s
      ON s.document_request_id = f.id AND s.is_verified
  )
  SELECT jsonb_build_object(
           'finished',  (SELECT count(*) FROM fin),
           'completed', (SELECT count(*) FROM fin WHERE status = 'completed'),
           'rejected',  (SELECT count(*) FROM fin WHERE status = 'rejected'),
           'submitters', (SELECT COALESCE(jsonb_object_agg(g.grp, g.n), '{}'::jsonb)
                          FROM (SELECT f.grp, count(*)::int AS n FROM fin AS f GROUP BY f.grp) AS g),
           'rateable', (SELECT count(*) FROM fin WHERE grp = 'citizen'),
           'rated', jsonb_build_object(
             'completed', (SELECT jsonb_build_object('cnt', count(*), 'sum', COALESCE(sum(rating), 0))
                           FROM rated WHERE status = 'completed'),
             'rejected',  (SELECT jsonb_build_object('cnt', count(*), 'sum', COALESCE(sum(rating), 0))
                           FROM rated WHERE status = 'rejected')
           ),
           'low', (SELECT count(*) FROM rated WHERE rating <= 2),
           'by_type', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                't', b.t, 'finished', b.finished, 'rateable', b.rateable,
                                'cnt', COALESCE(x.cnt, 0), 'sum', COALESCE(x.sum, 0)
                              ) ORDER BY b.finished DESC, b.t), '[]'::jsonb)
                       FROM (SELECT f.t, count(*)::int AS finished,
                                    count(*) FILTER (WHERE f.grp = 'citizen')::int AS rateable
                             FROM fin AS f GROUP BY f.t) AS b
                       LEFT JOIN (SELECT r.t, count(*)::int AS cnt, sum(r.rating) AS sum
                                  FROM rated AS r GROUP BY r.t) AS x
                         ON x.t IS NOT DISTINCT FROM b.t),
           -- ปิดแล้วแต่ไม่มีเวลาปิด = ปิดก่อนมี finished_at (ไม่ย้อนเติม) — บอกให้รู้ว่ามีกี่ใบที่ไม่อยู่ในฐานนี้
           'undated', (SELECT count(*) FROM public.document_requests AS r
                       WHERE r.municipality_id = _municipality_id
                         AND r.status IN ('completed', 'rejected')
                         AND r.finished_at IS NULL)
         )
    INTO v_out;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.exec_satisfaction_eservice(uuid, date, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_satisfaction_eservice(uuid, date, date) IS
  'ห้องผู้บริหาร: ความพึงพอใจคำขอ E-Service ตามวันที่ปิดคำขอ (ไม่รวมใบที่ผู้ยื่นถอนเอง) แยกเสร็จสิ้น/ไม่อนุมัติ + ผู้ยื่นแต่ละกลุ่ม '
  'เรียกผ่าน exec_summary_satisfaction() เท่านั้น';

-- ══════════════════════════════════════════════════════════════════════════════════
-- 7) exec_summary_satisfaction — ยกจาก 20261115100100 มาทั้งตัว (md5 ตรวจที่ด่านต้นไฟล์) แก้ 3 จุด ทำเครื่องหมาย [1.2]
--    เหตุ: คะแนนคำขอมี complaint_id เป็น NULL เหมือน "ประเมินภาพรวม" ถ้าไม่แก้ จะถูกนับรวมเป็นแบบประเมินรวมเงียบๆ
--    [1.2-ก] v_gen ตัดแถวที่ผูกคำขอออก   [1.2-ข] v_low แยกป้าย 'eservice'   [1.2-ค] คืนคีย์ 'eservice' เพิ่ม
--    ส่วนคำร้อง (v_main) ไม่แตะสักบรรทัด
--    แถว verified ที่ complaint_id และ document_request_id เป็น NULL ทั้งคู่ = เรื่อง/คำขอถูก admin ลบ (FK SET NULL —
--    ตั้งใจไม่ CASCADE เพื่อไม่ให้ลบคำขอแล้วคะแนนต่ำหายไปด้วย) แบบประเมินรวมเป็น verified ไม่ได้ (policy INSERT)
--    ⇒ ไม่นับเป็นแบบประเมินรวมอีก · ผลข้างเคียงกับข้อมูลเดิม: คะแนนคำร้องที่ถูกลบไปก่อนหน้า (ถ้ามี) ออกจากยอด "ภาพรวม"
--    ซึ่งเดิมนับผิดอยู่แล้ว
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

  RETURN v_main || jsonb_build_object(
    'general', v_gen,
    'low', v_low,
    'eservice', public.exec_satisfaction_eservice(_municipality_id, _from, _to)   -- [1.2-ค]
  );
END;
$$;
REVOKE ALL ON FUNCTION public.exec_summary_satisfaction(uuid, date, date) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
