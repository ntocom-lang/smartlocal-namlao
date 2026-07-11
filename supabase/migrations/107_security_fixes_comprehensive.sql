-- ============================================================
-- 107_security_fixes_comprehensive.sql
-- แก้ security issues ที่พบจากการ scan ทั้งหมด
-- CRITICAL: approval_requests, document_requests
-- HIGH:     get_users_with_email, complaints update, events, posts, payment-slips
-- MEDIUM:   QR storage, delete_user, complaint_ref phone, timeline, satisfaction, fleet_audit
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- [C1] approval_requests — แทน "full access" ด้วย municipality-scoped policies
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access approval_requests" ON approval_requests;

-- staff อ่านได้เฉพาะ municipality ตัวเอง
CREATE POLICY "staff read approval_requests" ON approval_requests
  FOR SELECT USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'council')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- staff สร้างคำขอได้เฉพาะ municipality ตัวเอง
CREATE POLICY "staff insert approval_requests" ON approval_requests
  FOR INSERT WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'council')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- admin/officer อนุมัติ; staff แก้ได้เฉพาะ row ที่ตัวเองสร้างและยัง pending
CREATE POLICY "admin update approval_requests" ON approval_requests
  FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer')
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('staff', 'council')
      AND created_by = auth.uid()
      AND status = 'pending'
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer')
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('staff', 'council')
      AND created_by = auth.uid()
      AND status = 'pending'
      AND municipality_id = get_my_municipality_id()
    )
  );

-- admin ลบได้เฉพาะ municipality ตัวเอง
CREATE POLICY "admin delete approval_requests" ON approval_requests
  FOR DELETE USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );


-- ══════════════════════════════════════════════════════════════
-- [C2] document_requests — ปิด public SELECT, ใส่ municipality filter
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public can select document_requests"     ON document_requests;
DROP POLICY IF EXISTS "public can insert document_requests"     ON document_requests;
DROP POLICY IF EXISTS "authenticated can update document_requests" ON document_requests;

-- ประชาชน insert ได้ แต่ต้องระบุ municipality (ไม่ใช่ NULL)
CREATE POLICY "public can insert document_requests" ON document_requests
  FOR INSERT WITH CHECK (municipality_id IS NOT NULL);

-- citizen อ่านเฉพาะของตัวเอง; staff อ่านเฉพาะ municipality ตัวเอง
CREATE POLICY "read document_requests" ON document_requests
  FOR SELECT USING (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- staff/admin update ได้เฉพาะ municipality ตัวเอง
CREATE POLICY "staff update document_requests" ON document_requests
  FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff')
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff')
      AND municipality_id = get_my_municipality_id()
    )
  );


-- ══════════════════════════════════════════════════════════════
-- [H1] get_users_with_email — เพิ่ม role + municipality guard
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_users_with_email(p_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  id                uuid,
  email             text,
  full_name         text,
  role              text,
  municipality_id   uuid,
  municipality_name text,
  phone             text,
  id_card           text,
  job_title         text,
  address           text,
  avatar_url        text,
  providers         text[],
  last_sign_in_at   timestamptz,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_muni uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_muni
  FROM public.profiles WHERE id = auth.uid();

  -- เฉพาะ admin / superadmin / officer เท่านั้น
  IF v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- admin/officer ต้องเรียกเฉพาะ municipality ตัวเอง
  IF v_role IN ('admin', 'officer') AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(p.email, ''), u.email) AS email,
    p.full_name,
    p.role,
    p.municipality_id,
    m.name AS municipality_name,
    p.phone,
    p.id_card,
    p.job_title,
    p.address,
    p.avatar_url,
    ARRAY(
      SELECT DISTINCT i.provider
      FROM auth.identities i WHERE i.user_id = p.id
    ) AS providers,
    u.last_sign_in_at,
    p.created_at
  FROM public.profiles p
  LEFT JOIN auth.users        u ON u.id = p.id
  LEFT JOIN public.municipalities m ON m.id = p.municipality_id
  WHERE
    (p_municipality_id IS NULL AND v_role = 'superadmin')
    OR p.municipality_id = p_municipality_id
    OR (
      p_municipality_id IS NOT NULL
      AND p.municipality_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.user_id = p.id AND c.municipality_id = p_municipality_id
      )
    )
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_with_email(uuid) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- [H2] complaints — DROP "admin update complaints" (014) ที่ไม่มี municipality filter
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "admin update complaints" ON complaints;


