-- 20260827100000_guard_delete_user_with_open_work.sql
--
-- ปัญหา: profiles.id ถูกอ้างจาก category_assignments.technician_id และ complaints.assigned_to
-- ด้วย FK แบบ ON DELETE SET NULL — เดิม delete_user_by_id ลบบัญชีได้ทันทีแม้เจ้าหน้าที่คนนั้นยังมีงาน
-- ค้างอยู่ ผลคือ assigned_to/technician_id ถูกเซ็ต NULL แบบเงียบๆ เสียประวัติว่าใครเคยรับผิดชอบ
-- และคำร้องเฉพาะกิจ (odor) จะไม่มีใครมองเห็นอีกเลยเพราะ OdorAcknowledgePanel filter ด้วย
-- assigned_to ตรงๆ ไม่มี fallback (ดู docs/แผนงาน โอนงานเมื่อเจ้าหน้าที่ย้าย)
--
-- ทางแก้: กันตั้งแต่ต้นทาง — ห้ามลบบัญชีที่ยังมีงานเปิดค้างอยู่ ต้องโอนงานก่อน (ใช้ RPC
-- reassign_staff_workload ในไมเกรชันถัดไป) ครอบคลุมทุกหมวดคำร้อง ไม่ใช่แค่ odor

-- 1) helper: คำร้องแถวนี้ยัง "เปิด" อยู่หรือไม่ (ยังต้องมีคนตาม)
--    หมวดเฉพาะกิจ (is_adhoc, เช่น odor) ใช้ extra_data.acknowledged_at เป็นตัวชี้วัด
--    หมวดปกติใช้ status — ไม่ hardcode 'odor' เพื่อให้หมวดเฉพาะกิจใหม่ในอนาคตได้ guard นี้ฟรี
CREATE OR REPLACE FUNCTION public.complaint_is_open(c public.complaints)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(
      (SELECT cc.is_adhoc FROM public.complaint_categories cc
        WHERE cc.municipality_id = c.municipality_id AND cc.value = c.category),
      false
    )
    THEN c.extra_data ->> 'acknowledged_at' IS NULL
    ELSE c.status NOT IN ('done', 'closed', 'rejected', 'completed')
  END
$$;

REVOKE EXECUTE ON FUNCTION public.complaint_is_open(public.complaints) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complaint_is_open(public.complaints) TO authenticated;

-- 2) เพิ่ม guard สองข้อใน delete_user_by_id (คัดลอก body เดิมจาก
--    20260730180100_158_harden_user_role_management.sql แล้วแทรกเช็คก่อนบันทึก audit_logs/ลบจริง)
CREATE OR REPLACE FUNCTION public.delete_user_by_id(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_muni uuid;
  v_caller_name text;
  v_target_role text;
  v_target_muni uuid;
  v_target_name text;
  v_target_email text;
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
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  SELECT role, municipality_id, full_name, email
    INTO v_target_role, v_target_muni, v_target_name, v_target_email
  FROM public.profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_target_role = 'superadmin' THEN
    RAISE EXCEPTION 'Cannot delete a superadmin account';
  END IF;
  IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Only superadmin can delete admin accounts';
  END IF;
  IF v_caller_role = 'admin'
     AND NOT (
       v_target_muni = v_caller_muni
       OR (
         v_target_muni IS NULL
         AND public.profile_linked_to_municipality(p_user_id, v_caller_muni)
       )
     )
  THEN
    RAISE EXCEPTION 'Permission denied: cannot delete user from another municipality';
  END IF;

  -- Guard ใหม่: ห้ามลบถ้ายังเป็นผู้รับผิดชอบเริ่มต้นของหมวดคำร้องใดอยู่ (ไม่ scope ตาม
  -- municipality โดยตั้งใจ — ถ้ายังผูกอยู่ที่ไหนก็ต้องโอนก่อนเสมอ)
  IF EXISTS (
    SELECT 1 FROM public.category_assignments ca WHERE ca.technician_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'ไม่สามารถลบผู้ใช้นี้ได้ เนื่องจากยังเป็น "ผู้รับผิดชอบเริ่มต้น" ของหมวดคำร้องอยู่ — กรุณาโอนงานให้ผู้อื่นก่อน (ใช้ปุ่ม "โอนงาน" ในหน้าจัดการผู้ใช้)';
  END IF;

  -- Guard ใหม่: ห้ามลบถ้ายังมีคำร้องที่เปิดอยู่ในความรับผิดชอบ (ทุกหมวด ไม่ใช่แค่ odor)
  IF EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.assigned_to = p_user_id
      AND public.complaint_is_open(c)
  ) THEN
    RAISE EXCEPTION 'ไม่สามารถลบผู้ใช้นี้ได้ เนื่องจากยังมีคำร้องที่เปิดอยู่ในความรับผิดชอบ — กรุณาโอนงานให้ผู้อื่นก่อน (ใช้ปุ่ม "โอนงาน" ในหน้าจัดการผู้ใช้)';
  END IF;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    COALESCE(v_target_muni, v_caller_muni),
    auth.uid(), v_caller_name, v_caller_role, 'delete_user',
    'profile', p_user_id::text, COALESCE(v_target_name, v_target_email),
    jsonb_build_object(
      'target_user_id', p_user_id,
      'target_role', v_target_role,
      'target_municipality_id', v_target_muni
    )
  );

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_user_by_id(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_by_id(uuid)
  TO authenticated;
