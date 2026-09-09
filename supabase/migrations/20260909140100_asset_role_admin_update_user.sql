-- เปิดให้แอดมินตั้ง profiles.asset_role ผ่านช่องทางเดียวที่อนุญาต คือ admin_update_user()
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน เนื้อของทั้งสองฟังก์ชันด้านล่างคัดมาครบจาก
-- ตัวจริงในฐาน (pg_get_functiondef) ห้ามตัดส่วนใดออก ส่วนที่เพิ่มมีเฉพาะที่ทำเครื่องหมาย
-- << ใหม่ >> ไว้เท่านั้น
--
-- ลำดับสำคัญ: ต้องแก้ guard ด้วย ไม่ใช่แค่ RPC — ถ้าแก้แต่ RPC ตัว guard จะไม่ดัก
-- asset_role ทำให้ใครก็ตามที่ UPDATE แถวโปรไฟล์ตัวเองได้ ตั้งสิทธิ์พัสดุให้ตัวเองได้เงียบๆ
-- (ตอนนี้ยังไม่ GRANT UPDATE บนคอลัมน์นี้จึงเขียนไม่ได้อยู่แล้ว แต่ต้องกันสองชั้น
-- เผื่อวันหน้ามีคน GRANT เพิ่มโดยไม่รู้ที่มา)

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ข้อยกเว้น: ประชาชนผูกตัวเองกับ อปท. ครั้งแรกได้ (null → ค่าแรกเท่านั้น)
  IF auth.uid() = NEW.id
     AND OLD.municipality_id IS NULL AND NEW.municipality_id IS NOT NULL
     AND OLD.role = 'citizen' AND NEW.role = 'citizen'
     AND NEW.fleet_role    IS NOT DISTINCT FROM OLD.fleet_role
     AND NEW.asset_role    IS NOT DISTINCT FROM OLD.asset_role      -- << ใหม่ >>
     AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id
     AND NEW.position_id   IS NOT DISTINCT FROM OLD.position_id
     AND NEW.is_dept_head  IS NOT DISTINCT FROM OLD.is_dept_head
  THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
     OR NEW.fleet_role IS DISTINCT FROM OLD.fleet_role
     OR NEW.asset_role IS DISTINCT FROM OLD.asset_role              -- << ใหม่ >>
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.position_id IS DISTINCT FROM OLD.position_id
     OR NEW.is_dept_head IS DISTINCT FROM OLD.is_dept_head
  THEN
    IF auth.role() IS NOT NULL
       AND auth.role() <> 'service_role'
       AND COALESCE(current_setting('app.user_management_rpc', true), '') <> '1'
    THEN
      RAISE EXCEPTION 'Privileged profile fields must be changed through admin_update_user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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
    'is_dept_head', 'fleet_role', 'asset_role'                      -- << ใหม่: asset_role >>
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

  IF v_new.fleet_role IS NOT NULL AND v_new.fleet_role NOT IN ('fleet_admin', 'fleet_staff', 'fleet_viewer') THEN
    RAISE EXCEPTION 'Invalid fleet_role';
  END IF;

  -- << ใหม่ >> ตรวจค่า asset_role
  IF v_new.asset_role IS NOT NULL AND v_new.asset_role NOT IN ('asset_admin', 'asset_staff', 'asset_viewer') THEN
    RAISE EXCEPTION 'Invalid asset_role';
  END IF;

  -- << ใหม่ >> asset_staff คุมได้เฉพาะกองตัวเอง ถ้าไม่มีสังกัดก็ไม่มีขอบเขตให้คุม
  -- ปล่อยผ่านแล้วจะได้คนที่ถืออำนาจแต่มองไม่เห็นของสักชิ้น แล้วมาแจ้งว่า "ระบบพัง"
  IF v_new.asset_role = 'asset_staff' AND v_new.department_id IS NULL THEN
    RAISE EXCEPTION 'asset_staff requires a department';
  END IF;

  -- << ใหม่ >> ประชาชนถือสิทธิ์พัสดุไม่ได้ ล้างทิ้งพร้อมกับสังกัดที่ถูกล้างไปแล้วด้านบน
  IF v_new.role IN ('citizen', 'superadmin') THEN
    v_new.asset_role := NULL;
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
    is_dept_head = COALESCE(v_new.is_dept_head, false),
    fleet_role = v_new.fleet_role,
    asset_role = v_new.asset_role                                   -- << ใหม่ >>
  WHERE id = p_user_id;
END;
$$;

COMMIT;