-- ══════════════════════════════════════════════════════════════
-- [H3] events — เพิ่ม municipality filter ทุก operation
-- ══════════════════════════════════════════════════════════════

-- SELECT: staff เห็นเฉพาะ municipality ตัวเอง; public events เห็นได้ทุกคน
DROP POLICY IF EXISTS "events select by audience" ON events;
CREATE POLICY "events select by audience" ON events FOR SELECT USING (
  get_my_role() = 'superadmin'
  OR audience = 'public'
  OR (
    get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician', 'kamnan')
    AND municipality_id = get_my_municipality_id()
    AND CASE
      WHEN get_my_role() = 'admin'       THEN true
      WHEN get_my_role() = 'officer'     THEN audience IN ('public','staff','council','management')
      WHEN get_my_role() = 'viewer'      THEN audience IN ('public','staff','management')
      WHEN get_my_role() = 'council'     THEN audience IN ('public','staff','council')
      WHEN get_my_role() = 'kamnan'      THEN audience IN ('public','staff','kamnan')
      WHEN get_my_role() = 'technician'  THEN audience IN ('public','staff')
      WHEN get_my_role() = 'staff'       THEN audience IN ('public','staff')
      ELSE false
    END
  )
);

-- INSERT: เพิ่ม municipality filter
DROP POLICY IF EXISTS "staff insert events" ON events;
CREATE POLICY "staff insert events" ON events
  FOR INSERT WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'viewer', 'council', 'officer', 'staff')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- UPDATE: เพิ่ม municipality filter
DROP POLICY IF EXISTS "staff update events" ON events;
CREATE POLICY "staff update events" ON events FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff')
      AND created_by = auth.uid()
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff')
      AND created_by = auth.uid()
      AND municipality_id = get_my_municipality_id()
    )
  );

-- DELETE: เพิ่ม municipality filter
DROP POLICY IF EXISTS "staff delete events" ON events;
CREATE POLICY "staff delete events" ON events FOR DELETE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('viewer', 'council', 'officer', 'staff')
      AND created_by = auth.uid()
      AND municipality_id = get_my_municipality_id()
    )
  );


-- ══════════════════════════════════════════════════════════════
-- [H4] posts — เพิ่ม municipality filter ทุก write operation
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff read drafts"   ON posts;
DROP POLICY IF EXISTS "staff insert posts"  ON posts;
DROP POLICY IF EXISTS "staff update posts"  ON posts;
DROP POLICY IF EXISTS "staff delete posts"  ON posts;

CREATE POLICY "staff read drafts" ON posts FOR SELECT TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin','officer','staff','viewer','council','technician')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff insert posts" ON posts FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin','officer','staff')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff update posts" ON posts FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin','officer','staff')
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin','officer','staff')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff delete posts" ON posts FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin','officer','staff')
      AND municipality_id = get_my_municipality_id()
    )
  );


-- ══════════════════════════════════════════════════════════════
-- [H5] payment-slips storage — จำกัด read เฉพาะ staff+
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff read payment slips" ON storage.objects;
CREATE POLICY "staff read payment slips"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND get_my_role() IN ('superadmin','admin','officer','staff','viewer')
  );


-- ══════════════════════════════════════════════════════════════
-- [M1] complaint-attachments: QR path — จำกัด upload/update เฉพาะ admin
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "admin can upload municipality qr" ON storage.objects;
CREATE POLICY "admin can upload municipality qr"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'complaint-attachments'
    AND name LIKE 'municipality-qr/%'
    AND get_my_role() IN ('superadmin','admin')
  );

DROP POLICY IF EXISTS "admin can update municipality qr" ON storage.objects;
CREATE POLICY "admin can update municipality qr"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'complaint-attachments'
    AND name LIKE 'municipality-qr/%'
    AND get_my_role() IN ('superadmin','admin')
  );

-- general upload: block municipality-qr path สำหรับ anon
DROP POLICY IF EXISTS "allow public upload complaint attachments" ON storage.objects;
CREATE POLICY "allow public upload complaint attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'complaint-attachments'
    AND name NOT LIKE 'municipality-qr/%'
  );


