-- คำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" เฟส 3/4 — RPC ทั้งหมดของ workflow
--
-- ทุกฟังก์ชันที่เปลี่ยนสถานะเป็น SECURITY DEFINER เพราะตารางลูกไม่มี grant เขียนให้
-- authenticated เลย (ดู 20260910100100) — ทุกตัวต้องตรวจสิทธิ์เองครบ ห้ามพึ่ง RLS
--
-- กติกาที่บังคับไว้ในไฟล์นี้ (แบบเดียวกับ 20260909100200_asset_borrow_rpc.sql):
--   1. ทุกตัว idempotent — กดซ้ำ/เน็ตหลุดแล้วยิงซ้ำต้องได้ผลเดิม
--      (สร้าง = ใช้ id จาก client, เปลี่ยนสถานะ = เช็คสถานะปัจจุบันก่อน)
--   2. ทุก action เขียน patient_transport_events ใน transaction เดียวกัน
--   3. ทุกตัว sync document_requests.status ให้ Inbox/สถิติ/ประวัติเห็นตรงกัน
--
-- ผู้มีสิทธิ์ดำเนินการ = เกณฑ์เดียวกับ policy "staff update document_requests" (20260802071000)
-- ไม่มี role รายโมดูลแบบ fleet_role/asset_role เพราะเป็นงานธุรการสวัสดิการ ไม่ใช่การจ่ายของออกจากคลัง
-- (ผู้ใช้เลือกแนวทางนี้ 2569-09-10)

DO $$
BEGIN
  IF to_regclass('public.patient_transport_requests') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260910100000_patient_transport_tables.sql ก่อนไฟล์นี้';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.patient_transport_requests'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260910100100_patient_transport_rls.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- 1. ตัวช่วยภายใน — ตรวจสิทธิ์ผู้ดำเนินการ และเขียน audit
