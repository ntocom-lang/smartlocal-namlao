-- 20260816120000_require_department_for_officer_role.sql
--
-- ช่องโหว่ที่พบ: กฎ "role = officer ต้องมี department_id" เดิมเช็คแค่ฝั่ง client
-- (src/pages/AdminDashboard.jsx saveUserEdits) — ไม่มีเช็คซ้ำใน admin_update_user RPC เหมือนกฎอื่นๆ
-- ทั้งหมดที่ฟังก์ชันนี้ re-validate ซ้ำเสมอ (เช่น "is_dept_head ต้องมี department" ข้างๆ กัน)
--
-- ผลถ้ามีทางเรียก RPC ตรง (บายพาส UI): ได้ officer ที่ department_id เป็น null — ไม่ใช่ช่องโหว่ข้อมูลรั่ว
-- (RLS ที่ scope งานตาม officer+department_id ออกแบบ fail-closed คือ "department_id IS NOT NULL" เป็น
-- เงื่อนไข ดู supabase/migrations/20260802060000_scope_department_clerk_permissions.sql) แต่เป็น
-- data-integrity bug: บัญชีนั้นจะใช้งานเมนูที่ scope ตามกองไม่ได้เลยโดยไม่มี error อธิบายสาเหตุ
--
-- แก้โดยเพิ่มเช็คใน admin_update_user ให้ตรงกับ pattern เดิมของฟังก์ชันนี้ (ทั้งฟังก์ชันเหมือน
-- 20260730180100_158_harden_user_role_management.sql ทุกประการ เพิ่มแค่ IF block ใหม่ 1 จุด)

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_changes jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_muni uuid;
  v_old public.profiles%ROWTYPE;
  v_new public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'No changes supplied';
  END IF;

  IF (p_changes - ARRAY[
    'full_name', 'phone', 'id_card', 'address', 'address_province',
    'address_district', 'address_subdistrict', 'address_moo', 'address_detail',
    'job_title', 'role', 'municipality_id', 'department_id', 'position_id',
    'is_dept_head'
  ]::text[]) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Unsupported profile field';
  END IF;

  SELECT role, municipality_id
    INTO v_caller_role, v_caller_muni
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot manage your own account from User Management';
  END IF;

  SELECT * INTO v_old
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_old.role = 'superadmin' THEN
    RAISE EXCEPTION 'Cannot modify a superadmin account';
  END IF;

  IF v_caller_role = 'admin' AND v_old.role = 'admin' THEN
    RAISE EXCEPTION 'Only superadmin can manage admin accounts';
  END IF;

  IF v_caller_role = 'admin'
     AND NOT (
       v_old.municipality_id = v_caller_muni
       OR (
         v_old.municipality_id IS NULL
         AND public.profile_linked_to_municipality(v_old.id, v_caller_muni)
       )
     )
  THEN
    RAISE EXCEPTION 'Permission denied: user is outside your municipality';
  END IF;

  v_new := jsonb_populate_record(v_old, p_changes);

  IF v_new.role IS NULL OR v_new.role NOT IN (
    'superadmin', 'admin', 'officer', 'technician',
    'staff', 'viewer', 'council', 'citizen'
  ) THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF v_caller_role = 'admin' AND v_new.role IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only superadmin can grant admin roles';
  END IF;

  IF v_new.role IN ('citizen', 'superadmin') THEN
    v_new.municipality_id := NULL;
    v_new.department_id := NULL;
    v_new.position_id := NULL;
    v_new.is_dept_head := false;
  ELSE
    v_new.municipality_id := COALESCE(v_new.municipality_id, v_old.municipality_id, v_caller_muni);
  END IF;

  IF v_new.role NOT IN ('citizen', 'superadmin') AND v_new.municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required for this role';
  END IF;

  IF v_caller_role = 'admin' AND v_new.municipality_id IS DISTINCT FROM v_caller_muni THEN
    RAISE EXCEPTION 'Permission denied: cannot move user to another municipality';
  END IF;

  IF v_new.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = v_new.department_id
      AND d.municipality_id = v_new.municipality_id
  ) THEN
    RAISE EXCEPTION 'Department does not belong to the selected municipality';
  END IF;

  IF v_new.position_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.positions p WHERE p.id = v_new.position_id)
  THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  IF COALESCE(v_new.is_dept_head, false) AND v_new.department_id IS NULL THEN
    RAISE EXCEPTION 'Department head must have a department';
  END IF;

  -- ใหม่: กันบายพาส client-side check เดิม (src/pages/AdminDashboard.jsx saveUserEdits) ที่เช็คกฎนี้
  -- อยู่แล้วแต่เป็นแค่ชั้น UI — role นี้ scope งานตาม department_id ทุกโมดูล (civil/infra/business/posts)
  -- ปล่อยให้ department_id เป็น null ผ่าน RPC ตรงได้ จะได้บัญชีที่ใช้งานเมนูเหล่านั้นไม่ได้เลยแบบไม่มี
  -- คำอธิบาย (RLS scope ตาม officer+department_id ออกแบบ fail-closed จึงไม่ใช่ช่องโหว่ข้อมูลรั่ว แต่เป็น
  -- data-integrity bug ที่ debug ยาก)
  IF v_new.role = 'officer' AND v_new.department_id IS NULL THEN
    RAISE EXCEPTION 'Officer role requires a department';
  END IF;

  IF length(COALESCE(v_new.full_name, '')) > 200
     OR length(COALESCE(v_new.job_title, '')) > 200
     OR length(COALESCE(v_new.address, '')) > 1000
     OR length(COALESCE(v_new.address_detail, '')) > 500
  THEN
    RAISE EXCEPTION 'Profile text is too long';
  END IF;

  IF v_new.phone IS NOT NULL AND v_new.phone !~ '^[0-9]{1,15}$' THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  IF v_new.id_card IS NOT NULL AND v_new.id_card !~ '^[0-9]{13}$' THEN
    RAISE EXCEPTION 'Invalid ID card number';
  END IF;

  PERFORM set_config('app.user_management_rpc', '1', true);

  UPDATE public.profiles SET
    full_name = NULLIF(btrim(v_new.full_name), ''),
    phone = NULLIF(v_new.phone, ''),
    id_card = NULLIF(v_new.id_card, ''),
    address = NULLIF(btrim(v_new.address), ''),
    address_province = NULLIF(btrim(v_new.address_province), ''),
    address_district = NULLIF(btrim(v_new.address_district), ''),
    address_subdistrict = NULLIF(btrim(v_new.address_subdistrict), ''),
    address_moo = NULLIF(v_new.address_moo, ''),
    address_detail = NULLIF(btrim(v_new.address_detail), ''),
    job_title = NULLIF(btrim(v_new.job_title), ''),
    role = v_new.role,
    municipality_id = v_new.municipality_id,
    department_id = v_new.department_id,
    position_id = v_new.position_id,
    is_dept_head = COALESCE(v_new.is_dept_head, false)
  WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, jsonb)
  TO authenticated;
