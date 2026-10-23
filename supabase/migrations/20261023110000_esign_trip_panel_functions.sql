-- ลงนามออนไลน์ ชุด S3a — ข้อมูลที่แผงลงนามในหน้ารายละเอียดทริปต้องใช้ (ไม่มี DDL: แก้ฟังก์ชัน 1 ตัว เพิ่มฟังก์ชัน 1 ตัว)
--
-- 1) esign_trip_status: เพิ่มฟิลด์ (ของเดิมไม่เปลี่ยนชื่อ/ความหมาย — ใช้ร่วมกับ esign_trip_stamps)
--      slots[].can_revoke        ผู้เรียกถอนลายเซ็นของช่องนี้ได้ (ผู้ดูแลรถ · ผู้ขอตัวจริง · เจ้าของลายเซ็นช่องนั้น — กติกาเดียวกับ esign_revoke_fleet_trip)
--      slots[].signature.mine    ลายเซ็นของช่องนี้เป็นของผู้เรียก
--      slots[].signature.with_image  ลงนามพร้อมภาพลายเซ็น (ไม่ส่งตัวภาพ — ภาพอ่านผ่าน esign_trip_stamps)
--      locked                    ทริปมีลายเซ็นที่ยังไม่ถูกถอน = แก้เนื้อหาคำขอไม่ได้ (trigger esign_fleet_trip_guard)
--      can_revoke_all            ผู้เรียกถอนทั้งหมดเพื่อแก้คำขอได้ (ผู้ดูแลรถ/ผู้ขอตัวจริง) และมีลายเซ็นให้ถอน
--    ต้นฉบับ = ..20261022100200_esign_functions.sql ข้อ 8 (เทียบกับ pg_get_functiondef บน production แล้ว ตรงกันทุกตัวอักษร 2026-10-23)
-- 2) esign_my_pending: ใบที่ "ถึงคิวฉันลงนาม" — ให้แถบ "รอลงนามของฉัน" (ชุด S3b) ใช้ โดยผู้ลงนามไม่ต้องไล่เปิดทริปเอง
--    ใช้ esign_trip_status เป็นตัวตัดสิน can_sign (แหล่งความจริงเดียว) จึงไม่มีทางขัดกับปุ่มลงนามในหน้าทริป
--    คืนเฉพาะสรุปที่ผู้ลงนามต้องเห็นก่อนลงนาม (ปลายทาง วัตถุประสงค์ วันเดินทาง ผู้ขอ รถ) ไม่คืนรายชื่อผู้โดยสาร
--
-- ทุกเส้นทางมี RETURN · ฟังก์ชันผู้ใช้เรียก: authenticated เท่านั้น (anon ถอนสิทธิ์)

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
    v_can := v_trip.esign_slots IS NOT NULL AND v_mode = 'online' AND v_applic AND NOT v_signed AND v_prereq_ok
             AND NOT v_closed AND v_exp ->> 'user_id' = v_uid::text;

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
      'can_sign', v_can,
      'can_revoke', v_can_revoke,
      'blocked', CASE WHEN v_mode = 'online' AND v_applic AND NOT v_signed THEN v_exp ->> 'reason' END,
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
    'can_revoke_all', v_locked AND (v_is_manager OR v_is_requester)
  );
END;
$$;

-- ใบที่ถึงคิวผู้เรียกลงนาม (ทุกช่องที่เป็นของผู้เรียกและลงได้ ณ ตอนนี้)
-- เฉพาะทริปของ อปท. ตัวเองที่เปิดโหมดออนไลน์และยังไม่ถูกปฏิเสธ/ยกเลิก/เสร็จสิ้น (ใบที่ปิดไปแล้วไม่เข้ากล่อง "ต้องทำ")
-- ใบละช่อง: คนเดียวถือหลายช่องในทริปเดียวได้ จึงได้หลายแถว · เรียงตามวันเดินทางที่ใกล้ที่สุดก่อน · ไม่เกิน 100 ใบ
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
  v_trip   record;
  v_status jsonb;
  v_slot   jsonb;
  v_items  jsonb := '[]'::jsonb;
  v_name   text;
  v_vehicle text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = v_uid;
  IF v_muni IS NULL THEN
    -- ไม่มีสังกัด (เช่น superadmin) ไม่มีใบที่ถึงคิว — ตอบว่างเปล่า ไม่ใช่ error
    RETURN jsonb_build_object('ok', true, 'count', 0, 'items', '[]'::jsonb);
  END IF;

  FOR v_trip IN
    SELECT t.id, t.status, t.destination, t.purpose, t.planned_departure, t.vehicle_id,
           COALESCE(t.requested_by, t.created_by) AS requester_id
    FROM public.fleet_trips t
    WHERE t.municipality_id = v_muni
      AND t.esign_slots IS NOT NULL
      AND t.status IN ('pending', 'waitlisted', 'approved', 'in_progress')
    ORDER BY t.planned_departure NULLS LAST, t.created_at
    LIMIT 100
  LOOP
    v_status := public.esign_trip_status(v_trip.id);
    CONTINUE WHEN NOT COALESCE((v_status ->> 'found')::boolean, false);
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
          'trip_status', v_trip.status,
          'requester_name', NULLIF(v_name, ''),
          'vehicle_name', v_vehicle,
          'destination', v_trip.destination,
          'purpose', v_trip.purpose,
          'planned_departure', v_trip.planned_departure
        ));
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', jsonb_array_length(v_items), 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.esign_trip_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_trip_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_pending() TO authenticated;
