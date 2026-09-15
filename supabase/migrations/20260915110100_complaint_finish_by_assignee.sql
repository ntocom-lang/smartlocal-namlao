-- 20260915110100_complaint_finish_by_assignee.sql
--
-- ผู้รับผิดชอบเริ่ม/ปิดงานเอง (ต้องมีหมุด) · ผู้ร้องเปิดเรื่องกลับ 7 วัน · แก้ข้อความพร้อมประวัติ
-- ต้อง apply หลัง 20260915110000 — เหตุผลการออกแบบอยู่ในไฟล์นั้น
--
-- เส้นทางเปลี่ยนสถานะของผู้รับผิดชอบรวมไว้ที่ RPC ชุดนี้ทุก role
--   role 'staff' ถูก enforce_staff_document_only_update ห้ามแก้ status/assigned_to/ข้อความทุกทาง
--   RPC ตรวจสิทธิ์เองแล้วตั้งธง app.complaint_workflow ให้ด่านนั้นปล่อยผ่านเฉพาะในทรานแซกชันนี้
--   (แบบเดียวกับ app.complaint_return / app.odor_ack) PostgREST ตั้ง GUC ชื่อนี้จาก request ไม่ได้
--
-- ⚠️ ไม่ย้าย/แก้คำร้องเก่า: ใบ 'closed' เดิมแสดงเป็น "ดำเนินการแล้ว" อยู่แล้ว ส่วนใบที่ค้าง 'done'
--   (ขั้นเก่า "รอแอดมินปิด") ผู้รับผิดชอบกด "ดำเนินการแล้ว" ซ้ำได้จากสถานะนั้น

-- ── 0) ตัวช่วยตรวจสิทธิ์ "ผู้ทำงานของคำร้องนี้" ─────────────────────────────────
-- ผู้รับผิดชอบ (assigned_to) · หัวหน้ากอง (officer) ของกองที่คำร้องสังกัด · แอดมินของ อปท. · superadmin
-- officer รวมไว้เพราะหน้าเจ้าหน้าที่ให้หัวหน้ากองเห็นและเดินงานทั้งกองมาตั้งแต่เดิม (StaffDashboard
-- seesWholeDepartment) ถ้าตัดออก หัวหน้ากองจะกดปุ่มที่เคยกดได้แล้วเจอ 42501
CREATE OR REPLACE FUNCTION public.complaint_worker_can_act(c public.complaints)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    c.assigned_to = auth.uid()
    OR (
      public.get_my_role() = 'officer'
      AND c.municipality_id = public.get_my_municipality_id()
      AND public.complaint_matches_my_department(c.department)
    )
    OR public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND c.municipality_id = public.get_my_municipality_id())
  )
$$;

REVOKE EXECUTE ON FUNCTION public.complaint_worker_can_act(public.complaints) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complaint_worker_can_act(public.complaints) TO authenticated;

