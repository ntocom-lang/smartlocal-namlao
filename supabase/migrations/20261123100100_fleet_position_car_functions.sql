-- โหมดขั้นตอนขอใช้รถ (P3) — ผู้มีรถประจำตำแหน่งขอใช้ยานพาหนะส่วนกลาง (เฟส 2: ฟังก์ชัน/trigger/RPC)
-- ต่อจาก 20261123100000_fleet_position_car_columns.sql
--
-- ตัวบท: ระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙ ข้อ ๑๒ ว.๕
--   ผู้มีรถประจำตำแหน่งใช้ยานพาหนะส่วนกลางได้เฉพาะจำเป็นเฉพาะคราว ต้องขออนุมัติจากผู้บริหารท้องถิ่นและระบุเหตุผล
--
-- กติกาที่ไฟล์นี้รักษา:
--   (1) ใช้เฉพาะใบ permit_mode='regulation' — ใบ queue (น้ำเลาและใบเก่าทุกใบ) ไม่เปลี่ยนแม้แต่ผลลัพธ์เดียว
--   (2) "ผู้มีรถประจำตำแหน่ง" = profiles.position_id ของผู้ขอ ตรงกับ fleet_vehicles.holder_position_id ของรถ
--       ประจำตำแหน่งที่ยังไม่จำหน่าย/ไม่ปลดระวาง ใน อปท. เดียวกับใบ และรถที่ขอเป็นรถส่วนกลาง (ไม่ใช่รถประจำตำแหน่ง)
--       คำนวณทุกครั้งที่ถาม (ผูกผู้ถือรถทีหลัง = ใบที่ยังไม่ออกรถต้องกรอกเหตุผล/ให้นายกอนุมัติ — เลือกเข้มไว้ก่อน)
--   (3) เหตุผลไม่บังคับตอนยื่น (fleet_override_booking สร้างทริปผ่าน RPC ที่ไม่มีช่องนี้) แต่ใบที่ยังไม่มีเหตุผล
--       คำนวณเป็น reason_required ⇒ ออกรถไม่ได้ / บันทึกใบกระดาษไม่ได้ จนกว่าจะกรอก
--   (4) ไม่มอบ ผอ.กอง และผู้มีอำนาจต้องเป็นนายก: ใบที่เลือกผู้มีอำนาจคนอื่น = mayor_required
--       ผู้ขอเป็นนายกเอง = ทาง สก.๑ (ข้อ ๑๒ ว.๖) เหมือนเดิม แต่ต้องกรอกเหตุผลด้วย (เจ้าของระบบเลือก 2026-11-12)
--   (5) ไม่แก้ esign_fleet_trip_payload (แก้แล้ว hash ของลายเซ็นเก่าทุกใบไม่ตรง) — เหตุผลล็อกด้วย trigger แยกแทน
--   (6) เขียนทับ approver (รุ่น P2) + state/record (รุ่น P1) ทั้งตัว (NOTES ข้อ 5) ด่านหัวไฟล์เทียบ md5 กับรุ่นตั้งต้นก่อน ไม่ตรง = หยุด
--   (7) esign_my_pending (รายการ "รอลงนามของฉัน"/ห้องผู้บริหาร) เพิ่มคีย์ position_car_reason ให้ผู้อนุญาตเห็นเหตุผล
--       ก่อนลงนาม (ว.๕ ให้ระบุเหตุผลต่อผู้อนุญาต) — เขียนทับทั้งตัวจาก 20261101120100 ต่างแค่คอลัมน์/คีย์นี้ (ด่าน md5 เดียวกัน)
--       exec_digest ใช้แค่จำนวนจากฟังก์ชันนี้ คีย์ใหม่ไม่ออกไปทาง Telegram

