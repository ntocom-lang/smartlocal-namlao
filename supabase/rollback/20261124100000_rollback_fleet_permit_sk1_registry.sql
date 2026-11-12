-- ย้อน P4 (20261124100000_fleet_permit_sk1_registry.sql) — คืน 7 ฟังก์ชันเป็นรุ่นตั้งต้น + ถอน helper
-- ⚠️ ย้อนหน้าเว็บ (revert PR) ก่อน แล้วค่อยรันไฟล์นี้ — หน้าเว็บ P4 ส่ง p_reason_hash ให้ใบ ว.๕ ถ้าฐานไม่มีพารามิเตอร์นี้ ใบนั้นลงนามไม่ได้
-- ห้ามรัน 20261101120100 ซ้ำทั้งไฟล์แทนไฟล์นี้ (จะเขียน esign_my_pending ของ P3 ทับ — NOTES ข้อ 5)
-- สร้างจากไฟล์ migration ต้นฉบับด้วยสคริปต์ (ไม่ได้พิมพ์เนื้อฟังก์ชันเอง) · ทดสอบใน PGlite แล้ว: md5 กลับรุ่นตั้งต้นครบ 7 ตัว และรัน P4 ซ้ำได้หลังย้อน
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.esign_sign_fleet_trip(uuid, text, text, text, text);

