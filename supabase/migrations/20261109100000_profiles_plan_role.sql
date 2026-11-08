-- เมนู "แผนพัฒนาท้องถิ่น" ไฟล์ 1/3 — สิทธิ์รายโมดูล profiles.plan_role (นักวิเคราะห์นโยบายและแผน = เจ้าของข้อมูลแผน)
--
-- ลอกแม่แบบ fleet_role / asset_role (20260909140000 + 20260909140100): คอลัมน์แยก ไม่ผูกกับ role หลัก
--   NULL = ไม่มีสิทธิ์จัดการแผน (ค่าเริ่มต้นของทุกคน) · 'plan_admin' = เขียนแผนทุกฉบับของ อปท. ตัวเอง
--   admin/superadmin ของ อปท. ได้สิทธิ์เต็มอยู่แล้วโดยไม่ต้องถูกตั้งค่า (ตรรกะอยู่ใน local_plan_is_manager() ไฟล์ 3)
--   ทำไมไม่ใช้ "เจ้าหน้าที่สำนักปลัด" (departments.code = 'general'): สำนักปลัดมีทั้งธุรการ ป้องกันฯ ฯลฯ
--   ผูกกับกองแล้วทุกคนในกองแก้แผนได้โดยไม่มีใครมอบสิทธิ์ ตรวจย้อนไม่ได้ว่าใครควรทำ
--
-- ⚠️ ต่างจากแม่แบบ asset_role ที่แยก "เพิ่มคอลัมน์" กับ "ด่านกัน" เป็น 2 ไฟล์:
--   ไฟล์นี้รวมไว้ใน transaction เดียวโดยตั้งใจ — ถ้าเพิ่มคอลัมน์แล้วยังไม่ได้ใส่ด่านกัน ผู้ใช้ทุกคน UPDATE แถวโปรไฟล์ตัวเอง
--   ตั้ง plan_role = 'plan_admin' ได้ (profiles ให้สิทธิ์ UPDATE ระดับตาราง ตัวกันคือ trigger guard_profile_privileged_update)
--   และค่านั้นจะติดอยู่หลังรันไฟล์ด่านกันตามมา · ฟังก์ชันทั้งสองเป็น plpgsql: ชื่อคอลัมน์ในเนื้อฟังก์ชันถูก resolve ตอนเรียกใช้
--   ไม่ใช่ตอน CREATE จึงไม่ชนกับดัก 42703 ของ NOTES ข้อ 3 (กับดักนั้นเกิดกับ statement ระดับบนสุด/ฟังก์ชัน sql)
--   ถ้าเครื่องมือรันพังกลางไฟล์ ทั้งไฟล์ย้อนกลับ (ล้มแบบปลอดภัย ไม่มีช่วงเปิดช่อง)
--
-- ⚠️ CREATE OR REPLACE ทับทั้งฟังก์ชัน (NOTES ข้อ 5):
--   guard_profile_privileged_update : คัดจาก 20260909140100 ทั้งตัว เพิ่มเฉพาะบรรทัด << plan_role >>
--   admin_update_user              : คัดจาก 20261001120000 ทั้งตัว เพิ่มเฉพาะบรรทัด << plan_role >>
--   audit_managed_profile_update   : คัดจาก pg_get_functiondef ของฐานจริง ทั้งตัว เพิ่มเฉพาะบรรทัด << plan_role >>
--   เทียบกับ pg_get_functiondef ของฐานจริงแล้ว 2569-11-08 (Supabase CLI --read-only): guard และ admin_update_user ตรงกับไฟล์ในรีโปทุกบรรทัด
--   ต่างเฉพาะรูปแบบที่ pg ใส่เอง ($$ ↔ $function$, SET search_path TO 'public', 'pg_temp')
--   บล็อก `ELSIF v_new.role = 'citizen'` ยังอยู่ครบ (npm run test:admin-update-user เฝ้าให้)
--
-- กติกา plan_role ใน admin_update_user
--   - ค่าได้แค่ NULL หรือ 'plan_admin'
--   - ถือได้เฉพาะ role admin / officer / staff — บทบาทอื่น (technician viewer council citizen superadmin) ระบบล้างเป็น NULL ให้เอง
--     (ลดสิทธิ์อย่างเดียว ไม่มีทางทำให้ใครได้สิทธิ์เพิ่มโดยไม่ตั้งใจ) · ผู้บริหาร (viewer) อ่านแผนได้อยู่แล้วตาม role หลัก
--   - ย้ายผู้ใช้ข้าม อปท. → ล้างเป็น NULL (migration-reviewer ข้อสังเกต 7)
--
-- ย้อนกลับ: คืนสามฟังก์ชันจาก 20260909140100 (guard) · 20261001120000 (admin_update_user) · 20260730180100 (audit_managed_profile_update)
--           แล้ว ALTER TABLE public.profiles DROP COLUMN plan_role (ต้องคืนฟังก์ชันก่อน ไม่งั้นทุก UPDATE profiles พัง 42703)
BEGIN;