DO $guard$
DECLARE
  v_missing text;
  v_drift   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_vehicles' AND column_name = 'holder_position_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_trips' AND column_name = 'position_car_reason'
  ) THEN
    RAISE EXCEPTION 'ไม่พบคอลัมน์ P3 — ต้องรัน 20261123100000_fleet_position_car_columns.sql ก่อน';
  END IF;

  SELECT string_agg(x, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'public.fleet_permit_requester_is_mayor(public.fleet_trips)', 'public.fleet_permit_registry(uuid,text,uuid,text,date)',
    'public.fleet_permit_signer_of(public.document_signatories,text)', 'public.fleet_permit_today()',
    'public.esign_trip_open_return(uuid)', 'public.esign_fleet_trip_payload(public.fleet_trips)',
    'public.esign_content_hash(jsonb)', 'public.esign_audit(uuid,text,text,text,text,jsonb)',
    'public.esign_is_tenant_admin(uuid)', 'public.fleet_is_manager(uuid)', 'public.fleet_can_read(uuid)',
    'public.fleet_permit_acting_title(uuid,text)'
  ]) x
  WHERE to_regprocedure(x) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชันที่ต้องใช้: %', v_missing;
  END IF;

  -- ฟังก์ชันที่จะเขียนทับต้องเป็นรุ่นที่ไฟล์นี้ตั้งต้น ตรงตัว — เทียบเนื้อหลังยุบช่องว่าง (CRLF/LF ให้ผลเท่ากัน)
  --   approver ← P2 20261122100000 (รันบนฐานจริงแล้ว 2026-11-12) · state/record ← P1 20261121100100 (#705) · esign_my_pending ← 20261101120100_esign_trip_return_functions.sql
  SELECT string_agg(e.sig, ', ') INTO v_drift
  FROM (VALUES
    ('public.fleet_trip_permit_approver(public.fleet_trips,date)', '39b6fd97fb82862424ce75e11a0dfc32'),
    ('public.fleet_trip_permit_state(public.fleet_trips)', '7591cf1077d33317943d4b4a3d10e755'),
    ('public.fleet_record_paper_permit(uuid,text,date)', 'a9fe21a5c5e15cb01e95d7cf7593a98b'),
    ('public.esign_my_pending()', 'e2710133845c2045a4278f7b1b38b7d4')
  ) AS e(sig, h)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE p.oid IS NULL OR md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) <> e.h;
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'ฟังก์ชันบนฐานไม่ใช่รุ่นที่ไฟล์นี้ตั้งต้น: % — หยุดหาสาเหตุก่อน ห้ามเขียนทับ (NOTES ข้อ 5)', v_drift;
  END IF;
END;
$guard$;

-- DROP/CREATE TRIGGER บน fleet_trips/fleet_vehicles ต้องได้ lock — ค้างเกิน 5 วินาที = ยอมแพ้ ไม่ขวางทั้งระบบ
SET lock_timeout = '5s';

