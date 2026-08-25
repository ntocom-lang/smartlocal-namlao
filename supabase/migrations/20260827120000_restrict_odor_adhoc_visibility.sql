-- 20260827120000_restrict_odor_adhoc_visibility.sql
--
-- หมวดเฉพาะกิจ (complaint_categories.is_adhoc, ปัจจุบันมีแค่ odor) ถูกออกแบบให้ "ส่งตรงถึงผู้รับผิดชอบ
-- โดยไม่ผ่านแอดมิน" แต่ที่ผ่านมาการมองเห็นกลับกว้างกว่าที่ตั้งใจมาก เพราะ RLS/RPC ที่ใช้ร่วมกับหมวดปกติ
-- ทุกจุดมี department-fallback ("เพื่อนร่วมกองเดียวกันเห็นได้ด้วย") ซึ่งขัดกับเจตนาของหมวดเฉพาะกิจ และ
-- ยังหลุดไปถึงแผนที่สาธารณะ (data_center_unified_pins, ใช้ทั้งหน้า /data-center/public ที่ไม่ต้อง login
-- และ /data-center/staff) ที่ไม่กรอง category เลย
--
-- ทางแก้: จำกัดหมวดเฉพาะกิจให้เห็นได้เฉพาะ (1) ผู้รับผิดชอบที่ถูก assign ตรงๆ (assigned_to = ตัวเอง)
-- และ (2) admin/superadmin เท่านั้น — ตัด department-fallback (officer/staff) และ viewer/council ออกไป
-- สำหรับหมวดเฉพาะกิจโดยเฉพาะ ไม่กระทบหมวดปกติที่ยังทำงานแบบเดิมทุกอย่าง
-- ผู้แจ้ง (citizen, user_id = ตัวเอง) ยังเห็นคำร้องของตัวเองได้เสมอ ไม่เกี่ยวกับ scope นี้

-- 1) helper กลาง: หมวดนี้เป็นหมวดเฉพาะกิจไหม (ดึงมาจาก complaint_is_open เดิมเพื่อไม่ให้เขียนซ้ำ 4 จุด)
CREATE OR REPLACE FUNCTION public.complaint_category_is_adhoc(p_municipality_id uuid, p_category text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT cc.is_adhoc FROM public.complaint_categories cc
      WHERE cc.municipality_id = p_municipality_id AND cc.value = p_category),
    false
  )
$$;

REVOKE EXECUTE ON FUNCTION public.complaint_category_is_adhoc(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complaint_category_is_adhoc(uuid, text) TO authenticated;

-- complaint_is_open (20260827100000) ใช้ logic เดียวกันนี้ซ้ำ — refactor ให้เรียก helper ร่วม
CREATE OR REPLACE FUNCTION public.complaint_is_open(c public.complaints)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.complaint_category_is_adhoc(c.municipality_id, c.category)
    THEN c.extra_data ->> 'acknowledged_at' IS NULL
    ELSE c.status NOT IN ('done', 'closed', 'rejected', 'completed')
  END
$$;

-- 2) RLS SELECT บนตาราง complaints โดยตรง (คุมทุก query ที่ query ตรง เช่น OdorAcknowledgePanel,
--    Realtime postgres_changes, และ query อื่นๆ ในอนาคตที่ยังไม่เขียน) — ตัด department-fallback
--    ออกเฉพาะตอนเป็นหมวดเฉพาะกิจ, เพิ่ม assigned_to หรือ admin/superadmin เท่านั้น (คงเดิมอยู่แล้ว)
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
      OR (
        NOT public.complaint_category_is_adhoc(municipality_id, category)
        AND public.complaint_matches_my_department(department)
      )
    )
  )
  OR (
    public.get_my_role() = 'technician'
    AND assigned_to = auth.uid()
  )
);

