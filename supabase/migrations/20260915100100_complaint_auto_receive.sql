-- 20260915100100_complaint_auto_receive.sql
--
-- ระบบรับเรื่องคำร้องเองเมื่อข้อมูลเส้นทางครบ + ช่องทางให้ผู้รับผิดชอบส่งเรื่องคืนแอดมิน
-- ต้อง apply หลัง 20260915100000 (คอลัมน์ requires_manual_intake)
--
-- ── กติกา "ระบบรับเรื่องเอง" ──────────────────────────────────────────────────
-- รับเองเมื่อครบทุกข้อ: สถานะตอนสร้างเป็นคำร้องใหม่ (pending/new) · มีกอง (department_id) ·
-- มีผู้รับผิดชอบ (assigned_to จาก category_assignments) · ไม่ใช่หมวดเฉพาะกิจ · หมวดไม่ได้ตั้ง
-- requires_manual_intake ข้อใดไม่ครบ = ค้าง pending ให้แอดมินรับเรื่องเหมือนเดิมทุกประการ
--
-- ⚠️ ทำไมคีย์ชื่อ auto_received_at ไม่ใช้ routed_at ของหมวดเฉพาะกิจ
--   MyComplaints.jsx ใช้ "การมีอยู่ของคีย์ routed_at" เป็นสัญญาณว่าเป็นหมวดเฉพาะกิจแล้วขึ้นป้ายของ
--   สายงานนั้น ถ้าหมวดปกติมีคีย์นี้ด้วย ป้ายจะขึ้นผิดทุกใบ
--
-- ⚠️ ทำไมไม่เขียนชื่อเจ้าหน้าที่ลง timeline
--   ไม่มีเจ้าหน้าที่คนใดกดรับเรื่องจริง (เหตุผลเดียวกับ 20260908100000) actor_name จึงเป็น
--   "ระบบ (อัตโนมัติ)" ถ้าเรื่องถูกสอบข้อเท็จจริงภายหลัง หลักฐานต้องไม่ชี้ไปที่คนที่ไม่เคยเห็นเรื่อง
--
-- ⚠️ ทำไมเป็น trigger แยกตัว ไม่แก้ auto_assign_complaint()
--   ฟังก์ชันนั้นใช้ร่วมทุกหมวดทุก อปท. CREATE OR REPLACE = เขียนใหม่ทั้งตัว พลาดบรรทัดเดียว
--   การมอบหมายพังทั้งระบบ ตัวใหม่พังก็พังแค่ "ไม่รับเรื่องเอง" แอดมินยังรับเรื่องได้ตามเดิม
--
-- ลำดับ BEFORE INSERT trigger ของ Postgres เรียงตามชื่อ ตัวนี้ต้องทำงานหลัง
--   complaints_auto_assign        (เติม assigned_to)
--   trg_resolve_complaint_routing (เติม category_id/department_id)
--   trg_route_adhoc_complaint
-- 'trg_route_complaint_auto_receive' เรียงหลังทั้งสามตัว ('trg_route_c' > 'trg_route_a' > 'trg_res')
--
-- ไม่ย้อนแก้คำร้องเก่าที่ยัง pending — ถ้าย้อนแก้ ใบเก่าจะดูเหมือนระบบรับเรื่องไว้ตั้งแต่วันยื่น
-- ซึ่งไม่ตรงกับที่เกิดขึ้นจริง ใบเก่าให้แอดมินกดรับเองตามเดิม