-- ── 1) ผู้มีรถประจำตำแหน่ง ─────────────────────────────────────────────────────────────────────
-- คืนรถประจำตำแหน่งของผู้ขอ (คันแรกตามทะเบียน) หรือ NULL — NULL ด้วยเมื่อรถที่ขอเป็นรถประจำตำแหน่งเอง
-- (ว.๕ ว่าด้วยการใช้ "ยานพาหนะส่วนกลาง") · รถเข้าซ่อมยังนับว่ามีรถ (เหตุจำเป็นคือสิ่งที่ต้องเขียนในเหตุผล)
CREATE OR REPLACE FUNCTION public.fleet_position_car_core(p_municipality_id uuid, p_requester uuid, p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
           'vehicle_id', v.id, 'license_plate', v.license_plate, 'name', v.name, 'position_name', pos.name
         )
  FROM public.profiles pr
  JOIN public.fleet_vehicles v
    ON v.holder_position_id = pr.position_id
   AND v.municipality_id = p_municipality_id
  LEFT JOIN public.positions pos ON pos.id = v.holder_position_id
  WHERE p_requester IS NOT NULL
    AND pr.id = p_requester
    AND v.regulation_category = 'position'
    AND v.disposed_date IS NULL
    AND v.status IS DISTINCT FROM 'retired'
    AND v.id IS DISTINCT FROM p_vehicle_id
    AND NOT EXISTS (
      SELECT 1 FROM public.fleet_vehicles tv
      WHERE tv.id = p_vehicle_id AND tv.regulation_category = 'position'
    )
  ORDER BY v.license_plate, v.id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.fleet_position_car_core(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fleet_trip_position_car(p_trip public.fleet_trips)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.fleet_position_car_core(
    p_trip.municipality_id, COALESCE(p_trip.requested_by, p_trip.created_by), p_trip.vehicle_id
  )
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_position_car(public.fleet_trips) FROM PUBLIC, anon, authenticated;

-- ── 2) เขียนทับ P2: ผู้อนุญาตที่ควรเป็นของใบ (ตั้งต้นจาก 20261122100000_fleet_permit_delegated_esign.sql) ─────────────────────────────────────────────────────
-- เพิ่มจาก P2: ผู้มีรถประจำตำแหน่ง (ไม่ใช่นายกเอง) ⇒ ไม่ใช้การมอบ ผอ.กอง และผู้มีอำนาจ = นายกเสมอ
--   fallback_reason = 'position_car_holder'
CREATE OR REPLACE FUNCTION public.fleet_trip_permit_approver(p_trip public.fleet_trips, p_at date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_at        date := COALESCE(p_at, public.fleet_permit_today());
  v_set       public.fleet_permit_settings%ROWTYPE;
  v_requester uuid := COALESCE(p_trip.requested_by, p_trip.created_by);
  v_dept      uuid;
  v_reg       public.document_signatories;
  v_fallback  text;
  v_role      text := COALESCE(p_trip.order_authority_role, 'mayor');
  v_label     text;
  v_signer    jsonb;
  v_is_mayor  boolean := public.fleet_permit_requester_is_mayor(p_trip);
  v_pc        jsonb := public.fleet_trip_position_car(p_trip);
BEGIN
  SELECT * INTO v_set FROM public.fleet_permit_settings s WHERE s.municipality_id = p_trip.municipality_id;

  IF FOUND AND v_set.delegate_dept_heads THEN
    -- กองที่ผู้ขอสังกัดจริง (แอดมินเป็นผู้ตั้ง) — ไม่รับกองที่ผู้ขอเลือกเองในใบ
    SELECT pr.department_id INTO v_dept FROM public.profiles pr WHERE pr.id = v_requester;
    IF v_is_mayor THEN
      v_fallback := 'requester_is_executive';
    ELSIF v_pc IS NOT NULL THEN
      -- ข้อ ๑๒ ว.๕ ต้องขออนุมัติจากผู้บริหารท้องถิ่น — การมอบตาม ว.๔ ใช้กับใบนี้ไม่ได้
      v_fallback := 'position_car_holder';
    ELSIF v_set.delegation_date IS NOT NULL AND v_at < v_set.delegation_date THEN
      -- ลงนามก่อนวันที่คำสั่งมอบหมาย = ตอนนั้น ผอ. ยังไม่มีอำนาจอนุมัติแทน
      v_fallback := 'delegation_not_in_effect';
    ELSIF v_dept IS NULL THEN
      v_fallback := 'no_department';
    ELSE
      v_reg := public.fleet_permit_registry(p_trip.municipality_id, 'department_head', v_dept, NULL, v_at);
      IF v_reg.id IS NULL THEN
        v_fallback := 'no_dept_head';
      ELSIF v_reg.profile_id IS NOT NULL
            AND (v_reg.profile_id = v_requester OR v_reg.profile_id IS NOT DISTINCT FROM p_trip.created_by) THEN
        -- ผอ. ขอเอง หรือ ผอ. เป็นคนกรอกใบแทนลูกน้อง = อนุมัติใบของตัวเองไม่ได้
        v_fallback := 'self_request';
      ELSE
        v_signer := public.fleet_permit_signer_of(v_reg, 'ผู้อำนวยการสำนัก/กอง');
        RETURN v_signer
          || jsonb_build_object(
               'kind', 'delegated_dept_head',
               'department_id', v_dept,
               'delegation_ref', v_set.delegation_ref,
               'delegation_date', v_set.delegation_date,
               'acting_title', public.fleet_permit_acting_title(p_trip.municipality_id, v_signer ->> 'title'),
               'fallback_reason', NULL
             );
      END IF;
    END IF;
  END IF;

  IF v_pc IS NOT NULL AND NOT v_is_mayor THEN
    v_role := 'mayor';
    v_fallback := COALESCE(v_fallback, 'position_car_holder');
  END IF;

  v_label := CASE v_role
    WHEN 'mayor' THEN 'นายก (ผู้บริหารท้องถิ่น)'
    WHEN 'clerk' THEN 'ปลัด'
    WHEN 'custom' THEN COALESCE(NULLIF(btrim(p_trip.order_authority_label), ''), 'ผู้มีอำนาจสั่งใช้ยานพาหนะ')
    ELSE 'ผู้มีอำนาจสั่งใช้ยานพาหนะ'
  END;
  v_reg := public.fleet_permit_registry(
    p_trip.municipality_id, v_role, NULL,
    CASE WHEN v_role = 'custom' THEN p_trip.order_authority_label ELSE NULL END,
    v_at
  );
  RETURN public.fleet_permit_signer_of(v_reg, v_label)
    || jsonb_build_object('kind', 'authority', 'role', v_role, 'fallback_reason', v_fallback);
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_permit_approver(public.fleet_trips, date) FROM PUBLIC, anon, authenticated;

-- ── 3) เขียนทับ P1: สถานะการอนุญาตของใบ ───────────────────────────────────────────────────────
-- เพิ่มจาก P1 (เฉพาะใบ regulation):
--   reason_required = ผู้มีรถประจำตำแหน่งยังไม่กรอกเหตุผลความจำเป็น (ว.๕)
--   mayor_required  = ผู้มีรถประจำตำแหน่ง (ไม่ใช่นายกเอง) แต่ช่องผู้มีอำนาจของใบไม่ใช่นายก
--   ทุกผลลัพธ์มีคีย์ position_car (NULL = ไม่ใช่ผู้มีรถประจำตำแหน่ง) · esign มี signature_id ไว้ทำคีย์แจ้งเตือน
--   สองสถานะใหม่มาก่อนลายเซ็น/ใบกระดาษ: ลายเซ็นที่มีอยู่แล้วไม่นับจนกว่าจะครบเงื่อนไข ว.๕
--   แต่ถ้ามีบันทึกใบกระดาษที่ยังมีผลอยู่ ต้องแนบ via/permit_id ไปด้วย ไม่งั้น info.can_void เป็นเท็จ ปุ่มยกเลิกบันทึกหาย
--   แล้วใบติดตาย (เหตุผลถูกล็อกเพราะมีบันทึก แต่ยกเลิกบันทึกไม่ได้) — ห้ามใส่ใน v_extra เพราะจะทับ via ของใบที่อนุญาตแล้ว
CREATE OR REPLACE FUNCTION public.fleet_trip_permit_state(p_trip public.fleet_trips)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_paper public.fleet_trip_permits%ROWTYPE;
  v_sig   public.esign_signatures%ROWTYPE;
  v_hash  text;
  v_pc    jsonb;
  v_extra jsonb;
  v_held  jsonb := '{}'::jsonb;