-- ← 20261101120100
CREATE OR REPLACE FUNCTION public.esign_sign_fleet_trip(
  p_trip_id  uuid,
  p_slot     text,
  p_pin      text,
  p_decision text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_trip      public.fleet_trips%ROWTYPE;
  v_exp       jsonb;
  v_signer    public.esign_signers%ROWTYPE;
  v_existing  public.esign_signatures%ROWTYPE;
  v_name      text;
  v_pos       text;
  v_decision  text;
  v_payload   jsonb;
  v_hash      text;
  v_sig_id    uuid;
  v_signed_at timestamptz;
  v_signed_as text;
  v_requester_pos text;
  v_required  int := 0;
  v_done      int := 0;
  v_s         text;
  v_waiting   text[] := '{}';
  v_open      public.esign_trip_returns%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.rpc_rate_limit_hit('esign_sign', 30, interval '5 minutes') THEN
    RAISE EXCEPTION 'ลงนามถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_trip.esign_slots IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_online');
  END IF;
  IF p_slot IS NULL OR NOT (p_slot = ANY (ARRAY['requester', 'dept_head', 'authority', 'sk1'])) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_slot');
  END IF;
  IF COALESCE(v_trip.esign_slots ->> p_slot, 'wet') <> 'online' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'slot_not_online');
  END IF;
  v_requester_pos := COALESCE(public.esign_expected_signer(v_trip, 'requester') ->> 'position', '');
  IF p_slot = 'sk1' AND NOT public.esign_is_mayor_position(v_requester_pos) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_applicable');
  END IF;
  IF v_trip.status IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'trip_closed');
  END IF;

  -- ผู้ลงนามต้องเป็นตัวบุคคลที่ช่องนั้นระบุ ไม่มีการลงนามแทน
  v_exp := public.esign_expected_signer(v_trip, p_slot);
  IF v_exp ->> 'user_id' IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_exp ->> 'reason', 'signatory_missing'));
  END IF;
  IF (v_exp ->> 'user_id')::uuid <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_your_slot');
  END IF;

  SELECT s.* INTO v_existing
  FROM public.esign_signatures s
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = p_slot
    AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
  ORDER BY s.signed_at DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.signer_id = v_uid THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'signature_id', v_existing.id, 'signed_at', v_existing.signed_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'already_signed');
  END IF;

  -- ส่งคืนค้างอยู่: ลงได้เฉพาะช่องผู้ขอ · ล็อกแถวทริปข้างบนกันการส่งคืนกับการลงนามชนกัน
  v_open := public.esign_trip_open_return(v_trip.id);
  IF v_open.id IS NOT NULL AND p_slot <> 'requester' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'returned_open');
  END IF;

  -- ลำดับ: ช่องก่อนหน้าที่เป็นออนไลน์ต้องลงนามก่อน
  IF p_slot IN ('dept_head', 'authority') AND COALESCE(v_trip.esign_slots ->> 'requester', 'wet') = 'online'
     AND NOT EXISTS (
       SELECT 1 FROM public.esign_signatures s
       WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = 'requester'
         AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
     ) THEN
    v_waiting := array_append(v_waiting, 'requester');
  END IF;
  IF p_slot = 'authority' AND COALESCE(v_trip.esign_slots ->> 'dept_head', 'wet') = 'online'
     AND NOT EXISTS (
       SELECT 1 FROM public.esign_signatures s
       WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = 'dept_head'
         AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
     ) THEN
    v_waiting := array_append(v_waiting, 'dept_head');
  END IF;
  IF array_length(v_waiting, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wait_previous', 'waiting', to_jsonb(v_waiting));
  END IF;

  IF p_slot = 'authority' THEN
    IF p_decision IS NOT NULL AND p_decision <> 'approve' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'bad_decision');
    END IF;
    v_decision := 'approve';
  ELSE
    v_decision := 'sign';
  END IF;

  -- รหัสลงนามของผู้ลงนาม
  SELECT * INTO v_signer FROM public.esign_signers WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_signer.pin_hash IS NULL OR v_signer.duty_ack_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pin_not_set');
  END IF;
  IF v_signer.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'suspended');
  END IF;
  IF v_signer.locked_until IS NOT NULL AND v_signer.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pin_locked', 'locked_until', v_signer.locked_until);
  END IF;
  IF p_pin IS NULL OR extensions.crypt(p_pin, v_signer.pin_hash) <> v_signer.pin_hash THEN
    UPDATE public.esign_signers
       SET failed_count = failed_count + 1,
           locked_until = CASE WHEN failed_count + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
           updated_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object('ok', false, 'code', 'bad_pin', 'remaining', GREATEST(0, 4 - v_signer.failed_count));
  END IF;
  UPDATE public.esign_signers SET failed_count = 0, locked_until = NULL, updated_at = now() WHERE user_id = v_uid;

  SELECT btrim(COALESCE(p.full_name, '')) INTO v_name FROM public.profiles p WHERE p.id = v_uid;
  IF COALESCE(v_name, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'profile_name_missing');
  END IF;
  v_pos := COALESCE(v_exp ->> 'position', '');
  v_signed_as := COALESCE(v_exp ->> 'signed_as', '');

  v_payload := public.esign_fleet_trip_payload(v_trip);
  v_hash := public.esign_content_hash(v_payload);

  INSERT INTO public.esign_signatures (
    municipality_id, doc_type, doc_id, slot, signer_id, signer_name, signer_position, signed_as, decision,
    registry_signatory_id, content_hash, content_snapshot, template_version
  ) VALUES (
    v_trip.municipality_id, 'fleet_trip_request', v_trip.id, p_slot, v_uid, v_name, v_pos, v_signed_as, v_decision,
    NULLIF(v_exp ->> 'registry_id', '')::uuid, v_hash, v_payload, v_payload ->> 'template'
  )
  RETURNING id, signed_at INTO v_sig_id, v_signed_at;

  PERFORM public.esign_audit(v_trip.municipality_id, 'esign_sign', 'fleet_trip', v_trip.id::text, p_slot,
    jsonb_build_object('slot', p_slot, 'decision', v_decision, 'content_hash', v_hash, 'signature_id', v_sig_id));

  -- ผู้ขอลงนามใหม่ = ส่งกลับให้ลงนามต่อ เริ่มสายใหม่ทันที
  IF v_open.id IS NOT NULL AND p_slot = 'requester' THEN
    INSERT INTO public.esign_trip_returns (municipality_id, doc_type, doc_id, kind, actor_id, actor_name, actor_position)
    VALUES (v_trip.municipality_id, 'fleet_trip_request', v_trip.id, 'resubmitted', v_uid, v_name, v_pos);
    PERFORM public.esign_audit(v_trip.municipality_id, 'esign_resubmit', 'fleet_trip', v_trip.id::text, p_slot,
      jsonb_build_object('return_id', v_open.id, 'by', 'sign'));
  END IF;

  -- ครบทุกช่องที่ต้องลงออนไลน์หรือยัง
  FOREACH v_s IN ARRAY ARRAY['requester', 'dept_head', 'authority', 'sk1'] LOOP
    IF COALESCE(v_trip.esign_slots ->> v_s, 'wet') = 'online'
       AND (v_s <> 'sk1' OR public.esign_is_mayor_position(v_requester_pos)) THEN
      v_required := v_required + 1;
      IF EXISTS (
        SELECT 1 FROM public.esign_signatures s
        WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = v_s
          AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
      ) THEN
        v_done := v_done + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'already', false, 'signature_id', v_sig_id, 'signed_at', v_signed_at,
    'complete', v_required > 0 AND v_done = v_required);
