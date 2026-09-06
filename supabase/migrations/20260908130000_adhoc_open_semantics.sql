-- 20260908130000_adhoc_open_semantics.sql
--
-- เลิกใช้เกณฑ์ "30 วัน" กับคำร้องหมวดเฉพาะกิจ แล้วแยกความหมายของคำว่า "เปิดอยู่" ตามผู้ใช้งานจริง
--
-- [ที่มา] 20260908100000 นิยาม complaint_is_open() ให้หมวดเฉพาะกิจ = "สร้างมาไม่เกิน 30 วัน"
-- เพราะหมวดนี้ไม่แตะ complaints.status เลย ถ้าใช้เกณฑ์ status แบบหมวดปกติจะเปิดค้างตลอดกาล
-- ⚠️ เลข 30 วันนั้นเป็นค่าที่ตั้งขึ้นเองตอนนั้น ไม่ได้อ้างอิงระเบียบหรือข้อกำหนดใด
-- เจ้าของระบบตัดสินใจเลิกใช้ (2569-09-06) เพราะเป็นเส้นแบ่งที่ไม่มีที่มา
--
-- [ทำไมไม่ใช่แค่ลบเงื่อนไขทิ้ง] complaint_is_open() ถูกเรียกจาก 2 ที่ที่ต้องการคนละความหมาย
-- ตรวจแล้วด้วย pg_get_functiondef ว่ามีแค่ 2 ที่นี้จริง ไม่มี policy ไหนใช้
--
--   1. reassign_staff_workload()  — โอนงานตอนเจ้าหน้าที่ย้าย/ลาออก
--      ต้องการ "งานที่ยังต้องมีเจ้าของ" → คำร้องเฉพาะกิจต้องนับเป็นเปิดเสมอ ไม่งั้นใบเก่า
--      จะค้างชี้ไปที่คนที่ไม่อยู่แล้ว ไม่มีใครรับผิดชอบ และไม่มีใครรู้ว่ามันหลุดไป
--
--   2. delete_user_by_id()        — กันลบบัญชีที่ยังมีงานค้าง
--      ต้องการ "งานที่ยังปิดได้" → ถ้านับคำร้องเฉพาะกิจด้วยจะกลายเป็นเงื่อนไขที่ไม่มีวันปลด
--      เพราะสายงานนี้ไม่มีขั้นปิดงานให้เดินไปถึง เจ้าหน้าที่ที่เคยรับคำร้องกลิ่นแม้ใบเดียว
--      จะลบบัญชีไม่ได้ตลอดกาล ซึ่งไม่ได้ปกป้องอะไรเลย มีแต่ทำให้แอดมินติด
--
-- ทางแก้: complaint_is_open() ยึดความหมายของข้อ 1 (เฉพาะกิจ = เปิดเสมอ) ส่วน delete_user_by_id()
-- คัดหมวดเฉพาะกิจออกจากด่านของตัวเองอย่างชัดเจนที่จุดเรียก ไม่ใช่ไปบิดความหมายของ helper กลาง
--
-- เมื่อลบบัญชีที่มีแต่คำร้องเฉพาะกิจและไม่ได้เป็นผู้รับผิดชอบเริ่มต้น คำร้องยังอยู่
-- แต่ assigned_to จะเป็น NULL ตาม foreign key ON DELETE SET NULL
-- ด่าน category_assignments ป้องกันเฉพาะผู้รับผิดชอบเริ่มต้น ไม่ได้บังคับโอนคำร้องทุกกรณี
-- หากต้องการรักษาผู้รับผิดชอบของประวัติคำร้อง ให้ใช้การโอนงานก่อนลบบัญชี

-- ── 1) helper กลาง: หมวดเฉพาะกิจเปิดเสมอ ────────────────────────────────────
-- body คัดจาก 20260908100000 (ยืนยันด้วย pg_get_functiondef แล้วว่าตรงกับฐานจริงทุกตัวอักษร
-- ไม่มี hotfix แทรก) เปลี่ยนเฉพาะสาขาของหมวดเฉพาะกิจ
CREATE OR REPLACE FUNCTION public.complaint_is_open(c public.complaints)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    -- หมวดเฉพาะกิจไม่มีขั้นปิดงาน จึงถือว่า "ยังต้องมีเจ้าของ" เสมอ — ใช้กับการโอนงานเป็นหลัก
    -- ถ้าวันหนึ่งระบบมีช่องบันทึกผลการตรวจสอบ ให้กลับมาแก้ตรงนี้เป็นเงื่อนไขของผลนั้นแทน
    WHEN public.complaint_category_is_adhoc(c.municipality_id, c.category)
    THEN true
    ELSE c.status NOT IN ('done', 'closed', 'rejected', 'completed')
  END