BEGIN
  IF p_trip.permit_mode IS DISTINCT FROM 'regulation' THEN
    RETURN jsonb_build_object('state', 'not_required');
  END IF;

  v_pc := public.fleet_trip_position_car(p_trip);
  v_extra := jsonb_build_object('position_car', v_pc);
  IF v_pc IS NOT NULL THEN
    SELECT g.* INTO v_paper
    FROM public.fleet_trip_permits g
    WHERE g.trip_id = p_trip.id AND g.kind = 'granted'
      AND NOT EXISTS (SELECT 1 FROM public.fleet_trip_permits v WHERE v.voids_id = g.id)
    ORDER BY g.seq DESC
    LIMIT 1;
    IF FOUND THEN
      v_held := jsonb_build_object(
        'via', 'paper', 'permit_id', v_paper.id, 'basis', v_paper.basis,
        'signer_name', v_paper.signer_name, 'signer_title', v_paper.signer_title, 'signed_on', v_paper.signed_on
      );
    END IF;
    IF NULLIF(btrim(COALESCE(p_trip.position_car_reason, '')), '') IS NULL THEN
      RETURN jsonb_build_object('state', 'reason_required') || v_held || v_extra;
    END IF;
    IF NOT public.fleet_permit_requester_is_mayor(p_trip)
       AND COALESCE(p_trip.order_authority_role, 'mayor') <> 'mayor' THEN
      RETURN jsonb_build_object('state', 'mayor_required') || v_held || v_extra;
    END IF;
  END IF;

  -- ลายเซ็นออนไลน์: เนื้อหาคำขอถูกล็อกโดย esign_fleet_trip_guard ตั้งแต่มีลายเซ็นแรก จึงไม่ต้องเทียบ hash ซ้ำ
  SELECT s.* INTO v_sig
  FROM public.esign_signatures s
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = p_trip.id
    AND (
      (s.slot = 'authority' AND s.decision = 'approve')
      OR (s.slot = 'sk1' AND public.fleet_permit_requester_is_mayor(p_trip))
    )
    AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
  ORDER BY s.signed_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'authorized', 'via', 'esign', 'slot', v_sig.slot, 'signature_id', v_sig.id,
      'signer_name', v_sig.signer_name, 'signer_title', NULLIF(v_sig.signed_as, ''),
      'signed_at', v_sig.signed_at
    ) || v_extra;
  END IF;

  SELECT g.* INTO v_paper
  FROM public.fleet_trip_permits g
  WHERE g.trip_id = p_trip.id AND g.kind = 'granted'
    AND NOT EXISTS (SELECT 1 FROM public.fleet_trip_permits v WHERE v.voids_id = g.id)
  ORDER BY g.seq DESC
  LIMIT 1;
  IF FOUND THEN
    v_hash := public.esign_content_hash(public.esign_fleet_trip_payload(p_trip));
    RETURN jsonb_build_object(
      'state', CASE WHEN v_paper.content_hash = v_hash THEN 'authorized' ELSE 'modified' END,
      'via', 'paper', 'permit_id', v_paper.id, 'basis', v_paper.basis,
      'signer_name', v_paper.signer_name, 'signer_title', v_paper.signer_title,
      'signed_on', v_paper.signed_on, 'delegation_ref', v_paper.delegation_ref,
      'delegation_date', v_paper.delegation_date,
      'recorded_by_name', v_paper.recorded_by_name, 'recorded_at', v_paper.recorded_at
    ) || v_extra;
  END IF;

  IF (public.esign_trip_open_return(p_trip.id)).id IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'returned') || v_extra;
  END IF;
  RETURN jsonb_build_object('state', 'waiting') || v_extra;
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_permit_state(public.fleet_trips) FROM PUBLIC, anon, authenticated;