END;
$$;
REVOKE ALL ON FUNCTION public.esign_sign_fleet_trip(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_sign_fleet_trip(uuid, text, text, text) TO authenticated;

-- ← 20261023100100
CREATE OR REPLACE FUNCTION public.esign_sign_fleet_trip_stamped(
  p_trip_id    uuid,
  p_slot       text,
  p_pin        text,
  p_decision   text,
  p_image_id   uuid,
  p_png_base64 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_dec    record;
  v_png    bytea;
  v_w      integer;
  v_h      integer;
  v_sha    text;
  v_res    jsonb;
  v_sig    uuid;
  v_muni   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF p_image_id IS NOT NULL AND p_png_base64 IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_image');
  END IF;

  -- ตรวจภาพก่อนแตะรหัส: ภาพเสียต้องไม่นับเป็นรหัสผิด
  IF p_image_id IS NOT NULL THEN
    SELECT b.sha256, b.png, b.width, b.height INTO v_sha, v_png, v_w, v_h
    FROM public.esign_signature_images i
    JOIN public.esign_image_blobs b ON b.sha256 = i.sha256
    WHERE i.id = p_image_id AND i.user_id = v_uid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'image_not_found');
    END IF;
  ELSIF p_png_base64 IS NOT NULL THEN
    SELECT * INTO v_dec FROM public.esign_png_decode(p_png_base64);
    IF v_dec.r_code IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', v_dec.r_code);
    END IF;
    v_png := v_dec.r_png;
    v_w := v_dec.r_width;
    v_h := v_dec.r_height;
    v_sha := encode(sha256(v_png), 'hex');
  END IF;

  v_res := public.esign_sign_fleet_trip(p_trip_id, p_slot, p_pin, p_decision);

  IF v_sha IS NOT NULL
     AND COALESCE((v_res ->> 'ok')::boolean, false)
     AND NOT COALESCE((v_res ->> 'already')::boolean, false) THEN
    v_sig := (v_res ->> 'signature_id')::uuid;
    SELECT s.municipality_id INTO v_muni FROM public.esign_signatures s WHERE s.id = v_sig AND s.signer_id = v_uid;
    IF NOT FOUND THEN
      -- ไม่ควรเกิด: ลายเซ็นที่เพิ่งสร้างต้องเป็นของผู้เรียก — ถ้าเกิดให้ยกเลิกทั้งรายการดีกว่าแนบภาพผิดใบ
      RAISE EXCEPTION 'ESIGN_STAMP_MISMATCH';
    END IF;
    INSERT INTO public.esign_image_blobs (sha256, png, width, height)
    VALUES (v_sha, v_png, v_w, v_h)
    ON CONFLICT (sha256) DO NOTHING;
    INSERT INTO public.esign_signature_stamps (signature_id, municipality_id, sha256)
    VALUES (v_sig, v_muni, v_sha);
    v_res := v_res || jsonb_build_object('stamped', true);
  ELSE
    v_res := v_res || jsonb_build_object('stamped', false);
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text) TO authenticated;

