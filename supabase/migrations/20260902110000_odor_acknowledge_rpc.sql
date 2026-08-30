-- 20260902110000_odor_acknowledge_rpc.sql
--
-- [ปัญหา P1] การ "รับทราบ" คำร้องหมวดเฉพาะกิจทำผ่าน UPDATE ตรงจาก browser:
--   OdorAcknowledgePanel.jsx: อ่าน extra_data ทั้งก้อนมาไว้ใน state ตอนโหลดหน้า แล้วเขียนกลับ
--   ทั้งก้อนตอนกดปุ่ม ({...c.extra_data, acknowledged_at, acknowledged_by}) — ปัญหา 3 ชั้น:
--     1. lost update: ถ้ามีใครแก้ extra_data ระหว่างนั้น (หรือเปิด 2 แท็บ) ก้อนเก่าทับก้อนใหม่ทั้งดุ้น
--     2. เวลาและตัวตนมาจาก client: new Date() ของเครื่องผู้ใช้ และ staffId ที่ browser ส่งมาเอง
--        เป็นหลักฐานว่า "ใครรับทราบเมื่อไหร่" ที่ปลอมได้ทั้งคู่
--     3. policy "technician update assigned complaints" (014_add_technician_role.sql) เขียนไว้ว่า
--        USING (assigned_to = auth.uid()) WITH CHECK (assigned_to = auth.uid()) เฉยๆ — RLS คุมได้แค่
--        "แถวไหน" ไม่ได้คุม "คอลัมน์ไหน" ผู้รับผิดชอบจึงยิง PATCH เปลี่ยน status/category/พิกัด/
--        ผู้แจ้ง ของคำร้องที่ถือครองอยู่ได้ทั้งหมดผ่าน PostgREST โดยไม่ต้องผ่านหน้าจอ
--
-- [ทางแก้] 2 ชิ้นที่ต้องมาคู่กัน
--   A. RPC acknowledge_odor_complaint() เป็นทางเดียวที่รับทราบได้: ตรวจสิทธิ์, ใช้ now()/auth.uid()
--      ของเซิร์ฟเวอร์, merge JSON ด้วย || ในคำสั่ง UPDATE เดียว (อ่าน-แก้-เขียนใน transaction เดียว
--      ไม่ใช่ 2 รอบคนละเวลา), idempotent ด้วย WHERE acknowledged_at IS NULL, ไม่แตะ status,
--      และลง audit_logs
--   B. trigger กัน direct API: คำร้องหมวดเฉพาะกิจ ใครที่ไม่ใช่ admin/superadmin ห้ามแก้คอลัมน์หลัก
--      ทุกตัว และแก้ extra_data ได้เฉพาะตอนที่ RPC ตั้งธง app.odor_ack ไว้ในทรานแซกชันเท่านั้น
--      (แพทเทิร์นเดียวกับ guard_complaint_rating_write ใน 20260830150000_rate_complaint_rpc.sql)
--
-- ไม่แตะสายงานหมวดปกติเลย: trigger คืนค่าออกทันทีถ้าคำร้องไม่ใช่หมวด is_adhoc ดังนั้น technician
-- ที่ไล่สถานะงานซ่อมตามปกติยังทำงานได้เหมือนเดิมทุกประการ

-- ── A. trigger กันการแก้คำร้องเฉพาะกิจผ่าน API ตรง ────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_adhoc_complaint_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  -- หมวดปกติ: พฤติกรรมเดิมทั้งหมด ไม่มีอะไรเปลี่ยน
  IF NOT public.complaint_category_is_adhoc(OLD.municipality_id, OLD.category) THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();

  -- admin/superadmin ยังจัดการคำร้องได้เต็มเหมือนเดิม (ลบ/แก้/มอบหมายใหม่)
  IF v_role IN ('admin', 'superadmin') THEN
    RETURN NEW;
  END IF;

  IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
    OR NEW.category      IS DISTINCT FROM OLD.category
    OR NEW.category_id   IS DISTINCT FROM OLD.category_id
    OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR NEW.user_id       IS DISTINCT FROM OLD.user_id
    OR NEW.reporter_name IS DISTINCT FROM OLD.reporter_name
    OR NEW.phone         IS DISTINCT FROM OLD.phone
    OR NEW.latitude      IS DISTINCT FROM OLD.latitude
    OR NEW.longitude     IS DISTINCT FROM OLD.longitude
    OR NEW.subject       IS DISTINCT FROM OLD.subject
    OR NEW.detail        IS DISTINCT FROM OLD.detail
    OR NEW.status        IS DISTINCT FROM OLD.status
    OR NEW.assigned_to   IS DISTINCT FROM OLD.assigned_to
    OR NEW.ref_no        IS DISTINCT FROM OLD.ref_no
  THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจแก้ไขข้อมูลหลักผ่าน API โดยตรงไม่ได้ (ต้องเป็นผู้ดูแลระบบ)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.extra_data IS DISTINCT FROM OLD.extra_data
    AND coalesce(current_setting('app.odor_ack', true), '') <> '1'
  THEN
    RAISE EXCEPTION 'การรับทราบคำร้องเฉพาะกิจต้องทำผ่าน acknowledge_odor_complaint() เท่านั้น'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_adhoc_complaint_write ON public.complaints;