-- 3) list_complaints_for_staff — RPC หลักที่ ComplaintsManager ใช้ (SECURITY DEFINER, ไม่ผ่าน RLS
--    ข้างบน ต้องแก้ scoping ในตัวมันเองด้วย) — officer/staff ตัด department-fallback เหมือนข้อ 2,
--    viewer/council ตัดหมวดเฉพาะกิจออกทั้งหมด (ไม่ใช่ผู้รับผิดชอบ ไม่ใช่ admin ตามที่ต้องการ)
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
          OR (
            NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
            AND public.complaint_matches_my_department(c.department)
          )
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
        AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
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
  'Role-scoped complaint list. Superadmin sees all; admin sees full complaint data only in own municipality; ad-hoc categories (is_adhoc) visible only to assigned_to + admin/superadmin, no department-fallback or viewer/council access.';

-- 4) get_complaint_private_detail — เส้นทางเปิดรายละเอียดเต็มแบบมี audit log, ต้องกันหมวดเฉพาะกิจ
--    เหมือนกัน มิฉะนั้น officer/staff ร่วมกองหรือ viewer/council ยังเปิดดูรายละเอียดเต็มได้ตรงๆ ผ่าน RPC นี้
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
        OR (
          NOT public.complaint_category_is_adhoc(v_complaint.municipality_id, v_complaint.category)
          AND public.complaint_matches_my_department(v_complaint.department)
        )
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
    AND v_complaint.municipality_id = v_actor.municipality_id
    AND NOT public.complaint_category_is_adhoc(v_complaint.municipality_id, v_complaint.category);

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
  'Need-to-know complaint detail with audited PII access; ad-hoc categories (is_adhoc) restricted to assigned_to + admin/superadmin, no department-fallback or viewer/council access.';

-- 5) data_center_unified_pins — แผนที่รวม ใช้ทั้งหน้า /data-center/public (ไม่ต้อง login เลย) และ
--    /data-center/staff เดิมไม่กรอง category เลย ทำให้หมวดเฉพาะกิจหลุดออกสู่สาธารณะทั้งหมด — เพิ่มเงื่อนไข
--    ต่อแถว: ไม่ใช่หมวดเฉพาะกิจ, หรือเป็น admin/superadmin, หรือเป็นผู้รับผิดชอบที่ถูก assign ตรงๆ เท่านั้น
--    (ผู้เยี่ยมชมแบบไม่ login: v_role เป็น NULL เสมอ → เงื่อนไข role/assigned_to เป็นเท็จเสมอ →
--    หมวดเฉพาะกิจถูกซ่อนจากสาธารณะโดยอัตโนมัติ)
DROP FUNCTION IF EXISTS public.data_center_unified_pins(uuid);

CREATE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz,
  description text, route_points jsonb, route_color text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare v_muni uuid; v_role text;
begin
  v_role := public.get_my_role();

  if v_role is not null and v_role not in ('superadmin','admin','officer','staff','technician','viewer','council') then
    raise exception 'Permission denied';
  end if;

  v_muni := case
    when v_role = 'superadmin' then _municipality_id
    when v_role is null then _municipality_id
    else public.get_my_municipality_id()
  end;

  return query
  select 'complaints'::text, c.id, 'คำร้อง'::text, c.category, c.subject, c.status,
         c.latitude::double precision, c.longitude::double precision, c.created_at,
         c.detail, null::jsonb, null::text
    from public.complaints c
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
      and (
        not public.complaint_category_is_adhoc(c.municipality_id, c.category)
        or v_role in ('admin', 'superadmin')
        or (v_role is not null and c.assigned_to = auth.uid())
      )
  union all
  select 'business_registrations', b.id, 'สถานประกอบการ', b.business_type, b.business_name, b.status,
         b.latitude::double precision, b.longitude::double precision, b.created_at,
         b.description, null::jsonb, null::text
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at,
         i.description, null::jsonb, null::text
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at,
         p.description, null::jsonb, null::text
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at,
         d.description, d.route_points, d.route_color
    from public.data_center_entries d
    where d.status = 'active' and (v_muni is null or d.municipality_id = v_muni);
end;
$$;

GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;