-- ===========================================================================
-- คืนแถวคำขอเมื่อมีสิทธิ์ ไม่มีสิทธิ์ให้ RAISE ทันที
--   superadmin ทั้งหมด · admin ทั้ง อปท. · officer เฉพาะกองตน · staff เฉพาะที่ถูกมอบหมาย
CREATE OR REPLACE FUNCTION public.assert_patient_transport_actor(p_request_id uuid)
RETURNS public.patient_transport_requests
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_req      public.patient_transport_requests;
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
  FROM public.patient_transport_requests
  WHERE request_id = p_request_id;

  IF v_req.request_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคำขอรถรับ-ส่งผู้ป่วยที่อ้างถึง';
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

  RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอนี้';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_patient_transport_actor(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_patient_transport_event(
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

  INSERT INTO public.patient_transport_events (request_id, municipality_id, actor_id, actor_name, event_type, detail)
  VALUES (p_request_id, p_muni, auth.uid(), v_name, p_type, COALESCE(p_detail, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.log_patient_transport_event(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ตัดช่องว่างหัวท้าย สตริงว่างเป็น NULL แล้วตรวจความยาว — ใช้กับทุกช่องข้อความใน payload
CREATE OR REPLACE FUNCTION public.patient_transport_text(
  p_value    text,
  p_label    text,
  p_max      integer,
  p_required boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text := NULLIF(btrim(COALESCE(p_value, '')), '');
BEGIN
  IF v IS NULL AND p_required THEN
    RAISE EXCEPTION 'กรุณากรอก%', p_label;
  END IF;
  IF v IS NOT NULL AND char_length(v) > p_max THEN
    RAISE EXCEPTION '%ยาวเกิน % ตัวอักษร', p_label, p_max;
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.patient_transport_text(text, text, integer, boolean) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 2. สร้างคำขอ — parent + header + audit สำเร็จหรือ rollback พร้อมกัน
-- ===========================================================================
-- snapshot ใน permit_form_data สร้างจากช่องที่ตรวจแล้วเท่านั้น (whitelist) ไม่เก็บ jsonb จาก
-- client ทั้งก้อน — กันข้อมูลเกินจำเป็นหลุดเข้ามาเก็บ (PDPA: เก็บเท่าที่จำเป็น) และกันก้อนใหญ่ผิดปกติ
CREATE OR REPLACE FUNCTION public.create_patient_transport_request(
  p_request_id uuid,
  p_payload    jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_role         text;
  v_muni         uuid;
  v_today        date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_staff_entry  boolean;
  v_partner      public.referral_partners;
  v_appt         timestamptz;
  v_appt_day     date;
  v_mobility     text;
  v_trip_type    text;
  v_kind         text;
  v_relation     text;
  v_companions   integer;
  v_patient_age  integer;
  v_consent_ver  text;
  v_requester    text;
  v_phone        text;
  v_patient      text;
  v_snapshot     jsonb;
  v_dept         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนยื่นคำขอ';
  END IF;

  -- กันกดปุ่มซ้ำ: id มาจาก client (crypto.randomUUID) ยิงซ้ำด้วย id เดิมได้คำตอบเดิม
  IF EXISTS (SELECT 1 FROM public.patient_transport_requests WHERE request_id = p_request_id) THEN
    RETURN p_request_id;
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'ข้อมูลคำขอไม่ถูกต้อง';
  END IF;
  IF pg_column_size(p_payload) > 16384 THEN
    RAISE EXCEPTION 'ข้อมูลคำขอมีขนาดใหญ่ผิดปกติ';
  END IF;

  SELECT profile.role, profile.municipality_id
  INTO v_role, v_muni
  FROM public.profiles AS profile
  WHERE profile.id = v_uid;

  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'บัญชีนี้ยังไม่ได้ผูกกับหน่วยงาน ไม่สามารถยื่นคำขอได้';
  END IF;

  -- ⚠️ ไม่ได้ส่งค่ามา = ถือว่าฉุกเฉิน (fail closed) — client ต้องยืนยันว่า "ไม่ฉุกเฉิน" มาเองเสมอ
  -- เคสฉุกเฉินต้องไปที่ 1669 ทันที ห้ามรอคิวหนังสือนำส่ง
  IF COALESCE((p_payload->>'is_emergency')::boolean, true) THEN
    RAISE EXCEPTION 'กรณีเจ็บป่วยฉุกเฉิน กรุณาโทร 1669 ทันที ระบบนี้ใช้สำหรับการเดินทางตามนัดที่ไม่ฉุกเฉินเท่านั้น';
  END IF;

  IF COALESCE((p_payload->>'consent_given')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ต้องให้ความยินยอมส่งข้อมูลให้หน่วยงานผู้จัดรถก่อนยื่นคำขอ';
  END IF;
  v_consent_ver := public.patient_transport_text(p_payload->>'consent_version', 'รุ่นข้อความยินยอม', 40, true);

  -- ⚠️ COALESCE(v_role, '') — บัญชีที่ยังไม่มี role ทำให้ IN (...) คืน NULL แล้วหลุดเงื่อนไขเงียบๆ
  v_staff_entry := COALESCE((p_payload->>'staff_entry')::boolean, false)
                   AND COALESCE(v_role, '') IN ('superadmin', 'admin', 'officer', 'staff');

  SELECT * INTO v_partner
  FROM public.referral_partners
  WHERE id = NULLIF(p_payload->>'partner_id', '')::uuid;

  IF v_partner.id IS NULL OR v_partner.municipality_id <> v_muni THEN
    RAISE EXCEPTION 'ไม่พบหน่วยงานผู้จัดรถที่เลือก';
  END IF;
  IF NOT v_partner.is_active THEN
    RAISE EXCEPTION 'หน่วยงาน "%" ปิดรับเรื่องอยู่ กรุณาติดต่อเจ้าหน้าที่', v_partner.name;
  END IF;
  IF NOT ('patient_transport_request' = ANY (v_partner.document_types)) THEN
    RAISE EXCEPTION 'หน่วยงาน "%" ไม่ได้รับเรื่องรถรับ-ส่งผู้ป่วย', v_partner.name;
  END IF;

  v_appt := NULLIF(p_payload->>'appointment_at', '')::timestamptz;
  IF v_appt IS NULL THEN
    RAISE EXCEPTION 'กรุณาระบุวันเวลานัด';
  END IF;
  v_appt_day := (v_appt AT TIME ZONE 'Asia/Bangkok')::date;
  IF v_appt_day < v_today THEN
    RAISE EXCEPTION 'วันนัดผ่านไปแล้ว กรุณาตรวจสอบวันที่';
  END IF;
  IF v_appt_day > v_today + 180 THEN
    RAISE EXCEPTION 'ยื่นล่วงหน้าได้ไม่เกิน 180 วัน';
  END IF;
  -- เจ้าหน้าที่รับเรื่องแทนหน้าเคาน์เตอร์ได้รับยกเว้น (เคสกระชั้นที่เจ้าหน้าที่ประสานทางโทรศัพท์แล้ว)
  IF NOT v_staff_entry AND v_appt_day - v_today < v_partner.min_lead_days THEN
    RAISE EXCEPTION 'ต้องยื่นล่วงหน้าอย่างน้อย % วันก่อนวันนัด กรณีเร่งด่วนกรุณาติดต่อเจ้าหน้าที่โดยตรง',
      v_partner.min_lead_days;
  END IF;

  v_mobility := p_payload->>'mobility';
  IF v_mobility IS NULL OR v_mobility NOT IN ('walk', 'wheelchair', 'stretcher') THEN
    RAISE EXCEPTION 'กรุณาเลือกลักษณะการเคลื่อนไหวของผู้ป่วย';
  END IF;

  v_trip_type := COALESCE(NULLIF(p_payload->>'trip_type', ''), 'round_trip');
  IF v_trip_type NOT IN ('round_trip', 'one_way') THEN
    RAISE EXCEPTION 'รูปแบบการเดินทางไม่ถูกต้อง';
  END IF;

  v_kind := p_payload->>'appointment_kind';
  IF v_kind IS NULL OR v_kind NOT IN ('dialysis', 'follow_up', 'rehab', 'medication', 'other') THEN
    RAISE EXCEPTION 'กรุณาเลือกประเภทนัด';
  END IF;

  v_relation := COALESCE(NULLIF(p_payload->>'requester_relation', ''), 'self');
  IF v_relation NOT IN ('self', 'relative', 'caregiver', 'other') THEN
    RAISE EXCEPTION 'ความเกี่ยวข้องกับผู้ป่วยไม่ถูกต้อง';
  END IF;

  v_companions := COALESCE(NULLIF(p_payload->>'companions', '')::integer, 0);
  IF v_companions < 0 OR v_companions > 3 THEN
    RAISE EXCEPTION 'ผู้ติดตามได้ไม่เกิน 3 คน';
  END IF;

  v_patient_age := NULLIF(p_payload->>'patient_age', '')::integer;
  IF v_patient_age IS NOT NULL AND (v_patient_age < 0 OR v_patient_age > 130) THEN
    RAISE EXCEPTION 'อายุผู้ป่วยไม่ถูกต้อง';
  END IF;

  v_requester := public.patient_transport_text(p_payload->>'requester_name', 'ชื่อผู้ยื่นคำขอ', 200, true);
  v_phone     := public.patient_transport_text(p_payload->>'requester_phone', 'เบอร์โทรติดต่อ', 20, true);
  v_patient   := CASE
                   WHEN v_relation = 'self' THEN v_requester
                   ELSE public.patient_transport_text(p_payload->>'patient_name', 'ชื่อผู้ป่วย', 200, true)
                 END;

  v_snapshot := jsonb_build_object(
    'form_type',              'patient_transport_request',
    'form_version',           1,
    'requester_relation',     v_relation,
    'requester_relation_note', public.patient_transport_text(p_payload->>'requester_relation_note', 'ความเกี่ยวข้อง', 100),
    'patient_name',           v_patient,
    'patient_age',            v_patient_age,
    'fund_member_no',         public.patient_transport_text(p_payload->>'fund_member_no', 'เลขที่สมาชิก', 40),
    'beneficiary_of_name',    public.patient_transport_text(p_payload->>'beneficiary_of_name', 'ชื่อสมาชิกที่เป็นผู้รับผลประโยชน์', 200),
    'beneficiary_of_member_no', public.patient_transport_text(p_payload->>'beneficiary_of_member_no', 'เลขที่สมาชิกของผู้รับผลประโยชน์', 40),
    'pickup_address',         public.patient_transport_text(p_payload->>'pickup_address', 'ที่อยู่จุดรับ', 500, true),
    'pickup_landmark',        public.patient_transport_text(p_payload->>'pickup_landmark', 'จุดสังเกต', 300),
    'destination',            public.patient_transport_text(p_payload->>'destination', 'สถานพยาบาลปลายทาง', 200, true),
    'destination_detail',     public.patient_transport_text(p_payload->>'destination_detail', 'แผนก/อาคาร', 200),
    'appointment_at',         v_appt,
    'trip_type',              v_trip_type,
    'return_note',            public.patient_transport_text(p_payload->>'return_note', 'หมายเหตุเที่ยวกลับ', 200),
    'appointment_kind',       v_kind,
    -- ช่อง "อื่นๆ" จำกัด 100 ตัวอักษร และหน้าจอบอกว่าไม่ต้องระบุชื่อโรค
    'appointment_kind_note',  CASE WHEN v_kind = 'other'
                                   THEN public.patient_transport_text(p_payload->>'appointment_kind_note', 'ประเภทนัด (อื่นๆ)', 100, true)
                                   ELSE NULL END,
    'mobility',               v_mobility,
    'companions',             v_companions,
    'partner_name',           v_partner.name,
    'consent_given',          true,
    'consent_version',        v_consent_ver,
    -- เก็บข้อความยินยอมทั้งก้อนที่ผู้ยื่นเห็นตอนติ๊ก — รุ่นอย่างเดียวไม่พอ เพราะข้อความมีชื่อ อปท.
    -- และชื่อหน่วยงานปลายทางแทรกอยู่ ต้องพิสูจน์ย้อนหลังได้ว่ายินยอมให้ส่งข้อมูลให้ใคร
    'consent_text',           public.patient_transport_text(p_payload->>'consent_text', 'ข้อความยินยอม', 2000, true),
    'consent_at',             now(),
    'signed_at',              now(),
    'signed_by',              CASE WHEN jsonb_typeof(p_payload->'signed_by') = 'object'
                                    AND pg_column_size(p_payload->'signed_by') <= 1024
                                   THEN p_payload->'signed_by' ELSE NULL END
  );

  -- แถวแม่: ไม่ระบุ department_id ให้ route_document_request_department() หากองให้
  -- (ผังงาน document_type_assignments ก่อน แล้วค่อย CASE → กองสวัสดิการสังคม → สำนักปลัด)
  INSERT INTO public.document_requests (
    id, municipality_id, department_id, document_type,
    requester_name, requester_phone, requester_address,
    purpose, status, user_id, assigned_to,
    fee_amount, payment_status, payment_slip_url, permit_form_data
  ) VALUES (
    p_request_id,
    v_muni,
    NULL,
    'patient_transport_request',
    v_requester,
    v_phone,
    public.patient_transport_text(p_payload->>'requester_address', 'ที่อยู่ผู้ยื่น', 500),
    'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย (ส่งต่อ ' || v_partner.name || ')',
    'pending',
    CASE WHEN v_staff_entry THEN NULL ELSE v_uid END,
    CASE WHEN v_staff_entry THEN v_uid ELSE NULL END,
    NULL, 'not_required', NULL,
    v_snapshot
  )
  RETURNING department_id INTO v_dept;

  INSERT INTO public.patient_transport_requests (
    request_id, municipality_id, department_id,
    partner_id, partner_name_snapshot, recipient_title_snapshot,
    appointment_at, mobility, workflow_status,
    consent_at, consent_version
  ) VALUES (
    p_request_id, v_muni, v_dept,
    v_partner.id, v_partner.name, v_partner.recipient_title,
    v_appt, v_mobility, 'submitted',
    now(), v_consent_ver
  );

  PERFORM public.log_patient_transport_event(
    p_request_id, v_muni, 'created',
    jsonb_build_object('staff_entry', v_staff_entry, 'partner_id', v_partner.id)
  );

  RETURN p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_patient_transport_request(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_patient_transport_request(uuid, jsonb) TO authenticated;

-- ===========================================================================
-- 3. อปท. ไม่ส่งต่อ — ทำได้ก่อนออกหนังสือนำส่งเท่านั้น
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.reject_patient_transport_request(
  p_request_id uuid,
  p_reason     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req    public.patient_transport_requests;
  v_reason text;
BEGIN
  v_req := public.assert_patient_transport_actor(p_request_id);

  IF v_req.workflow_status = 'rejected' THEN
    RETURN 'rejected';
  END IF;
  -- ส่งหนังสือออกไปแล้ว ข้อมูลอยู่ที่หน่วยงานปลายทางแล้ว ต้องใช้ "ยกเลิก" ซึ่งบังคับให้แจ้งปลายทาง
  IF v_req.workflow_status <> 'submitted' THEN
    RAISE EXCEPTION 'คำขอนี้ส่งต่อไปแล้ว ใช้ปุ่มยกเลิกและแจ้งหน่วยงานปลายทางแทน';
  END IF;

  v_reason := public.patient_transport_text(p_reason, 'เหตุผลที่ไม่ส่งต่อ', 500, true);

  UPDATE public.patient_transport_requests
  SET workflow_status = 'rejected',
      reject_reason   = v_reason,
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'rejected' WHERE id = p_request_id;

  PERFORM public.log_patient_transport_event(
    p_request_id, v_req.municipality_id, 'rejected', jsonb_build_object('reason', v_reason)
  );

  RETURN 'rejected';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_patient_transport_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_patient_transport_request(uuid, text) TO authenticated;

-- ===========================================================================
-- 4. บันทึกว่าออกหนังสือนำส่งแล้ว — จุดที่ข้อมูลผู้ป่วยออกจาก อปท.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.forward_patient_transport_request(
  p_request_id  uuid,
  p_letter_no   text,
  p_letter_date date DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req    public.patient_transport_requests;
  v_today  date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_no     text;
  v_date   date;
BEGIN
  v_req := public.assert_patient_transport_actor(p_request_id);

  IF v_req.workflow_status IN ('forwarded', 'fund_accepted', 'fund_declined', 'completed') THEN
    RETURN v_req.workflow_status;
  END IF;
  IF v_req.workflow_status <> 'submitted' THEN
    RAISE EXCEPTION 'ส่งต่อได้เฉพาะคำขอที่ยังรอตรวจสอบ';
  END IF;

  -- วันนัดผ่านไปแล้ว ส่งข้อมูลสุขภาพออกไปก็ไม่มีประโยชน์ = เปิดเผยเกินจำเป็น
  IF v_req.appointment_at < now() THEN
    RAISE EXCEPTION 'วันเวลานัดผ่านไปแล้ว ไม่ควรส่งต่อข้อมูล กรุณาปิดเรื่องด้วยปุ่มไม่ส่งต่อ';
  END IF;

  v_no   := public.patient_transport_text(p_letter_no, 'เลขที่หนังสือนำส่ง', 40, true);
  v_date := COALESCE(p_letter_date, v_today);
  IF v_date > v_today THEN
    RAISE EXCEPTION 'วันที่หนังสือนำส่งเป็นวันในอนาคตไม่ได้';
  END IF;
  IF v_date < (v_req.created_at AT TIME ZONE 'Asia/Bangkok')::date THEN
    RAISE EXCEPTION 'วันที่หนังสือนำส่งต้องไม่ก่อนวันที่ยื่นคำขอ';
  END IF;

  UPDATE public.patient_transport_requests
  SET workflow_status     = 'forwarded',
      forward_letter_no   = v_no,
      forward_letter_date = v_date,
      forwarded_at        = now(),
      forwarded_by        = auth.uid(),
      updated_at          = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'processing' WHERE id = p_request_id;

  PERFORM public.log_patient_transport_event(
    p_request_id, v_req.municipality_id, 'forwarded',
    jsonb_build_object('letter_no', v_no, 'letter_date', v_date, 'partner_id', v_req.partner_id)
  );

  RETURN 'forwarded';
END;
$$;

REVOKE ALL ON FUNCTION public.forward_patient_transport_request(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forward_patient_transport_request(uuid, text, date) TO authenticated;

-- ===========================================================================
-- 5. บันทึกผลจากหน่วยงานปลายทาง (รับจัดรถ / ไม่รับ)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.record_patient_transport_fund_result(
  p_request_id uuid,
  p_accepted   boolean,
  p_note       text DEFAULT NULL,
  p_contact    text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req    public.patient_transport_requests;
  v_status text;
  v_note   text;
BEGIN
  v_req := public.assert_patient_transport_actor(p_request_id);

  IF v_req.workflow_status IN ('fund_accepted', 'fund_declined', 'completed') THEN
    RETURN v_req.workflow_status;
  END IF;
  IF v_req.workflow_status <> 'forwarded' THEN
    RAISE EXCEPTION 'บันทึกผลได้เฉพาะคำขอที่ส่งต่อแล้ว';
  END IF;
  IF p_accepted IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุว่าหน่วยงานปลายทางรับหรือไม่รับ';
  END IF;

  v_status := CASE WHEN p_accepted THEN 'fund_accepted' ELSE 'fund_declined' END;
  v_note   := public.patient_transport_text(
                p_note, 'เหตุผลที่หน่วยงานปลายทางไม่รับ', 500, NOT p_accepted
              );

  UPDATE public.patient_transport_requests
  SET workflow_status   = v_status,
      fund_result_note  = v_note,
      fund_contact      = public.patient_transport_text(p_contact, 'ช่องทางติดต่อ', 200),
      fund_responded_at = now(),
      fund_recorded_by  = auth.uid(),
      updated_at        = now()
  WHERE request_id = p_request_id;

  -- ไม่รับ = งานของ อปท. จบลงโดยประชาชนไม่ได้รับบริการ — ใช้ rejected ให้สถิติไม่นับเป็นงานสำเร็จ
  -- หน้าประชาชนแสดงข้อความ "หน่วยงานผู้จัดรถไม่รับเรื่อง" จาก workflow_status ไม่ใช่คำว่าไม่อนุมัติ
  UPDATE public.document_requests
  SET status = CASE WHEN p_accepted THEN 'processing' ELSE 'rejected' END
  WHERE id = p_request_id;

  PERFORM public.log_patient_transport_event(
    p_request_id, v_req.municipality_id, v_status, jsonb_build_object('note', v_note)
  );

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.record_patient_transport_fund_result(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_patient_transport_fund_result(uuid, boolean, text, text) TO authenticated;

-- ===========================================================================
-- 6. ปิดเรื่องเมื่อเดินทางเรียบร้อย
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.complete_patient_transport_request(
  p_request_id uuid,
  p_note       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_req  public.patient_transport_requests;
  v_note text;
BEGIN
  v_req := public.assert_patient_transport_actor(p_request_id);

  IF v_req.workflow_status = 'completed' THEN
    RETURN 'completed';
  END IF;
  IF v_req.workflow_status <> 'fund_accepted' THEN
    RAISE EXCEPTION 'ปิดเรื่องได้เฉพาะคำขอที่หน่วยงานปลายทางรับจัดรถแล้ว';
  END IF;

  v_note := public.patient_transport_text(p_note, 'หมายเหตุ', 1000);

  UPDATE public.patient_transport_requests
  SET workflow_status = 'completed',
      staff_note      = COALESCE(v_note, staff_note),
      completed_at    = now(),
      completed_by    = auth.uid(),
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'completed' WHERE id = p_request_id;

  PERFORM public.log_patient_transport_event(
    p_request_id, v_req.municipality_id, 'completed', jsonb_build_object('note', v_note)
  );

  RETURN 'completed';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_patient_transport_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_patient_transport_request(uuid, text) TO authenticated;

-- ===========================================================================
-- 7. ยกเลิก — ช่องทางถอนความยินยอมของประชาชน
-- ===========================================================================
-- ผู้ยื่นยกเลิกเองได้เฉพาะก่อนส่งต่อ หลังส่งต่อแล้วข้อมูลอยู่ที่หน่วยงานปลายทาง ต้องให้เจ้าหน้าที่
-- เป็นคนยกเลิก (บังคับเหตุผล) เพื่อให้มีคนรับผิดชอบแจ้งหน่วยงานปลายทางให้หยุดใช้ข้อมูล
CREATE OR REPLACE FUNCTION public.cancel_patient_transport_request(
  p_request_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_req    public.patient_transport_requests;
  v_owner  uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;

  SELECT * INTO v_req FROM public.patient_transport_requests WHERE request_id = p_request_id;
  IF v_req.request_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคำขอรถรับ-ส่งผู้ป่วยที่อ้างถึง';
  END IF;

  IF v_req.workflow_status = 'cancelled' THEN
    RETURN 'cancelled';
  END IF;

  SELECT parent.user_id INTO v_owner FROM public.document_requests AS parent WHERE parent.id = p_request_id;

  IF v_owner IS NOT DISTINCT FROM v_uid THEN
    IF v_req.workflow_status IN ('rejected', 'fund_declined', 'completed') THEN
      RAISE EXCEPTION 'คำขอนี้ปิดไปแล้ว ยกเลิกไม่ได้';
    END IF;
    IF v_req.workflow_status <> 'submitted' THEN
      RAISE EXCEPTION 'คำขอนี้ส่งต่อให้หน่วยงานผู้จัดรถแล้ว กรุณาติดต่อเจ้าหน้าที่ อปท. เพื่อยกเลิก';
    END IF;
    v_reason := COALESCE(public.patient_transport_text(p_reason, 'เหตุผล', 500), 'ผู้ยื่นขอยกเลิกคำขอ');
  ELSE
    v_req := public.assert_patient_transport_actor(p_request_id);
    IF v_req.workflow_status NOT IN ('submitted', 'forwarded', 'fund_accepted') THEN
      RAISE EXCEPTION 'คำขอนี้ปิดไปแล้ว ยกเลิกไม่ได้';
    END IF;
    v_reason := public.patient_transport_text(p_reason, 'เหตุผลที่ยกเลิก', 500, true);
  END IF;

  UPDATE public.patient_transport_requests
  SET workflow_status = 'cancelled',
      reject_reason   = v_reason,
      cancelled_at    = now(),
      cancelled_by    = v_uid,
      updated_at      = now()
  WHERE request_id = p_request_id;

  UPDATE public.document_requests SET status = 'rejected' WHERE id = p_request_id;

  PERFORM public.log_patient_transport_event(
    p_request_id, v_req.municipality_id, 'cancelled',
    jsonb_build_object(
      'reason', v_reason,
      'by_owner', v_owner IS NOT DISTINCT FROM v_uid,
      -- ยกเลิกหลังส่งต่อ = เจ้าหน้าที่ต้องแจ้งหน่วยงานปลายทาง หน้าจอใช้ธงนี้ขึ้นเตือน
      'after_forward', v_req.workflow_status <> 'submitted'
    )
  );

  RETURN 'cancelled';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_patient_transport_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_patient_transport_request(uuid, text) TO authenticated;

COMMIT;