CREATE TRIGGER trg_guard_adhoc_complaint_write
BEFORE UPDATE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.guard_adhoc_complaint_write();

COMMENT ON FUNCTION public.guard_adhoc_complaint_write() IS
  'คำร้องหมวดเฉพาะกิจ (is_adhoc): ผู้ที่ไม่ใช่ admin/superadmin แก้คอลัมน์หลักผ่าน API ตรงไม่ได้ และแก้ extra_data ได้เฉพาะผ่าน acknowledge_odor_complaint() ที่ตั้งธง app.odor_ack';

-- ── B. RPC รับทราบ ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acknowledge_odor_complaint(p_complaint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor    public.profiles%ROWTYPE;
  v_complaint public.complaints%ROWTYPE;
  v_extra    jsonb;
  v_acked_at timestamptz := now();
BEGIN
  IF p_complaint_id IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุคำร้องที่ต้องการรับทราบ' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนรับทราบคำร้อง' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_complaint FROM public.complaints WHERE id = p_complaint_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- ผู้รับผิดชอบที่ถูก assign เท่านั้น — admin ที่ไม่ได้เป็นผู้รับผิดชอบก็กดแทนไม่ได้
  -- เพราะ acknowledged_by เป็นหลักฐานว่า "ใครรับเรื่องนี้ไปดำเนินการ" ไม่ใช่ปุ่มปิดงานของแอดมิน
  IF v_complaint.assigned_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'รับทราบได้เฉพาะผู้รับผิดชอบที่ถูกมอบหมายคำร้องนี้' USING ERRCODE = '42501';
  END IF;

  IF NOT public.complaint_category_is_adhoc(v_complaint.municipality_id, v_complaint.category) THEN
    RAISE EXCEPTION 'คำร้องนี้ไม่ใช่หมวดเฉพาะกิจ ให้ใช้ขั้นตอนสถานะปกติ' USING ERRCODE = '22023';
  END IF;

  -- กดซ้ำ (2 แท็บ / เน็ตกระตุกแล้วกดใหม่): ไม่ถือเป็นความผิดพลาด แต่ต้องไม่ทับเวลา/ผู้รับทราบเดิม
  IF (v_complaint.extra_data ->> 'acknowledged_at') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'acknowledged_at', v_complaint.extra_data -> 'acknowledged_at',
      'acknowledged_by', v_complaint.extra_data -> 'acknowledged_by'
    );
  END IF;

  PERFORM set_config('app.odor_ack', '1', true);

  -- merge ในคำสั่งเดียว: ไม่มีช่วงเวลาที่ค่าเก่าค้างอยู่ใน memory ของ client
  -- WHERE ... IS NULL ทำให้ผู้ที่มาทีหลังในเสี้ยววินาทีเดียวกันได้ 0 แถว แทนที่จะทับของคนแรก
  UPDATE public.complaints
     SET extra_data = coalesce(extra_data, '{}'::jsonb)
                      || jsonb_build_object(
                           'acknowledged_at', to_jsonb(v_acked_at),
                           'acknowledged_by', to_jsonb(auth.uid())
                         )
   WHERE id = p_complaint_id
     AND (extra_data ->> 'acknowledged_at') IS NULL
  RETURNING extra_data INTO v_extra;

  PERFORM set_config('app.odor_ack', '0', true);

  IF v_extra IS NULL THEN
    SELECT extra_data INTO v_extra FROM public.complaints WHERE id = p_complaint_id;
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'acknowledged_at', v_extra -> 'acknowledged_at',
      'acknowledged_by', v_extra -> 'acknowledged_by'
    );
  END IF;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_complaint.municipality_id,
    v_actor.id,
    coalesce(v_actor.full_name, v_actor.email, v_actor.id::text),
    v_actor.role,
    'acknowledge_adhoc_complaint',
    'complaint',
    v_complaint.id::text,
    coalesce(v_complaint.ref_no, v_complaint.complaint_number::text, v_complaint.id::text),
    jsonb_build_object(
      'category', v_complaint.category,
      'acknowledged_at', to_jsonb(v_acked_at),
      'status_unchanged', v_complaint.status
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'acknowledged_at', to_jsonb(v_acked_at),
    'acknowledged_by', to_jsonb(auth.uid())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_odor_complaint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_odor_complaint(uuid) TO authenticated;

COMMENT ON FUNCTION public.acknowledge_odor_complaint(uuid) IS
  'รับทราบคำร้องหมวดเฉพาะกิจ: เฉพาะผู้รับผิดชอบที่ถูก assign, ใช้ now()/auth.uid() ของเซิร์ฟเวอร์, merge extra_data ในคำสั่งเดียว, กดซ้ำได้โดยไม่ทับของเดิม, ไม่เปลี่ยน status และบันทึก audit log';

-- ตรวจหลัง apply:
--   1) ผู้รับผิดชอบเรียก select public.acknowledge_odor_complaint('<id>');  → ok=true already=false
--   2) เรียกซ้ำทันที                                                      → ok=true already=true (เวลาเดิม)
--   3) คนที่ไม่ได้ถูก assign เรียก                                          → 42501
--   4) ผู้รับผิดชอบยิง PATCH /complaints?id=eq.<id> {"status":"closed"}     → 42501 จาก trigger
--   5) select status from complaints where id='<id>'                       → ยังเป็น pending
