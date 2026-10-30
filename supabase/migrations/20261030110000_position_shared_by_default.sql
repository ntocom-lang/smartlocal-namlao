-- ตำแหน่ง "ใช้ได้ทุกกอง" เป็นค่าตั้งต้น: กองเป็นของคน ไม่ใช่ของตำแหน่ง (เจ้าของระบบอนุมัติ 2569-10-30)
-- เดิม merge มาในชื่อ 20261030100000 (#615) ซึ่งชนเลขกับ telegram_dm_columns (#616) จึงเปลี่ยนเลข
-- apply กับ production แล้ว 2569-10-30 — schema_migrations บันทึกไว้ที่เลขใหม่นี้
--
-- เหตุ: ตำแหน่งสายงาน เช่น เจ้าพนักงานธุรการ / เจ้าพนักงานจ้างเหมาปฏิบัติหน้าที่ธุรการ มีแทบทุกกอง
-- แต่ระบบเดิมผูกตำแหน่งกับกองเดียว ทำให้แอดมินแต่งตั้งคนกองอื่นไม่ได้ และแก้กองที่ใส่ผิดไม่ได้
-- ใช้ได้กับทุกประเภท อปท. (อบต./ทต./ทม./ทน./อบจ.) เพราะไม่อิงชื่อกองหรือ org_type
--
-- กฎหลังไฟล์นี้
-- 1. department_id ของตำแหน่ง = "ล็อกกอง" ใช้เฉพาะตำแหน่งหัวหน้าหน่วยงาน (แอดมินเลือกเอง)
-- 2. department_hint = "กองที่มักสังกัด" เป็นคำแนะนำ ระบบเติมให้ตอนแต่งตั้ง แต่ไม่ล็อก
-- 3. guard เลิกเดาผูกกองจาก department_hint เอง (เดิมผูกทุกตำแหน่งที่ชื่อกองตรง เช่น นายช่างโยธา→กองช่าง)
--    import_default_positions ผูกเองเฉพาะชื่อหัวหน้าหน่วยงาน + ชื่อกองตรงกันเพียงกองเดียว
-- 4. กลับเป็นส่วนกลางแล้วคงกองเดิมไว้เป็นกองแนะนำ ไม่ลบทิ้ง
--
-- ฟังก์ชันทั้ง 3 ตัวตั้งต้นจากนิยามล่าสุดใน 20261024210000_position_department_move.sql
-- (และ 20260831142000 สำหรับ import_default_positions) แก้เฉพาะจุดที่ระบุ
-- ข้อมูลเดิมยังไม่ถูกแก้ในไฟล์นี้ — แยกไปไฟล์ 20261030110100

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.admin_save_position(uuid,jsonb,uuid,boolean,integer)') IS NULL
     OR to_regprocedure('public.import_default_positions(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261024210000_position_department_move first';
  END IF;
END;
$$;

-- ชื่อตำแหน่งหัวหน้าหน่วยงานระดับกอง (มีได้กองเดียวโดยธรรมชาติ)
-- ต้องตรงกับ UNIT_HEAD_POSITION_PATTERN ใน src/lib/personnelStructure.js (เทสต์ตรวจให้)
-- "หัวหน้าฝ่าย..." ไม่นับ เพราะฝ่ายชื่อเดียวกันมีได้หลายกอง เช่น ฝ่ายบริหารงานทั่วไป
CREATE OR REPLACE FUNCTION public.is_unit_head_position_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_name ~ '^\s*(รอง)?ผู้อำนวยการ\s*(กอง|สำนัก)|^\s*หัวหน้า\s*สำนัก|^\s*หัวหน้า\s*หน่วย\s*ตรวจสอบภายใน', false)
$$;
REVOKE ALL ON FUNCTION public.is_unit_head_position_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_unit_head_position_name(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_position_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_department public.departments%ROWTYPE;
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
  -- ตำแหน่งใช้ได้ทุกกอง: department_hint เป็นแค่กองแนะนำ ห้ามเดาผูกกองจากข้อความเอง
  -- (เดิมผูกให้ทุกตำแหน่งที่ชื่อกองตรง ทำให้ตำแหน่งที่มีหลายกองถูกล็อกไว้กองเดียว)
  IF NEW.department_id IS NULL THEN
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

-- นำเข้าชุดมาตรฐาน: ผูกกองเฉพาะตำแหน่งหัวหน้าหน่วยงานที่ชื่อกองตรงกันเพียงกองเดียว
-- ตำแหน่งอื่นเป็น "ใช้ได้ทุกกอง" พร้อมกองแนะนำ ชื่อกองของ อปท. ไม่ตรงแม่แบบ (เช่น สำนักการช่าง
-- ของ ทม./ทน.) ก็แค่ไม่ผูก ไม่ผูกผิด
CREATE OR REPLACE FUNCTION public.import_default_positions(p_municipality_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุหน่วยงาน';
  END IF;

  -- SECURITY DEFINER ข้าม RLS ได้ จึงต้องตรวจสิทธิ์เองให้ครบ ไม่งั้นแอดมิน อปท. หนึ่ง
  -- ยิง RPC ใส่ municipality_id ของอีกหน่วยงานได้ตรงๆ
  IF NOT (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND p_municipality_id = public.get_my_municipality_id())
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์นำเข้าชุดตำแหน่งของหน่วยงานนี้';
  END IF;

  INSERT INTO public.positions (name, category, role, department_id, department_hint, sort_order, municipality_id)
  SELECT t.name, t.category, t.role,
    CASE WHEN matched.match_count = 1 AND public.is_unit_head_position_name(t.name) THEN matched.department_id END,
    t.department_hint, t.sort_order, p_municipality_id
  FROM public.position_templates t
  LEFT JOIN LATERAL (
    SELECT count(*) AS match_count, (array_agg(d.id))[1] AS department_id
    FROM public.departments d
    WHERE d.municipality_id = p_municipality_id
      AND d.is_active IS TRUE
      AND NULLIF(btrim(t.department_hint), '') IS NOT NULL
      AND (lower(btrim(d.name)) = lower(btrim(t.department_hint))
        OR lower(btrim(COALESCE(d.short_name, ''))) = lower(btrim(t.department_hint)))
  ) matched ON true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.positions p
    WHERE p.municipality_id = p_municipality_id AND p.name = t.name
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.import_default_positions(uuid) IS
  'คัดลอกชุดตำแหน่งมาตรฐานจาก position_templates เข้าให้หน่วยงานที่ระบุ (ข้ามชื่อที่มีอยู่แล้ว) ผูกกองเฉพาะหัวหน้าหน่วยงาน';

REVOKE ALL ON FUNCTION public.import_default_positions(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.import_default_positions(uuid) TO authenticated;

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
  -- ใช้ได้ทุกกอง = คงกองเดิมไว้เป็น "กองที่มักสังกัด" ให้ระบบเติมตอนแต่งตั้ง (เดิมล้างเป็น NULL)
  UPDATE public.positions SET name=v_new.name, category=v_new.category, role=v_new.role,
    department_id=v_new.department_id,
    department_hint=CASE WHEN v_new.department_id IS NULL THEN v_old.department_hint ELSE v_department_name END,
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
