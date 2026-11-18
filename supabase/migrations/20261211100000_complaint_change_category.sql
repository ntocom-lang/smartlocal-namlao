-- 20261211100000_complaint_change_category.sql
--
-- แก้ประเภทคำร้องที่ยื่นแล้ว (กองตามประเภทใหม่) + ย้ายเรื่องค้างตามกองของประเภทที่แอดมินแก้
--
-- ที่มา (เจ้าของระบบแจ้ง 2569-11-18): คำร้อง ES-69-0034 หมวด "สนับสนุนน้ำอุปโภค" ยื่นตอนหมวดยังผูกกองช่าง
-- แอดมินแก้กองของหมวดเป็นสำนักปลัดทีหลัง แต่การแก้นั้นมีผลเฉพาะคำร้องใหม่ คำร้องเดิมยังเป็นกองช่าง
-- ใบพิมพ์ (prepare_complaint_print) อ่านกองจากตัวคำร้อง → ขึ้นชื่อกองช่าง + หัวหน้ากองช่าง ใช้งานจริงไม่ได้
-- และหน้าเว็บไม่มีทางย้ายกองของคำร้องที่ยื่นแล้วเลย (ปุ่ม "ส่งคืนแอดมิน" คืนเรื่องได้ แต่แอดมินแก้กองไม่ได้)
--
-- ⚠️ ทำไมเป็น "แก้ประเภท" ไม่ใช่ "โอนกอง" (เจ้าของระบบเลือก 2569-11-18):
--   trigger trg_resolve_complaint_routing → guard_complaint_routing_scope() (20260901160000) ตั้ง
--   department_id/department ตามกองของประเภททุกครั้งที่ UPDATE คอลัมน์กอง/ประเภท โอนกองโดยไม่แก้ประเภท
--   จะถูกดีดกลับเงียบๆ · ไฟล์นี้จึงไม่แตะ trigger นั้น — แก้ประเภทแล้วปล่อยให้ trigger เลือกกองเอง
--   แล้วตรวจซ้ำว่ากองที่ได้ตรงกับที่คาด ไม่ตรง = RAISE ย้อนทั้งเรื่อง
--
-- ใครทำอะไรได้
--   change_complaint_category        : admin / superadmin / officer (หัวหน้ากอง) ที่เป็นผู้ทำงานของเรื่อง
--                                      (complaint_worker_can_act) · ต้องมีเหตุผล 5–500 ตัวอักษร
--                                      staff/technician ใช้ปุ่ม "ส่งคืนแอดมิน" เดิม (การเปลี่ยนกองเป็นการตัดสินของหัวหน้า)
--                                      เรื่องแจ้งการทุจริต (corruption) เข้า/ออกได้เฉพาะแอดมิน — ล็อกเดียวกับ #756
--   reroute_category_open_complaints : admin / superadmin เท่านั้น (เป็นคนแก้กองของประเภท) ·
--                                      p_apply=false นับอย่างเดียว ให้หน้าเว็บถามก่อน · true ย้ายจริง
--
-- กติกาที่ใช้ร่วมกัน (complaint_reroute_apply — ฟังก์ชันภายใน ไม่เปิดให้เรียกจาก API)
--   - เรื่องที่จบแล้ว (closed/completed/done/rejected) ไม่แตะ — เอกสารที่ออกไปแล้วต้องคงเดิม
--     (และ UPDATE จะเลื่อน updated_at ซึ่ง prepare_complaint_print ใช้เลือกผู้ลงนามของเรื่องที่ไม่มี closed_at)
--   - ผู้รับผิดชอบเดิมอยู่กองใหม่ = คงไว้ · ไม่ใช่ = ใช้ผู้รับผิดชอบเริ่มต้นของประเภท (category_assignments)
--     เฉพาะเมื่อคนนั้นอยู่กองของประเภท (ไม่งั้นเรื่องวนกลับไปหาคนกองเดิม) · ประเภทที่ requires_manual_intake
--     = ไม่ตั้งใคร ให้แอดมินรับเรื่อง
--   - ไม่มีผู้รับผิดชอบหลังย้าย และเรื่องอยู่ received/in_progress/parked → กลับเป็น pending (คิวแอดมิน) แบบเดียวกับ
--     return_complaint_to_intake · in_progress ที่เปลี่ยนผู้รับผิดชอบ → received (คนใหม่ยังไม่เริ่มงาน) · pending/new คงเดิม
--   - เรื่องแจ้งการทุจริต: timeline เขียนข้อความกลางๆ ไม่มีชื่อหมวด/เหตุผล (viewer/council อ่าน timeline ได้)
--   - ย้ายทั้งชุด: เรื่องที่ถูกปิด/ย้ายระหว่างนับกับย้ายจะถูกข้าม (skipped) ไม่ทำให้ทั้งชุดล้ม
--   - กำหนดเสร็จ (due_date) คงเดิม — ประชาชนรอมาแล้วตั้งแต่วันยื่น การย้ายภายในไม่ควรเริ่มนับใหม่ (ความเห็นเชิงวิชาชีพ)
--   - ลง complaint_timeline + audit_logs ทุกเรื่อง (ใคร/เมื่อไร/จากอะไรเป็นอะไร/เหตุผล)
-- ⚠️ ไม่มีการอนุมัติเงิน/พัสดุ และไม่ตัดสินสิทธิของประชาชน — เป็นการจัดเส้นทางงานภายใน
--
-- ไม่มี DDL · ไม่ CREATE OR REPLACE ฟังก์ชันเดิมตัวใด (ฟังก์ชันใหม่ 3 ตัว)
-- ย้อนกลับ: DROP FUNCTION ทั้ง 3 ตัว (ข้อมูลที่ย้ายไปแล้วดูต้นทางได้จาก audit_logs.metadata)