-- ── 4) เขียนทับ P1: บันทึกการอนุญาตจากใบกระดาษ ─────────────────────────────────────────────────
-- เพิ่มจาก P1: ใบที่ยังไม่ครบเงื่อนไข ว.๕ (reason_required / mayor_required) บันทึกไม่ได้
-- (basis 'delegated_dept_head' ถูกกันอยู่แล้วเพราะ approver คืน kind='authority' fallback position_car_holder)
CREATE OR REPLACE FUNCTION public.fleet_record_paper_permit(
  p_trip_id   uuid,
  p_basis     text,
  p_signed_on date
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_trip     public.fleet_trips%ROWTYPE;
  v_today    date := public.fleet_permit_today();
  v_approver jsonb;
  v_signer   jsonb;
  v_reg      public.document_signatories;
  v_role     text;
  v_rec_name text;
  v_id       uuid;
  v_state    text;
BEGIN
  IF auth.uid() IS NULL OR p_trip_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  -- ตรวจสิทธิ์ก่อนล็อกแถว (คนไม่มีสิทธิ์ต้องไม่ได้ถือ lock ทริปของ อปท. อื่น)
  IF NOT public.fleet_is_manager((SELECT t.municipality_id FROM public.fleet_trips t WHERE t.id = p_trip_id)) THEN
    -- ไม่บอกว่ามีใบนี้หรือไม่ ถ้าไม่ใช่ผู้ดูแลของ อปท. นั้น
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT * INTO v_trip FROM public.fleet_trips t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fleet_is_manager(v_trip.municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_trip.permit_mode IS DISTINCT FROM 'regulation' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_required');
  END IF;
  IF v_trip.status NOT IN ('pending', 'waitlisted', 'approved') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_status');
  END IF;
  v_state := public.fleet_trip_permit_state(v_trip) ->> 'state';
  IF v_state = 'authorized' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_authorized');
  END IF;
  IF v_state IN ('reason_required', 'mayor_required') THEN
    RETURN jsonb_build_object('ok', false, 'code', v_state);
  END IF;
  IF p_signed_on IS NULL OR p_signed_on > v_today OR p_signed_on < v_today - 60 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_date');
  END IF;

  IF p_basis = 'delegated_dept_head' THEN
    v_approver := public.fleet_trip_permit_approver(v_trip, p_signed_on);
    IF v_approver ->> 'kind' IS DISTINCT FROM 'delegated_dept_head' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'delegation_not_applicable',
                                'fallback_reason', v_approver ->> 'fallback_reason');
    END IF;
    v_signer := v_approver;
  ELSIF p_basis = 'authority' THEN
    v_role := COALESCE(v_trip.order_authority_role, 'mayor');
    v_reg := public.fleet_permit_registry(
      v_trip.municipality_id, v_role, NULL,
      CASE WHEN v_role = 'custom' THEN v_trip.order_authority_label ELSE NULL END,
      p_signed_on
    );
    v_signer := public.fleet_permit_signer_of(v_reg, NULL);
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'bad_basis');
  END IF;

  IF v_signer ->> 'registry_id' IS NULL OR NULLIF(btrim(v_signer ->> 'name'), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'signatory_missing');
  END IF;

  SELECT p.full_name INTO v_rec_name FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.fleet_trip_permits (
    municipality_id, trip_id, kind, basis, signer_name, signer_title, registry_id,
    delegation_ref, delegation_date, signed_on, content_hash, recorded_by, recorded_by_name
  ) VALUES (
    v_trip.municipality_id, v_trip.id, 'granted', p_basis,
    left(v_signer ->> 'name', 250), left(v_signer ->> 'title', 300), (v_signer ->> 'registry_id')::uuid,
    CASE WHEN p_basis = 'delegated_dept_head' THEN v_signer ->> 'delegation_ref' END,
    CASE WHEN p_basis = 'delegated_dept_head' THEN (v_signer ->> 'delegation_date')::date END,
    p_signed_on, public.esign_content_hash(public.esign_fleet_trip_payload(v_trip)),
    auth.uid(), COALESCE(v_rec_name, '')
  )
  RETURNING id INTO v_id;

  -- self_recorded: ผู้ดูแลรถบันทึกการอนุญาตให้คำขอของตัวเอง — ไม่ห้าม (อปท. เล็กมีผู้ดูแลคนเดียว) แต่ติดธงให้ผู้ตรวจเห็น
  PERFORM public.esign_audit(
    v_trip.municipality_id, 'fleet_permit_recorded', 'fleet_trip', v_trip.id::text, 'บันทึกการอนุญาตใช้รถ (ใบกระดาษ)',
    jsonb_build_object('permit_id', v_id, 'basis', p_basis, 'registry_id', v_signer ->> 'registry_id', 'signed_on', p_signed_on,
                       'self_recorded', COALESCE(auth.uid() IN (v_trip.requested_by, v_trip.created_by), false),
                       -- P3: ตอนอนุญาตเข้าข่าย ว.๕ หรือไม่ (ทะเบียนรถ/ตำแหน่ง ไม่มีเหตุผลข้อความอิสระ)
                       'position_car', public.fleet_trip_position_car(v_trip))
  );
  RETURN jsonb_build_object('ok', true, 'permit_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_record_paper_permit(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_record_paper_permit(uuid, text, date) TO authenticated;

-- ── 5) trigger: เหตุผล ว.๕ ────────────────────────────────────────────────────────────────────
-- ช่องว่าง/เว้นวรรคล้วน = NULL (ให้ CHECK 5–500 ตัวอักษรตัดสินเฉพาะข้อความจริง)
-- ล็อกหลังมีลายเซ็นที่ยังไม่ถูกถอน หรือมีบันทึกใบกระดาษที่ยังไม่ถูกยกเลิก: ผู้อนุญาตเห็นเหตุผลชุดไหน ต้องคงชุดนั้น
-- (เหตุผลไม่อยู่ใน payload ของลายเซ็น/ใบกระดาษ จึงต้องล็อกที่นี่ — ดูกติกา (5) หัวไฟล์)
-- แก้หลังล็อก = ถอนลายเซ็น / ยกเลิกบันทึกใบกระดาษก่อน แล้วขออนุญาตใหม่
CREATE OR REPLACE FUNCTION public.fleet_trip_position_reason_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.position_car_reason := NULLIF(btrim(COALESCE(NEW.position_car_reason, '')), '');
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.position_car_reason IS NOT DISTINCT FROM OLD.position_car_reason THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.esign_signatures s
       WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = OLD.id
         AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
     )
     OR EXISTS (
       SELECT 1 FROM public.fleet_trip_permits g
       WHERE g.trip_id = OLD.id AND g.kind = 'granted'
         AND NOT EXISTS (SELECT 1 FROM public.fleet_trip_permits v WHERE v.voids_id = g.id)
     ) THEN
    RAISE EXCEPTION 'FLEET_POSITION_REASON_LOCKED: คำขอนี้มีการลงนามหรือบันทึกการอนุญาตแล้ว แก้เหตุผลไม่ได้ ให้ถอนลายเซ็นหรือยกเลิกบันทึกก่อน'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_position_reason_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_trips_position_reason_guard ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trips_position_reason_guard
