-- แยก "กองหลัก" ออกจาก "ล็อกกอง" ในการแก้ตำแหน่ง (เจ้าของระบบอนุมัติ 2569-10-30)
-- ต่อจาก 20261030110000_position_shared_by_default.sql
--
-- เหตุ: หน้าแบบตำแหน่งจัดกลุ่มตามกองที่ล็อกอย่างเดียว และฟอร์มแก้ตำแหน่งตั้งกองได้ทางเดียวคือล็อก
-- แอดมินที่อยากให้ตำแหน่งไปอยู่ใต้กองจึงล็อกกองทีละตัว (ทุ่งแค้ว 30 ตำแหน่ง 2569-10-30)
-- ทำให้คนกองอื่นถือตำแหน่งนั้นไม่ได้อีก (เช่น ธุรการ) — ปัญหาเดิมที่ #615 แก้ไปแล้ว
--
-- admin_save_position รับ department_hint ("กองหลัก") ได้เพิ่ม:
-- - ตำแหน่งใช้ได้ทุกกอง: department_hint = ชื่อกองที่ใช้งานอยู่ของ อปท. เดียวกัน หรือ NULL
-- - ตำแหน่งล็อกกอง: department_hint = ชื่อกองที่ล็อก (เหมือนเดิม)
-- - audit_logs เพิ่ม hint_before / hint_after
-- การเปลี่ยนกองหลักไม่ย้ายใคร (ไม่ใช่การล็อก) จึงไม่ต้องยืนยันจำนวนผู้ถือ
--
-- ตั้งต้นจากนิยามล่าสุดใน 20261030110000 ทั้งฟังก์ชัน แก้เฉพาะจุดที่ระบุ (CREATE OR REPLACE เขียนทับทั้งตัว)
-- ปลอดภัยกับหน้าเว็บรุ่นเก่า: client เดิมไม่ส่ง department_hint จึงได้พฤติกรรมเดิมทุกอย่าง

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_unit_head_position_name(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261030110000_position_shared_by_default first';
  END IF;
END;
$$;

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
  v_hint text;
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
     OR (p_changes - ARRAY['name','category','role','department_id','department_hint','sort_order']::text[]) <> '{}'::jsonb
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

  -- กองหลักของตำแหน่งใช้ได้ทุกกอง (department_hint): จัดกลุ่ม + เติมกองให้ตอนแต่งตั้ง ไม่ล็อก
  -- รับเฉพาะชื่อกองที่ใช้งานอยู่ของ อปท. เดียวกัน (หรือ NULL = ไม่ระบุ) — ข้อความอิสระทำให้จับคู่กองไม่ได้
  -- ตำแหน่งล็อกกอง: กองหลัก = กองที่ล็อกเสมอ ค่าที่ส่งมาถูกเมิน
  IF v_new.department_id IS NOT NULL THEN
    v_hint := v_department_name;
  ELSIF p_changes ? 'department_hint' THEN
    v_hint := NULLIF(btrim(p_changes->>'department_hint'), '');
    IF v_hint IS NOT NULL THEN
      SELECT d.name INTO v_hint FROM public.departments d
      WHERE d.municipality_id = v_old.municipality_id AND d.is_active IS TRUE AND d.name = v_hint;
      IF NOT FOUND THEN RAISE EXCEPTION 'Select an active department in this municipality'; END IF;
    END IF;
  ELSE
    v_hint := v_old.department_hint;
  END IF;

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
  -- ใช้ได้ทุกกอง = คงกองเดิมไว้เป็น "กองที่มักสังกัด" ให้ระบบเติมตอนแต่งตั้ง (เดิมล้างเป็น NULL)
  UPDATE public.positions SET name=v_new.name, category=v_new.category, role=v_new.role,
    department_id=v_new.department_id,
    department_hint=v_hint,
    sort_order=v_new.sort_order
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
      'holder_count',v_holder_count,'moved_count',v_moved_count,'confirmed_move',COALESCE(p_confirm_move,false),
      'hint_before',v_old.department_hint,'hint_after',v_hint)
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
