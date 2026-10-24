-- 20261025100100_complaint_parked_functions.sql
--
-- สถานะ "ขึ้นทะเบียนรอดำเนินการ" (parked) — CHECK คู่คอลัมน์ + trigger กันเขียนตรง + RPC พักเรื่อง/นำกลับเข้าคิว
-- ต้อง apply หลัง 20261025100000 — เหตุผลการออกแบบอยู่ในไฟล์นั้น
--
-- ใครทำอะไรได้
--   park_complaints   : admin / superadmin / officer (หัวหน้ากอง) เท่านั้น และต้องเป็น "ผู้ทำงานของเรื่องนั้น"
--                       (complaint_worker_can_act) · หมวดต้องเปิด allow_parking · พักได้จาก received / in_progress
--                       ผู้รับผิดชอบทั่วไป (staff/technician) ไม่มีสิทธิ์ — การพักเรื่องคือการตัดสินของหัวหน้า ไม่ใช่ผู้ลงมือ
--   unpark_complaint  : สิทธิ์เดียวกัน · กลับเป็น received และ "เริ่มนับกำหนดเสร็จใหม่" (add_working_days จากวันนี้)
--                       ไม่งั้นเรื่องที่พักมาหลายเดือนจะกลับมาเกินกำหนดทันทีและฉุดผลงานผู้รับผิดชอบ
--
-- ทุกการพัก/นำกลับลง complaint_timeline (ใคร/เมื่อไร/เหตุผล) — ตรวจย้อนได้ตามหลัก "ระบบตัดสินต้องมีบันทึก"
-- ⚠️ ไม่มีการอนุมัติเงิน/พัสดุ/จัดซื้อจัดจ้าง และไม่ตัดสินสิทธิของประชาชน: เป็นแค่การจัดคิวงานภายใน

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'parked_reason'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaint_categories' AND column_name = 'allow_parking'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261025100000_complaint_parked_columns.sql ก่อน';
  END IF;
  IF to_regprocedure('public.add_working_days(date,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20260927220000_add_working_days_fn.sql ก่อน';
  END IF;
END $$;

-- ── 1) CHECK คู่กัน: สถานะ parked ⇔ มีเวลาที่ขึ้นทะเบียน, รหัสเหตุผลต้องอยู่ในรายการ ──────────
ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_parked_consistency;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_parked_consistency
  CHECK ((status = 'parked') = (parked_at IS NOT NULL));

-- รายการรหัสต้องตรง PARK_REASONS ใน src/lib/complaintWorkflow.js (tests/complaint-parked.test.mjs เทียบให้)
ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_parked_reason_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_parked_reason_check
  CHECK (parked_reason IS NULL OR parked_reason IN ('plan', 'budget', 'authority', 'season', 'other'));

