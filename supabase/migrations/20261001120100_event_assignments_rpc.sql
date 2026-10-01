-- มอบหมายผู้ไปแทนในกิจกรรมปฏิทิน ไฟล์ที่ 2/2 — ฟังก์ชันที่อ้างตาราง event_assignments
-- แยกจากไฟล์สร้างตาราง (20261001120000) ตามกติกา "1 ไฟล์ = 1 เฟส": ฟังก์ชัน LANGUAGE sql ที่อ้าง
-- ตารางซึ่งสร้างในไฟล์เดียวกันเคยพัง 42P01 บน production
--
-- 1. set_event_assignments      — ทางเขียนทางเดียว ตรวจสิทธิ์ + ประทับผู้บันทึก/เวลา + audit_logs
-- 2. list_event_assignee_candidates — รายชื่อบุคลากรที่มอบหมายได้ (staff อ่าน profiles คนอื่นเองไม่ได้)
-- 3. list_events_for_staff      — ยกนิยามจาก production (pg_get_functiondef 2569-10-01, md5 6aef4273…)
--                                  มาทั้งก้อน เพิ่มแค่ "ผู้รับมอบหมายเปิดอ่านได้" กับคีย์ assignments

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.event_assignments') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261001120000_event_assignments_table.sql ก่อนไฟล์นี้';
  END IF;
END $$;