-- ← 20261101120100
CREATE OR REPLACE FUNCTION public.esign_trip_may_need_me(p_trip public.fleet_trips, p_uid uuid, p_is_signatory boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_slot text;
  v_passed boolean;
BEGIN
  IF COALESCE(p_trip.requested_by, p_trip.created_by) = p_uid THEN
    IF (public.esign_trip_open_return(p_trip.id)).id IS NOT NULL THEN
      RETURN true;
    END IF;
    IF COALESCE(p_trip.esign_slots ->> 'requester', 'wet') = 'online' AND NOT public.esign_slot_signed(p_trip.id, 'requester') THEN
      RETURN true;
    END IF;
    IF COALESCE(p_trip.esign_slots ->> 'sk1', 'wet') = 'online' AND NOT public.esign_slot_signed(p_trip.id, 'sk1')
       AND public.esign_is_mayor_position(public.esign_expected_signer(p_trip, 'requester') ->> 'position') THEN
      RETURN true;
    END IF;
  END IF;
  IF p_is_signatory THEN
    -- v_passed = ช่องก่อนหน้าในสายผ่านแล้ว (เซ็นสด หรือลงนามแล้ว) — ลำดับเดียวกับ can_sign ใน esign_trip_status
    v_passed := COALESCE(p_trip.esign_slots ->> 'requester', 'wet') <> 'online' OR public.esign_slot_signed(p_trip.id, 'requester');
    FOREACH v_slot IN ARRAY ARRAY['dept_head', 'authority'] LOOP
      IF COALESCE(p_trip.esign_slots ->> v_slot, 'wet') = 'online' THEN
        IF NOT public.esign_slot_signed(p_trip.id, v_slot) THEN
          IF v_passed AND public.esign_expected_signer(p_trip, v_slot) ->> 'user_id' = p_uid::text THEN
            RETURN true;
          END IF;
          v_passed := false;
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.esign_trip_may_need_me(public.fleet_trips, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.esign_trip_status(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_trip      public.fleet_trips%ROWTYPE;
  v_order     text[] := ARRAY['requester', 'dept_head', 'authority', 'sk1'];
  v_slot      text;
  v_mode      text;
  v_applic    boolean;
  v_exp       jsonb;
  v_sig       public.esign_signatures%ROWTYPE;
  v_signed    boolean;
  v_signed_map jsonb := '{}'::jsonb;
  v_prereq_ok boolean;
  v_can       boolean;
  v_closed    boolean;
  v_slots     jsonb := '[]'::jsonb;
  v_hash      text;
  v_integrity text := 'none';
  v_required  int := 0;
  v_done      int := 0;
  v_involved  boolean := false;
  v_requester_pos text;
  v_exp_name  text;
  v_is_requester boolean := false;
  v_is_manager   boolean := false;
  v_locked       boolean := false;
  v_can_revoke   boolean;
  v_can_return   boolean;
  v_last_return  public.esign_trip_returns%ROWTYPE;
  v_open_return  boolean := false;
  v_returns      integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_closed := v_trip.status IN ('rejected', 'cancelled');
  v_requester_pos := COALESCE(public.esign_expected_signer(v_trip, 'requester') ->> 'position', '');
  v_hash := public.esign_content_hash(public.esign_fleet_trip_payload(v_trip));
  IF COALESCE(v_trip.requested_by, v_trip.created_by) = v_uid THEN
    v_involved := true;
    v_is_requester := true;
  END IF;
  v_is_manager := public.fleet_is_manager(v_trip.municipality_id);

  -- การส่งคืนล่าสุด (ค้างอยู่หรือจบไปแล้ว) ใบที่ปิดแล้วไม่นับว่าค้าง
  SELECT r.* INTO v_last_return
  FROM public.esign_trip_returns r
  WHERE r.doc_type = 'fleet_trip_request' AND r.doc_id = v_trip.id AND r.kind = 'returned'
  ORDER BY r.seq DESC
  LIMIT 1;
  IF FOUND THEN
    v_returns := public.esign_trip_return_round(v_trip.id);
    v_open_return := NOT v_closed AND (public.esign_trip_open_return(v_trip.id)).id IS NOT NULL;
  END IF;

  FOREACH v_slot IN ARRAY v_order LOOP
    v_mode := COALESCE(v_trip.esign_slots ->> v_slot, 'wet');
    v_applic := (v_slot <> 'sk1') OR public.esign_is_mayor_position(v_requester_pos);
    v_exp := public.esign_expected_signer(v_trip, v_slot);
    IF v_exp ->> 'user_id' = v_uid::text THEN
      v_involved := true;
    END IF;

    SELECT s.* INTO v_sig
    FROM public.esign_signatures s
    WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = v_slot
      AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
    ORDER BY s.signed_at DESC
    LIMIT 1;
    v_signed := FOUND;
    v_signed_map := v_signed_map || jsonb_build_object(v_slot, v_signed);
    IF v_signed THEN
      v_locked := true;
    END IF;

    IF v_mode = 'online' AND v_applic THEN
      v_required := v_required + 1;
      IF v_signed THEN v_done := v_done + 1; END IF;
    END IF;

    -- ลำดับ requester → dept_head → authority: ข้ามช่องที่ไม่ใช่ออนไลน์/ไม่เข้าเงื่อนไข
    v_prereq_ok := CASE v_slot
      WHEN 'dept_head' THEN (COALESCE(v_trip.esign_slots ->> 'requester', 'wet') <> 'online') OR (v_signed_map ->> 'requester')::boolean
      WHEN 'authority' THEN
        ((COALESCE(v_trip.esign_slots ->> 'requester', 'wet') <> 'online') OR (v_signed_map ->> 'requester')::boolean)
        AND ((COALESCE(v_trip.esign_slots ->> 'dept_head', 'wet') <> 'online') OR (v_signed_map ->> 'dept_head')::boolean)
      ELSE true
    END;
    -- ส่งคืนค้างอยู่: ลงได้เฉพาะช่องผู้ขอ คนอื่นรอผู้ขอแก้แล้วส่งกลับ (กันช่องผู้ขอเซ็นสดที่ลำดับไม่หยุดเอง)
    v_can := v_trip.esign_slots IS NOT NULL AND v_mode = 'online' AND v_applic AND NOT v_signed AND v_prereq_ok
             AND NOT v_closed AND v_exp ->> 'user_id' = v_uid::text
             AND NOT (v_open_return AND v_slot <> 'requester');

    -- ส่งคืนได้เมื่อถึงคิวตัวเอง · ผู้ขอที่ถือช่องนี้ด้วยไม่ต้องส่งคืนให้ตัวเอง ใช้ถอนลายเซ็นหรือยกเลิกคำขอแทน
    v_can_return := v_can AND v_slot IN ('dept_head', 'authority') AND NOT v_is_requester;

    -- ถอนได้: กติกาเดียวกับ esign_revoke_fleet_trip (ผู้ดูแลรถ · ผู้ขอตัวจริง · เจ้าของลายเซ็นช่องนั้น)
    v_can_revoke := v_signed AND (v_is_manager OR v_is_requester OR v_sig.signer_id = v_uid);

    v_exp_name := NULL;
    IF v_exp ->> 'user_id' IS NOT NULL THEN
      SELECT p.full_name INTO v_exp_name FROM public.profiles p WHERE p.id = (v_exp ->> 'user_id')::uuid;
    END IF;

    IF v_signed AND v_sig.content_hash <> v_hash THEN
      v_integrity := 'modified';
    ELSIF v_signed AND v_integrity = 'none' THEN
      v_integrity := 'ok';
    END IF;

    v_slots := v_slots || jsonb_build_array(jsonb_build_object(
      'slot', v_slot,
      'label', public.esign_slot_label(v_slot),
      'mode', v_mode,
      'applicable', v_applic,
      'signed', v_signed,
      'waiting_for_previous', (v_mode = 'online' AND v_applic AND NOT v_signed AND NOT v_prereq_ok),
      'waiting_for_return', (v_open_return AND v_mode = 'online' AND v_applic AND NOT v_signed AND v_slot <> 'requester'),
      'can_sign', v_can,
      'can_return', v_can_return,
      'can_revoke', v_can_revoke,
      'blocked', CASE WHEN v_mode = 'online' AND v_applic AND NOT v_signed THEN v_exp ->> 'reason' END,
      -- เฟส 2: ช่องที่เปิดออนไลน์แต่ตอนสร้างคำขอผู้ลงนามยังไม่พร้อม จึงเซ็นสด (เหตุผลตรึงไว้ตอนสร้าง)
      'fallback', v_trip.esign_fallback ->> v_slot,
      'expected_name', v_exp_name,
      'signature', CASE WHEN v_signed THEN jsonb_build_object(
        'signer_name', v_sig.signer_name,
        'signer_position', v_sig.signer_position,
        'signed_as', v_sig.signed_as,
        'decision', v_sig.decision,
        'signed_at', v_sig.signed_at,
        'content_matches', v_sig.content_hash = v_hash,
        'mine', v_sig.signer_id = v_uid,
        'with_image', EXISTS (SELECT 1 FROM public.esign_signature_stamps st WHERE st.signature_id = v_sig.id)
      ) END
    ));
  END LOOP;

  IF NOT (v_involved OR public.fleet_can_read(v_trip.municipality_id)) THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'mode', CASE WHEN v_trip.esign_slots IS NULL THEN 'wet' ELSE 'online' END,
    'verify_code', v_trip.esign_verify_code,
    'trip_status', v_trip.status,
    'slots', v_slots,
    'required', v_required,
    'signed_count', v_done,
    'complete', v_trip.esign_slots IS NOT NULL AND v_required > 0 AND v_done = v_required,
    'integrity', v_integrity,
    'locked', v_locked,
    'can_revoke_all', v_locked AND (v_is_manager OR v_is_requester),
    'returns_count', v_returns,
    'last_return', CASE WHEN v_last_return.id IS NOT NULL THEN jsonb_build_object(
      'slot', v_last_return.slot,
      'label', public.esign_slot_label(v_last_return.slot),
      'by_name', v_last_return.actor_name,
      'by_position', v_last_return.actor_position,
      'reason', v_last_return.reason,
      'at', v_last_return.created_at,
      'open', v_open_return
    ) END,
    'can_resubmit', v_open_return AND COALESCE(v_trip.esign_slots ->> 'requester', 'wet') <> 'online'
      AND (v_is_manager OR v_is_requester)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.esign_trip_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_trip_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.esign_trip_turns(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_trip       public.fleet_trips%ROWTYPE;
  v_order      text[] := ARRAY['requester', 'dept_head', 'authority', 'sk1'];
  v_slot       text;
  v_mode       text;
  v_applic     boolean;
  v_exp        jsonb;
  v_signed     boolean;
  v_signed_map jsonb := '{}'::jsonb;
  v_prereq_ok  boolean;
  v_requester_pos text;
  v_turns      jsonb := '[]'::jsonb;
  v_open       boolean;
  v_round      integer;
BEGIN
  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id;
  IF NOT FOUND OR v_trip.esign_slots IS NULL
     OR v_trip.status NOT IN ('pending', 'waitlisted', 'approved', 'in_progress', 'completed') THEN
    RETURN v_turns;
  END IF;

  v_open := (public.esign_trip_open_return(v_trip.id)).id IS NOT NULL;
  v_round := public.esign_trip_return_round(v_trip.id);

  v_requester_pos := COALESCE(public.esign_expected_signer(v_trip, 'requester') ->> 'position', '');

  FOREACH v_slot IN ARRAY v_order LOOP
    v_mode := COALESCE(v_trip.esign_slots ->> v_slot, 'wet');
    v_applic := (v_slot <> 'sk1') OR public.esign_is_mayor_position(v_requester_pos);

    SELECT EXISTS (
      SELECT 1 FROM public.esign_signatures s
       WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = v_slot
         AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
    ) INTO v_signed;
    v_signed_map := v_signed_map || jsonb_build_object(v_slot, v_signed);

    v_prereq_ok := CASE v_slot
      WHEN 'dept_head' THEN (COALESCE(v_trip.esign_slots ->> 'requester', 'wet') <> 'online') OR (v_signed_map ->> 'requester')::boolean
      WHEN 'authority' THEN
        ((COALESCE(v_trip.esign_slots ->> 'requester', 'wet') <> 'online') OR (v_signed_map ->> 'requester')::boolean)
        AND ((COALESCE(v_trip.esign_slots ->> 'dept_head', 'wet') <> 'online') OR (v_signed_map ->> 'dept_head')::boolean)
      ELSE true
    END;

    IF v_mode = 'online' AND v_applic AND NOT v_signed AND v_prereq_ok AND NOT (v_open AND v_slot <> 'requester') THEN
      v_exp := public.esign_expected_signer(v_trip, v_slot);
      IF v_exp ->> 'user_id' IS NOT NULL THEN
        v_turns := v_turns || jsonb_build_array(jsonb_build_object(
          'slot', v_slot,
          'label', public.esign_slot_label(v_slot),
          'user_id', v_exp ->> 'user_id',
          'round', v_round
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN v_turns;
END;
$$;
REVOKE ALL ON FUNCTION public.esign_trip_turns(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_trip_turns(uuid) TO service_role;

-- ← 20261123100100
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

-- ← 20261022100200
CREATE OR REPLACE FUNCTION public.esign_verify(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_trip      public.fleet_trips%ROWTYPE;
  v_muni_name text;
  v_slot      text;
  v_mode      text;
  v_applic    boolean;
  v_sig       public.esign_signatures%ROWTYPE;
  v_slots     jsonb := '[]'::jsonb;
  v_hash      text;
  v_modified  boolean := false;
  v_required  int := 0;
  v_done      int := 0;
  v_revoked   int;
  v_requester_pos text;
  v_state     text;
BEGIN
  IF NOT public.rpc_rate_limit_hit('esign_verify', 30, interval '5 minutes') THEN
    RAISE EXCEPTION 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  SELECT * INTO v_trip FROM public.fleet_trips WHERE esign_verify_code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT m.name INTO v_muni_name FROM public.municipalities m WHERE m.id = v_trip.municipality_id;
  v_requester_pos := COALESCE(public.esign_expected_signer(v_trip, 'requester') ->> 'position', '');
  v_hash := public.esign_content_hash(public.esign_fleet_trip_payload(v_trip));

  FOREACH v_slot IN ARRAY ARRAY['requester', 'dept_head', 'authority', 'sk1'] LOOP
    v_mode := COALESCE(v_trip.esign_slots ->> v_slot, 'wet');
    v_applic := (v_slot <> 'sk1') OR public.esign_is_mayor_position(v_requester_pos);
    CONTINUE WHEN v_mode <> 'online' OR NOT v_applic;
    v_required := v_required + 1;

    SELECT s.* INTO v_sig
    FROM public.esign_signatures s
    WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = v_slot
      AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
    ORDER BY s.signed_at DESC
    LIMIT 1;
    IF FOUND THEN
      v_done := v_done + 1;
      IF v_sig.content_hash <> v_hash THEN v_modified := true; END IF;
      v_slots := v_slots || jsonb_build_array(jsonb_build_object(
        'slot', v_slot, 'label', public.esign_slot_label(v_slot), 'signed', true,
        'signer_name', v_sig.signer_name, 'signer_position', v_sig.signer_position, 'signed_as', v_sig.signed_as,
        'decision', v_sig.decision, 'signed_at', v_sig.signed_at
      ));
    ELSE
      v_slots := v_slots || jsonb_build_array(jsonb_build_object(
        'slot', v_slot, 'label', public.esign_slot_label(v_slot), 'signed', false
      ));
    END IF;
  END LOOP;

  SELECT count(*)::int INTO v_revoked
  FROM public.esign_revocations r
  JOIN public.esign_signatures s ON s.id = r.signature_id
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id;

  v_state := CASE
    WHEN v_modified THEN 'modified'
    WHEN v_required > 0 AND v_done = v_required THEN 'complete'
    WHEN v_done > 0 THEN 'partial'
    ELSE 'unsigned'
  END;

  RETURN jsonb_build_object(
    'found', true,
    'municipality_name', v_muni_name,
    'doc_type', 'fleet_trip_request',
    'doc_label', 'ใบขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง (แบบ 3)',
    'document_date', COALESCE(v_trip.document_date, (timezone('Asia/Bangkok', v_trip.created_at))::date),
    'trip_status', CASE WHEN v_trip.status IN ('cancelled', 'rejected') THEN v_trip.status ELSE 'active' END,
    'state', v_state,
    'required', v_required,
    'signed_count', v_done,
    'revoked_count', v_revoked,
    'slots', v_slots
  );
END;
$$;
REVOKE ALL ON FUNCTION public.esign_verify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.esign_verify(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.fleet_trip_sk1_applies(public.fleet_trips);

NOTIFY pgrst, 'reload schema';
COMMIT;
-- แล้วลบแถว version: delete from supabase_migrations.schema_migrations where version = '20261124100000';