-- ALTER TABLE profiles ถือ ACCESS EXCLUSIVE: ถ้าติด transaction ค้าง คำขอที่อ่าน profiles จะต่อคิวทั้งระบบ → ยอมพังแล้วรันใหม่ดีกว่า
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.admin_update_user(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.guard_profile_privileged_update()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ admin_update_user / guard_profile_privileged_update';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'asset_role') THEN
    RAISE EXCEPTION 'ต้องรัน 20260909140000_profiles_asset_role_column.sql ก่อน (ไม่พบ profiles.asset_role)';
  END IF;
END $guard$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_role text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_plan_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_plan_role_check
      CHECK (plan_role IS NULL OR plan_role IN ('plan_admin'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.plan_role IS
  'สิทธิ์เมนูแผนพัฒนาท้องถิ่น: plan_admin = นักวิเคราะห์ฯ เขียนแผนทุกฉบับของ อปท. ตัวเอง, NULL = ไม่มีสิทธิ์จัดการ '
  '(ยังอ่านได้ตาม role หลัก) ถือได้เฉพาะ admin/officer/staff ตั้งค่าได้ทาง admin_update_user() เท่านั้น';

-- เหตุผลเดียวกับ asset_role: profiles ให้สิทธิ์ระดับตารางอยู่แล้ว เขียนไว้เพื่อความชัดเจน
-- ไม่ให้ anon (ต่างจาก asset_role): ไม่มีหน้าไหนของผู้ไม่ล็อกอินต้องอ่าน และจะค้างเป็นสิทธิ์คอลัมน์ถ้าวันหน้าถอนระดับตาราง
GRANT SELECT (plan_role) ON public.profiles TO authenticated;

-- ── ด่านกัน: คัดจาก 20260909140100 ทั้งตัว + plan_role ──────────────────────────
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
     AND NEW.asset_role    IS NOT DISTINCT FROM OLD.asset_role
     AND NEW.plan_role     IS NOT DISTINCT FROM OLD.plan_role       -- << plan_role >>
     AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id
     AND NEW.position_id   IS NOT DISTINCT FROM OLD.position_id
     AND NEW.is_dept_head  IS NOT DISTINCT FROM OLD.is_dept_head
  THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
     OR NEW.fleet_role IS DISTINCT FROM OLD.fleet_role
     OR NEW.asset_role IS DISTINCT FROM OLD.asset_role
     OR NEW.plan_role IS DISTINCT FROM OLD.plan_role                -- << plan_role >>
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

-- ── admin_update_user: คัดจาก 20261001120000 ทั้งตัว + plan_role ─────────────────
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
    'is_dept_head', 'fleet_role', 'asset_role', 'plan_role'         -- << plan_role >>
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

  -- แยก citizen ออกจาก superadmin (คืนค่าจาก 20260829130000 ที่ 20260909140100 ทับหาย)
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

  -- ตรวจค่า asset_role
  IF v_new.asset_role IS NOT NULL AND v_new.asset_role NOT IN ('asset_admin', 'asset_staff', 'asset_viewer') THEN
    RAISE EXCEPTION 'Invalid asset_role';
  END IF;

  -- asset_staff คุมได้เฉพาะกองตัวเอง ถ้าไม่มีสังกัดก็ไม่มีขอบเขตให้คุม
  -- ปล่อยผ่านแล้วจะได้คนที่ถืออำนาจแต่มองไม่เห็นของสักชิ้น แล้วมาแจ้งว่า "ระบบพัง"
  IF v_new.asset_role = 'asset_staff' AND v_new.department_id IS NULL THEN
    RAISE EXCEPTION 'asset_staff requires a department';
  END IF;

  -- ประชาชนถือสิทธิ์พัสดุไม่ได้ ล้างทิ้งพร้อมกับสังกัดที่ถูกล้างไปแล้วด้านบน
  IF v_new.role IN ('citizen', 'superadmin') THEN
    v_new.asset_role := NULL;
  END IF;

  -- << plan_role >> ตรวจค่า แล้วล้างให้บทบาทที่ถือสิทธิ์แผนไม่ได้ (ลดสิทธิ์อย่างเดียว)
  IF v_new.plan_role IS NOT NULL AND v_new.plan_role NOT IN ('plan_admin') THEN
    RAISE EXCEPTION 'Invalid plan_role';
  END IF;
  IF v_new.role NOT IN ('admin', 'officer', 'staff') THEN
    v_new.plan_role := NULL;
  END IF;
  -- << plan_role >> ย้ายข้าม อปท. = สิทธิ์เดิมไม่ติดตัวไป (ไม่งั้นได้สิทธิ์จัดการแผนของที่ใหม่ทันที)
  -- เว้นบัญชีที่ยังไม่มีสังกัด: ตั้งสังกัดกับสิทธิ์พร้อมกันครั้งแรกต้องไม่ถูกล้างเงียบๆ
  IF v_old.municipality_id IS NOT NULL AND v_new.municipality_id IS DISTINCT FROM v_old.municipality_id THEN
    v_new.plan_role := NULL;
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
    asset_role = v_new.asset_role,
    plan_role = v_new.plan_role                                     -- << plan_role >>
  WHERE id = p_user_id;
END;
$function$;

-- ── บันทึกตรวจสอบ: คัดจาก pg_get_functiondef ของฐานจริง 2569-11-08 ทั้งตัว + plan_role ─────────
-- รายชื่อช่องในฟังก์ชันนี้ตายตัว ไม่เพิ่ม = มอบสิทธิ์นักวิเคราะห์แล้วไม่มีร่องรอยว่าใครมอบ (ระบบต้องตรวจย้อนได้)
-- ⚠️ asset_role ก็ตกหล่นจากรายชื่อนี้มาตั้งแต่ 20260909140000 — เป็นเรื่องของโมดูลพัสดุ ไม่แก้ในไฟล์นี้ (แจ้งเจ้าของแล้ว)
CREATE OR REPLACE FUNCTION public.audit_managed_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_name text;
  v_actor_role text;
  v_actor_muni uuid;
  v_fields text[];
BEGIN
  IF auth.uid() IS NULL OR auth.uid() = NEW.id THEN
    RETURN NEW;
  END IF;

  SELECT full_name, role, municipality_id
    INTO v_actor_name, v_actor_role, v_actor_muni
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_actor_role IS NULL THEN
    RETURN NEW;
  END IF;

  v_fields := array_remove(ARRAY[
    CASE WHEN NEW.full_name IS DISTINCT FROM OLD.full_name THEN 'full_name' END,
    CASE WHEN NEW.phone IS DISTINCT FROM OLD.phone THEN 'phone' END,
    CASE WHEN NEW.id_card IS DISTINCT FROM OLD.id_card THEN 'id_card' END,
    CASE WHEN NEW.address IS DISTINCT FROM OLD.address THEN 'address' END,
    CASE WHEN NEW.address_province IS DISTINCT FROM OLD.address_province THEN 'address_province' END,
    CASE WHEN NEW.address_district IS DISTINCT FROM OLD.address_district THEN 'address_district' END,
    CASE WHEN NEW.address_subdistrict IS DISTINCT FROM OLD.address_subdistrict THEN 'address_subdistrict' END,
    CASE WHEN NEW.address_moo IS DISTINCT FROM OLD.address_moo THEN 'address_moo' END,
    CASE WHEN NEW.address_detail IS DISTINCT FROM OLD.address_detail THEN 'address_detail' END,
    CASE WHEN NEW.job_title IS DISTINCT FROM OLD.job_title THEN 'job_title' END,
    CASE WHEN NEW.role IS DISTINCT FROM OLD.role THEN 'role' END,
    CASE WHEN NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN 'municipality_id' END,
    CASE WHEN NEW.department_id IS DISTINCT FROM OLD.department_id THEN 'department_id' END,
    CASE WHEN NEW.position_id IS DISTINCT FROM OLD.position_id THEN 'position_id' END,
    CASE WHEN NEW.is_dept_head IS DISTINCT FROM OLD.is_dept_head THEN 'is_dept_head' END,
    CASE WHEN NEW.fleet_role IS DISTINCT FROM OLD.fleet_role THEN 'fleet_role' END,
    CASE WHEN NEW.plan_role IS DISTINCT FROM OLD.plan_role THEN 'plan_role' END   -- << plan_role >>
  ], NULL);

  IF COALESCE(array_length(v_fields, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    COALESCE(NEW.municipality_id, OLD.municipality_id, v_actor_muni),
    auth.uid(), v_actor_name, v_actor_role, 'update_user',
    'profile', NEW.id::text, COALESCE(NEW.full_name, NEW.email),
    jsonb_build_object(
      'target_user_id', NEW.id,
      'changed_fields', to_jsonb(v_fields),
      'authorization_before', jsonb_build_object(
        'role', OLD.role,
        'municipality_id', OLD.municipality_id,
        'department_id', OLD.department_id,
        'position_id', OLD.position_id,
        'is_dept_head', OLD.is_dept_head,
        'plan_role', OLD.plan_role                                  -- << plan_role >>
      ),
      'authorization_after', jsonb_build_object(
        'role', NEW.role,
        'municipality_id', NEW.municipality_id,
        'department_id', NEW.department_id,
        'position_id', NEW.position_id,
        'is_dept_head', NEW.is_dept_head,
        'plan_role', NEW.plan_role                                  -- << plan_role >>
      )
    )
  );

  RETURN NEW;
END;
$function$;

-- ด่านท้ายไฟล์: ด่านกันต้องรู้จัก plan_role แล้ว ไม่งั้นเปิดช่องตั้งสิทธิ์ให้ตัวเอง
DO $check$
BEGIN
  IF position('plan_role' IN pg_get_functiondef('public.guard_profile_privileged_update()'::regprocedure)) = 0
     OR position('plan_role' IN pg_get_functiondef('public.admin_update_user(uuid,jsonb)'::regprocedure)) = 0
     OR position('plan_role' IN pg_get_functiondef('public.audit_managed_profile_update()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'ด่านกัน plan_role ไม่ครบ — ห้าม COMMIT';
  END IF;
END $check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