-- ── 1) BEFORE INSERT: ตัดสินว่ารับเรื่องเองได้หรือไม่ ─────────────────────────
CREATE OR REPLACE FUNCTION public.route_complaint_auto_receive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category public.complaint_categories%ROWTYPE;
BEGIN
  -- คีย์เหล่านี้เซิร์ฟเวอร์เป็นผู้เขียนเท่านั้น ตัดทิ้งทุกครั้งที่ INSERT ไม่ว่ามาจากเส้นทางไหน
  -- submit_citizen_complaint_v4 รับ p_extra_data จาก client และไม่ได้กันคีย์ชุดนี้ไว้
  NEW.extra_data := coalesce(NEW.extra_data, '{}'::jsonb)
                    - 'auto_received_at' - 'returned_at' - 'returned_by' - 'returned_reason';

  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('pending', 'new') THEN
    -- แอดมินบันทึกย้อนหลังด้วยสถานะอื่นมาเอง (เช่น รับแจ้งหน้าเคาน์เตอร์) ไม่แตะ
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS NULL OR NEW.department_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_category
  FROM public.complaint_categories
  WHERE municipality_id = NEW.municipality_id
    AND (id = NEW.category_id OR (NEW.category_id IS NULL AND value = NEW.category))
  ORDER BY (id = NEW.category_id) DESC NULLS LAST, is_active DESC, sort_order, id
  LIMIT 1;

  IF NOT FOUND OR v_category.is_adhoc OR v_category.requires_manual_intake THEN
    RETURN NEW;
  END IF;

  NEW.status := 'received';
  -- เวลาจาก now() ของเซิร์ฟเวอร์เสมอ ไม่ใช่นาฬิกาเครื่องผู้แจ้ง
  NEW.extra_data := NEW.extra_data || jsonb_build_object('auto_received_at', to_jsonb(now()));

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.route_complaint_auto_receive() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.route_complaint_auto_receive() IS
  'คำร้องหมวดปกติที่มีกอง+ผู้รับผิดชอบครบและหมวดไม่ได้ตั้ง requires_manual_intake: ระบบตั้ง status=received และประทับ extra_data.auto_received_at ตอน INSERT (ไม่ใช่การรับเรื่องของบุคคล)';

DROP TRIGGER IF EXISTS trg_route_complaint_auto_receive ON public.complaints;
CREATE TRIGGER trg_route_complaint_auto_receive
BEFORE INSERT ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.route_complaint_auto_receive();

-- ── 2) AFTER INSERT: ลงประวัติว่าระบบเป็นผู้รับเรื่อง ───────────────────────────
-- ต้องเป็น AFTER เพราะ complaint_timeline มี FK ไป complaints ซึ่งยังไม่มีแถวตอน BEFORE
CREATE OR REPLACE FUNCTION public.log_complaint_auto_receive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.extra_data ? 'auto_received_at' THEN
    INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
    VALUES (
      NEW.id,
      'received',
      'ระบบรับเรื่องและส่งถึงผู้รับผิดชอบตามหมวดคำร้องโดยอัตโนมัติ',
      'ระบบ (อัตโนมัติ)'
    );
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_complaint_auto_receive() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_complaint_auto_receive ON public.complaints;
CREATE TRIGGER trg_log_complaint_auto_receive
AFTER INSERT ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.log_complaint_auto_receive();

-- ── 3) ให้ RPC ส่งคืนเรื่องผ่านด่าน staff ได้ ─────────────────────────────────
-- เจ้าหน้าที่ role 'staff' เป็นผู้รับผิดชอบหมวดคำร้องอยู่จริง (10 คน 16 หมวด ณ 2569-09-15) แต่
-- trigger นี้ห้าม staff เปลี่ยน status/assigned_to ทุกทาง ถ้าไม่เปิดช่อง staff จะกดส่งคืนไม่ได้
-- ช่องที่เปิดคือธง app.complaint_return ที่ตั้งได้จากใน return_complaint_to_intake() เท่านั้น
-- (แบบเดียวกับ app.odor_ack / app.retention_purge) PostgREST ตั้งค่า GUC ชื่อนี้จาก request ไม่ได้
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — ตัวด้านล่างคัดจาก pg_get_functiondef ของ production
-- 2569-09-15 ทุกบรรทัด เพิ่มแค่บล็อก IF ธงบนสุด ห้ามแก้เงื่อนไขเดิม
CREATE OR REPLACE FUNCTION public.enforce_staff_document_only_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- ส่งคืนเรื่องให้แอดมินผ่าน return_complaint_to_intake() (ตรวจสิทธิ์ผู้รับผิดชอบในนั้นแล้ว)
  if coalesce(current_setting('app.complaint_return', true), '') = '1' then
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

