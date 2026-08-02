-- แอดมินระบบเป็นผู้คัดกรองคำร้องของเทศบาล จึงต้องเห็นและจัดการคำร้องได้ครบ
-- ขอบเขต: admin เฉพาะ municipality ของตน, superadmin ทุก municipality

DROP POLICY IF EXISTS "complaints select by role scope" ON public.complaints;
CREATE POLICY "complaints select by role scope"
ON public.complaints
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
  OR (
    public.get_my_role() IN ('officer', 'staff')
    AND municipality_id = public.get_my_municipality_id()
    AND (
      assigned_to = auth.uid()
      OR public.complaint_matches_my_department(department)
    )
  )
  OR (
    public.get_my_role() = 'technician'
    AND assigned_to = auth.uid()
  )
);

DROP POLICY IF EXISTS "admin update complaints in role scope" ON public.complaints;
CREATE POLICY "admin update complaints in role scope"
ON public.complaints
FOR UPDATE
TO authenticated
USING (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
)
WITH CHECK (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
);

DROP POLICY IF EXISTS "admin delete complaints" ON public.complaints;
CREATE POLICY "admin delete complaints"
ON public.complaints
FOR DELETE
TO authenticated
USING (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
);

-- รายการหลัก: admin ต้องเห็นข้อมูลจริงเพื่อคัดกรองเรื่องจริง/เท็จและติดต่อผู้แจ้ง
-- officer/staff/technician ยังคงเห็น PII แบบ masked และตาม scope เดิม
CREATE OR REPLACE FUNCTION public.list_complaints_for_staff(p_municipality_id uuid DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH actor AS (
    SELECT p.id, p.role, p.municipality_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), scoped AS (
    SELECT c.*, a.role AS actor_role
    FROM public.complaints c
    CROSS JOIN actor a
    WHERE
      (
        a.role = 'superadmin'
        AND (p_municipality_id IS NULL OR c.municipality_id = p_municipality_id)
      )
      OR (
        a.role = 'admin'
        AND c.municipality_id = a.municipality_id
        AND c.municipality_id = p_municipality_id
      )
      OR (
        a.role IN ('officer', 'staff')
        AND c.municipality_id = a.municipality_id
        AND c.municipality_id = p_municipality_id
        AND (
          c.assigned_to = a.id
          OR public.complaint_matches_my_department(c.department)
        )
      )
      OR (
        a.role = 'technician'
        AND c.municipality_id = a.municipality_id
        AND c.municipality_id = p_municipality_id
        AND c.assigned_to = a.id
      )
      OR (
        a.role IN ('viewer', 'council')
        AND c.municipality_id = a.municipality_id
        AND c.municipality_id = p_municipality_id
      )
  )
  SELECT
    CASE
      WHEN s.actor_role IN ('superadmin', 'admin') THEN
        to_jsonb(s) - 'actor_role'
        || jsonb_build_object(
          'profiles', CASE WHEN rp.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', rp.id,
            'full_name', rp.full_name,
            'phone', rp.phone,
            'email', rp.email,
            'avatar_url', rp.avatar_url,
            'created_at', rp.created_at
          ) END
        )
      WHEN s.actor_role IN ('viewer', 'council') THEN
        (to_jsonb(s) - ARRAY[
          'actor_role', 'phone', 'reporter_name', 'user_id', 'detail',
          'latitude', 'longitude', 'location', 'location_name', 'village',
          'attachments', 'work_photos', 'technician_note', 'progress_note',
          'rejection_reason', 'draft_pdf_path', 'final_document_path',
          'document_uploaded_by', 'gdrive_url', 'gdrive_file_id'
        ]::text[])
        || jsonb_build_object(
          'phone', public.mask_complaint_phone(s.phone),
          'reporter_name', public.mask_complaint_reporter_name(coalesce(s.reporter_name, rp.full_name)),
          'profiles', CASE WHEN rp.id IS NULL THEN NULL ELSE jsonb_build_object(
            'full_name', public.mask_complaint_reporter_name(rp.full_name),
            'phone', public.mask_complaint_phone(coalesce(s.phone, rp.phone))
          ) END
        )
      ELSE
        (to_jsonb(s) - ARRAY[
          'actor_role', 'phone', 'reporter_name', 'user_id', 'location',
          'attachments', 'work_photos', 'draft_pdf_path', 'final_document_path',
          'document_uploaded_by', 'gdrive_url', 'gdrive_file_id'
        ]::text[])
        || jsonb_build_object(
          'phone', public.mask_complaint_phone(coalesce(s.phone, rp.phone)),
          'reporter_name', public.mask_complaint_reporter_name(coalesce(s.reporter_name, rp.full_name)),
          'profiles', CASE WHEN rp.id IS NULL THEN NULL ELSE jsonb_build_object(
            'full_name', public.mask_complaint_reporter_name(rp.full_name),
            'phone', public.mask_complaint_phone(coalesce(s.phone, rp.phone))
          ) END
        )
    END
  FROM scoped s
  LEFT JOIN public.profiles rp ON rp.id = s.user_id
  ORDER BY s.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.list_complaints_for_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_complaints_for_staff(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_complaints_for_staff(uuid) IS
  'Role-scoped complaint list. Superadmin sees all; admin sees full complaint data only in own municipality; other roles remain masked and scoped.';

-- Hotfix: complaint_number เป็น integer แต่ resource_label เป็น text
-- ต้อง cast ก่อน COALESCE มิฉะนั้น RPC ล้มด้วย "COALESCE types text and integer cannot be matched"
CREATE OR REPLACE FUNCTION public.get_complaint_private_detail(
  p_complaint_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%rowtype;
  v_complaint public.complaints%rowtype;
  v_reporter public.profiles%rowtype;
  v_full boolean := false;
  v_sanitized boolean := false;
  v_result jsonb;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authenticated profile required' USING errcode = '42501';
  END IF;

  SELECT * INTO v_complaint
  FROM public.complaints
  WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_complaint.user_id IS NOT NULL THEN
    SELECT * INTO v_reporter
    FROM public.profiles
    WHERE id = v_complaint.user_id;
  END IF;

  v_full :=
    v_actor.role = 'superadmin'
    OR (
      v_actor.role = 'admin'
      AND v_complaint.municipality_id = v_actor.municipality_id
    )
    OR (
      v_actor.role IN ('officer', 'staff')
      AND v_complaint.municipality_id = v_actor.municipality_id
      AND (
        v_complaint.assigned_to = v_actor.id
        OR public.complaint_matches_my_department(v_complaint.department)
      )
    )
    OR (
      v_actor.role = 'technician'
      AND v_complaint.assigned_to = v_actor.id
    )
    OR (
      v_actor.role = 'citizen'
      AND v_complaint.user_id = v_actor.id
    );

  v_sanitized :=
    v_actor.role IN ('viewer', 'council')
    AND v_complaint.municipality_id = v_actor.municipality_id;

  IF NOT v_full AND NOT v_sanitized THEN
    RAISE EXCEPTION 'complaint access denied' USING errcode = '42501';
  END IF;

  IF v_full THEN
    v_result := to_jsonb(v_complaint)
      || jsonb_build_object(
        'profiles', CASE WHEN v_reporter.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', v_reporter.id,
          'full_name', v_reporter.full_name,
          'phone', v_reporter.phone,
          'email', v_reporter.email,
          'avatar_url', v_reporter.avatar_url,
          'created_at', v_reporter.created_at
        ) END
      );

    IF v_actor.role <> 'citizen' THEN
      INSERT INTO public.audit_logs (
        municipality_id, actor_id, actor_name, actor_role, action,
        resource_type, resource_id, resource_label, metadata
      ) VALUES (
        v_complaint.municipality_id,
        v_actor.id,
        coalesce(v_actor.full_name, v_actor.email, v_actor.id::text),
        v_actor.role,
        'view_pii',
        'complaint',
        v_complaint.id::text,
        coalesce(v_complaint.ref_no, v_complaint.complaint_number::text, v_complaint.id::text),
        jsonb_build_object(
          'reason', left(nullif(btrim(p_reason), ''), 200),
          'fields', jsonb_build_array('reporter_name', 'phone', 'contact_profile', 'exact_location')
        )
      );
    END IF;
  ELSE
    v_result :=
      (to_jsonb(v_complaint) - ARRAY[
        'phone', 'reporter_name', 'user_id', 'detail',
        'latitude', 'longitude', 'location', 'location_name', 'village',
        'attachments', 'work_photos', 'technician_note', 'progress_note',
        'rejection_reason', 'draft_pdf_path', 'final_document_path',
        'document_uploaded_by', 'gdrive_url', 'gdrive_file_id'
      ]::text[])
      || jsonb_build_object(
        'phone', public.mask_complaint_phone(coalesce(v_complaint.phone, v_reporter.phone)),
        'reporter_name', public.mask_complaint_reporter_name(coalesce(v_complaint.reporter_name, v_reporter.full_name)),
        'profiles', CASE WHEN v_reporter.id IS NULL THEN NULL ELSE jsonb_build_object(
          'full_name', public.mask_complaint_reporter_name(v_reporter.full_name),
          'phone', public.mask_complaint_phone(coalesce(v_complaint.phone, v_reporter.phone))
        ) END
      );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_complaint_private_detail(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_complaint_private_detail(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.get_complaint_private_detail(uuid, text) IS
  'Need-to-know complaint detail with audited PII access; complaint_number is cast to text for audit resource labels.';
