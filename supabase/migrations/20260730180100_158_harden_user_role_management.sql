-- 158_harden_user_role_management.sql
-- Harden User Management at the database boundary.

-- Privilege-bearing fields may only be changed by the controlled RPC.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
     OR NEW.fleet_role IS DISTINCT FROM OLD.fleet_role
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

DROP TRIGGER IF EXISTS trg_guard_profile_privileged_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_update();

REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_update()
  FROM PUBLIC, anon, authenticated;

-- Keep normal self-service profile editing, while the trigger above blocks
-- role, tenant, department, position, department-head and fleet privileges.
DROP POLICY IF EXISTS "users can update own profile" ON public.profiles;
CREATE POLICY "users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Audit managed profile changes. PII values are intentionally not copied into
-- metadata; only field names and authorization-state changes are recorded.
CREATE OR REPLACE FUNCTION public.audit_managed_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    CASE WHEN NEW.fleet_role IS DISTINCT FROM OLD.fleet_role THEN 'fleet_role' END
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
        'is_dept_head', OLD.is_dept_head
      ),
      'authorization_after', jsonb_build_object(
        'role', NEW.role,
        'municipality_id', NEW.municipality_id,
        'department_id', NEW.department_id,
        'position_id', NEW.position_id,
        'is_dept_head', NEW.is_dept_head
      )
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_managed_profile_update ON public.profiles;
CREATE TRIGGER trg_audit_managed_profile_update
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_managed_profile_update();

REVOKE EXECUTE ON FUNCTION public.audit_managed_profile_update()
  FROM PUBLIC, anon, authenticated;

-- One controlled write path for the Admin UI.
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

-- Cross-tenant-safe, audited user deletion.
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

-- Tenant-scoped and paginated user listing. Superadmin must also select a
-- municipality; returning all municipalities to one browser is prohibited.
CREATE OR REPLACE FUNCTION public.get_users_with_email(
  p_municipality_id uuid DEFAULT NULL,
  p_roles text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, email text, full_name text, role text, municipality_id uuid, municipality_name text,
  phone text, id_card text, job_title text, address text, address_province text, address_district text,
  address_subdistrict text, address_moo text, address_detail text, avatar_url text, providers text[],
  last_sign_in_at timestamptz, created_at timestamptz, staff_id uuid, staff_name text, staff_title text,
  department_id uuid, department_name text, is_dept_head boolean, position_id uuid, position_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_muni uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN QUERY
  SELECT
    p.id, COALESCE(NULLIF(p.email, ''), u.email), p.full_name, p.role,
    p.municipality_id, m.name, p.phone, p.id_card, p.job_title, p.address,
    p.address_province, p.address_district, p.address_subdistrict,
    p.address_moo, p.address_detail, p.avatar_url,
    ARRAY(SELECT DISTINCT i.provider FROM auth.identities i WHERE i.user_id = p.id),
    u.last_sign_in_at, p.created_at,
    s.id, s.name, s.title, p.department_id, dep.name, p.is_dept_head,
    p.position_id, pos.name
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.municipalities m ON m.id = p.municipality_id
  LEFT JOIN public.staff s ON s.id = p.staff_id
  LEFT JOIN public.departments dep ON dep.id = p.department_id
  LEFT JOIN public.positions pos ON pos.id = p.position_id
  WHERE (
      p.municipality_id = p_municipality_id
      OR (
        p.municipality_id IS NULL
        AND public.profile_linked_to_municipality(p.id, p_municipality_id)
      )
    )
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR p.full_name ILIKE '%' || btrim(p_search) || '%'
      OR COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%' || btrim(p_search) || '%'
      OR p.phone ILIKE '%' || btrim(p_search) || '%'
      OR p.id_card ILIKE '%' || btrim(p_search) || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_users_with_email(uuid, text[], text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_email(uuid, text[], text, integer, integer)
  TO authenticated;
