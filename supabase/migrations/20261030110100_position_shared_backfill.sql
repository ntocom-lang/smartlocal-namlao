-- ล้างข้อมูลเดิมครั้งเดียวทุก อปท.: ตำแหน่งที่ผูกกองแต่ไม่ใช่หัวหน้าหน่วยงาน → ใช้ได้ทุกกอง
-- (เจ้าของระบบอนุมัติ 2569-10-30) ต้องรันหลัง 20261030110000_position_shared_by_default.sql
-- เดิม merge มาในชื่อ 20261030100100 (#615) ซึ่งชนเลขกับ telegram_dm_functions (#616) จึงเปลี่ยนเลข
-- apply กับ production แล้ว 2569-10-30 (63 ตำแหน่ง ไม่มีบุคลากรถูกย้าย) — schema_migrations บันทึกไว้ที่เลขใหม่นี้
--
-- ผลที่เกิด
-- - positions.department_id → NULL, department_hint = ชื่อกองเดิม (ระบบยังเติมกองนี้ให้ตอนแต่งตั้ง)
-- - profiles ไม่ถูกแตะเลย: ผู้ถือตำแหน่งทุกคนอยู่กองเดิม สิทธิ์ที่ผูกกับกองไม่เปลี่ยน
-- - บันทึก audit_logs รายตำแหน่ง (actor_role = 'system') ย้อนตรวจได้ว่าตำแหน่งไหนเคยผูกกองไหน
--
-- ดูรายการที่จะเปลี่ยนก่อนรัน (อ่านอย่างเดียว):
--   SELECT m.name AS municipality, p.name AS position, d.name AS department_before,
--     (SELECT count(*) FROM public.profiles h WHERE h.position_id = p.id) AS holders
--   FROM public.positions p
--   JOIN public.municipalities m ON m.id = p.municipality_id
--   LEFT JOIN public.departments d ON d.id = p.department_id
--   WHERE p.department_id IS NOT NULL AND NOT public.is_unit_head_position_name(p.name)
--   ORDER BY m.name, d.name, p.name;
--
-- ย้อนกลับรายตำแหน่ง: เมนูแบบตำแหน่ง → แก้ไข → เลือกกอง (ผ่าน admin_save_position ตามปกติ)
-- หรือใช้ metadata.department_before ใน audit_logs ที่ reason = 'position_shared_by_default_backfill'

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_unit_head_position_name(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261030110000_position_shared_by_default first';
  END IF;
END;
$$;

DO $$
DECLARE
  v_position record;
  v_count integer := 0;
  v_profiles_before text;
  v_move_flag text := COALESCE(current_setting('app.position_department_move', true), '');
BEGIN
  -- ประตูกันพลาด: สังกัดของบุคลากรต้องเหมือนเดิมทุกคนหลังรัน
  SELECT md5(COALESCE(string_agg(p.id::text || ':' || COALESCE(p.department_id::text, '-'), ',' ORDER BY p.id), ''))
    INTO v_profiles_before
  FROM public.profiles p WHERE p.position_id IS NOT NULL;

  FOR v_position IN
    SELECT p.id, p.municipality_id, p.name, p.department_id, d.name AS department_name
    FROM public.positions p
    LEFT JOIN public.departments d ON d.id = p.department_id
    WHERE p.department_id IS NOT NULL
      AND NOT public.is_unit_head_position_name(p.name)
    ORDER BY p.municipality_id, p.id
    FOR UPDATE OF p
  LOOP
    PERFORM set_config('app.position_department_move', v_position.id::text, true);
    UPDATE public.positions
    SET department_id = NULL,
        department_hint = COALESCE(v_position.department_name, department_hint)
    WHERE id = v_position.id;

    INSERT INTO public.audit_logs (
      municipality_id, actor_id, actor_name, actor_role, action, resource_type, resource_id, resource_label, metadata
    ) VALUES (
      v_position.municipality_id, NULL, 'ระบบ (ปรับมาตรฐานตำแหน่ง)', 'system', 'update_position', 'position',
      v_position.id::text, v_position.name,
      jsonb_build_object('department_before', v_position.department_id, 'department_after', NULL,
        'moved_count', 0, 'reason', 'position_shared_by_default_backfill')
    );
    v_count := v_count + 1;
  END LOOP;
  PERFORM set_config('app.position_department_move', v_move_flag, true);

  IF v_profiles_before IS DISTINCT FROM (
    SELECT md5(COALESCE(string_agg(p.id::text || ':' || COALESCE(p.department_id::text, '-'), ',' ORDER BY p.id), ''))
    FROM public.profiles p WHERE p.position_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Personnel departments changed during backfill — aborted';
  END IF;

  RAISE NOTICE 'positions switched to shared: %', v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
