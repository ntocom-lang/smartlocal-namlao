-- โมดูล "ขอยืมพัสดุ/ครุภัณฑ์" เฟส 3/3 — RPC ทั้งหมดของ workflow
--
-- ทุกฟังก์ชันที่เปลี่ยนสถานะเป็น SECURITY DEFINER เพราะตารางลูกไม่มี grant เขียนให้
-- authenticated เลย (ดูเหตุผลใน 20260909100100) — นี่คือชั้นเดียวที่เขียนข้อมูลได้
-- ฉะนั้นทุกตัวต้องตรวจสิทธิ์เองครบทุกครั้ง ห้ามพึ่ง RLS
--
-- กติกาที่บังคับไว้ในไฟล์นี้:
--   1. ทุกตัว idempotent — กดปุ่มซ้ำ/เน็ตหลุดแล้วยิงซ้ำ ต้องได้ผลเดิม ไม่เกิดคำขอหรือ
--      การจ่ายของซ้ำ (สร้าง = ใช้ id จาก client, เปลี่ยนสถานะ = เช็คสถานะปัจจุบันก่อน)
--   2. การอนุมัติล็อกแถวใน borrowable_assets ด้วย FOR UPDATE เรียงตาม id เสมอ
--      — เรียงเพื่อกัน deadlock เมื่อสองกองอนุมัติคำขอที่มีของชุดเดียวกันพร้อมกัน
--   3. ทุก action เขียน asset_borrow_events ใน transaction เดียวกัน ไม่พึ่ง log ฝั่ง client
--
-- ⚠️ ของสูญหาย: ระบบ **ไม่ตัดจำนวนออกจากทะเบียนให้อัตโนมัติ** — การจำหน่ายพัสดุออกจาก
-- ทะเบียนต้องผ่านการสอบข้อเท็จจริงและขั้นตอนตามระเบียบพัสดุก่อน ไม่ใช่ผลของการกดปุ่มในระบบ
-- (ยังไม่ได้เปิดตัวบทยืนยันรายข้อ) หน้าจอแอดมินจะขึ้นเตือนรายการที่มีของหายค้างอยู่แทน
-- เพื่อให้เจ้าหน้าที่ไปปรับทะเบียนเองหลังดำเนินการตามระเบียบเสร็จ

BEGIN;