BEFORE INSERT OR UPDATE ON public.fleet_trips
FOR EACH ROW EXECUTE FUNCTION public.fleet_trip_position_reason_guard();

-- ── 6) trigger: ตำแหน่งผู้ถือรถต้องเป็นของ อปท. เดียวกับรถ ───────────────────────────────────────
-- ตรวจเฉพาะตอนตั้ง/เปลี่ยนผู้ถือ หรือย้าย อปท. — แก้ช่องอื่นของรถไม่ถูกกันเพราะข้อมูลตำแหน่งเปลี่ยนทีหลัง
CREATE OR REPLACE FUNCTION public.fleet_vehicle_holder_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.holder_position_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.holder_position_id IS NOT DISTINCT FROM OLD.holder_position_id
     AND NEW.municipality_id IS NOT DISTINCT FROM OLD.municipality_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.positions p
    WHERE p.id = NEW.holder_position_id AND p.municipality_id = NEW.municipality_id
  ) THEN
    RAISE EXCEPTION 'FLEET_HOLDER_POSITION_TENANT: ตำแหน่งผู้ถือรถต้องเป็นตำแหน่งของ อปท. เดียวกับรถ'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_vehicle_holder_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_vehicles_holder_guard ON public.fleet_vehicles;
CREATE TRIGGER trg_fleet_vehicles_holder_guard
BEFORE INSERT OR UPDATE ON public.fleet_vehicles
FOR EACH ROW EXECUTE FUNCTION public.fleet_vehicle_holder_guard();