-- ── 2) trigger: เข้าสถานะ parked ได้ทาง RPC เท่านั้น · ออกจาก parked แล้วล้างข้อมูลพักเอง ───────
-- ธง app.complaint_workflow ตั้งได้จากในฟังก์ชัน SECURITY DEFINER เท่านั้น (PostgREST ตั้ง GUC ชื่อนี้จาก request ไม่ได้)
-- SQL ภายใน/migration (auth.role() เป็น NULL) และ service_role ลอดผ่านโดยตั้งใจ เหมือน guard_complaint_final_close_role
CREATE OR REPLACE FUNCTION public.guard_complaint_parked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trusted boolean := auth.role() IS NULL
                       OR auth.role() = 'service_role'
                       OR coalesce(current_setting('app.complaint_workflow', true), '') = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- ประชาชนยื่นคำร้องแบบ anon ได้ (policy INSERT เปิด) — ห้ามยัดสถานะนี้มากับแถวใหม่
    IF NOT v_trusted AND (
         NEW.status = 'parked'
         OR NEW.parked_at IS NOT NULL OR NEW.parked_by IS NOT NULL OR NEW.parked_reason IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'สถานะ "ขึ้นทะเบียนรอดำเนินการ" ตั้งตอนยื่นคำร้องไม่ได้' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ออกจาก parked ด้วยทางใดก็ตาม (นำกลับเข้าคิว, แอดมินเปลี่ยนสถานะตรง, ปฏิเสธ) → ล้างข้อมูลพัก
  IF OLD.status = 'parked' AND NEW.status IS DISTINCT FROM 'parked' THEN
    NEW.parked_at := NULL;
    NEW.parked_by := NULL;
    NEW.parked_reason := NULL;
    RETURN NEW;
  END IF;

  IF NOT v_trusted AND (
       (NEW.status = 'parked' AND OLD.status IS DISTINCT FROM 'parked')
       OR NEW.parked_at IS DISTINCT FROM OLD.parked_at
       OR NEW.parked_by IS DISTINCT FROM OLD.parked_by
       OR NEW.parked_reason IS DISTINCT FROM OLD.parked_reason
     ) THEN
    RAISE EXCEPTION 'ขึ้นทะเบียนรอดำเนินการได้ผ่านปุ่ม "ขึ้นทะเบียนรอดำเนินการ" เท่านั้น (park_complaints)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_complaint_parked() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_complaint_parked ON public.complaints;
CREATE TRIGGER trg_guard_complaint_parked
BEFORE INSERT OR UPDATE OF status, parked_at, parked_by, parked_reason ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_parked();

-- ── 3) RPC: ขึ้นทะเบียนรอดำเนินการ (ทีละเรื่องหรือหลายเรื่อง) ───────────────────────────────
-- เรื่องที่พักไม่ได้ไม่ทำให้ทั้งชุดล้ม: ข้ามแล้วบอกรหัสเหตุผลรายเรื่องใน skipped
--   forbidden            ไม่พบเรื่อง หรือไม่ใช่ผู้ทำงานของเรื่องนี้ (ไม่แยกสองกรณี กันไล่เดารหัสเรื่องของกองอื่น)
--   adhoc                หมวดเฉพาะกิจไม่ใช้ขั้นตอนนี้
--   category_not_allowed หมวดยังไม่เปิด allow_parking
--   bad_status           พักได้จาก received / in_progress เท่านั้น (ต้องรับเรื่องก่อน)
--   already_parked       อยู่ในทะเบียนแล้ว
CREATE OR REPLACE FUNCTION public.park_complaints(
  p_complaint_ids uuid[],
  p_reason        text,
  p_note          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ids     uuid[];
  v_id      uuid;
  v_c       public.complaints%ROWTYPE;
  v_allow   boolean;
  v_label   text;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_actor   text;
  v_parked  int := 0;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF coalesce(public.get_my_role(), '') NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'ขึ้นทะเบียนรอดำเนินการได้เฉพาะหัวหน้ากองหรือแอดมิน' USING ERRCODE = '42501';
  END IF;

  -- ป้ายเหตุผลต้องตรง PARK_REASONS ใน src/lib/complaintWorkflow.js
  v_label := CASE p_reason
    WHEN 'plan'      THEN 'รอบรรจุในแผนพัฒนาท้องถิ่น'
    WHEN 'budget'    THEN 'รองบประมาณ'
    WHEN 'authority' THEN 'รอตรวจสอบอำนาจหน้าที่/สิทธิ์ในที่ดิน'
    WHEN 'season'    THEN 'รอช่วงฤดูกาลที่เหมาะสม'
    WHEN 'other'     THEN 'เหตุผลอื่น'
    ELSE NULL
  END;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'เหตุผลไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;
  IF p_reason = 'other' AND v_note IS NULL THEN
    RAISE EXCEPTION 'เลือก "เหตุผลอื่น" ต้องระบุรายละเอียด' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'หมายเหตุยาวได้ไม่เกิน 500 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  -- เรียงรหัสก่อนล็อกแถว: สองคนกดพักชุดซ้อนกันจะไม่ล็อกไขว้เป็น deadlock
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
  FROM unnest(coalesce(p_complaint_ids, '{}'::uuid[])) AS x
  WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'ยังไม่ได้เลือกเรื่อง' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'ขึ้นทะเบียนได้ครั้งละไม่เกิน 200 เรื่อง' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor
  FROM public.profiles WHERE id = auth.uid();

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_c FROM public.complaints WHERE id = v_id FOR UPDATE;
    -- complaint_worker_can_act() คืน NULL (ไม่ใช่ false) เมื่อเรื่องไม่มีผู้รับผิดชอบและผู้เรียกไม่ใช่แอดมิน/หัวหน้ากอง
    -- (c.assigned_to = auth.uid() เป็น NULL) → NOT NULL ก็ NULL แล้ว IF ไม่ทำงาน = ปล่อยผ่าน · ต้องห่อ coalesce เสมอ
    IF NOT FOUND OR NOT coalesce(public.complaint_worker_can_act(v_c), false) THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'code', 'forbidden');
      CONTINUE;
    END IF;
    IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'code', 'adhoc');
      CONTINUE;
    END IF;

    SELECT cc.allow_parking INTO v_allow
    FROM public.complaint_categories cc
    WHERE cc.municipality_id = v_c.municipality_id
      AND cc.value = v_c.category
    ORDER BY cc.is_active DESC, cc.sort_order, cc.id
    LIMIT 1;
    IF NOT coalesce(v_allow, false) THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'code', 'category_not_allowed');
      CONTINUE;
    END IF;

    IF v_c.status = 'parked' THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'code', 'already_parked');
      CONTINUE;
    END IF;
    IF v_c.status NOT IN ('received', 'in_progress') THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'code', 'bad_status');
      CONTINUE;
    END IF;

    PERFORM set_config('app.complaint_workflow', '1', true);
    UPDATE public.complaints
    SET status        = 'parked',
        parked_at     = now(),
        parked_by     = auth.uid(),
        parked_reason = p_reason
    WHERE id = v_id;
    PERFORM set_config('app.complaint_workflow', '', true);

    INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
    VALUES (
      v_id, 'parked',
      v_label || CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END,
      v_actor
    );
    v_parked := v_parked + 1;
  END LOOP;

  RETURN jsonb_build_object('parked', v_parked, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.park_complaints(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.park_complaints(uuid[], text, text) TO authenticated;

-- ── 4) RPC: นำกลับเข้าคิวงาน ───────────────────────────────────────────────────────
-- กลับเป็น 'received' (ผู้รับผิดชอบเดิมคงอยู่) และตั้งกำหนดเสร็จใหม่ตาม sla_days ของหมวด นับจากวันนี้
-- (สูตรเดียวกับ auto_assign_complaint ตอนยื่น) · ไม่คืนสถานะ in_progress เดิม — เริ่มงานใหม่เมื่อพร้อมจริง
CREATE OR REPLACE FUNCTION public.unpark_complaint(p_complaint_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c     public.complaints%ROWTYPE;
  v_sla   int;
  v_due   date;
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF coalesce(public.get_my_role(), '') NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'นำกลับเข้าคิวได้เฉพาะหัวหน้ากองหรือแอดมิน' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(public.complaint_worker_can_act(v_c), false) THEN
    RAISE EXCEPTION 'นำกลับเข้าคิวได้เฉพาะผู้ทำงานของคำร้องนี้' USING ERRCODE = '42501';
  END IF;
  IF v_c.status <> 'parked' THEN
    RAISE EXCEPTION 'คำร้องนี้ไม่ได้อยู่ในสถานะขึ้นทะเบียนรอดำเนินการ' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sla_days, 2) INTO v_sla
  FROM public.category_assignments
  WHERE municipality_id = v_c.municipality_id AND category = v_c.category
  LIMIT 1;
  v_due := public.add_working_days(
    (now() AT TIME ZONE 'Asia/Bangkok')::date, COALESCE(v_sla, 2), v_c.municipality_id);

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app.complaint_workflow', '1', true);
  -- parked_* ถูก trigger ล้างให้เองเมื่อสถานะออกจาก parked
  UPDATE public.complaints SET status = 'received', due_date = v_due WHERE id = p_complaint_id;
  PERFORM set_config('app.complaint_workflow', '', true);

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (p_complaint_id, 'received', 'นำกลับเข้าคิวงาน เริ่มนับกำหนดเสร็จใหม่', v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.unpark_complaint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpark_complaint(uuid) TO authenticated;

COMMENT ON FUNCTION public.park_complaints(uuid[], text, text) IS
  'ขึ้นทะเบียนรอดำเนินการ (parked) ทีละหลายเรื่อง — หัวหน้ากอง/แอดมินเท่านั้น หมวดต้องเปิด allow_parking ลง complaint_timeline ทุกเรื่อง';
COMMENT ON FUNCTION public.unpark_complaint(uuid) IS
  'นำเรื่อง parked กลับเป็น received และตั้งกำหนดเสร็จใหม่ (add_working_days จากวันนี้) ลง complaint_timeline';

-- ตรวจหลัง apply (tenant demo ในทรานแซกชันที่ rollback — หมวด road ของ demo เปิด allow_parking ชั่วคราวในทรานแซกชันนั้น):
--   admin park_complaints([received]) → parked=1 · status='parked' · parked_at/by/reason มีค่า · timeline 1 แถว
--   staff/technician park → 42501 · หมวดไม่เปิดธง → skipped category_not_allowed · status new → bad_status
--   UPDATE complaints SET status='parked' ตรงจาก authenticated → 42501 · INSERT status='parked' แบบ anon → 42501
--   unpark → received + parked_* เป็น NULL + due_date เป็นวันทำการใหม่ · admin UPDATE status='received' ตรง → parked_* ถูกล้าง
