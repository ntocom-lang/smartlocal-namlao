-- ภาพข่าวประชาสัมพันธ์คำร้อง (PR 2) — ไฟล์ 2/2: ฟังก์ชัน
--
--   complaint_news_branding(m)                      ชื่อ/ตำแหน่ง/รูปนายกบนภาพข่าว — เจ้าหน้าที่ทุก role ของ อปท. เดียวกัน
--   set_complaint_news_executive_photo(m, url)      ตั้ง/ลบรูปนายก — admin ของ อปท. นั้น หรือ superadmin (ลง audit_logs)
--   exec_complaint_news_items(m)                    ห้องผู้บริหาร: เรื่องที่ทำภาพข่าวได้ — ด่าน exec_assert_viewer
--   exec_complaint_news_detail(m, id)               ห้องผู้บริหาร: ข้อมูลเท่าที่ภาพข่าวใช้ — ด่าน exec_assert_viewer
--   (ภายใน) complaint_news_current_mayor(m), exec_complaint_news_base(m)
--
-- "ทำภาพข่าวได้" ตัดสินที่ exec_complaint_news_base ที่เดียว (รายการกับรายละเอียดใช้ตัวเดียวกัน ไม่มีทางกว้างกว่ากัน):
--   ดำเนินการแล้ว · มีรูปหลังดำเนินการ · เสร็จภายใน 90 วัน · ปิดตายเมื่อไม่แน่ใจเรื่องหมวด:
--   ต้องเจอแถวหมวด และ requires_manual_intake / is_adhoc เป็น false จริง · ตัด odor และ corruption ตายตัว
--   (requires_manual_intake เป็นธงที่แอดมินปิดเองได้ — ภาพข่าวเป็นการเผยแพร่สาธารณะ จึงไม่พึ่งธงนี้อย่างเดียว)
-- วันที่เสร็จ: สูตรเดียวกับ exec_summary_complaints (20261115100100) — closed_at ของเรื่องเก่าก่อน 2569-09-15
--   คือเวลารับเรื่อง เชื่อได้เฉพาะเมื่อ resolved_by มีค่า ไม่งั้นใช้ timeline done/closed/completed แรกสุด
--
-- PDPA: exec_* ไม่คืนชื่อ เบอร์ ที่อยู่ พิกัด รายละเอียดที่ผู้แจ้งเขียน หรือรูปที่ผู้แจ้งแนบ (attachments)
--   หมู่บ้าน: exec_village_label (ชื่อบ้านในทะเบียน locations หรือ "หมู่ N") สำรองด้วย regex "หมู่ N" — ไม่คืนข้อความอิสระ
--   note (บันทึกผลที่เจ้าหน้าที่เขียน) ปิดเลขโทรศัพท์เป็น [เบอร์โทร] และตัดที่ 500 ตัวอักษร — หน้าจอเตือนให้ตรวจก่อนเผยแพร่
--
-- ย้อนกลับ:
--   DROP FUNCTION public.exec_complaint_news_detail(uuid, uuid);
--   DROP FUNCTION public.exec_complaint_news_items(uuid);
--   DROP FUNCTION public.exec_complaint_news_base(uuid);
--   DROP FUNCTION public.set_complaint_news_executive_photo(uuid, text);
--   DROP FUNCTION public.complaint_news_branding(uuid);
--   DROP FUNCTION public.complaint_news_current_mayor(uuid);

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL
     OR to_regprocedure('public.exec_complaint_dept(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.exec_village_label(uuid,text)') IS NULL
     OR to_regprocedure('public.executive_overview(uuid,date,date,text[])') IS NULL THEN
    RAISE EXCEPTION 'complaint_news: ต้องมีฟังก์ชันห้องผู้บริหาร E2/E3 ก่อน (exec_assert_viewer/exec_complaint_dept/exec_village_label)';
  END IF;
  IF to_regclass('public.municipality_pr_branding') IS NULL THEN
    RAISE EXCEPTION 'complaint_news: รันไฟล์ 20261119100000 ก่อน';
  END IF;
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    -- ตารางของไฟล์ 1 — CREATE TABLE IF NOT EXISTS ข้ามเงียบถ้าเคยมีรุ่นที่คอลัมน์ต่างออกไป (plpgsql ไม่ตรวจตอนสร้าง)
    ('municipality_pr_branding', 'executive_photo_file_id'), ('municipality_pr_branding', 'photo_identity'),
    ('municipality_pr_branding', 'updated_by'), ('municipality_pr_branding', 'updated_at'),
    ('complaints', 'ref_no'), ('complaints', 'village'), ('complaints', 'work_photos'), ('complaints', 'technician_note'),
    ('complaints', 'closed_at'), ('complaints', 'resolved_by'), ('complaints', 'due_date'), ('complaints', 'created_at'),
    ('complaints', 'department_id'), ('complaints', 'department'), ('complaints', 'category'), ('complaints', 'status'),
    ('complaint_categories', 'requires_manual_intake'), ('complaint_categories', 'is_adhoc'),
    ('complaint_categories', 'label'), ('complaint_categories', 'value'),
    ('departments', 'short_name'), ('departments', 'name'),
    ('complaint_timeline', 'note'), ('complaint_timeline', 'status'), ('complaint_timeline', 'created_at'),
    ('document_signatories', 'signatory_role'), ('document_signatories', 'document_type'),
    ('document_signatories', 'department_id'), ('document_signatories', 'profile_id'),
    ('document_signatories', 'manual_name'), ('document_signatories', 'title_override'),
    ('document_signatories', 'effective_from'), ('document_signatories', 'effective_to'),
    ('document_signatories', 'is_active'), ('document_signatories', 'created_at'),
    ('profiles', 'full_name'), ('profiles', 'job_title'), ('profiles', 'position_id'), ('profiles', 'role'),
    ('positions', 'name'),
    ('drive_files', 'id'), ('drive_files', 'municipality_id'), ('drive_files', 'is_public'), ('drive_files', 'content_type'),
    ('audit_logs', 'municipality_id'), ('audit_logs', 'actor_id'), ('audit_logs', 'actor_name'), ('audit_logs', 'actor_role'),
    ('audit_logs', 'action'), ('audit_logs', 'resource_type'), ('audit_logs', 'resource_id'),
    ('audit_logs', 'resource_label'), ('audit_logs', 'metadata')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'complaint_news: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

