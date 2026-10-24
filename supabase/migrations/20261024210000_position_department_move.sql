-- ย้ายตำแหน่งพร้อมสังกัดผู้ถือใน transaction เดียว โดยผู้ดูแลต้องยืนยันก่อน
-- guard/sync ตั้งต้นจากนิยามจริงที่ตรวจ md5 ตรงกับฐานข้อมูลก่อนแก้
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.sync_profile_department_from_position()') IS NULL
     OR to_regprocedure('public.admin_update_user(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply personnel structure and managed-user migrations first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_position_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_department public.departments%ROWTYPE;
  v_match_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.position_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete a position while personnel hold it';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id
     AND COALESCE(current_setting('app.position_department_move', true), '') <> NEW.id::text
  THEN
    RAISE EXCEPTION 'Use admin_save_position to change the department';
  END IF;
  IF NEW.department_id IS NULL THEN
    -- รองรับ import_default_positions รุ่นเดิมที่ยังส่ง department_hint มาเป็นข้อความ:
    -- ผูก FK เฉพาะชื่อเต็ม/ชื่อย่อที่ตรงกัน exact เท่านั้น ไม่เดาจากคำบางส่วน
    IF NULLIF(btrim(NEW.department_hint), '') IS NOT NULL THEN
      SELECT count(*) INTO v_match_count
      FROM public.departments d
      WHERE d.municipality_id = NEW.municipality_id
        AND (lower(btrim(d.name)) = lower(btrim(NEW.department_hint))
          OR lower(btrim(COALESCE(d.short_name, ''))) = lower(btrim(NEW.department_hint)));
      IF v_match_count <> 1 THEN
        RETURN NEW;
      END IF;
      SELECT * INTO v_department
      FROM public.departments d
      WHERE d.municipality_id = NEW.municipality_id
        AND (
          lower(btrim(d.name)) = lower(btrim(NEW.department_hint))
          OR lower(btrim(COALESCE(d.short_name, ''))) = lower(btrim(NEW.department_hint))
        )
      ORDER BY d.sort_order, d.id
      LIMIT 1;

      IF FOUND THEN
        IF EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.position_id = NEW.id
            AND (p.municipality_id IS DISTINCT FROM NEW.municipality_id
              OR p.department_id IS DISTINCT FROM v_department.id)
        ) THEN
          RETURN NEW;
        END IF;
        NEW.department_id := v_department.id;
        NEW.department_hint := v_department.name;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_department
  FROM public.departments d
  WHERE d.id = NEW.department_id;

  IF NOT FOUND OR v_department.municipality_id IS DISTINCT FROM NEW.municipality_id THEN
    RAISE EXCEPTION 'Department does not belong to the position municipality';
  END IF;

  -- คง department_hint ไว้ให้ client รุ่นเก่าอ่านได้ระหว่าง rollout แต่แหล่งจริงคือ FK
  NEW.department_hint := v_department.name;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_position_department() FROM PUBLIC, anon, authenticated;

-- การแต่งตั้งใหม่รอ transaction ที่กำลังย้ายตำแหน่ง แล้วอ่านกองปลายทางที่ยืนยันแล้ว
CREATE OR REPLACE FUNCTION public.sync_profile_department_from_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_position_municipality uuid;
  v_position_department uuid;
BEGIN
  IF NEW.position_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.municipality_id, p.department_id
    INTO v_position_municipality, v_position_department
  FROM public.positions p
  WHERE p.id = NEW.position_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position_municipality IS DISTINCT FROM NEW.municipality_id THEN
    RAISE EXCEPTION 'Position does not belong to the selected municipality';
  END IF;

  -- ตำแหน่งที่ผูกกองชัดเจนเป็น rule ที่ตั้งครั้งเดียว ส่วนตำแหน่งส่วนกลางยังให้คนเลือกกองได้
  IF v_position_department IS NOT NULL THEN
    NEW.department_id := v_position_department;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    NEW.is_dept_head := false;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_profile_department_from_position() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_position_holder_counts(p_municipality_id uuid)