-- ── 7) RPC ให้ฟอร์มขอใช้รถถามก่อนบันทึก ─────────────────────────────────────────────────────────
-- p_requested_by ว่าง = ตัวผู้เรียก · ผู้ใช้โมดูลยานพาหนะ / แอดมิน อปท. นั้นเท่านั้น
-- คืนเฉพาะทะเบียน/ชื่อรถ/ชื่อตำแหน่ง (ข้อมูลราชการ) ไม่คืนชื่อบุคคล
CREATE OR REPLACE FUNCTION public.fleet_position_car_check(
  p_municipality_id uuid,
  p_requested_by    uuid,
  p_vehicle_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL
     OR NOT (public.fleet_can_read(p_municipality_id) OR public.esign_is_tenant_admin(p_municipality_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'permit_mode', COALESCE(
      (SELECT s.permit_mode FROM public.fleet_permit_settings s WHERE s.municipality_id = p_municipality_id), 'queue'),
    'position_car', public.fleet_position_car_core(p_municipality_id, COALESCE(p_requested_by, auth.uid()), p_vehicle_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_position_car_check(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_position_car_check(uuid, uuid, uuid) TO authenticated;

-- ── 8) RPC สำหรับ notify-telegram (service_role เท่านั้น) — "ออกรถได้แล้ว" ─────────────────────────
-- edge function ตรวจสถานะจริงฝั่งเซิร์ฟเวอร์ ไม่เชื่อ client · key = ลายเซ็น/บันทึกที่ทำให้อนุญาต
-- (ยกเลิกแล้วอนุญาตใหม่ = key ใหม่ = แจ้งรอบใหม่) · key มีค่าเฉพาะ state='authorized' เท่านั้น
-- (ใบ modified / reason_required / mayor_required ก็มี permit_id ของใบกระดาษ แต่ไม่ได้แปลว่าออกรถได้)
CREATE OR REPLACE FUNCTION public.fleet_trip_authorized_notice(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_trip  public.fleet_trips%ROWTYPE;
  v_state jsonb;
BEGIN
  SELECT * INTO v_trip FROM public.fleet_trips t WHERE t.id = p_trip_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF v_trip.permit_mode IS DISTINCT FROM 'regulation' THEN
    RETURN jsonb_build_object('found', true, 'permit_mode', 'queue', 'state', 'not_required', 'status', v_trip.status);
  END IF;
  v_state := public.fleet_trip_permit_state(v_trip);
  RETURN v_state || jsonb_build_object(
    'found', true, 'permit_mode', 'regulation', 'status', v_trip.status,
    'key', CASE WHEN v_state ->> 'state' = 'authorized'
                THEN COALESCE(v_state ->> 'signature_id', v_state ->> 'permit_id') END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_authorized_notice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_trip_authorized_notice(uuid) TO service_role;

-- ── 9) เขียนทับ esign_my_pending: เพิ่ม position_car_reason ในรายการรอลงนาม ───────────────────────────
-- ตั้งต้นจาก 20261101120100_esign_trip_return_functions.sql ทั้งตัว (ด่าน md5 หัวไฟล์) ต่างแค่คอลัมน์ใน SELECT + คีย์ใน items
CREATE OR REPLACE FUNCTION public.esign_my_pending()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_muni   uuid;
  v_signatory boolean;
  v_trip   record;
  v_status jsonb;
  v_slot   jsonb;
  v_items  jsonb := '[]'::jsonb;
  v_returned jsonb := '[]'::jsonb;
  v_last   jsonb;
  v_round  integer;
  v_name   text;
  v_vehicle text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = v_uid;
  IF v_muni IS NULL THEN
    -- ไม่มีสังกัด (เช่น superadmin) ไม่มีใบที่ถึงคิว — ตอบว่างเปล่า ไม่ใช่ error
    RETURN jsonb_build_object('ok', true, 'count', 0, 'items', '[]'::jsonb, 'returned', '[]'::jsonb);
  END IF;

  -- คนส่วนใหญ่ไม่ได้อยู่ในทะเบียนผู้ลงนาม ไม่ต้องไล่หาช่อง ผอ.กอง/ผู้มีอำนาจ ทุกใบของหน่วยงาน
  v_signatory := EXISTS (
    SELECT 1 FROM public.document_signatories s
    WHERE s.municipality_id = v_muni AND s.document_type = 'complaint' AND s.profile_id = v_uid AND s.is_active
  );

  FOR v_trip IN
    SELECT t.id, t.status, t.destination, t.purpose, t.planned_departure, t.vehicle_id, t.position_car_reason, t.permit_mode,
           COALESCE(t.requested_by, t.created_by) AS requester_id
    FROM public.fleet_trips t
    WHERE t.municipality_id = v_muni
      AND t.esign_slots IS NOT NULL
      AND t.status IN ('pending', 'waitlisted', 'approved', 'in_progress', 'completed')
      AND public.esign_trip_may_need_me(t, v_uid, v_signatory)
    -- ใบที่ยังไม่จบทริปขึ้นก่อน (วันเดินทางใกล้สุดก่อน) · ใบที่จบแล้วเอาล่าสุดก่อน ใบเก่าที่ค้างจะไม่ดันใบใหม่ตกจากเพดาน
    ORDER BY (t.status = 'completed'),
             CASE WHEN t.status <> 'completed' THEN t.planned_departure END NULLS LAST,
             t.planned_departure DESC NULLS LAST,
             t.created_at
    LIMIT 300
  LOOP
    v_status := public.esign_trip_status(v_trip.id);
    CONTINUE WHEN NOT COALESCE((v_status ->> 'found')::boolean, false);
    v_last := v_status -> 'last_return';
    v_round := COALESCE((v_status ->> 'returns_count')::integer, 0);
    FOR v_slot IN SELECT e FROM jsonb_array_elements(v_status -> 'slots') e LOOP
      IF COALESCE((v_slot ->> 'can_sign')::boolean, false) THEN
        v_name := NULL;
        SELECT btrim(COALESCE(p.full_name, '')) INTO v_name FROM public.profiles p WHERE p.id = v_trip.requester_id;
        v_vehicle := NULL;
        SELECT v.name INTO v_vehicle FROM public.fleet_vehicles v WHERE v.id = v_trip.vehicle_id;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'trip_id', v_trip.id,
          'slot', v_slot ->> 'slot',
          'slot_label', v_slot ->> 'label',
          'decision', CASE WHEN v_slot ->> 'slot' = 'authority' THEN 'approve' ELSE 'sign' END,
          'can_return', COALESCE((v_slot ->> 'can_return')::boolean, false),
          'round', v_round,
          'last_return', v_last,
          'trip_status', v_trip.status,
          'requester_name', NULLIF(v_name, ''),
          'vehicle_name', v_vehicle,
          'destination', v_trip.destination,
          'purpose', v_trip.purpose,
          'planned_departure', v_trip.planned_departure,
          -- P3 ข้อ ๑๒ ว.๕: ผู้อนุญาตต้องเห็นเหตุผลของผู้มีรถประจำตำแหน่งก่อนลงนาม
          -- position_car_required แยก "ใบทั่วไป" กับ "ใบผู้ถือรถที่ยังไม่กรอกเหตุผล" (ลงนามตอนนั้น = ไม่นับ + ล็อกเหตุผล)
          -- คำนวณเฉพาะแถวที่ถึงคิวลงนาม (ไม่เกินเพดาน 100) ไม่ใช่ทุกใบที่ไล่ดู
          'position_car_reason', v_trip.position_car_reason,
          'position_car_required', (
            v_trip.permit_mode = 'regulation'
            AND public.fleet_position_car_core(v_muni, v_trip.requester_id, v_trip.vehicle_id) IS NOT NULL
          )
        ));
      END IF;
    END LOOP;

    -- ใบที่ถูกส่งคืนมาหาฉัน แต่ช่องผู้ขอเซ็นสด จึงไม่มีแถวให้ลงนาม ต้องกดส่งให้ลงนามต่อ
    IF v_trip.requester_id = v_uid AND COALESCE((v_status ->> 'can_resubmit')::boolean, false) THEN
      v_vehicle := NULL;
      SELECT v.name INTO v_vehicle FROM public.fleet_vehicles v WHERE v.id = v_trip.vehicle_id;
      v_returned := v_returned || jsonb_build_array(jsonb_build_object(
        'trip_id', v_trip.id,
        'round', v_round,
        'trip_status', v_trip.status,
        'vehicle_name', v_vehicle,
        'destination', v_trip.destination,
        'purpose', v_trip.purpose,
        'planned_departure', v_trip.planned_departure,
        'last_return', v_last
      ));
    END IF;

    EXIT WHEN jsonb_array_length(v_items) + jsonb_array_length(v_returned) >= 100;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', jsonb_array_length(v_items), 'items', v_items, 'returned', v_returned);
END;
$$;
REVOKE ALL ON FUNCTION public.esign_my_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_my_pending() TO authenticated;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select tgname from pg_trigger where tgrelid = 'public.fleet_trips'::regclass and not tgisinternal order by 1;
--     → มี trg_fleet_trips_position_reason_guard
--   select has_function_privilege('authenticated', 'public.fleet_trip_authorized_notice(uuid)', 'execute'); → false
--   select has_function_privilege('anon', 'public.fleet_position_car_check(uuid,uuid,uuid)', 'execute');     → false
--   select count(*) from public.fleet_vehicles where holder_position_id is not null;                     → 0

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