-- ── 1) ด่าน staff: เปิดธงของ RPC ชุดนี้ ────────────────────────────────────────
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — คัดจาก production หลัง 20260915100100 ทุกบรรทัด
-- เปลี่ยนแค่เงื่อนไขธงบนสุดให้รับ app.complaint_workflow เพิ่ม
CREATE OR REPLACE FUNCTION public.enforce_staff_document_only_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- ส่งคืนเรื่อง (return_complaint_to_intake) / เริ่ม-ปิดงาน-แก้ข้อความ (RPC ในไฟล์ 20260915110100)
  -- ทุกตัวตรวจสิทธิ์ผู้รับผิดชอบก่อนตั้งธงแล้ว
  if coalesce(current_setting('app.complaint_return', true), '') = '1'
     or coalesce(current_setting('app.complaint_workflow', true), '') = '1' then
    return NEW;
  end if;

  if get_my_role() = 'staff' then
    if NEW.status is distinct from OLD.status
       or NEW.assigned_to is distinct from OLD.assigned_to
       or NEW.priority is distinct from OLD.priority
       or NEW.category is distinct from OLD.category
       or NEW.detail is distinct from OLD.detail
       or NEW.subject is distinct from OLD.subject
       or NEW.location_name is distinct from OLD.location_name
       or NEW.village is distinct from OLD.village
       or NEW.reporter_name is distinct from OLD.reporter_name
       or NEW.phone is distinct from OLD.phone
       or NEW.latitude is distinct from OLD.latitude
       or NEW.longitude is distinct from OLD.longitude
       or (NEW.location::text is distinct from OLD.location::text)
       or NEW.form_type is distinct from OLD.form_type
       or NEW.department is distinct from OLD.department
       or NEW.due_date is distinct from OLD.due_date
       or NEW.progress_note is distinct from OLD.progress_note
       or NEW.rejection_reason is distinct from OLD.rejection_reason
       or NEW.closed_at is distinct from OLD.closed_at
       or NEW.ref_no is distinct from OLD.ref_no
       or NEW.rating is distinct from OLD.rating
       or NEW.channel is distinct from OLD.channel
       or NEW.complaint_number is distinct from OLD.complaint_number
       or NEW.user_id is distinct from OLD.user_id
       or NEW.municipality_id is distinct from OLD.municipality_id
       or NEW.technician_note is distinct from OLD.technician_note
       or NEW.work_photos is distinct from OLD.work_photos
       or NEW.attachments is distinct from OLD.attachments
    then
      raise exception 'staff role may only update document fields on complaints (draft_pdf_path, official_receipt_no, final_document_path, document_uploaded_at, document_uploaded_by)';
    end if;
  end if;
  return NEW;
end;
$function$;

-- ── 2) ด่านปิดงาน: ผู้รับผิดชอบปิดได้ผ่าน RPC + ต้องมีหมุด ─────────────────────
-- ของเดิม (20260901100000): ปิดได้เฉพาะ admin/superadmin — เจ้าของระบบตัดขั้นตรวจรับออกแล้ว
-- ของใหม่:
--   ก) หมวดที่ requires_resolved_location ต้องมีหมุดจุดที่ดำเนินการ ไม่ว่าใครปิด (รวมแอดมิน)
--   ข) ผู้ใช้ทั่วไปปิดได้เฉพาะผ่าน finish_complaint() (ตรวจสิทธิ์ผู้รับผิดชอบแล้ว) แอดมินปิดตรงได้ตามเดิม
-- SQL ภายใน/migration (auth.role() เป็น NULL) และ service_role ลอดผ่านทั้งสองข้อตามเดิมโดยตั้งใจ
CREATE OR REPLACE FUNCTION public.guard_complaint_final_close_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role      text;
  v_is_close  boolean;
  v_need_pin  boolean;
