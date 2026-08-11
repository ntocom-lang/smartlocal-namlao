-- ให้แบบพิมพ์คำร้องใช้ที่อยู่จากข้อมูลบัญชีของผู้ยื่นก่อนข้อมูลพื้นที่ของหน่วยงาน
-- ข้อมูลนี้อยู่ในผลลัพธ์เฉพาะกรณีที่ get_complaint_private_detail อนุญาตให้เห็น PII แบบเต็ม
-- ผู้มีสิทธิ์แบบ sanitized ยังคงไม่ได้รับที่อยู่บัญชี

BEGIN;

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
          'created_at', v_reporter.created_at,
          'job_title', v_reporter.job_title,
          'address', v_reporter.address,
          'address_province', v_reporter.address_province,
          'address_district', v_reporter.address_district,
          'address_subdistrict', v_reporter.address_subdistrict,
          'address_moo', v_reporter.address_moo,
          'address_detail', v_reporter.address_detail
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
          'fields', jsonb_build_array('reporter_name', 'phone', 'contact_profile', 'profile_address', 'exact_location')
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

COMMIT;