-- ── 1. บันทึก/เปลี่ยน/ล้างการมอบหมายของกิจกรรมหนึ่ง ─────────────────────────────────────────────
--
-- p_assignees = [{ "profile_id": "<uuid>" } | { "name": "...", "title": "..." }, ...] สูงสุด 5 คน
--   - มี profile_id: ต้องเป็นบุคลากรภายในของ อปท. เดียวกัน ชื่อ/ตำแหน่งดึงจากฐานข้อมูลเอง
--     ไม่เชื่อค่าที่หน้าจอส่งมา (กันการแอบอ้างชื่อคนอื่น)
--   - ไม่มี profile_id: คนที่ไม่มีบัญชีในระบบ พิมพ์ชื่อ (บังคับ) + ตำแหน่ง (ไม่บังคับ)
--   - array ว่าง = ล้างการมอบหมาย
-- p_task: attend = ไปประชุมแทน · preside = เป็นประธาน/เปิดงานแทน · join = ร่วมงานแทน
--
-- สิทธิ์ (เจ้าของระบบเลือก 2569-10-01 "ผู้แก้ไขกิจกรรม + ผู้บริหาร"):
--   - คนที่แก้ไขกิจกรรมได้ = กติกาเดียวกับ policy "staff update events": superadmin / admin ของ อปท.
--     เดียวกัน / คนสร้าง / หัวหน้ากองของกิจกรรม
--   - viewer (นายก รองนายก เลขาฯ ที่ปรึกษา) ของ อปท. เดียวกัน บนกิจกรรมที่มีกลุ่ม 'management'
--     แม้ไม่ได้สร้างเอง — งานจริงคือเจ้าหน้าที่ลงกำหนดการ แล้วนายก/เลขาฯ เป็นคนสั่งว่าใครไปแทน
CREATE OR REPLACE FUNCTION public.set_event_assignments(
  p_event_id     uuid,
  p_task         text,
  p_on_behalf_of text,
  p_assignees    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_actor    record;
  v_event    record;
  v_org_type text;
  v_task     text := NULLIF(btrim(COALESCE(p_task, '')), '');
  v_behalf   text := NULLIF(btrim(COALESCE(p_on_behalf_of, '')), '');
  v_count    integer;
  v_item     jsonb;
  v_idx      integer := 0;
  v_pid      uuid;
  v_name     text;
  v_title    text;
  v_person   record;
  v_before   jsonb;
  v_after    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.role, p.municipality_id, p.department_id,
         COALESCE(p.is_dept_head, false) AS is_dept_head, p.full_name
    INTO v_actor
    FROM public.profiles p
   WHERE p.id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบข้อมูลบัญชีผู้ใช้' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: สองคนกดบันทึกการมอบหมายของกิจกรรมเดียวกันพร้อมกัน ให้เข้าคิวทีละคน
  SELECT e.id, e.municipality_id, e.created_by, e.department_id, e.title,
         COALESCE(e.audiences, ARRAY[]::text[]) AS audiences
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบกิจกรรมนี้' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_actor.role = 'superadmin'
    OR (
      v_actor.municipality_id = v_event.municipality_id
      AND (
        v_actor.role = 'admin'
        OR (
          v_actor.role IN ('viewer', 'council', 'officer', 'staff', 'technician')
          AND (
            v_event.created_by = v_uid
            OR (v_actor.is_dept_head AND v_actor.department_id IS NOT NULL
                AND v_actor.department_id = v_event.department_id)
          )
        )
        OR (v_actor.role = 'viewer' AND 'management' = ANY(v_event.audiences))
      )
    )
  ) THEN
    RAISE EXCEPTION 'บัญชีนี้ไม่มีสิทธิ์มอบหมายผู้ไปแทนในกิจกรรมนี้' USING ERRCODE = '42501';
  END IF;

  IF p_assignees IS NULL OR jsonb_typeof(p_assignees) <> 'array' THEN
    RAISE EXCEPTION 'รูปแบบรายชื่อผู้รับมอบหมายไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_assignees);
  IF v_count > 5 THEN
    RAISE EXCEPTION 'มอบหมายได้สูงสุด 5 คนต่อกิจกรรม' USING ERRCODE = '22023';
  END IF;
  IF v_count > 0 THEN
    IF v_task IS NULL OR v_task NOT IN ('attend', 'preside', 'join') THEN
      RAISE EXCEPTION 'กรุณาเลือกภารกิจที่มอบหมาย' USING ERRCODE = '22023';
    END IF;
    IF v_behalf IS NOT NULL AND char_length(v_behalf) > 120 THEN
      RAISE EXCEPTION 'ช่อง "แทน" ยาวเกิน 120 ตัวอักษร' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT m.org_type INTO v_org_type FROM public.municipalities m WHERE m.id = v_event.municipality_id;

  -- รูปแบบ JSON ต้องตรงกับคีย์ assignments ใน list_events_for_staff ด้านล่าง
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'profile_id', ea.profile_id, 'name', ea.assignee_name, 'title', ea.assignee_title,
           'task', ea.task, 'on_behalf_of', ea.on_behalf_of
         ) ORDER BY ea.sort_order, ea.assigned_at), '[]'::jsonb)
    INTO v_before
    FROM public.event_assignments ea
   WHERE ea.event_id = p_event_id;

  DELETE FROM public.event_assignments WHERE event_id = p_event_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_assignees) LOOP
    v_idx := v_idx + 1;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'รูปแบบรายชื่อผู้รับมอบหมายไม่ถูกต้อง' USING ERRCODE = '22023';
    END IF;

    v_pid := NULL;
    IF NULLIF(btrim(COALESCE(v_item->>'profile_id', '')), '') IS NOT NULL THEN
      BEGIN
        v_pid := (v_item->>'profile_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'รหัสบุคลากรไม่ถูกต้อง' USING ERRCODE = '22023';
      END;

      SELECT NULLIF(btrim(COALESCE(p.full_name, '')), '') AS full_name,
             public.event_assignee_title(p.job_title, pos.name, v_org_type) AS title
        INTO v_person
        FROM public.profiles p
        LEFT JOIN public.positions pos ON pos.id = p.position_id
       WHERE p.id = v_pid
         AND p.municipality_id = v_event.municipality_id
         AND p.role IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ผู้รับมอบหมายต้องเป็นบุคลากรของหน่วยงานนี้' USING ERRCODE = '22023';
      END IF;
      IF v_person.full_name IS NULL THEN
        RAISE EXCEPTION 'บัญชีผู้รับมอบหมายยังไม่มีชื่อในระบบ ให้พิมพ์ชื่อเองแทน' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.event_assignments ea
                  WHERE ea.event_id = p_event_id AND ea.profile_id = v_pid) THEN
        RAISE EXCEPTION 'เลือกบุคคลเดียวกันซ้ำ' USING ERRCODE = '22023';
      END IF;
      v_name  := v_person.full_name;
      v_title := v_person.title;
    ELSE
      v_name  := NULLIF(btrim(COALESCE(v_item->>'name', '')), '');
      v_title := NULLIF(btrim(COALESCE(v_item->>'title', '')), '');
      IF v_name IS NULL OR char_length(v_name) > 120 THEN
        RAISE EXCEPTION 'กรุณาพิมพ์ชื่อผู้รับมอบหมาย (ไม่เกิน 120 ตัวอักษร)' USING ERRCODE = '22023';
      END IF;
      IF v_title IS NOT NULL AND char_length(v_title) > 120 THEN
        RAISE EXCEPTION 'ตำแหน่งยาวเกิน 120 ตัวอักษร' USING ERRCODE = '22023';
      END IF;
    END IF;

    INSERT INTO public.event_assignments
      (event_id, municipality_id, profile_id, assignee_name, assignee_title,
       task, on_behalf_of, sort_order, assigned_by)
    VALUES
      (p_event_id, v_event.municipality_id, v_pid, v_name, v_title,
       v_task, v_behalf, v_idx, v_uid);
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'profile_id', ea.profile_id, 'name', ea.assignee_name, 'title', ea.assignee_title,
           'task', ea.task, 'on_behalf_of', ea.on_behalf_of
         ) ORDER BY ea.sort_order, ea.assigned_at), '[]'::jsonb)
    INTO v_after
    FROM public.event_assignments ea
   WHERE ea.event_id = p_event_id;

  -- ย้อนตรวจได้ว่าใครเปลี่ยนการมอบหมายจากอะไรเป็นอะไร เมื่อไร — เขียนฝั่งเซิร์ฟเวอร์ หน้าจอข้ามไม่ได้
  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.audit_logs
      (municipality_id, actor_id, actor_name, actor_role, action,
       resource_type, resource_id, resource_label, metadata)
    VALUES
      (v_event.municipality_id, v_uid, v_actor.full_name, v_actor.role, 'assign',
       'event', p_event_id::text, v_event.title,
       jsonb_build_object('before', v_before, 'after', v_after));
  END IF;

  -- คืนรูปแบบเดียวกับคีย์ assignments ของ list_events_for_staff หน้าจอจะได้แทนค่าได้ทันที
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'profile_id',       ea.profile_id,
             'name',             ea.assignee_name,
             'title',            ea.assignee_title,
             'task',             ea.task,
             'on_behalf_of',     ea.on_behalf_of,
             'assigned_at',      ea.assigned_at,
             'assigned_by_name', bp.full_name
           ) ORDER BY ea.sort_order, ea.assigned_at), '[]'::jsonb)
      FROM public.event_assignments ea
      LEFT JOIN public.profiles bp ON bp.id = ea.assigned_by
     WHERE ea.event_id = p_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_assignments(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_assignments(uuid, text, text, jsonb) TO authenticated;

-- ── 2. รายชื่อบุคลากรที่มอบหมายได้ ─────────────────────────────────────────────────────────────
--
-- ต้องเป็น RPC เพราะ policy ของ profiles ไม่ให้ role staff อ่านโปรไฟล์คนอื่น (เจ้าหน้าที่ธุรการคือคน
-- ลงกำหนดการให้ผู้บริหารบ่อยที่สุด) — คืนแค่ชื่อ ตำแหน่ง และกลุ่ม ไม่มีเบอร์/อีเมล ให้เฉพาะบุคลากรภายใน
-- ของ อปท. เดียวกัน · กลุ่มมาจาก positions.category ไม่มีตำแหน่งจึงเดาจาก role
-- plpgsql (ไม่ใช่ sql) เพื่อไม่ให้ตัวฟังก์ชันถูกตรวจชื่อตารางตอนสร้าง — ดูหัวไฟล์
CREATE OR REPLACE FUNCTION public.list_event_assignee_candidates(p_municipality_id uuid)
RETURNS TABLE (profile_id uuid, full_name text, title text, group_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_muni uuid;
BEGIN
  SELECT p.role, p.municipality_id INTO v_role, v_muni
    FROM public.profiles p
   WHERE p.id = auth.uid();
  IF v_role IS NULL OR NOT (
    v_role = 'superadmin'
    OR (v_role IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician')
        AND v_muni = p_municipality_id)
  ) THEN
    RAISE EXCEPTION 'เฉพาะบุคลากรของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id, c.person_name, c.person_title, c.grp
    FROM (
      SELECT p.id,
             btrim(p.full_name) AS person_name,
             public.event_assignee_title(p.job_title, pos.name, m.org_type) AS person_title,
             CASE
               WHEN pos.category = 'political_exec'
                 OR (pos.category IS NULL AND p.role = 'viewer') THEN 'executive'
               WHEN pos.category IN ('top_admin', 'dept_head')
                 OR (pos.category IS NULL AND p.role IN ('admin', 'officer')) THEN 'admin'
               WHEN pos.category = 'council'
                 OR (pos.category IS NULL AND p.role = 'council') THEN 'council'
               ELSE 'staff'
             END AS grp,
             COALESCE(pos.sort_order, 9999) AS pos_order
        FROM public.profiles p
        JOIN public.municipalities m ON m.id = p.municipality_id
        LEFT JOIN public.positions pos ON pos.id = p.position_id
       WHERE p.municipality_id = p_municipality_id
         AND p.role IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician')
         AND NULLIF(btrim(p.full_name), '') IS NOT NULL
    ) c
   ORDER BY CASE c.grp WHEN 'executive' THEN 1 WHEN 'admin' THEN 2 WHEN 'council' THEN 3 ELSE 4 END,
            c.pos_order, c.person_name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_assignee_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_event_assignee_candidates(uuid) TO authenticated;

-- ── 3. รายการกิจกรรมของบุคลากรภายใน — เพิ่มผู้รับมอบหมาย ──────────────────────────────────────
-- นิยามเดิมทั้งก้อนจาก production เพิ่ม 2 จุดที่มีคอมเมนต์ (2569-10-01) เท่านั้น
-- return type คงเดิม (SETOF jsonb) หน้าเว็บรุ่นก่อนหน้าแค่ไม่ได้ใช้คีย์ใหม่ ไม่พัง
CREATE OR REPLACE FUNCTION public.list_events_for_staff(p_municipality_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH actor AS (
    SELECT
      p.id,
      p.role,
      p.municipality_id,
      p.department_id,
      COALESCE(p.is_dept_head, false) AS is_dept_head
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), scoped AS (
    SELECT
      e.*,
      (
        -- ประกาศเป็นสาธารณะ ประชาชนก็เห็นอยู่แล้ว ไม่มีเหตุให้ปิดจากเจ้าหน้าที่
        'public' = ANY(COALESCE(e.audiences, ARRAY[]::text[]))
        -- ผู้ดูแลระบบ
        OR a.role IN ('admin', 'superadmin')
        -- คนสร้างเอง
        OR e.created_by = a.id
        -- หัวหน้ากอง ดูของกองตัวเองได้ (กติกาเดียวกับสิทธิ์แก้ไข/ลบในหน้าจอ)
        OR (a.is_dept_head AND a.department_id IS NOT NULL AND e.department_id = a.department_id)
        -- บทบาทตรงกับกลุ่มเป้าหมายของกิจกรรม
        OR (a.role = 'viewer'  AND 'management' = ANY(COALESCE(e.audiences, ARRAY[]::text[])))
        OR (a.role = 'council' AND 'council'    = ANY(COALESCE(e.audiences, ARRAY[]::text[])))
        OR (a.role IN ('officer', 'staff', 'technician')
            AND 'staff' = ANY(COALESCE(e.audiences, ARRAY[]::text[])))
        -- (2569-10-01) ผู้รับมอบหมายให้ไปแทนต้องอ่านรายละเอียดได้ แม้ไม่อยู่ในกลุ่มเป้าหมาย
        -- เช่น ผอ.กองที่ถูกส่งไปประชุมแทนนายกในกิจกรรมกลุ่ม "ผู้บริหาร"
        OR EXISTS (
          SELECT 1
          FROM public.event_assignments ea
          WHERE ea.event_id = e.id AND ea.profile_id = a.id
        )
      ) AS can_view_detail
    FROM public.events e
    CROSS JOIN actor a
    WHERE e.municipality_id = p_municipality_id
      -- superadmin ข้ามเทศบาลได้ตามการออกแบบ ที่เหลือต้องอยู่เทศบาลเดียวกันเท่านั้น
      AND (a.role = 'superadmin' OR a.municipality_id = p_municipality_id)
  )
  SELECT
    (
      CASE
        WHEN s.can_view_detail THEN to_jsonb(s)
        ELSE
          (to_jsonb(s) - ARRAY['description', 'attachment_url', 'attachment_urls']::text[])
          || jsonb_build_object(
               'description',     NULL,
               'attachment_url',  NULL,
               'attachment_urls', ARRAY[]::text[]
             )
      END
    )
    -- has_attachment: ให้หน้าจอยังโชว์ไอคอนคลิปหนีบแบบกดไม่ได้ ผู้ใช้จะได้รู้ว่ามีไฟล์อยู่
    -- และไปขอจากคนที่มีสิทธิ์ได้ โดยไม่ต้องส่ง URL จริงมาให้
    || jsonb_build_object(
         'has_attachment', (
           COALESCE(array_length(s.attachment_urls, 1), 0) > 0
           OR s.attachment_url IS NOT NULL
         ),
         'creator', CASE
           WHEN cp.id IS NULL THEN NULL
           ELSE jsonb_build_object('full_name', cp.full_name)
         END,
         -- (2569-10-01) ผู้รับมอบหมาย — นับเป็น "รายละเอียด" คนที่ไม่มีสิทธิ์ได้ [] แบบเดียวกับ description
         -- รูปแบบต้องตรงกับค่าที่ set_event_assignments คืน
         'assignments', CASE
           WHEN s.can_view_detail THEN (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'profile_id',       ea.profile_id,
                      'name',             ea.assignee_name,
                      'title',            ea.assignee_title,
                      'task',             ea.task,
                      'on_behalf_of',     ea.on_behalf_of,
                      'assigned_at',      ea.assigned_at,
                      'assigned_by_name', bp.full_name
                    ) ORDER BY ea.sort_order, ea.assigned_at), '[]'::jsonb)
             FROM public.event_assignments ea
             LEFT JOIN public.profiles bp ON bp.id = ea.assigned_by
             WHERE ea.event_id = s.id
           )
           ELSE '[]'::jsonb
         END
       )
  FROM scoped s
  LEFT JOIN public.profiles cp ON cp.id = s.created_by
  ORDER BY s.event_date ASC NULLS LAST, s.event_time ASC NULLS LAST, s.created_at ASC
$$;

REVOKE ALL ON FUNCTION public.list_events_for_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_events_for_staff(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_events_for_staff(uuid) IS
  'รายการกิจกรรมสำหรับหน้าเจ้าหน้าที่ — คืนทุกแถวของเทศบาลแต่ตัด description/ไฟล์แนบ/ผู้รับมอบหมายออก '
  'สำหรับคนที่ไม่มีสิทธิ์ดูรายละเอียด แนบ can_view_detail และ has_attachment มาให้หน้าจอใช้ '
  'ผู้รับมอบหมายให้ไปแทนเปิดอ่านรายละเอียดได้เสมอ (2569-10-01)';
COMMENT ON FUNCTION public.set_event_assignments(uuid, text, text, jsonb) IS
  'บันทึก/เปลี่ยน/ล้างผู้รับมอบหมายให้ไปแทนในกิจกรรม — ตรวจสิทธิ์ ประทับผู้บันทึก และเขียน audit_logs '
  'บันทึกเพื่อแจ้งให้ทราบภายใน ไม่ใช่คำสั่งมอบหมาย/มอบอำนาจตามกฎหมาย';

NOTIFY pgrst, 'reload schema';

COMMIT;
