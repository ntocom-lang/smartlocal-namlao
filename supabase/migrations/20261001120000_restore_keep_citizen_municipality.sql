-- แก้บั๊กที่กลับมาซ้ำ: กดบันทึกบัญชีประชาชนในหน้า "จัดการผู้ใช้และการแต่งตั้ง" แล้วบัญชีหายจากรายการ
--
-- 20260829130000_keep_citizen_municipality_on_admin_update.sql เคยแก้ให้ admin_update_user()
-- คง municipality_id ของ citizen ไว้แล้ว แต่ 20260909140100_asset_role_admin_update_user.sql
-- (#108) CREATE OR REPLACE ทั้งฟังก์ชันจากเนื้อรุ่นก่อนหน้านั้น บล็อก citizen จึงกลับไปเป็น
-- `municipality_id := NULL` อีก (กับดักข้อ 5 ใน docs/ai/NOTES.md)
--
-- อาการที่เกิดจริง 2026-10-01: Super Admin แก้ชื่อ/ที่อยู่ของประชาชนทุ่งแค้ว 1 บัญชี
-- audit_logs บันทึก municipality_id เปลี่ยนจากทุ่งแค้วเป็น NULL ทั้งที่ไม่ได้ตั้งใจย้าย อปท.
-- ส่วนแอดมินของ อปท. (role admin) จะชนด่าน 'cannot move user to another municipality'
-- ทุกครั้งที่บันทึกบัญชีประชาชน เพราะค่าใหม่กลายเป็น NULL ไม่ตรงกับ อปท. ของผู้แก้
--
-- เนื้อฟังก์ชันด้านล่างคัดจาก pg_get_functiondef ของฐานจริง 2026-10-01
-- (md5 f6b2f1a4be47687395ad281d41d51355) ครบทุกบรรทัด เปลี่ยนเฉพาะช่วงที่ทำเครื่องหมาย
-- << แก้ >> เท่านั้น เครื่องหมาย << ใหม่ >> ที่เหลือเป็นของ #108 เดิม
--
-- ⚠️ ใครจะ CREATE OR REPLACE ฟังก์ชันนี้อีก ต้องดึงเนื้อจาก pg_get_functiondef ของฐานจริง
-- แล้วตรวจว่ายังมี `ELSIF v_new.role = 'citizen'` อยู่ ไม่งั้นบั๊กนี้กลับมาเป็นรอบที่ 3

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_user(p_user_id uuid, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- << แก้ >> แยก citizen ออกจาก superadmin (คืนค่าจาก 20260829130000 ที่ 20260909140100 ทับหาย)
  IF v_new.role = 'superadmin' THEN
    -- superadmin เป็น cross-tenant โดยการออกแบบ ต้องไม่ผูกกับ อปท. ใด อปท. หนึ่ง
    v_new.municipality_id := NULL;
    v_new.department_id := NULL;
    v_new.position_id := NULL;
    v_new.is_dept_head := false;
  ELSIF v_new.role = 'citizen' THEN
    -- ประชาชนไม่มีกอง/ตำแหน่ง/หัวหน้ากอง แต่ต้องคงสังกัด อปท. ไว้เสมอ
    v_new.municipality_id := COALESCE(v_new.municipality_id, v_old.municipality_id, v_caller_muni);
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
$function$;

COMMIT;