-- ══════════════════════════════════════════════════════════════
-- [M2] delete_user_by_id — admin ลบข้าม municipality ไม่ได้
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_user_by_id(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_caller_muni uuid;
  v_target_role text;
  v_target_muni uuid;
BEGIN
  SELECT role, municipality_id INTO v_caller_role, v_caller_muni
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  SELECT role, municipality_id INTO v_target_role, v_target_muni
  FROM public.profiles WHERE id = p_user_id;

  IF v_target_role = 'superadmin' THEN
    RAISE EXCEPTION 'Cannot delete a superadmin account';
  END IF;

  IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Only superadmin can delete admin accounts';
  END IF;

  -- admin ต้องอยู่ municipality เดียวกับ target (ยกเว้น citizen ที่ municipality_id = NULL)
  IF v_caller_role = 'admin'
     AND v_target_muni IS NOT NULL
     AND v_target_muni IS DISTINCT FROM v_caller_muni
  THEN
    RAISE EXCEPTION 'Permission denied: cannot delete user from another municipality';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_by_id(uuid) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- [M3] get_complaint_by_ref — mask phone สำหรับ anon
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_complaint_by_ref(text, uuid);

CREATE OR REPLACE FUNCTION get_complaint_by_ref(_ref_no text, _municipality_id uuid)
RETURNS TABLE (
  id uuid, ref_no text, category text, subject text, detail text,
  status text, created_at timestamptz, due_date date,
  village text, latitude double precision, longitude double precision,
  phone text, reporter_name text,
  attachments jsonb, work_photos jsonb, technician_note text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, ref_no, category, subject, detail,
    status, created_at, due_date,
    village, latitude, longitude,
    -- anon: mask เบอร์กลาง แสดงแค่ 3 ตัวแรก + 3 ตัวท้าย
    CASE
      WHEN auth.uid() IS NOT NULL THEN phone
      WHEN phone IS NULL           THEN NULL
      ELSE LEFT(phone, 3) || REPEAT('x', GREATEST(0, LENGTH(phone) - 6)) || RIGHT(phone, 3)
    END AS phone,
    reporter_name,
    to_jsonb(attachments), work_photos, technician_note
  FROM complaints
  WHERE ref_no = upper(trim(_ref_no))
    AND municipality_id = _municipality_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_complaint_by_ref(text, uuid) TO anon, authenticated;


-- ══════════════════════════════════════════════════════════════
-- [M4/M6] complaint_timeline SELECT — เพิ่ม role check
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "timeline_select" ON complaint_timeline;

CREATE POLICY "timeline_select" ON complaint_timeline FOR SELECT USING (
  -- citizen เห็นเฉพาะ timeline ของตัวเอง
  EXISTS (
    SELECT 1 FROM complaints c
    WHERE c.id = complaint_timeline.complaint_id
      AND c.user_id = auth.uid()
  )
  -- staff เห็นเฉพาะ municipality ตัวเอง
  OR EXISTS (
    SELECT 1 FROM complaints c
    JOIN profiles p ON p.id = auth.uid()
    WHERE c.id = complaint_timeline.complaint_id
      AND c.municipality_id = p.municipality_id
      AND p.role IN ('superadmin','admin','officer','staff','technician','viewer','council')
  )
);


-- ══════════════════════════════════════════════════════════════
-- [M5] satisfaction_ratings — ต้องระบุ municipality ที่ถูกต้อง
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anyone can insert satisfaction" ON public.satisfaction_ratings;
CREATE POLICY "anyone can insert satisfaction" ON public.satisfaction_ratings
  FOR INSERT WITH CHECK (
    municipality_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.municipalities WHERE id = municipality_id)
  );


-- ══════════════════════════════════════════════════════════════
-- [L2] fleet_audit_log INSERT — จำกัดเฉพาะ fleet_admin / fleet_staff
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "faudit_insert" ON public.fleet_audit_log;
CREATE POLICY "faudit_insert" ON public.fleet_audit_log FOR INSERT
  WITH CHECK (
    municipality_id = (SELECT mun_id FROM public.my_fleet())
    AND (SELECT frole FROM public.my_fleet()) IN ('fleet_admin', 'fleet_staff')
  );