-- ===========================================================================
-- 1. คำนวณของที่ถูกจองไว้แล้วในช่วงวันที่หนึ่ง
-- ===========================================================================
-- SECURITY DEFINER เพราะต้องนับคำขอของ "ทุกคน" ไม่ใช่เฉพาะที่ผู้เรียกมองเห็น
-- คืนค่าเป็นตัวเลขรวมอย่างเดียว ไม่หลุดข้อมูลว่าใครยืมอะไร
CREATE OR REPLACE FUNCTION public.asset_borrow_reserved_qty(
  p_asset_id        uuid,
  p_start           date,
  p_end             date,
  p_exclude_request uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(SUM(
    GREATEST(
      COALESCE(item.approved_qty, 0)
        - item.returned_qty - item.damaged_qty - item.lost_qty,
      0
    )
  ), 0)::integer
  FROM public.asset_borrow_items AS item
  JOIN public.asset_borrow_requests AS req ON req.request_id = item.request_id
  WHERE item.asset_id = p_asset_id
    -- นับเฉพาะใบที่ยังกันของอยู่จริง: อนุมัติแล้วรอรับ / จ่ายไปแล้ว / คืนแล้วแต่ยังเคลียร์ไม่จบ
    -- ใบที่ยังไม่อนุมัติ (submitted) ยังไม่กันของ — ของไปให้คนที่ได้รับอนุมัติก่อนเสมอ
    AND req.workflow_status IN ('approved', 'issued', 'settlement')
    -- ช่วงวันซ้อนทับกัน (ยืมคนละช่วงใช้ของชิ้นเดียวกันได้)
    AND req.borrow_start_date <= p_end
    AND req.return_due_date   >= p_start
    AND (p_exclude_request IS NULL OR req.request_id <> p_exclude_request);
$$;

REVOKE ALL ON FUNCTION public.asset_borrow_reserved_qty(uuid, date, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_borrow_reserved_qty(uuid, date, date, uuid) TO authenticated;

-- ===========================================================================
-- 2. รายการของที่ยืมได้ พร้อมจำนวนว่างในช่วงวันที่ที่ขอ
-- ===========================================================================
-- SECURITY INVOKER โดยตั้งใจ — RLS ของ borrowable_assets ทำงานตามปกติ
-- ประชาชนจึงได้เฉพาะแถวที่ is_public_borrowable ส่วนบุคลากรได้ทั้งทะเบียน
--
-- ⚠️ ต้องรับ p_municipality_id มาแล้วกรองเอง ไม่ใช่พึ่ง RLS อย่างเดียว — policy ของ superadmin
-- คือ "เห็นทุก อปท." ถ้าไม่กรอง ตัวเลือกพัสดุของ superadmin จะมีของทุกเทศบาลปนกันมา
-- RLS ยังทำงานซ้อนอยู่ ผู้ใช้ทั่วไปจึงส่ง id ของ อปท. อื่นเข้ามาแล้วดูของก็ไม่ได้อยู่ดี
CREATE OR REPLACE FUNCTION public.list_borrowable_assets(
  p_municipality_id uuid,
  p_start date,
  p_end   date
)
RETURNS TABLE (
  id              uuid,
  department_id   uuid,
  department_name text,
  asset_code      text,
  name            text,
  unit            text,
  total_quantity  integer,
  available_qty   integer,
  notes           text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    asset.id,
    asset.department_id,
    dept.name,
    asset.asset_code,
    asset.name,
    asset.unit,
    asset.total_quantity,
    GREATEST(
      asset.total_quantity
        - public.asset_borrow_reserved_qty(asset.id, p_start, p_end, NULL),
      0
    )::integer,
    asset.notes
  FROM public.borrowable_assets AS asset
  LEFT JOIN public.departments AS dept ON dept.id = asset.department_id
  WHERE asset.is_active
    AND asset.municipality_id = p_municipality_id
  ORDER BY dept.sort_order NULLS LAST, dept.name, asset.name;
$$;

REVOKE ALL ON FUNCTION public.list_borrowable_assets(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_borrowable_assets(uuid, date, date) TO authenticated;

-- ===========================================================================
-- 3. ตัวช่วยภายใน — ตรวจสิทธิ์ผู้ดำเนินการ และเขียน audit
-- ===========================================================================
-- คืนแถวคำขอเมื่อมีสิทธิ์ ไม่มีสิทธิ์ให้ RAISE ทันที
-- เกณฑ์เดียวกับ policy "staff update document_requests" (20260802071000):
--   superadmin ทั้งหมด · admin ทั้ง อปท. · officer เฉพาะกองตน · staff เฉพาะที่ถูกมอบหมาย
CREATE OR REPLACE FUNCTION public.assert_asset_borrow_actor(p_request_id uuid)
RETURNS public.asset_borrow_requests
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_req      public.asset_borrow_requests;
  v_role     text;
  v_muni     uuid;
  v_dept     uuid;
  v_assigned uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;

  SELECT profile.role, profile.municipality_id, profile.department_id
  INTO v_role, v_muni, v_dept
  FROM public.profiles AS profile
  WHERE profile.id = v_uid;

  SELECT * INTO v_req
  FROM public.asset_borrow_requests
  WHERE request_id = p_request_id;

  IF v_req.request_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคำขอยืมพัสดุที่อ้างถึง';
  END IF;

  IF v_role = 'superadmin' THEN
    RETURN v_req;
  END IF;

  IF v_muni IS NULL OR v_req.municipality_id <> v_muni THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอของหน่วยงานอื่น';
  END IF;

  IF v_role = 'admin' THEN
    RETURN v_req;
  END IF;

  IF v_role = 'officer' AND v_req.department_id IS NOT DISTINCT FROM v_dept THEN
    RETURN v_req;
  END IF;

  SELECT parent.assigned_to INTO v_assigned
  FROM public.document_requests AS parent
  WHERE parent.id = p_request_id;

  IF v_role = 'staff' AND v_assigned = v_uid THEN
    RETURN v_req;
  END IF;

  RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอยืมนี้';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_asset_borrow_actor(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_asset_borrow_event(
  p_request_id uuid,
  p_muni       uuid,
  p_type       text,
  p_detail     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT profile.full_name INTO v_name
  FROM public.profiles AS profile
  WHERE profile.id = auth.uid();

  INSERT INTO public.asset_borrow_events (request_id, municipality_id, actor_id, actor_name, event_type, detail)
  VALUES (p_request_id, p_muni, auth.uid(), v_name, p_type, COALESCE(p_detail, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.log_asset_borrow_event(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. สร้างคำขอ — parent + header + items + audit สำเร็จหรือ rollback พร้อมกัน
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.create_asset_borrow_request(
  p_request_id uuid,
  p_payload    jsonb,
  p_items      jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_role        text;
  v_muni        uuid;
  v_today       date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_start       date;
  v_end         date;
  v_staff_entry boolean;
  v_dept        uuid;
  v_dept_set    boolean := false;
  v_item        jsonb;
  v_asset       public.borrowable_assets;
  v_qty         integer;
  v_count       integer;
  v_sort        integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนยื่นคำขอยืมพัสดุ';
  END IF;

  -- กันกดปุ่มซ้ำ: id มาจาก client (crypto.randomUUID) ยิงซ้ำด้วย id เดิมได้คำตอบเดิม
  IF EXISTS (SELECT 1 FROM public.asset_borrow_requests WHERE request_id = p_request_id) THEN
    RETURN p_request_id;
  END IF;

  SELECT profile.role, profile.municipality_id
  INTO v_role, v_muni
  FROM public.profiles AS profile
  WHERE profile.id = v_uid;

  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'บัญชีนี้ยังไม่ได้ผูกกับหน่วยงาน ไม่สามารถยื่นคำขอได้';
  END IF;

  v_count := jsonb_array_length(COALESCE(p_items, '[]'::jsonb));
  IF v_count < 1 THEN
    RAISE EXCEPTION 'ต้องเลือกพัสดุอย่างน้อย 1 รายการ';
  END IF;
  -- ตารางบนใบ บย. มี 7 แถว/หน้า — 20 รายการคือ 3 หน้าซึ่งเป็นเพดานที่ยังพิมพ์อ่านได้
  IF v_count > 20 THEN
    RAISE EXCEPTION 'หนึ่งคำขอเลือกได้ไม่เกิน 20 รายการ กรุณาแยกยื่นเป็นหลายคำขอ';
  END IF;

  -- ดักซ้ำตรงนี้เพื่อให้ได้ข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง แทนที่จะปล่อยให้ชน unique index
  -- asset_borrow_items_request_asset_key แล้วเด้ง error ดิบของ Postgres ขึ้นหน้าจอ
  IF (SELECT count(DISTINCT element->>'asset_id') FROM jsonb_array_elements(p_items) AS element) <> v_count THEN
    RAISE EXCEPTION 'มีพัสดุชิ้นเดียวกันซ้ำกันในคำขอ กรุณารวมเป็นบรรทัดเดียวแล้วแก้จำนวนแทน';
  END IF;

  v_start := NULLIF(p_payload->>'borrow_start_date', '')::date;
  v_end   := NULLIF(p_payload->>'return_due_date', '')::date;
  IF v_start IS NULL OR v_end IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุวันที่เริ่มยืมและวันกำหนดคืน';
  END IF;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'วันกำหนดคืนต้องไม่ก่อนวันเริ่มยืม';
  END IF;
  IF v_end - v_start > 365 THEN
    RAISE EXCEPTION 'ยืมต่อเนื่องเกิน 1 ปีไม่ได้ กรณีนี้ต้องดำเนินการตามระเบียบพัสดุคนละหมวด';
  END IF;

  -- เจ้าหน้าที่บันทึกแทนหน้าเคาน์เตอร์ย้อนหลังได้ (ใบกระดาษมาถึงช้า) แต่ประชาชนที่ยื่นเองไม่ได้
  -- ⚠️ ต้อง COALESCE(v_role, '') — บัญชีที่ยังไม่มี role ทำให้ IN (...) คืน NULL แล้ว
  -- เงื่อนไข IF ข้างล่างจะไม่ทำงานเลย (NULL ไม่ใช่ true) = หลุดการกันย้อนวันที่เงียบๆ
  v_staff_entry := COALESCE((p_payload->>'staff_entry')::boolean, false)
                   AND COALESCE(v_role, '') IN ('superadmin', 'admin', 'officer', 'staff');
  IF NOT v_staff_entry AND v_start < v_today THEN
    RAISE EXCEPTION 'วันเริ่มยืมย้อนหลังไม่ได้ กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป';
  END IF;

  IF COALESCE((p_payload->>'acknowledged_terms')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ต้องรับทราบเงื่อนไขความรับผิดกรณีชำรุด สูญหาย หรือใช้การไม่ได้ ก่อนยื่นคำขอ';
  END IF;

  -- ตรวจของทุกชิ้นก่อน แล้วค่อยเขียนอะไรลงฐานข้อมูล
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_asset
    FROM public.borrowable_assets
    WHERE id = NULLIF(v_item->>'asset_id', '')::uuid;

    IF v_asset.id IS NULL THEN
      RAISE EXCEPTION 'ไม่พบพัสดุที่เลือก อาจถูกลบออกจากทะเบียนแล้ว';
    END IF;
    IF v_asset.municipality_id <> v_muni THEN
      RAISE EXCEPTION 'พัสดุที่เลือกไม่ใช่ของหน่วยงานท่าน';
    END IF;
    IF NOT v_asset.is_active THEN
      RAISE EXCEPTION 'พัสดุ "%" ปิดการให้ยืมอยู่', v_asset.name;
    END IF;
    IF v_role = 'citizen' AND NOT v_asset.is_public_borrowable THEN
      RAISE EXCEPTION 'พัสดุ "%" ไม่ได้เปิดให้ประชาชนยืมออนไลน์ กรุณาติดต่อเจ้าหน้าที่', v_asset.name;
    END IF;

    -- รุ่นแรกบังคับ 1 คำขอ = 1 กองเจ้าของพัสดุ (ใบ บย. มีช่อง "ส่วนราชการ" ช่องเดียว
    -- และแต่ละกองออกเลข บย. ในทะเบียนของตัวเอง) — ใช้ธงแยกเพราะ department_id เป็น NULL ได้
    IF NOT v_dept_set THEN
      v_dept := v_asset.department_id;
      v_dept_set := true;
    ELSIF v_dept IS DISTINCT FROM v_asset.department_id THEN
      RAISE EXCEPTION 'หนึ่งคำขอเลือกพัสดุได้จากกองเดียวเท่านั้น กรุณาแยกยื่นตามกองเจ้าของพัสดุ';
    END IF;

    v_qty := NULLIF(v_item->>'requested_qty', '')::integer;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'จำนวนที่ขอยืม "%" ต้องเป็นจำนวนเต็มอย่างน้อย 1', v_asset.name;
    END IF;
    IF v_qty > v_asset.total_quantity THEN
      RAISE EXCEPTION 'ขอยืม "%" % % เกินจำนวนที่หน่วยงานมีทั้งหมด (% %)',
        v_asset.name, v_qty, v_asset.unit, v_asset.total_quantity, v_asset.unit;
    END IF;
  END LOOP;

  -- แถวแม่: กองที่รับเรื่อง = กองเจ้าของพัสดุ (กองที่ต้องจ่ายของและรับคืนจริง)
  -- ระบุมาเองจึงชนะ CASE ใน route_document_request_department() — ถ้าของไม่ได้ผูกกอง
  -- (department_id เป็น NULL) จะปล่อยให้ trigger หากองให้ตามผังงานปกติ
  INSERT INTO public.document_requests (
    id, municipality_id, department_id, document_type,
    requester_name, requester_phone, requester_address,
    purpose, status, user_id, assigned_to,
    fee_amount, payment_status, payment_slip_url, permit_form_data
  ) VALUES (
    p_request_id,
    v_muni,
    v_dept,
    'asset_borrow_request',
    NULLIF(btrim(COALESCE(p_payload->>'borrower_name', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'borrower_phone', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'borrower_address', '')), ''),
    btrim(p_payload->>'purpose'),
    'pending',
    CASE WHEN v_staff_entry THEN NULL ELSE v_uid END,
    CASE WHEN v_staff_entry THEN v_uid ELSE NULL END,
    -- การยืมพัสดุของทางราชการไม่มีค่าธรรมเนียม
    NULL, 'not_required', NULL,
    COALESCE(p_payload->'form_snapshot', '{}'::jsonb)
  )
  -- ⚠️ ต้องอ่านกองกลับมาจากแถวที่ถูก trigger ประมวลผลแล้ว ไม่ใช่ใช้ v_dept ที่ส่งเข้าไป
  -- ของในทะเบียนที่ยังไม่ได้ผูกกอง (department_id เป็น NULL) จะถูก route_document_request_*
  -- หากองให้ ถ้า header เก็บ NULL ไว้ หัวหน้ากองจะเทียบกองไม่ตรงแล้วกดอนุมัติไม่ได้เลย
  RETURNING department_id INTO v_dept;

  INSERT INTO public.asset_borrow_requests (
    request_id, municipality_id, department_id,
    borrower_type, borrower_position, borrower_org,
    purpose, place_of_use, borrow_start_date, return_due_date,
    workflow_status, acknowledged_terms
  ) VALUES (
    p_request_id,
    v_muni,
    v_dept,
    COALESCE(NULLIF(p_payload->>'borrower_type', ''), 'citizen'),
    NULLIF(btrim(COALESCE(p_payload->>'borrower_position', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'borrower_org', '')), ''),
    btrim(p_payload->>'purpose'),
    NULLIF(btrim(COALESCE(p_payload->>'place_of_use', '')), ''),
    v_start,
    v_end,
    'submitted',
    true
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_asset
    FROM public.borrowable_assets
    WHERE id = (v_item->>'asset_id')::uuid;

    v_sort := v_sort + 1;

    INSERT INTO public.asset_borrow_items (
      request_id, municipality_id, asset_id, department_id,
      asset_code_snapshot, asset_name_snapshot, unit_snapshot,
      requested_qty, item_note, sort_order
    ) VALUES (
      p_request_id, v_muni, v_asset.id, v_asset.department_id,
      v_asset.asset_code, v_asset.name, v_asset.unit,
      (v_item->>'requested_qty')::integer,
      NULLIF(btrim(COALESCE(v_item->>'item_note', '')), ''),
      v_sort
    );
  END LOOP;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_muni, 'created',
    jsonb_build_object('item_count', v_count, 'staff_entry', v_staff_entry)
  );

  RETURN p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_asset_borrow_request(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_asset_borrow_request(uuid, jsonb, jsonb) TO authenticated;

-- ===========================================================================
-- 5. อนุมัติ (เต็ม/บางส่วน) — ล็อกของก่อนตรวจจำนวน กันสองกองอนุมัติชนกัน
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_asset_borrow_request(
  p_request_id uuid,
  p_items      jsonb,
  p_form_no    text DEFAULT NULL,
  p_note       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req       public.asset_borrow_requests;
  v_item      jsonb;
  v_row       public.asset_borrow_items;
  v_qty       integer;
  v_available integer;
  v_asset     public.borrowable_assets;
  v_total     integer := 0;
  v_status    text;
BEGIN
  v_req := public.assert_asset_borrow_actor(p_request_id);

  -- idempotent: กดซ้ำหลังอนุมัติไปแล้วได้สถานะปัจจุบันกลับไป ไม่ทับตัวเลขที่พิจารณาไว้
  IF v_req.workflow_status <> 'submitted' THEN
    RETURN v_req.workflow_status;
  END IF;

  -- ⚠️ ล็อกแถวของในทะเบียนก่อน "เรียงตาม id เสมอ" — สองคำขอที่มีของชุดเดียวกันจะเข้าคิวกัน
  -- ไม่เรียงแล้วสองเซสชันล็อกสลับลำดับกันจะ deadlock
  PERFORM 1
  FROM public.borrowable_assets
  WHERE id IN (SELECT asset_id FROM public.asset_borrow_items WHERE request_id = p_request_id)
  ORDER BY id
  FOR UPDATE;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT * INTO v_row
    FROM public.asset_borrow_items
    WHERE id = NULLIF(v_item->>'item_id', '')::uuid
      AND request_id = p_request_id;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'ไม่พบรายการพัสดุที่อ้างถึงในคำขอนี้';
    END IF;

    v_qty := COALESCE(NULLIF(v_item->>'approved_qty', '')::integer, 0);
    IF v_qty < 0 OR v_qty > v_row.requested_qty THEN
      RAISE EXCEPTION 'จำนวนที่อนุมัติ "%" ต้องอยู่ระหว่าง 0 ถึง % (จำนวนที่ขอ)',
        v_row.asset_name_snapshot, v_row.requested_qty;
    END IF;

    IF v_qty > 0 THEN
      SELECT * INTO v_asset FROM public.borrowable_assets WHERE id = v_row.asset_id;

      -- คำนวณของว่างหลังได้ล็อกแล้ว — statement นี้เห็นผลของธุรกรรมที่เพิ่ง commit ไป
      v_available := v_asset.total_quantity
        - public.asset_borrow_reserved_qty(
            v_row.asset_id, v_req.borrow_start_date, v_req.return_due_date, p_request_id
          );

      IF v_qty > v_available THEN
        RAISE EXCEPTION 'อนุมัติ "%" % % ไม่ได้ ช่วงวันที่นี้เหลือว่างเพียง % %',
          v_row.asset_name_snapshot, v_qty, v_row.unit_snapshot,
          GREATEST(v_available, 0), v_row.unit_snapshot;
      END IF;
    END IF;

    UPDATE public.asset_borrow_items
    SET approved_qty = v_qty
    WHERE id = v_row.id;

    v_total := v_total + v_qty;
  END LOOP;

  -- รายการที่เจ้าหน้าที่ไม่ได้ส่งมาถือว่า "พิจารณาแล้วไม่อนุมัติ" (0) ไม่ใช่ค้างเป็น NULL
  UPDATE public.asset_borrow_items
  SET approved_qty = 0
  WHERE request_id = p_request_id AND approved_qty IS NULL;

  -- ไม่อนุมัติสักรายการ = ปฏิเสธทั้งใบ ไม่ใช่ "อนุมัติแล้วรอรับของ 0 ชิ้น"
  v_status := CASE WHEN v_total > 0 THEN 'approved' ELSE 'rejected' END;

  UPDATE public.asset_borrow_requests
  SET workflow_status = v_status,
      form_no         = COALESCE(NULLIF(btrim(COALESCE(p_form_no, '')), ''), form_no),
      staff_note      = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), staff_note),
      reject_reason   = CASE WHEN v_status = 'rejected'
                             THEN COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), 'ไม่อนุมัติให้ยืม')
                             ELSE reject_reason END,
      approved_at     = now(),
      approved_by     = auth.uid(),
      updated_at      = now()
  WHERE request_id = p_request_id;

  -- ⚠️ อนุมัติแล้วยังไม่ใช่ "เสร็จสิ้น" — งานจบเมื่อคืนของครบและเคลียร์ความเสียหายเรียบร้อย
  UPDATE public.document_requests
  SET status = CASE WHEN v_status = 'approved' THEN 'processing' ELSE 'rejected' END
  WHERE id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id,
    CASE WHEN v_status = 'approved' THEN 'approved' ELSE 'rejected' END,
    jsonb_build_object('approved_total', v_total, 'form_no', p_form_no)
  );

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_asset_borrow_request(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_asset_borrow_request(uuid, jsonb, text, text) TO authenticated;

-- ===========================================================================
-- 6. ไม่อนุมัติทั้งใบ
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.reject_asset_borrow_request(
  p_request_id uuid,
  p_reason     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req public.asset_borrow_requests;
BEGIN
  v_req := public.assert_asset_borrow_actor(p_request_id);

  IF v_req.workflow_status = 'rejected' THEN
    RETURN 'rejected';
  END IF;

  -- จ่ายของออกไปแล้วปฏิเสธย้อนหลังไม่ได้ ต้องไปจบที่การรับคืนแทน
  IF v_req.workflow_status <> 'submitted' THEN
    RAISE EXCEPTION 'คำขอนี้ผ่านขั้นตอนอนุมัติไปแล้ว ไม่สามารถปฏิเสธย้อนหลังได้';
  END IF;

  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลที่ไม่อนุมัติ';
  END IF;

  UPDATE public.asset_borrow_items SET approved_qty = 0 WHERE request_id = p_request_id;

  UPDATE public.asset_borrow_requests
  SET workflow_status = 'rejected',
      reject_reason   = btrim(p_reason),
      approved_at     = now(),
      approved_by     = auth.uid(),
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'rejected' WHERE id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id, 'rejected', jsonb_build_object('reason', btrim(p_reason))
  );

  RETURN 'rejected';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_asset_borrow_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_asset_borrow_request(uuid, text) TO authenticated;

-- ===========================================================================
-- 7. จ่ายของ
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_asset_borrow_items(
  p_request_id uuid,
  p_items      jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req   public.asset_borrow_requests;
  v_item  jsonb;
  v_row   public.asset_borrow_items;
  v_qty   integer;
  v_total integer := 0;
BEGIN
  v_req := public.assert_asset_borrow_actor(p_request_id);

  IF v_req.workflow_status = 'issued' THEN
    RETURN 'issued';
  END IF;
  IF v_req.workflow_status <> 'approved' THEN
    RAISE EXCEPTION 'จ่ายของได้เฉพาะคำขอที่อนุมัติแล้วและยังไม่ได้จ่าย';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT * INTO v_row
    FROM public.asset_borrow_items
    WHERE id = NULLIF(v_item->>'item_id', '')::uuid
      AND request_id = p_request_id;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'ไม่พบรายการพัสดุที่อ้างถึงในคำขอนี้';
    END IF;

    v_qty := COALESCE(NULLIF(v_item->>'issued_qty', '')::integer, 0);
    IF v_qty < 0 OR v_qty > COALESCE(v_row.approved_qty, 0) THEN
      RAISE EXCEPTION 'จำนวนที่จ่าย "%" ต้องอยู่ระหว่าง 0 ถึง % (จำนวนที่อนุมัติ)',
        v_row.asset_name_snapshot, COALESCE(v_row.approved_qty, 0);
    END IF;

    UPDATE public.asset_borrow_items SET issued_qty = v_qty WHERE id = v_row.id;
    v_total := v_total + v_qty;
  END LOOP;

  IF v_total < 1 THEN
    RAISE EXCEPTION 'ต้องจ่ายของอย่างน้อย 1 รายการ ถ้าไม่จ่ายเลยให้ใช้ปุ่มไม่อนุมัติแทน';
  END IF;

  UPDATE public.asset_borrow_requests
  SET workflow_status = 'issued',
      issued_at       = now(),
      issued_by       = auth.uid(),
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'processing' WHERE id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id, 'issued', jsonb_build_object('issued_total', v_total)
  );

  RETURN 'issued';
END;
$$;

REVOKE ALL ON FUNCTION public.issue_asset_borrow_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_asset_borrow_items(uuid, jsonb) TO authenticated;

-- ===========================================================================
-- 8. รับของคืน — ตัดสินเองว่าจบงานเลย หรือค้างไว้รอชดใช้
-- ===========================================================================
-- p_items ส่ง "ยอดสะสม" ของแต่ละรายการ ไม่ใช่ส่วนต่าง — เจ้าหน้าที่เห็นตัวเลขปัจจุบัน
-- บนหน้าจอแล้วแก้ทับได้ คืนหลายรอบจึงยิงซ้ำได้โดยยอดไม่บวกทบกันเอง
CREATE OR REPLACE FUNCTION public.receive_asset_borrow_items(
  p_request_id uuid,
  p_items      jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req         public.asset_borrow_requests;
  v_item        jsonb;
  v_row         public.asset_borrow_items;
  v_ret         integer;
  v_dmg         integer;
  v_lost        integer;
  v_outstanding integer;
  v_problem     integer;
  v_status      text;
BEGIN
  v_req := public.assert_asset_borrow_actor(p_request_id);

  IF v_req.workflow_status NOT IN ('issued', 'settlement') THEN
    RAISE EXCEPTION 'รับคืนได้เฉพาะคำขอที่จ่ายของออกไปแล้ว';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT * INTO v_row
    FROM public.asset_borrow_items
    WHERE id = NULLIF(v_item->>'item_id', '')::uuid
      AND request_id = p_request_id;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'ไม่พบรายการพัสดุที่อ้างถึงในคำขอนี้';
    END IF;

    v_ret  := COALESCE(NULLIF(v_item->>'returned_qty', '')::integer, 0);
    v_dmg  := COALESCE(NULLIF(v_item->>'damaged_qty', '')::integer, 0);
    v_lost := COALESCE(NULLIF(v_item->>'lost_qty', '')::integer, 0);

    IF v_ret < 0 OR v_dmg < 0 OR v_lost < 0 THEN
      RAISE EXCEPTION 'จำนวนที่คืน/ชำรุด/สูญหาย ติดลบไม่ได้';
    END IF;
    IF v_ret + v_dmg + v_lost > v_row.issued_qty THEN
      RAISE EXCEPTION 'ยอดคืน+ชำรุด+สูญหายของ "%" รวมกัน % เกินจำนวนที่จ่ายไป %',
        v_row.asset_name_snapshot, v_ret + v_dmg + v_lost, v_row.issued_qty;
    END IF;

    UPDATE public.asset_borrow_items
    SET returned_qty    = v_ret,
        damaged_qty     = v_dmg,
        lost_qty        = v_lost,
        settlement_note = COALESCE(NULLIF(btrim(COALESCE(v_item->>'settlement_note', '')), ''), settlement_note)
    WHERE id = v_row.id;
  END LOOP;

  SELECT
    COALESCE(SUM(issued_qty - returned_qty - damaged_qty - lost_qty), 0),
    COALESCE(SUM(damaged_qty + lost_qty), 0)
  INTO v_outstanding, v_problem
  FROM public.asset_borrow_items
  WHERE request_id = p_request_id;

  -- ยังคืนไม่ครบ = ยังยืมอยู่ (คืนบางรายการแล้ว parent ต้องยังไม่ completed)
  -- ครบแล้วแต่มีของชำรุด/สูญหาย = ค้างรอผลชดใช้ ยังปิดงานไม่ได้
  v_status := CASE
    WHEN v_outstanding > 0 THEN 'issued'
    WHEN v_problem > 0     THEN 'settlement'
    ELSE 'returned'
  END;

  UPDATE public.asset_borrow_requests
  SET workflow_status = v_status,
      returned_at     = CASE WHEN v_outstanding = 0 THEN now() ELSE returned_at END,
      received_by     = CASE WHEN v_outstanding = 0 THEN auth.uid() ELSE received_by END,
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests
  SET status = CASE WHEN v_status = 'returned' THEN 'completed' ELSE 'processing' END
  WHERE id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id,
    CASE WHEN v_status = 'settlement' THEN 'settlement_opened' ELSE 'returned' END,
    jsonb_build_object('outstanding', v_outstanding, 'damaged_or_lost', v_problem)
  );

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_asset_borrow_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_asset_borrow_items(uuid, jsonb) TO authenticated;

-- ===========================================================================
-- 9. ปิดเรื่องชำรุด/สูญหาย — ทางเดียวที่ทำให้ใบที่มีของเสียหายกลายเป็น "เสร็จสิ้น"
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.settle_asset_borrow_request(
  p_request_id uuid,
  p_items      jsonb,
  p_note       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req      public.asset_borrow_requests;
  v_item     jsonb;
  v_unsolved integer;
BEGIN
  v_req := public.assert_asset_borrow_actor(p_request_id);

  IF v_req.workflow_status = 'returned' THEN
    RETURN 'returned';
  END IF;
  IF v_req.workflow_status <> 'settlement' THEN
    RAISE EXCEPTION 'ปิดเรื่องชดใช้ได้เฉพาะคำขอที่รับคืนแล้วและมีของชำรุดหรือสูญหาย';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    UPDATE public.asset_borrow_items
    SET settlement_note = NULLIF(btrim(COALESCE(v_item->>'settlement_note', '')), '')
    WHERE id = NULLIF(v_item->>'item_id', '')::uuid
      AND request_id = p_request_id;
  END LOOP;

  -- ของเสียหาย/หายทุกรายการต้องมีบันทึกผลดำเนินการ ไม่งั้นปิดงานไม่ได้
  SELECT count(*) INTO v_unsolved
  FROM public.asset_borrow_items
  WHERE request_id = p_request_id
    AND (damaged_qty + lost_qty) > 0
    AND COALESCE(btrim(settlement_note), '') = '';

  IF v_unsolved > 0 THEN
    RAISE EXCEPTION 'ยังมี % รายการที่ชำรุด/สูญหายแต่ไม่ได้บันทึกผลดำเนินการ ปิดงานไม่ได้', v_unsolved;
  END IF;

  UPDATE public.asset_borrow_requests
  SET workflow_status = 'returned',
      staff_note      = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), staff_note),
      settled_at      = now(),
      settled_by      = auth.uid(),
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'completed' WHERE id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id, 'settled', jsonb_build_object('note', p_note)
  );

  RETURN 'returned';
END;
$$;

REVOKE ALL ON FUNCTION public.settle_asset_borrow_request(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_asset_borrow_request(uuid, jsonb, text) TO authenticated;

-- ===========================================================================
-- 10. ขยายกำหนดคืน — ต้องมีเหตุผลและถูกบันทึกไว้เสมอ (ประเด็นตรวจสอบ)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.extend_asset_borrow_due_date(
  p_request_id uuid,
  p_new_date   date,
  p_reason     text
)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req public.asset_borrow_requests;
BEGIN
  v_req := public.assert_asset_borrow_actor(p_request_id);

  IF v_req.workflow_status NOT IN ('approved', 'issued') THEN
    RAISE EXCEPTION 'ขยายกำหนดคืนได้เฉพาะคำขอที่อนุมัติแล้วและยังไม่ปิดงาน';
  END IF;
  IF p_new_date IS NULL OR p_new_date <= v_req.return_due_date THEN
    RAISE EXCEPTION 'วันกำหนดคืนใหม่ต้องหลังกำหนดเดิม';
  END IF;
  IF p_new_date - v_req.borrow_start_date > 365 THEN
    RAISE EXCEPTION 'ยืมต่อเนื่องเกิน 1 ปีไม่ได้';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'ต้องระบุเหตุผลที่ขยายกำหนดคืน';
  END IF;

  UPDATE public.asset_borrow_requests
  SET return_due_date = p_new_date,
      updated_at      = now()
  WHERE request_id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id, 'due_date_extended',
    jsonb_build_object('from', v_req.return_due_date, 'to', p_new_date, 'reason', btrim(p_reason))
  );

  RETURN p_new_date;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_asset_borrow_due_date(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_asset_borrow_due_date(uuid, date, text) TO authenticated;

-- ===========================================================================
-- 11. ผู้ยื่นยกเลิกคำขอของตัวเอง — ทำได้ก่อนจ่ายของเท่านั้น
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.cancel_asset_borrow_request(
  p_request_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_req   public.asset_borrow_requests;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;

  SELECT * INTO v_req FROM public.asset_borrow_requests WHERE request_id = p_request_id;
  IF v_req.request_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคำขอยืมพัสดุที่อ้างถึง';
  END IF;

  SELECT parent.user_id INTO v_owner FROM public.document_requests AS parent WHERE parent.id = p_request_id;

  -- เจ้าของคำขอยกเลิกเองได้ คนอื่นต้องผ่านเกณฑ์เจ้าหน้าที่ตามปกติ
  IF v_owner IS DISTINCT FROM v_uid THEN
    v_req := public.assert_asset_borrow_actor(p_request_id);
  END IF;

  IF v_req.workflow_status = 'rejected' THEN
    RETURN 'rejected';
  END IF;
  IF v_req.workflow_status NOT IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'จ่ายของออกไปแล้ว ยกเลิกไม่ได้ ต้องนำของมาคืนตามขั้นตอน';
  END IF;

  UPDATE public.asset_borrow_items SET approved_qty = 0 WHERE request_id = p_request_id;

  UPDATE public.asset_borrow_requests
  SET workflow_status = 'rejected',
      reject_reason   = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'ผู้ยื่นขอยกเลิกคำขอ'),
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'rejected' WHERE id = p_request_id;

  PERFORM public.log_asset_borrow_event(
    p_request_id, v_req.municipality_id, 'cancelled', jsonb_build_object('reason', p_reason)
  );

  RETURN 'rejected';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_asset_borrow_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_asset_borrow_request(uuid, text) TO authenticated;

COMMIT;