-- ── 4) RPC: ผู้รับผิดชอบกด "ไม่ใช่งานของกองนี้" ─────────────────────────────────
-- กรณีที่ระบบตัดสินผิดซึ่งคาดได้: ประชาชนเลือกหมวดผิด → เรื่องไปถึงกองผิดเร็วขึ้นกว่าเดิม
-- ทางแก้ต้องเป็น 1 คลิกของผู้รับผิดชอบ แล้วเรื่องกลับไปคิวแอดมินพร้อมเหตุผล ไม่ใช่ให้ไปโทรหาแอดมินเอง
--
-- ผล: status → pending, assigned_to → NULL (ผู้รับผิดชอบเดิมบอกแล้วว่าไม่ใช่งานตน แอดมินต้องเลือกใหม่),
-- ลบ auto_received_at (ประวัติยังอยู่ใน timeline), ประทับ returned_* ให้คิวแอดมินแสดงเหตุผล
CREATE OR REPLACE FUNCTION public.return_complaint_to_intake(p_complaint_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_complaint public.complaints%ROWTYPE;
  v_actor     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผล 5-500 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_complaint
  FROM public.complaints
  WHERE id = p_complaint_id
  FOR UPDATE;

  -- ไม่แยกข้อความ "ไม่พบ" กับ "ไม่มีสิทธิ์" — กันการไล่เดา id คำร้องของคนอื่น
  IF NOT FOUND OR v_complaint.assigned_to IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'ส่งคืนได้เฉพาะคำร้องที่คุณเป็นผู้รับผิดชอบ' USING ERRCODE = '42501';
  END IF;

  IF public.complaint_category_is_adhoc(v_complaint.municipality_id, v_complaint.category) THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจไม่ใช้ขั้นตอนรับเรื่อง ส่งคืนไม่ได้' USING ERRCODE = '22023';
  END IF;

  IF v_complaint.status NOT IN ('received', 'in_progress') THEN
    RAISE EXCEPTION 'ส่งคืนได้เฉพาะคำร้องที่รับเรื่องแล้วหรือกำลังดำเนินการ' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), 'ผู้รับผิดชอบ') INTO v_actor
  FROM public.profiles WHERE id = v_uid;

  PERFORM set_config('app.complaint_return', '1', true);

  UPDATE public.complaints
  SET status      = 'pending',
      assigned_to = NULL,
      extra_data  = (coalesce(extra_data, '{}'::jsonb) - 'auto_received_at')
                    || jsonb_build_object(
                         'returned_at', to_jsonb(now()),
                         'returned_by', to_jsonb(v_uid),
                         'returned_reason', to_jsonb(v_reason)
                       )
  WHERE id = p_complaint_id;

  PERFORM set_config('app.complaint_return', '', true);

  INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name)
  VALUES (p_complaint_id, 'pending', 'ส่งคืนให้แอดมิน: ' || v_reason, coalesce(v_actor, 'ผู้รับผิดชอบ'));
END;
$$;

REVOKE ALL ON FUNCTION public.return_complaint_to_intake(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_complaint_to_intake(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.return_complaint_to_intake(uuid, text) IS
  'ผู้รับผิดชอบ (assigned_to) ส่งคำร้องที่ไม่ใช่งานของตนคืนคิวแอดมิน: status=pending, assigned_to=NULL, บันทึกเหตุผลใน extra_data.returned_* และ complaint_timeline';

-- ── ตรวจหลัง apply (tenant demo เท่านั้น — เคสที่ผ่านสร้างคำร้องจริง ลบทิ้งหลังตรวจ) ──
--   1) trigger ครบและเรียงถูก:
--      select tgname from pg_trigger where tgrelid='public.complaints'::regclass
--        and not tgisinternal order by tgname;
--   2) ยื่นหมวดปกติที่มีผู้รับผิดชอบ → status='received', extra_data ? 'auto_received_at',
--      complaint_timeline มีแถว actor_name='ระบบ (อัตโนมัติ)'
--   3) ยื่นหมวด corruption → status='pending', ไม่มี auto_received_at, ไม่มีแถว timeline
--   4) ยื่นพร้อม p_extra_data {"auto_received_at":"2000-01-01"} ในหมวด corruption → คีย์ต้องหาย
--   5) ผู้รับผิดชอบเรียก return_complaint_to_intake(id, 'หมวดผิด เป็นงานกองช่าง') →
--      status='pending', assigned_to NULL, returned_reason มีค่า; คนอื่นเรียก → 42501