$function$;

REVOKE EXECUTE ON FUNCTION public.complaint_is_open(public.complaints) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complaint_is_open(public.complaints) TO authenticated;

COMMENT ON FUNCTION public.complaint_is_open(public.complaints) IS
  'คำร้องนี้ยังต้องมีเจ้าของอยู่ไหม — หมวดปกติดูจาก status, หมวดเฉพาะกิจถือว่าเปิดเสมอเพราะไม่มีขั้นปิดงาน (เลิกใช้เกณฑ์ 30 วันของ 20260908100000 ซึ่งเป็นเลขที่ตั้งขึ้นเองไม่มีที่มา); ใช้กับการโอนงาน ส่วนด่านลบบัญชีคัดหมวดเฉพาะกิจออกเองที่ delete_user_by_id';

-- ── 2) ด่านลบบัญชี: ไม่นับหมวดเฉพาะกิจเป็นตัวบล็อก ──────────────────────────
-- ⚠️ body ทั้งก้อนคัดจาก 20260827100000_guard_delete_user_with_open_work.sql
-- (เทียบ pg_get_functiondef กับฐานจริงแล้วตรงกันทุกตัวอักษร) แก้เฉพาะเงื่อนไขในด่านที่ 2
-- ห้ามย่อหรือใส่ placeholder — CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน ตกบรรทัดไหนคือหายจริง
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
  -- ⚠️ ยกเว้นหมวดเฉพาะกิจ: complaint_is_open() ถือว่าหมวดนั้นเปิดเสมอ (ไม่มีขั้นปิดงาน)
  --   ถ้านับด้วยจะกลายเป็นเงื่อนไขที่ไม่มีวันปลด แอดมินจะลบบัญชีเจ้าหน้าที่ที่เคยรับคำร้องกลิ่น
  --   แม้ใบเดียวไม่ได้ตลอดกาล ซึ่งไม่ได้ปกป้องอะไร ด่านแรก (category_assignments) ยังบังคับ
  --   ให้โอน "ผู้รับผิดชอบเริ่มต้น" ก่อนอยู่แล้ว ซึ่งหมวดกลิ่นมีผูกไว้จริง
  IF EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.assigned_to = p_user_id
      AND public.complaint_is_open(c)
      AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
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



-- ตรวจหลัง apply (อ่านอย่างเดียว ไม่ต้องสร้างข้อมูลทดสอบ)
--
--   1) เกณฑ์ 30 วันหายไปจาก complaint_is_open แล้ว และหมวดเฉพาะกิจคืน true เสมอ
--      select pg_get_functiondef(oid) not like '%interval ''30 days''%' as no_30d,
--             pg_get_functiondef(oid) like '%THEN true%'                as adhoc_always_open
--        from pg_proc where proname = 'complaint_is_open';
--
--   2) ด่านลบบัญชีคัดหมวดเฉพาะกิจออกแล้ว
--      select pg_get_functiondef(oid) like '%NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)%'
--        from pg_proc where proname = 'delete_user_by_id';
--
--   3) ด่านอื่นของ delete_user_by_id ต้องยังอยู่ครบ (ห้ามหายไปกับการเขียนทับ)
--      ตรวจว่ายังมีข้อความเหล่านี้: 'Cannot delete your own account',
--      'Cannot delete a superadmin account', 'Only superadmin can delete admin accounts',
--      'cannot delete user from another municipality', 'ผู้รับผิดชอบเริ่มต้น',
--      และยังมี INSERT INTO public.audit_logs กับ DELETE FROM auth.users
--
--   4) เคสจริงที่ควรลองบนสนามซ้อม: เจ้าหน้าที่ที่มีเฉพาะคำร้องกลิ่นค้างอยู่และไม่ได้เป็น
--      ผู้รับผิดชอบเริ่มต้นของหมวดใดเลย ต้องลบบัญชีได้ ส่วนคนที่มีคำร้องหมวดปกติค้างต้องยังลบไม่ได้
