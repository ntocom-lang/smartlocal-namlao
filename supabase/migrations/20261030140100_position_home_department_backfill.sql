-- ปลดล็อกตำแหน่งที่ไม่ใช่หัวหน้าหน่วยงานซ้ำอีกรอบ — กติกาเดียวกับ 20261030110100 (เจ้าของระบบอนุมัติ 2569-10-30 ทางเลือก ก)
-- ต้องรันหลัง 20261030140000_position_home_department.sql
--
-- เหตุ: แอดมินทุ่งแค้วล็อกกองให้ 30 ตำแหน่งที่ไม่ใช่หัวหน้า (2569-10-30 13:22–13:29 น.) เพื่อจัดกลุ่มตามกอง
-- เพราะหน้าจอเดิมจัดกลุ่มได้ทางเดียวคือล็อก ตอนนี้กองหลัก (department_hint) จัดกลุ่มได้โดยไม่ล็อกแล้ว
-- ตรวจ production ก่อนเขียนไฟล์: แถวที่ตรงเงื่อนไขมีเฉพาะทุ่งแค้ว 30 แถว อปท. อื่นล็อกเฉพาะหัวหน้า
--
-- ผลที่เกิด
-- - positions.department_id → NULL, department_hint = ชื่อกองที่เขาเลือกไว้ (ตำแหน่งยังอยู่ใต้กองเดิมในหน้าจอ)
-- - profiles ไม่ถูกแตะเลย: ผู้ถือตำแหน่งทุกคนอยู่กองเดิม (มีประตูตรวจ md5 ก่อน-หลัง)
-- - audit_logs รายตำแหน่ง reason = 'position_home_department_backfill' (metadata.department_before = กองที่เคยล็อก)
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
-- ย้อนกลับรายตำแหน่ง: เมนูจัดการผู้ใช้ → แบบตำแหน่ง → แก้ไข → ติ๊กล็อกกอง

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
      v_position.municipality_id, NULL, 'ระบบ (ปรับมาตรฐานตำแหน่ง รอบ 2)', 'system', 'update_position', 'position',
      v_position.id::text, v_position.name,
      jsonb_build_object('department_before', v_position.department_id, 'department_after', NULL,
        'moved_count', 0, 'reason', 'position_home_department_backfill')
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
