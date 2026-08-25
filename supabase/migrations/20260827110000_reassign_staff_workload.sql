-- 20260827110000_reassign_staff_workload.sql
--
-- RPC ให้แอดมินโอนงานทั้งหมดจากเจ้าหน้าที่คนเดิม (กำลังจะย้าย/พ้นตำแหน่ง) ไปยังคนใหม่ได้ในคลิกเดียว:
--   1) category_assignments.technician_id — ผู้รับผิดชอบเริ่มต้นของหมวด (งานในอนาคต)
--   2) complaints.assigned_to — เฉพาะคำร้องที่ยังเปิดอยู่ (public.complaint_is_open, เพิ่มใน
--      20260827100000) คำร้องที่ปิด/รับทราบแล้วจะไม่ถูกแตะ เพื่อรักษาประวัติว่าใครเคยจัดการจริง
-- ใช้คู่กับ guard ใน delete_user_by_id — แอดมินต้องโอนงานผ่าน RPC นี้ก่อนถึงจะลบบัญชีเดิมได้

CREATE OR REPLACE FUNCTION public.reassign_staff_workload(
  p_old_staff_id uuid,
  p_new_staff_id uuid,
  p_category text DEFAULT NULL,
  p_municipality_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_muni uuid;
  v_caller_name text;
  v_muni uuid;
  v_old_role text;
  v_old_muni uuid;
  v_new_role text;
  v_new_muni uuid;
  v_cat_count int;
  v_complaint_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role, municipality_id, full_name
    INTO v_caller_role, v_caller_muni, v_caller_name
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_caller_role = 'admin' THEN
    v_muni := v_caller_muni;
  ELSE
    IF p_municipality_id IS NULL THEN
      RAISE EXCEPTION 'ต้องระบุเทศบาลสำหรับ superadmin';
    END IF;
    v_muni := p_municipality_id;
  END IF;

  IF p_old_staff_id = p_new_staff_id THEN
    RAISE EXCEPTION 'ผู้รับโอนงานต้องไม่ใช่คนเดิม';
  END IF;

  SELECT role, municipality_id INTO v_old_role, v_old_muni
  FROM public.profiles WHERE id = p_old_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบผู้ใช้ต้นทาง (ผู้โอนงานออก)';
  END IF;
  IF NOT (
    v_old_muni = v_muni
    OR (v_old_muni IS NULL AND public.profile_linked_to_municipality(p_old_staff_id, v_muni))
  ) THEN
    RAISE EXCEPTION 'ผู้ใช้ต้นทางอยู่นอกเทศบาลของคุณ';
  END IF;

  SELECT role, municipality_id INTO v_new_role, v_new_muni
  FROM public.profiles WHERE id = p_new_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบผู้ใช้ปลายทาง (ผู้รับโอนงาน)';
  END IF;
  IF v_new_role NOT IN ('technician', 'officer', 'staff', 'admin') THEN
    RAISE EXCEPTION 'ผู้รับโอนงานต้องเป็นเจ้าหน้าที่ที่รับมอบหมายงานได้ (ปฏิบัติงาน/ธุรการกอง/เจ้าหน้าที่/แอดมิน)';
  END IF;
  IF NOT (
    v_new_muni = v_muni
    OR (v_new_muni IS NULL AND public.profile_linked_to_municipality(p_new_staff_id, v_muni))
  ) THEN
    RAISE EXCEPTION 'ผู้ใช้ปลายทางอยู่นอกเทศบาลของคุณ';
  END IF;

  -- 1) หมวดคำร้องที่ตั้งค่าให้เป็นผู้รับผิดชอบเริ่มต้น (งานใหม่ที่จะเข้ามา)
  UPDATE public.category_assignments
  SET technician_id = p_new_staff_id
  WHERE municipality_id = v_muni
    AND technician_id = p_old_staff_id
    AND (p_category IS NULL OR category = p_category);
  GET DIAGNOSTICS v_cat_count = ROW_COUNT;

  -- 2) คำร้องที่ยังเปิดอยู่เท่านั้น — ของที่ปิด/รับทราบแล้วคงผู้รับผิดชอบเดิมไว้เป็นประวัติ
  UPDATE public.complaints c
  SET assigned_to = p_new_staff_id
  WHERE c.municipality_id = v_muni
    AND c.assigned_to = p_old_staff_id
    AND (p_category IS NULL OR c.category = p_category)
    AND public.complaint_is_open(c);
  GET DIAGNOSTICS v_complaint_count = ROW_COUNT;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_muni, auth.uid(), v_caller_name, v_caller_role, 'reassign_staff_workload',
    'profile', p_old_staff_id::text, NULL,
    jsonb_build_object(
      'old_staff_id', p_old_staff_id,
      'new_staff_id', p_new_staff_id,
      'category', p_category,
      'category_assignments_updated', v_cat_count,
      'complaints_updated', v_complaint_count
    )
  );

  RETURN jsonb_build_object(
    'category_assignments_updated', v_cat_count,
    'complaints_updated', v_complaint_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_staff_workload(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_staff_workload(uuid, uuid, text, uuid)
  TO authenticated;