-- ── (ภายใน) ผู้ลงนามช่องนายกที่มีผลวันนี้ ─────────────────────────────────────────────
-- ชื่อ/ตำแหน่งไล่ลำดับเดียวกับ prepare_complaint_print (20261007120000): manual_name → full_name ·
-- title_override → job_title → positions.name · กรอง document_type/department_id/อปท. ของโปรไฟล์แบบเดียวกับใบพิมพ์
-- identity = 'p:<profile_id>' หรือ 'm:<ชื่อที่พิมพ์ ตัดช่องว่าง>' — ใช้ผูกรูปกับตัวคน
-- ไม่เป็น SECURITY DEFINER: เรียกจากฟังก์ชัน DEFINER ในไฟล์นี้เท่านั้น (รันในนามเจ้าของ) · ไม่ให้ใครเรียกตรง
CREATE OR REPLACE FUNCTION public.complaint_news_current_mayor(_municipality_id uuid)
RETURNS TABLE (signatory_id uuid, identity text, full_name text, title text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT s.id,
         CASE WHEN s.profile_id IS NOT NULL THEN 'p:' || s.profile_id::text
              ELSE 'm:' || regexp_replace(s.manual_name, '[[:space:]]', '', 'g') END,
         COALESCE(NULLIF(btrim(s.manual_name), ''), NULLIF(btrim(p.full_name), '')),
         COALESCE(NULLIF(btrim(s.title_override), ''), NULLIF(btrim(p.job_title), ''), pos.name)
  FROM public.document_signatories AS s
  LEFT JOIN public.profiles AS p ON p.id = s.profile_id
  LEFT JOIN public.positions AS pos ON pos.id = p.position_id
  WHERE s.municipality_id = _municipality_id
    AND s.document_type = 'complaint'
    AND s.signatory_role = 'mayor'
    AND s.department_id IS NULL
    AND s.is_active
    AND (p.id IS NULL OR p.municipality_id = s.municipality_id)
    AND (s.profile_id IS NOT NULL OR NULLIF(btrim(s.manual_name), '') IS NOT NULL)
    AND s.effective_from <= (now() AT TIME ZONE 'Asia/Bangkok')::date
    AND (s.effective_to IS NULL OR s.effective_to >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
  ORDER BY s.effective_from DESC, s.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.complaint_news_current_mayor(uuid) FROM PUBLIC, anon, authenticated;

-- ── ชื่อ/ตำแหน่ง/รูปนายกบนภาพข่าว ─────────────────────────────────────────────────
-- คืน { mayor_name, mayor_title, photo_file_id } — ไม่มีผู้ลงนามช่องนายก = ทุกช่อง null (ภาพข่าวไม่มีบล็อกนายก)
-- photo_file_id คืนเฉพาะเมื่อรูปเป็นของผู้ลงนามช่องนายกคนปัจจุบัน · หน้าเว็บประกอบ URL drive-file เอง
CREATE OR REPLACE FUNCTION public.complaint_news_branding(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role  text;
  v_muni  uuid;
  v_mayor record;
  v_file  text;
BEGIN
  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles AS p WHERE p.id = auth.uid();

  -- ชุด role เดียวกับ STAFF_PORTAL_ROLES (src/lib/portalAccess.js) · ปิดตายเมื่อไม่แน่ใจ (IS NOT TRUE: NULL = ไม่ผ่าน)
  IF (v_role = 'superadmin'
      OR (v_role IN ('staff', 'officer', 'admin', 'viewer', 'council', 'technician')
          AND v_muni = _municipality_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mayor FROM public.complaint_news_current_mayor(_municipality_id);
  IF v_mayor.signatory_id IS NULL THEN
    RETURN jsonb_build_object('mayor_name', NULL, 'mayor_title', NULL, 'photo_file_id', NULL);
  END IF;

  SELECT b.executive_photo_file_id INTO v_file
  FROM public.municipality_pr_branding AS b
  WHERE b.municipality_id = _municipality_id
    AND b.photo_identity = v_mayor.identity;

  RETURN jsonb_build_object(
    'mayor_name', v_mayor.full_name,
    'mayor_title', v_mayor.title,
    'photo_file_id', v_file);
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_news_branding(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complaint_news_branding(uuid) TO authenticated;

-- ── ตั้ง/ลบรูปนายก ───────────────────────────────────────────────────────────────
-- _photo_url = null/ว่าง → ลบรูป · ไม่งั้นต้องเป็น URL ของ drive-file (?id=<file id>) ที่ drive_files บันทึกว่า
-- เป็นรูปสาธารณะของ อปท. นี้ · รูปผูกกับผู้ลงนามช่องนายกคนปัจจุบันเสมอ (ไม่มีผู้ลงนาม = ตั้งรูปไม่ได้)
-- ด่านเดียวกับ update_municipality_logo (admin ของ อปท. นั้น หรือ superadmin) · ลง audit_logs ทุกครั้ง
-- ⚠️ ลบรูปแล้วไฟล์บน Drive ยังอยู่ (เปิดด้วยลิงก์ได้) — ระดับเดียวกับโลโก้เก่า
CREATE OR REPLACE FUNCTION public.set_complaint_news_executive_photo(_municipality_id uuid, _photo_url text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_muni  uuid;
  v_name  text;
  v_url   text := NULLIF(btrim(COALESCE(_photo_url, '')), '');
  v_file  text;
  v_mayor record;
  v_sig   uuid;   -- ผู้ลงนามที่ผูกรูป (ลบรูป = null) — แยกจาก record เพราะ record ที่ไม่เคย SELECT INTO อ้างฟิลด์ไม่ได้
  v_old   text;   -- file id ที่ถูกลบ (ทางลบรูป) — ลง audit_logs
BEGIN
  SELECT p.role, p.municipality_id, p.full_name INTO v_role, v_muni, v_name
  FROM public.profiles AS p WHERE p.id = v_uid;

  -- ปิดตายเมื่อไม่แน่ใจ (IS NOT TRUE: role/สังกัด/_municipality_id เป็น NULL = ไม่ผ่าน)
  IF (v_role = 'superadmin'
      OR (v_role = 'admin' AND v_muni = _municipality_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.municipalities AS m WHERE m.id = _municipality_id) THEN
    RAISE EXCEPTION 'ไม่พบหน่วยงาน' USING ERRCODE = '22023';
  END IF;

  IF v_url IS NULL THEN
    -- จดว่าลบรูปไหน (ค่าที่ RETURN ออกไปยังเป็น null)
    DELETE FROM public.municipality_pr_branding AS b WHERE b.municipality_id = _municipality_id
    RETURNING b.executive_photo_file_id INTO v_old;
  ELSE
    v_file := substring(v_url FROM '/functions/v1/drive-file\?id=([A-Za-z0-9_-]{10,200})$');
    IF length(v_url) > 600 OR v_file IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.drive_files AS df
      WHERE df.id = v_file
        AND df.municipality_id = _municipality_id
        AND df.is_public
        AND df.content_type IN ('image/jpeg', 'image/png', 'image/webp')   -- ไม่รับ SVG (docs/ai/NOTES.md)
    ) THEN
      RAISE EXCEPTION 'ที่อยู่รูปไม่ถูกต้อง — อัปโหลดรูปผ่านหน้าตั้งค่าเท่านั้น' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_mayor FROM public.complaint_news_current_mayor(_municipality_id);
    IF v_mayor.signatory_id IS NULL THEN
      RAISE EXCEPTION 'ยังไม่ได้ตั้งผู้ลงนามช่องนายก (เมนู "การลงนามเอกสาร") — ตั้งก่อนแล้วค่อยอัปโหลดรูป' USING ERRCODE = '22023';
    END IF;
    v_sig := v_mayor.signatory_id;

    INSERT INTO public.municipality_pr_branding AS b
      (municipality_id, executive_photo_file_id, photo_identity, updated_by, updated_at)
    VALUES (_municipality_id, v_file, v_mayor.identity, v_uid, now())
    ON CONFLICT (municipality_id) DO UPDATE
      SET executive_photo_file_id = EXCLUDED.executive_photo_file_id,
          photo_identity          = EXCLUDED.photo_identity,
          updated_by              = EXCLUDED.updated_by,
          updated_at              = EXCLUDED.updated_at;
  END IF;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    _municipality_id, v_uid, v_name, v_role,
    CASE WHEN v_url IS NULL THEN 'clear_complaint_news_executive_photo' ELSE 'set_complaint_news_executive_photo' END,
    'municipality', _municipality_id::text, 'รูปนายกบนภาพข่าวประชาสัมพันธ์',
    jsonb_build_object('file_id', v_file, 'removed_file_id', v_old, 'signatory_id', v_sig)
  );

  RETURN jsonb_build_object('photo_file_id', v_file);
END;
$$;

REVOKE ALL ON FUNCTION public.set_complaint_news_executive_photo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_complaint_news_executive_photo(uuid, text) TO authenticated;

-- ── (ภายใน) เรื่องที่ทำภาพข่าวได้ — ตัดสินที่เดียว ─────────────────────────────────────
-- ไม่เป็น SECURITY DEFINER: เรียกจาก exec_* (DEFINER) เท่านั้น · ไม่ให้ใครเรียกตรง
CREATE OR REPLACE FUNCTION public.exec_complaint_news_base(_municipality_id uuid)
RETURNS TABLE (complaint_id uuid, completed_at timestamptz, photos int)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT x.id, x.completed_at, x.photos
  FROM (
    SELECT c.id,
           CASE
             WHEN c.resolved_by IS NOT NULL THEN c.closed_at
             ELSE LEAST(c.closed_at,
                        (SELECT min(t.created_at) FROM public.complaint_timeline AS t
                          WHERE t.complaint_id = c.id AND t.status IN ('done', 'closed', 'completed')))
           END AS completed_at,
           -- ค่าที่ไม่ใช่ array (null/scalar) นับเป็น 0 รูป — แถวเดียวผิดรูปต้องไม่ทำให้ทั้งรายการล้ม
           CASE WHEN jsonb_typeof(to_jsonb(c.work_photos)) = 'array'
                THEN jsonb_array_length(to_jsonb(c.work_photos)) ELSE 0 END AS photos
    FROM public.complaints AS c
    JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
    WHERE c.municipality_id = _municipality_id
      AND c.status IN ('closed', 'done', 'completed')
      AND c.category NOT IN ('odor', 'corruption')
      AND cat.requires_manual_intake IS FALSE
      AND cat.is_adhoc IS FALSE
      -- ตัดเรื่องเก่าก่อนไล่ timeline (completed_at ≤ closed_at เสมอ จึงไม่ตัดเรื่องที่ควรอยู่ในรายการ)
      AND (c.closed_at IS NULL OR c.closed_at >= now() - interval '91 days')
  ) AS x
  WHERE x.photos > 0
    AND x.completed_at IS NOT NULL
    AND (x.completed_at AT TIME ZONE 'Asia/Bangkok')::date > (now() AT TIME ZONE 'Asia/Bangkok')::date - 90;
$$;

REVOKE ALL ON FUNCTION public.exec_complaint_news_base(uuid) FROM PUBLIC, anon, authenticated;

-- ── ห้องผู้บริหาร: เรื่องที่ทำภาพข่าวได้ ─────────────────────────────────────────────
-- คืน { as_of, days, limit, total, truncated,
--        items: [{id, ref, cat_label, dept, closed, photos}] } — เรียงเสร็จล่าสุดก่อน สูงสุด 100
CREATE OR REPLACE FUNCTION public.exec_complaint_news_items(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_limit int  := 100;
  v_out   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  WITH usable AS (
    SELECT b.complaint_id AS id, b.completed_at, b.photos,
           COALESCE(NULLIF(btrim(c.ref_no), ''), upper(left(c.id::text, 8))) AS ref,
           cat.label AS cat_label,
           public.exec_complaint_dept(c.municipality_id, c.department_id, c.department) AS dept_id
    FROM public.exec_complaint_news_base(_municipality_id) AS b
    JOIN public.complaints AS c ON c.id = b.complaint_id
    JOIN public.complaint_categories AS cat
      ON cat.municipality_id = c.municipality_id AND cat.value = c.category
  ), shown AS (
    SELECT * FROM usable ORDER BY completed_at DESC, ref LIMIT v_limit
  ), items AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', s.id, 'ref', s.ref, 'cat_label', s.cat_label,
             'dept', COALESCE(NULLIF(btrim(dp.short_name), ''), dp.name),
             'closed', (s.completed_at AT TIME ZONE 'Asia/Bangkok')::date,
             'photos', s.photos
           ) ORDER BY s.completed_at DESC, s.ref), '[]'::jsonb) AS j
    FROM shown AS s
    LEFT JOIN public.departments AS dp ON dp.id = s.dept_id AND dp.municipality_id = _municipality_id
  ), tot AS (
    SELECT count(*)::int AS n FROM usable
  )
  SELECT jsonb_build_object(
           'as_of', v_today, 'days', 90, 'limit', v_limit,
           'total', tot.n, 'truncated', tot.n > v_limit,
           'items', items.j)
    INTO v_out
  FROM tot, items;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_complaint_news_items(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_complaint_news_items(uuid) TO authenticated;

-- ── ห้องผู้บริหาร: ข้อมูลเท่าที่ภาพข่าวใช้ ─────────────────────────────────────────────
-- คืน { id, ref, category, cat_label, village, dept, created_at, closed_at, due_date, work_photos, note }
-- เรื่องที่ไม่อยู่ใน exec_complaint_news_base (ทุกเหตุผล รวมคนละ อปท.) = 42501 ข้อความเดียวกัน ไม่บอกว่ามีเรื่องอยู่จริงไหม
CREATE OR REPLACE FUNCTION public.exec_complaint_news_detail(_municipality_id uuid, _complaint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
  -- "หมู่ 3" / "หมู่ที่ 3" / "หมู่ ที่ 3" / "ม.3" (ไม่จับ "กม.12" — lookbehind ตัดพยัญชนะนำหน้า ม.) · ไม่จับ "หมู่ 123"
  v_rx  text := '(?:หมู่[[:space:]]*(?:ที่)?|(?<![ก-ฮ])ม\.)[[:space:]]*([0-9๐-๙]{1,2})(?![0-9๐-๙])';
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  SELECT jsonb_build_object(
           'id', c.id,
           'ref', COALESCE(NULLIF(btrim(c.ref_no), ''), upper(left(c.id::text, 8))),
           'category', c.category,
           'cat_label', cat.label,
           'village', COALESCE(
                        NULLIF(public.exec_village_label(c.municipality_id, c.village), ''),
                        CASE
                          WHEN btrim(COALESCE(c.village, '')) ~ '^[0-9๐-๙]{1,2}$'
                            THEN 'หมู่ ' || translate(btrim(c.village), '๐๑๒๓๔๕๖๗๘๙', '0123456789')::int::text
                          WHEN (regexp_match(COALESCE(c.village, ''), v_rx))[1] IS NOT NULL
                            THEN 'หมู่ ' || translate((regexp_match(c.village, v_rx))[1], '๐๑๒๓๔๕๖๗๘๙', '0123456789')::int::text
                        END),
           'dept', COALESCE(NULLIF(btrim(dp.short_name), ''), dp.name),
           'created_at', c.created_at,
           'closed_at', b.completed_at,
           'due_date', c.due_date,
           'work_photos', to_jsonb(c.work_photos),
           -- ข้อความที่เจ้าหน้าที่เขียน: ปิดเลขโทรศัพท์ + ตัดความยาว ก่อนออกจากฐานข้อมูล
           'note', left(regexp_replace(
                          COALESCE(NULLIF(btrim(tl.note), ''), NULLIF(btrim(c.technician_note), ''), ''),
                          '0[0-9]([ -]?[0-9]){7,8}', '[เบอร์โทร]', 'g'), 500))
    INTO v_out
  FROM public.exec_complaint_news_base(_municipality_id) AS b
  JOIN public.complaints AS c ON c.id = b.complaint_id
  JOIN public.complaint_categories AS cat
    ON cat.municipality_id = c.municipality_id AND cat.value = c.category
  LEFT JOIN public.departments AS dp
    ON dp.id = public.exec_complaint_dept(c.municipality_id, c.department_id, c.department)
   AND dp.municipality_id = _municipality_id
  LEFT JOIN LATERAL (
    SELECT t.note
    FROM public.complaint_timeline AS t
    WHERE t.complaint_id = c.id AND t.status = 'closed'
    ORDER BY t.created_at DESC
    LIMIT 1
  ) AS tl ON true
  WHERE b.complaint_id = _complaint_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'ไม่พบเรื่องหรือไม่มีสิทธิ์' USING ERRCODE = '42501';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_complaint_news_detail(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_complaint_news_detail(uuid, uuid) TO authenticated;

-- ── ด่านท้ายไฟล์ (ล้ม = ย้อนกลับทั้งไฟล์) ──────────────────────────────────────────────
-- 1) เจ้าของต้องเดียวกับ executive_overview — ฟังก์ชัน DEFINER รันในนามเจ้าของ ถ้า apply คนละ role (CLI กับ MCP)
--    จะเรียก exec_assert_viewer / exec_complaint_dept / exec_village_label ไม่ได้ (ถอน PUBLIC แล้ว) ทุก RPC ได้ 42501
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
    AND p.proname IN ('complaint_news_current_mayor', 'complaint_news_branding', 'set_complaint_news_executive_photo',
                      'exec_complaint_news_base', 'exec_complaint_news_items', 'exec_complaint_news_detail')
    AND p.proowner <> (SELECT o.proowner FROM pg_proc AS o
                       WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'complaint_news_functions: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;

  SELECT string_agg(x.fn || ':' || x.rol, ', ')
    INTO v_bad
  FROM (VALUES
    ('public.complaint_news_current_mayor(uuid)',             'anon',          false),
    ('public.complaint_news_current_mayor(uuid)',             'authenticated', false),
    ('public.exec_complaint_news_base(uuid)',                 'anon',          false),
    ('public.exec_complaint_news_base(uuid)',                 'authenticated', false),
    ('public.complaint_news_branding(uuid)',                  'anon',          false),
    ('public.complaint_news_branding(uuid)',                  'authenticated', true),
    ('public.set_complaint_news_executive_photo(uuid,text)',  'anon',          false),
    ('public.set_complaint_news_executive_photo(uuid,text)',  'authenticated', true),
    ('public.exec_complaint_news_items(uuid)',                'anon',          false),
    ('public.exec_complaint_news_items(uuid)',                'authenticated', true),
    ('public.exec_complaint_news_detail(uuid,uuid)',          'anon',          false),
    ('public.exec_complaint_news_detail(uuid,uuid)',          'authenticated', true)
  ) AS x(fn, rol, want)
  WHERE has_function_privilege(x.rol, x.fn, 'EXECUTE') IS DISTINCT FROM x.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'complaint_news_functions: สิทธิ์ EXECUTE ไม่ตรงแผน: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