BEGIN
  v_is_close := NEW.status IN ('closed', 'completed')
                AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status);

  IF NOT v_is_close OR auth.role() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- หมวดที่ถูกลบไปแล้วตั้งค่ายกเว้นไม่ได้ ถ้าบังคับหมุดจะปิดเรื่องนั้นไม่ได้ตลอดกาล จึงถือว่าไม่บังคับ
  SELECT cc.requires_resolved_location INTO v_need_pin
  FROM public.complaint_categories cc
  WHERE cc.municipality_id = NEW.municipality_id
    AND cc.value = NEW.category
  ORDER BY cc.is_active DESC, cc.sort_order, cc.id
  LIMIT 1;

  IF coalesce(v_need_pin, false)
     AND (NEW.resolved_latitude IS NULL OR NEW.resolved_longitude IS NULL)
  THEN
    RAISE EXCEPTION 'ต้องปักหมุดจุดที่ดำเนินการก่อนเปลี่ยนเป็น "ดำเนินการแล้ว"'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(current_setting('app.complaint_workflow', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();
  IF COALESCE(v_role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Only admin or superadmin may close a complaint directly — use finish_complaint()'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_complaint_final_close_role() FROM PUBLIC, anon, authenticated;

-- ── 3) ประวัติการแก้ข้อความ (ทุกเส้นทาง รวมแอดมินแก้ตรง) ──────────────────────
-- ใช้ trigger ไม่ใช่ให้ RPC เขียน — แอดมิน/ช่างยังแก้ผ่าน UPDATE ตรงได้อยู่ ถ้าเก็บเฉพาะใน RPC
-- ประวัติจะมีรูรั่วทันที
-- technician_note: ไม่เก็บครั้งแรกที่เขียน (ค่าเดิมว่าง) — ไม่มีอะไรให้เทียบ และจะรกทุกใบที่ปิดงาน
CREATE OR REPLACE FUNCTION public.log_complaint_text_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
  v_role text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT nullif(btrim(full_name), ''), role INTO v_name, v_role
    FROM public.profiles WHERE id = v_uid;
  END IF;

  IF NEW.subject IS DISTINCT FROM OLD.subject THEN
    INSERT INTO public.complaint_text_revisions
      (complaint_id, municipality_id, field, old_value, new_value, edited_by, edited_by_name, edited_role)
    VALUES (NEW.id, NEW.municipality_id, 'subject', OLD.subject, NEW.subject, v_uid, coalesce(v_name, 'ระบบ'), v_role);
  END IF;

  IF NEW.detail IS DISTINCT FROM OLD.detail THEN
    INSERT INTO public.complaint_text_revisions
      (complaint_id, municipality_id, field, old_value, new_value, edited_by, edited_by_name, edited_role)
    VALUES (NEW.id, NEW.municipality_id, 'detail', OLD.detail, NEW.detail, v_uid, coalesce(v_name, 'ระบบ'), v_role);
  END IF;

  IF NEW.technician_note IS DISTINCT FROM OLD.technician_note
     AND nullif(btrim(coalesce(OLD.technician_note, '')), '') IS NOT NULL
  THEN
    INSERT INTO public.complaint_text_revisions
      (complaint_id, municipality_id, field, old_value, new_value, edited_by, edited_by_name, edited_role)
    VALUES (NEW.id, NEW.municipality_id, 'technician_note', OLD.technician_note, NEW.technician_note, v_uid, coalesce(v_name, 'ระบบ'), v_role);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_complaint_text_revision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_complaint_text_revision ON public.complaints;
CREATE TRIGGER trg_log_complaint_text_revision
AFTER UPDATE OF subject, detail, technician_note ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.log_complaint_text_revision();

-- ── 4) RPC: เริ่มดำเนินการ ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_complaint_work(p_complaint_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c     public.complaints%ROWTYPE;
  v_actor text;
BEGIN
  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND OR NOT public.complaint_worker_can_act(v_c) THEN
    RAISE EXCEPTION 'เปลี่ยนสถานะได้เฉพาะผู้รับผิดชอบคำร้องนี้หรือแอดมิน' USING ERRCODE = '42501';
  END IF;
  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจไม่ใช้ขั้นตอนนี้' USING ERRCODE = '22023';
  END IF;
  IF v_c.status <> 'received' THEN
    RAISE EXCEPTION 'เริ่มดำเนินการได้เฉพาะคำร้องที่รับเรื่องแล้ว' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app.complaint_workflow', '1', true);
  UPDATE public.complaints SET status = 'in_progress' WHERE id = p_complaint_id;
  PERFORM set_config('app.complaint_workflow', '', true);

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (p_complaint_id, 'in_progress', NULL, coalesce(v_actor, 'เจ้าหน้าที่'));
END;
$$;

REVOKE ALL ON FUNCTION public.start_complaint_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_complaint_work(uuid) TO authenticated;

-- ── 5) RPC: ดำเนินการแล้ว ─────────────────────────────────────────────────────
-- ปิดได้ตั้งแต่ "รับเรื่องแล้ว" (งานเล็กที่ทำเสร็จในรอบเดียวไม่ต้องกด 2 ครั้ง) และจาก 'done' ขั้นเก่า
CREATE OR REPLACE FUNCTION public.finish_complaint(
  p_complaint_id uuid,
  p_latitude     double precision,
  p_longitude    double precision,
  p_note         text   DEFAULT NULL,
  p_work_photos  text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c      public.complaints%ROWTYPE;
  v_actor  text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_photos text[] := coalesce(p_work_photos, '{}');
  v_url    text;
BEGIN
  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND OR NOT public.complaint_worker_can_act(v_c) THEN
    RAISE EXCEPTION 'เปลี่ยนสถานะได้เฉพาะผู้รับผิดชอบคำร้องนี้หรือแอดมิน' USING ERRCODE = '42501';
  END IF;
  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจไม่ใช้ขั้นตอนนี้' USING ERRCODE = '22023';
  END IF;
  IF v_c.status NOT IN ('received', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'บันทึก "ดำเนินการแล้ว" ได้เฉพาะคำร้องที่รับเรื่องแล้วหรือกำลังดำเนินการ' USING ERRCODE = '22023';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'พิกัดหมุดไม่ครบ' USING ERRCODE = '22023';
  END IF;
  -- ช่วงพิกัด/บังคับหมุดรายหมวด ตรวจซ้ำที่ CHECK constraint และ guard_complaint_final_close_role

  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'บันทึกผลยาวได้ไม่เกิน 2000 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_photos) > 20 THEN
    RAISE EXCEPTION 'แนบรูปได้ไม่เกิน 20 รูปต่อครั้ง' USING ERRCODE = '22023';
  END IF;
  FOREACH v_url IN ARRAY v_photos LOOP
    IF v_url IS NULL OR char_length(v_url) > 1000 OR v_url ~ '\s' OR v_url !~ '^(https://|/)' THEN
      RAISE EXCEPTION 'ลิงก์รูปผลงานไม่ถูกต้อง' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app.complaint_workflow', '1', true);
  UPDATE public.complaints
  SET status             = 'closed',
      closed_at          = now(),
      resolved_latitude  = p_latitude,
      resolved_longitude = p_longitude,
      resolved_by        = auth.uid(),
      technician_note    = coalesce(v_note, technician_note),
      work_photos        = CASE WHEN cardinality(v_photos) = 0 THEN work_photos
                                ELSE coalesce(work_photos, '[]'::jsonb) || to_jsonb(v_photos) END
  WHERE id = p_complaint_id;
  PERFORM set_config('app.complaint_workflow', '', true);

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (p_complaint_id, 'closed', v_note, coalesce(v_actor, 'เจ้าหน้าที่'));
END;
$$;

REVOKE ALL ON FUNCTION public.finish_complaint(uuid, double precision, double precision, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_complaint(uuid, double precision, double precision, text, text[]) TO authenticated;

-- ── 6) RPC: ผู้ร้องเปิดเรื่องกลับ ─────────────────────────────────────────────
-- เงื่อนไข (เจ้าของระบบกำหนด): เจ้าของเรื่องที่ล็อกอิน · ภายใน 7 วันนับจาก closed_at · 1 ครั้งต่อใบ
-- ผล: กลับไปผู้รับผิดชอบเดิมทันที (received) — ถ้าผู้รับผิดชอบเดิมไม่อยู่แล้ว ตกคิวแอดมิน (pending)
-- ล้างหมุดจุดดำเนินการ ผู้รับผิดชอบต้องปักใหม่ตอนปิดรอบถัดไป ประวัติรอบแรกอยู่ใน timeline
-- ⚠️ ไม่ขยับ due_date — เรื่องที่เปิดกลับจะขึ้นเกินกำหนดทันทีถ้าเลยมาแล้ว ซึ่งเป็นข้อเท็จจริง
CREATE OR REPLACE FUNCTION public.reopen_complaint(p_complaint_id uuid, p_reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_c       public.complaints%ROWTYPE;
  v_count   int;
  v_status  text;
  v_keep    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผล 5-500 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'เปิดเรื่องกลับได้เฉพาะคำร้องของคุณ' USING ERRCODE = '42501';
  END IF;
  IF v_c.status NOT IN ('closed', 'completed') OR v_c.closed_at IS NULL THEN
    RAISE EXCEPTION 'เปิดเรื่องกลับได้เฉพาะคำร้องที่ดำเนินการแล้ว' USING ERRCODE = '22023';
  END IF;
  IF v_c.closed_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'เกิน 7 วันหลังดำเนินการแล้ว กรุณายื่นคำร้องใหม่' USING ERRCODE = '22023';
  END IF;

  v_count := coalesce((v_c.extra_data ->> 'reopen_count')::int, 0);
  IF v_count >= 1 THEN
    RAISE EXCEPTION 'คำร้องนี้เคยเปิดกลับแล้ว กรุณายื่นคำร้องใหม่' USING ERRCODE = '22023';
  END IF;

  v_keep := v_c.assigned_to IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_c.assigned_to AND p.municipality_id = v_c.municipality_id
  );
  v_status := CASE WHEN v_keep THEN 'received' ELSE 'pending' END;

  PERFORM set_config('app.complaint_workflow', '1', true);
  UPDATE public.complaints
  SET status             = v_status,
      assigned_to        = CASE WHEN v_keep THEN assigned_to ELSE NULL END,
      closed_at          = NULL,
      resolved_latitude  = NULL,
      resolved_longitude = NULL,
      resolved_by        = NULL,
      extra_data         = coalesce(extra_data, '{}'::jsonb) || jsonb_build_object(
                             'reopened_at', to_jsonb(now()),
                             'reopen_reason', to_jsonb(v_reason),
                             'reopen_count', v_count + 1
                           )
  WHERE id = p_complaint_id;
  PERFORM set_config('app.complaint_workflow', '', true);

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (p_complaint_id, v_status, 'ผู้ร้องแจ้งว่ายังไม่เรียบร้อย: ' || v_reason, 'ผู้ร้อง');

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_complaint(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_complaint(uuid, text) TO authenticated;

-- ── 7) RPC: แก้ข้อความ ───────────────────────────────────────────────────────
-- ส่ง NULL = ไม่แก้ช่องนั้น · ประวัติทุกรุ่นเก็บโดย trg_log_complaint_text_revision
CREATE OR REPLACE FUNCTION public.edit_complaint_text(
  p_complaint_id    uuid,
  p_subject         text DEFAULT NULL,
  p_detail          text DEFAULT NULL,
  p_technician_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c public.complaints%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND OR NOT public.complaint_worker_can_act(v_c) THEN
    RAISE EXCEPTION 'แก้ข้อความได้เฉพาะผู้รับผิดชอบคำร้องนี้หรือแอดมิน' USING ERRCODE = '42501';
  END IF;
  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจแก้ข้อความผ่านช่องทางนี้ไม่ได้' USING ERRCODE = '22023';
  END IF;

  IF p_detail IS NOT NULL AND (nullif(btrim(p_detail), '') IS NULL OR char_length(p_detail) > 5000) THEN
    RAISE EXCEPTION 'รายละเอียดคำร้องต้องไม่ว่างและยาวไม่เกิน 5000 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF p_subject IS NOT NULL AND char_length(p_subject) > 300 THEN
    RAISE EXCEPTION 'เรื่องยาวได้ไม่เกิน 300 ตัวอักษร' USING ERRCODE = '22023';
  END IF;
  IF p_technician_note IS NOT NULL AND char_length(p_technician_note) > 2000 THEN
    RAISE EXCEPTION 'บันทึกผลยาวได้ไม่เกิน 2000 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.complaint_workflow', '1', true);
  UPDATE public.complaints
  SET subject         = CASE WHEN p_subject IS NULL THEN subject ELSE nullif(btrim(p_subject), '') END,
      detail          = CASE WHEN p_detail IS NULL THEN detail ELSE btrim(p_detail) END,
      technician_note = CASE WHEN p_technician_note IS NULL THEN technician_note ELSE nullif(btrim(p_technician_note), '') END
  WHERE id = p_complaint_id;
  PERFORM set_config('app.complaint_workflow', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_complaint_text(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_complaint_text(uuid, text, text, text) TO authenticated;

-- ── ตรวจหลัง apply (tenant demo ในทรานแซกชันที่ rollback) ────────────────────
--   staff ผู้รับผิดชอบ: start → in_progress · finish ไม่มีหมุด (หมวดบังคับ) → 23514 · มีหมุด → closed
--   คนอื่น start/finish → 42501 · หมวดยกเว้น (grievance) finish ไม่มีหมุด → ผ่าน
--   ผู้ร้อง reopen ภายใน 7 วัน → received + ผู้รับผิดชอบเดิม · ครั้งที่ 2 → 22023 · closed_at เกิน 7 วัน → 22023
--   edit_complaint_text โดยผู้รับผิดชอบ → complaint_text_revisions มีค่าเดิม · staff UPDATE detail ตรง → ยังโดนบล็อก