DO $$
BEGIN
  IF to_regprocedure('public.complaint_worker_can_act(public.complaints)') IS NULL THEN
    RAISE EXCEPTION 'ต้องมี complaint_worker_can_act (20260915110100) ก่อน';
  END IF;
  IF to_regprocedure('public.guard_complaint_routing_scope()') IS NULL THEN
    RAISE EXCEPTION 'ต้องมี guard_complaint_routing_scope (20260901160000) ก่อน';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaint_categories' AND column_name = 'requires_manual_intake'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260915100000 (requires_manual_intake) ก่อน';
  END IF;
END $$;

-- ── 1) ตัวทำงานภายใน: ย้ายคำร้อง 1 เรื่องไปตามประเภทที่ระบุ ─────────────────────────
-- ผู้เรียก (RPC ข้างล่าง) ตรวจสิทธิ์และล็อกแถวมาก่อนแล้ว · SECURITY INVOKER + ถอน EXECUTE จากทุกบทบาท API
-- เรียกได้เฉพาะจากในฟังก์ชัน SECURITY DEFINER ที่ทำงานเป็นเจ้าของฟังก์ชัน
CREATE OR REPLACE FUNCTION public.complaint_reroute_apply(
  p_complaint_id uuid,
  p_category     text,
  p_reason       text,
  p_actor        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c            public.complaints%ROWTYPE;
  v_cat          public.complaint_categories%ROWTYPE;
  v_old_label    text;
  v_old_dept     text;
  v_new_dept     text;
  v_assignee     uuid;
  v_assignee_dep uuid;
  v_status       text;
  v_extra        jsonb;
  v_chk_dept     uuid;
  v_note         text;
BEGIN
  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบคำร้อง' USING ERRCODE = 'P0002';
  END IF;
  IF v_c.status IN ('closed', 'completed', 'done', 'rejected') THEN
    RAISE EXCEPTION 'เรื่องที่ดำเนินการเสร็จหรือปฏิเสธแล้วแก้ประเภทไม่ได้ (เอกสารที่ออกไปแล้วต้องคงเดิม)'
      USING ERRCODE = '22023';
  END IF;

  -- เลือกแถวประเภทด้วยลำดับเดียวกับ guard_complaint_routing_scope() — ให้ผลตรงกับที่ trigger จะเลือก
  SELECT * INTO v_cat
  FROM public.complaint_categories
  WHERE municipality_id = v_c.municipality_id AND value = p_category
  ORDER BY is_active DESC, sort_order, id
  LIMIT 1;
  IF NOT FOUND OR v_cat.department_id IS NULL THEN
    RAISE EXCEPTION 'ประเภทนี้ยังไม่ได้ตั้งกองรับผิดชอบ ให้แอดมินตั้งในหน้าประเภทคำร้องก่อน' USING ERRCODE = '22023';
  END IF;
  IF v_cat.is_adhoc THEN
    RAISE EXCEPTION 'ย้ายเข้าประเภทเฉพาะกิจไม่ได้' USING ERRCODE = '22023';
  END IF;

  SELECT name INTO v_new_dept
  FROM public.departments
  WHERE id = v_cat.department_id AND municipality_id = v_c.municipality_id;
  IF v_new_dept IS NULL THEN
    RAISE EXCEPTION 'กองของประเภทนี้ไม่อยู่ในหน่วยงานเดียวกัน' USING ERRCODE = '23503';
  END IF;

  SELECT d.name INTO v_old_dept FROM public.departments d WHERE d.id = v_c.department_id;
  v_old_dept := coalesce(v_old_dept, nullif(btrim(v_c.department), ''), 'ไม่ระบุกอง');
  SELECT label INTO v_old_label
  FROM public.complaint_categories
  WHERE municipality_id = v_c.municipality_id AND value = v_c.category
  ORDER BY is_active DESC, sort_order, id
  LIMIT 1;
  v_old_label := coalesce(v_old_label, v_c.category);

  -- ผู้รับผิดชอบ
  v_assignee := v_c.assigned_to;
  IF v_cat.requires_manual_intake THEN
    v_assignee := NULL;
  ELSIF v_assignee IS NOT NULL THEN
    SELECT department_id INTO v_assignee_dep FROM public.profiles WHERE id = v_assignee;
    IF v_assignee_dep IS DISTINCT FROM v_cat.department_id THEN
      v_assignee := NULL;
    END IF;
  END IF;
  -- ผู้รับผิดชอบเริ่มต้นของประเภทใช้ได้เฉพาะเมื่ออยู่กองเดียวกับประเภท — แอดมินมักแก้กองของประเภท
  -- แต่ยังไม่ได้เปลี่ยนผู้รับผิดชอบเริ่มต้น (เคส ES-69-0034) ถ้าไม่กรอง เรื่องจะวนกลับไปหาช่างกองเดิม
  IF v_assignee IS NULL AND NOT v_cat.requires_manual_intake THEN
    SELECT ca.technician_id INTO v_assignee
    FROM public.category_assignments ca
    JOIN public.profiles p ON p.id = ca.technician_id
    WHERE ca.municipality_id = v_c.municipality_id AND ca.category = p_category
      AND p.department_id = v_cat.department_id
    LIMIT 1;
  END IF;

  v_status := v_c.status;
  v_extra := v_c.extra_data;
  -- parked รวมด้วย: ถ้าคงไว้ พอนำกลับเข้าคิว (unpark_complaint → received) จะได้เรื่องที่ไม่มีผู้รับผิดชอบ
  -- และไม่อยู่ทั้งคิวแอดมินและกล่องงานใคร · การพักเรื่องเป็นการตัดสินของกองเดิม กองใหม่ควรตัดสินเอง
  -- (guard_complaint_parked ล้าง parked_* ให้เองเมื่อออกจาก parked)
  IF v_assignee IS NULL AND v_c.status IN ('received', 'in_progress', 'parked') THEN
    v_status := 'pending';
    v_extra := coalesce(v_extra, '{}'::jsonb) - 'auto_received_at';
  ELSIF v_c.status = 'in_progress' AND v_assignee IS DISTINCT FROM v_c.assigned_to THEN
    -- คนใหม่ยังไม่ได้เริ่มงาน — ให้เขากดเริ่มงานเอง
    v_status := 'received';
  END IF;

  -- ธงเดียวกับ RPC ชุดรับ/ปิดงาน: ผ่านด่าน staff (enforce_staff_document_only_update) ได้เพราะตรวจสิทธิ์มาแล้ว
  PERFORM set_config('app.complaint_workflow', '1', true);
  UPDATE public.complaints
  SET category      = p_category,
      department_id = v_cat.department_id,
      department    = v_new_dept,
      assigned_to   = v_assignee,
      status        = v_status,
      extra_data    = v_extra
  WHERE id = v_c.id
  RETURNING department_id INTO v_chk_dept;
  PERFORM set_config('app.complaint_workflow', '', true);

  IF v_chk_dept IS DISTINCT FROM v_cat.department_id THEN
    RAISE EXCEPTION 'ระบบเลือกกองไม่ตรงกับประเภท (ได้ % แต่ประเภทนี้เป็นของ %) ยกเลิกการแก้ไข — แจ้งผู้ดูแลระบบ',
      coalesce((SELECT name FROM public.departments WHERE id = v_chk_dept), 'ไม่ระบุกอง'), v_new_dept
      USING ERRCODE = 'P0001';
  END IF;

  -- timeline อ่านได้ทั้ง viewer/council และเจ้าของเรื่อง (policy "scoped read complaint_timeline")
  -- เรื่องแจ้งการทุจริตห้ามมีชื่อหมวด/เหตุผลในนี้ (ล็อกเดียวกับ 20261207100000) — เก็บใน audit_logs (แอดมินอ่าน) อย่างเดียว
  IF 'corruption' IN (v_c.category, p_category) THEN
    v_note := 'แอดมินปรับประเภท/กองรับผิดชอบ';
  ELSE
  v_note := CASE
      WHEN p_category = v_c.category THEN 'ย้ายตามกองรับผิดชอบของประเภทที่แอดมินแก้'
      ELSE 'แก้ประเภทจาก "' || v_old_label || '" เป็น "' || v_cat.label || '"'
    END
    || CASE WHEN v_old_dept IS DISTINCT FROM v_new_dept THEN ' · ย้ายจาก' || v_old_dept || 'ไป' || v_new_dept ELSE '' END
    || CASE WHEN v_assignee IS NULL THEN ' · รอแอดมินรับเรื่อง/มอบหมายผู้รับผิดชอบ' ELSE '' END
    || CASE WHEN nullif(btrim(coalesce(p_reason, '')), '') IS NOT NULL THEN ' — ' || btrim(p_reason) ELSE '' END;
  END IF;

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (v_c.id, v_status, v_note, coalesce(p_actor, 'เจ้าหน้าที่'));

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_c.municipality_id, auth.uid(), p_actor, public.get_my_role(),
    CASE WHEN p_category = v_c.category THEN 'reroute_department' ELSE 'change_category' END,
    'complaint', v_c.id::text, v_c.ref_no,
    jsonb_build_object(
      'from_category', v_c.category, 'to_category', p_category,
      'from_department_id', v_c.department_id, 'from_department', v_old_dept,
      'to_department_id', v_cat.department_id, 'to_department', v_new_dept,
      'from_assigned_to', v_c.assigned_to, 'to_assigned_to', v_assignee,
      'from_status', v_c.status, 'to_status', v_status,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'id', v_c.id,
    'department', v_new_dept,
    'department_changed', v_old_dept IS DISTINCT FROM v_new_dept,
    'assigned_to', v_assignee,
    'assignee_changed', v_assignee IS DISTINCT FROM v_c.assigned_to,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_reroute_apply(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── 2) RPC: แก้ประเภทคำร้องทีละเรื่อง ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_complaint_category(
  p_complaint_id uuid,
  p_category     text,
  p_reason       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   text := coalesce(public.get_my_role(), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cat    text := btrim(coalesce(p_category, ''));
  v_c      public.complaints%ROWTYPE;
  v_active boolean;
  v_actor  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'แก้ประเภทคำร้องได้เฉพาะหัวหน้ากองหรือแอดมิน' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผล 5-500 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF v_cat = '' THEN
    RAISE EXCEPTION 'ยังไม่ได้เลือกประเภทใหม่' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  -- complaint_worker_can_act() คืน NULL ได้ (ดู park_complaints) ต้องห่อ coalesce เสมอ
  -- ไม่แยก "ไม่พบ" กับ "ไม่มีสิทธิ์" — กันไล่เดารหัสเรื่องของกองอื่น
  IF NOT FOUND OR NOT coalesce(public.complaint_worker_can_act(v_c), false) THEN
    RAISE EXCEPTION 'แก้ประเภทได้เฉพาะผู้ทำงานของคำร้องนี้' USING ERRCODE = '42501';
  END IF;
  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RAISE EXCEPTION 'คำร้องประเภทเฉพาะกิจแก้ประเภทไม่ได้' USING ERRCODE = '22023';
  END IF;
  IF v_cat = v_c.category THEN
    RAISE EXCEPTION 'เป็นประเภทนี้อยู่แล้ว' USING ERRCODE = '22023';
  END IF;
  IF 'corruption' IN (v_c.category, v_cat) AND v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'เรื่องแจ้งการทุจริตต้องให้แอดมินเป็นผู้แก้ประเภท' USING ERRCODE = '42501';
  END IF;

  -- ประเภทปลายทางต้องเปิดใช้อยู่ (ปิดไปแล้ว = แอดมินเลิกใช้ ไม่ควรมีเรื่องใหม่ไหลเข้า)
  SELECT bool_or(is_active) INTO v_active
  FROM public.complaint_categories
  WHERE municipality_id = v_c.municipality_id AND value = v_cat;
  IF NOT coalesce(v_active, false) THEN
    RAISE EXCEPTION 'ไม่พบประเภทนี้ หรือประเภทนี้ปิดใช้งานอยู่' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor
  FROM public.profiles WHERE id = auth.uid();

  RETURN public.complaint_reroute_apply(v_c.id, v_cat, v_reason, v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.change_complaint_category(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_complaint_category(uuid, text, text) TO authenticated;

-- ── 3) RPC: ย้ายเรื่องที่ยังไม่เสร็จของประเภทนี้ไปกองปัจจุบันของประเภท ─────────────────
-- หน้าแอดมินเรียกหลังบันทึกกองของประเภท: p_apply=false นับก่อน → ถามแอดมิน → p_apply=true ย้ายจริง
CREATE OR REPLACE FUNCTION public.reroute_category_open_complaints(
  p_municipality_id uuid,
  p_category        text,
  p_apply           boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role  text := coalesce(public.get_my_role(), '');
  v_cat   public.complaint_categories%ROWTYPE;
  v_dept  text;
  v_ids   uuid[];
  v_id    uuid;
  v_actor text;
  v_moved int := 0;
  v_skipped int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    v_role = 'superadmin'
    OR (v_role = 'admin' AND p_municipality_id IS NOT DISTINCT FROM public.get_my_municipality_id())
  ) OR p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'ย้ายเรื่องตามประเภทได้เฉพาะแอดมินของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cat
  FROM public.complaint_categories
  WHERE municipality_id = p_municipality_id AND value = p_category
  ORDER BY is_active DESC, sort_order, id
  LIMIT 1;
  -- ประเภทเฉพาะกิจ/ยังไม่มีกอง = ไม่มีอะไรให้ย้าย (ไม่ raise — หน้าเว็บเรียกทุกครั้งที่บันทึกกอง)
  IF NOT FOUND OR v_cat.is_adhoc OR v_cat.department_id IS NULL THEN
    RETURN jsonb_build_object('count', 0, 'moved', 0, 'department', NULL);
  END IF;
  SELECT name INTO v_dept FROM public.departments WHERE id = v_cat.department_id;

  -- เรียงรหัสก่อนล็อกแถว: กันล็อกไขว้กับ RPC ชุดอื่นที่ทำหลายเรื่องพร้อมกัน
  SELECT array_agg(id ORDER BY id) INTO v_ids
  FROM public.complaints
  WHERE municipality_id = p_municipality_id
    AND category = p_category
    AND status NOT IN ('closed', 'completed', 'done', 'rejected')
    AND department_id IS DISTINCT FROM v_cat.department_id;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('count', 0, 'moved', 0, 'department', v_dept);
  END IF;
  IF NOT coalesce(p_apply, false) THEN
    RETURN jsonb_build_object('count', cardinality(v_ids), 'moved', 0, 'department', v_dept);
  END IF;
  IF cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'มีเรื่องค้าง % เรื่อง เกินที่ย้ายได้ในครั้งเดียว (500) แจ้งผู้ดูแลระบบ', cardinality(v_ids)
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'แอดมิน') INTO v_actor
  FROM public.profiles WHERE id = auth.uid();

  -- ล็อกแล้วตรวจซ้ำรายเรื่อง: เรื่องที่ถูกปิด/ย้ายระหว่างนับกับย้าย ข้ามไป ไม่ให้ทั้งชุดล้มเพราะเรื่องเดียว
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.complaints
    WHERE id = v_id
      AND category = p_category
      AND status NOT IN ('closed', 'completed', 'done', 'rejected')
      AND department_id IS DISTINCT FROM v_cat.department_id
    FOR UPDATE;
    IF NOT FOUND THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    PERFORM public.complaint_reroute_apply(v_id, p_category, NULL, v_actor);
    v_moved := v_moved + 1;
  END LOOP;

  RETURN jsonb_build_object('count', cardinality(v_ids), 'moved', v_moved, 'skipped', v_skipped, 'department', v_dept);
END;
$$;

REVOKE ALL ON FUNCTION public.reroute_category_open_complaints(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reroute_category_open_complaints(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.change_complaint_category(uuid, text, text) IS
  'แก้ประเภทคำร้องที่ยังไม่เสร็จ (กองตามประเภทใหม่ผ่าน trigger) — แอดมิน/หัวหน้ากองที่เป็นผู้ทำงานของเรื่อง ต้องมีเหตุผล ลง complaint_timeline + audit_logs';
COMMENT ON FUNCTION public.reroute_category_open_complaints(uuid, text, boolean) IS
  'ย้ายคำร้องที่ยังไม่เสร็จของประเภทไปกองปัจจุบันของประเภท — แอดมินเท่านั้น p_apply=false นับอย่างเดียว';
COMMENT ON FUNCTION public.complaint_reroute_apply(uuid, text, text, text) IS
  'ภายใน: ย้ายคำร้อง 1 เรื่องตามประเภท + จัดผู้รับผิดชอบ/สถานะ + timeline + audit (ไม่เปิดให้ API เรียก)';