RETURNS TABLE (position_id uuid, holder_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT p.role, p.municipality_id INTO v_role, v_municipality_id
  FROM public.profiles p WHERE p.id = auth.uid();
  IF p_municipality_id IS NULL THEN RAISE EXCEPTION 'Municipality is required'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin','superadmin')
     OR (v_role = 'admin' AND v_municipality_id IS DISTINCT FROM p_municipality_id)
  THEN RAISE EXCEPTION 'Permission denied'; END IF;

  RETURN QUERY
  SELECT pos.id, count(holder.id)
  FROM public.positions pos
  LEFT JOIN public.profiles holder ON holder.position_id = pos.id
  WHERE pos.municipality_id = p_municipality_id
  GROUP BY pos.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_position_holder_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_position_holder_counts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_position(
  p_position_id uuid,
  p_changes jsonb,
  p_expected_department_id uuid,
  p_confirm_move boolean DEFAULT false,
  p_expected_holder_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_old public.positions%ROWTYPE;
  v_new public.positions%ROWTYPE;
  v_department_name text;
  v_holder record;
  v_holder_count integer;
  v_moved_count integer := 0;
  v_department_changed boolean;
  v_move_flag text := COALESCE(current_setting('app.position_department_move',true),'');
  v_management_flag text := COALESCE(current_setting('app.user_management_rpc',true),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor.role IS NULL OR v_actor.role NOT IN ('admin','superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
     OR (p_changes - ARRAY['name','category','role','department_id','sort_order']::text[]) <> '{}'::jsonb
  THEN RAISE EXCEPTION 'Invalid position changes'; END IF;

  SELECT * INTO v_old FROM public.positions WHERE id = p_position_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not found'; END IF;
  IF v_actor.role = 'admin' AND v_actor.municipality_id IS DISTINCT FROM v_old.municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;
  IF v_old.department_id IS DISTINCT FROM p_expected_department_id THEN
    RAISE EXCEPTION 'Position changed; reload and review before saving';
  END IF;

  v_new := jsonb_populate_record(v_old,p_changes);
  v_new.name := btrim(v_new.name);
  IF NULLIF(v_new.name,'') IS NULL OR length(v_new.name) > 200
     OR v_new.category IS NULL OR v_new.category NOT IN
       ('political_exec','council','top_admin','dept_head','operating_staff','field_technician')
     OR v_new.role IS NULL OR v_new.role NOT IN
       ('superadmin','admin','officer','technician','staff','viewer','council')
     OR v_new.sort_order IS NULL
  THEN RAISE EXCEPTION 'Invalid position values'; END IF;
  IF v_new.department_id IS NOT NULL THEN
    SELECT d.name INTO v_department_name FROM public.departments d
    WHERE d.id = v_new.department_id AND d.municipality_id = v_old.municipality_id
      AND d.is_active IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active department in this municipality'; END IF;
  END IF;
  v_department_changed := v_new.department_id IS DISTINCT FROM v_old.department_id;

  -- ล็อกผู้ถือเดิมตามลำดับเดียวกันและตรวจจำนวนจริงก่อนแก้ ไม่มีการดึง PII กลับไป browser
  PERFORM p.id FROM public.profiles p WHERE p.position_id = p_position_id ORDER BY p.id FOR UPDATE;
  SELECT count(*) INTO v_holder_count FROM public.profiles WHERE position_id = p_position_id;
  IF v_department_changed AND (
      p_expected_holder_count IS NULL OR p_expected_holder_count <> v_holder_count
  ) THEN RAISE EXCEPTION 'Personnel changed; reload and review before saving'; END IF;
  IF v_department_changed AND v_holder_count > 0 AND NOT COALESCE(p_confirm_move,false) THEN
    RAISE EXCEPTION 'Confirm moving the position and its personnel first';
  END IF;
  IF v_department_changed AND v_new.department_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.position_id = p_position_id
      AND (p.municipality_id IS DISTINCT FROM v_old.municipality_id OR p.role IN ('citizen','superadmin'))
  ) THEN RAISE EXCEPTION 'Invalid personnel assignment; review holders individually'; END IF;

  PERFORM set_config('app.position_department_move',p_position_id::text,true);
  UPDATE public.positions SET name=v_new.name, category=v_new.category, role=v_new.role,
    department_id=v_new.department_id, department_hint=v_department_name, sort_order=v_new.sort_order
  WHERE id=p_position_id;
  PERFORM set_config('app.position_department_move',v_move_flag,true);

  -- กลับเป็นส่วนกลาง = ปลดกฎของตำแหน่ง แต่คงกองปัจจุบันของคนไว้ ไม่ล้างสังกัด
  IF v_department_changed AND v_new.department_id IS NOT NULL THEN
    FOR v_holder IN
      SELECT p.id FROM public.profiles p
      WHERE p.position_id=p_position_id AND p.department_id IS DISTINCT FROM v_new.department_id ORDER BY p.id
    LOOP
      -- ใช้ช่องทางเดิมเพื่อคงขอบเขตสิทธิ์ (ห้ามแก้ตนเอง/บัญชี admin ที่ไม่มีอำนาจ) และ audit รายบุคคล
      PERFORM public.admin_update_user(v_holder.id,
        jsonb_build_object('department_id',v_new.department_id,'is_dept_head',false));
      v_moved_count := v_moved_count + 1;
    END LOOP;
  END IF;
  PERFORM set_config('app.user_management_rpc',v_management_flag,true);

  INSERT INTO public.audit_logs (
    municipality_id,actor_id,actor_name,actor_role,action,resource_type,resource_id,resource_label,metadata
  ) VALUES (
    v_old.municipality_id,auth.uid(),v_actor.full_name,v_actor.role,'update_position','position',
    p_position_id::text,v_new.name,
    jsonb_build_object('department_before',v_old.department_id,'department_after',v_new.department_id,
      'holder_count',v_holder_count,'moved_count',v_moved_count,'confirmed_move',COALESCE(p_confirm_move,false))
  );
  RETURN jsonb_build_object('position_id',p_position_id,'department_id',v_new.department_id,
    'holder_count',v_holder_count,'moved_count',v_moved_count);
EXCEPTION
  WHEN deadlock_detected OR serialization_failure THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Personnel changed concurrently; reload and try again';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_position(uuid,jsonb,uuid,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_position(uuid,jsonb,uuid,boolean,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

