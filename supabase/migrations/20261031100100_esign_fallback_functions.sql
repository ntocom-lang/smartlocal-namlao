-- 20261031100100_esign_fallback_functions.sql
--
-- ลงนามออนไลน์ เฟส 2 (เจ้าของระบบอนุมัติ 2569-10-31 "ลุยเฟส 2") — ต่อจาก 20261031100000 (คอลัมน์ esign_fallback)
--
-- ปัญหาเดิม:
--   (ก) เปิดลงนามออนไลน์ต้องกด "ยืนยันว่าผู้ลงนามทดลองใช้แล้ว" ก่อน แต่ระบบไม่เคยตรวจว่าทดลองจริง
--   (ข) ตอนสร้างคำขอใช้รถ ทุกช่องที่เปิดออนไลน์ถูกตรึงเป็นออนไลน์ โดยไม่ดูว่าผู้ลงนามพร้อมไหม
--       ผอ.กองที่ไม่มีบัญชี/ยังไม่ตั้งรหัส = ใบค้าง ไม่มีใครเซ็นได้
--   (ค) แอดมินไม่รู้ว่าใครพร้อม (esign_signers ไม่มี grant ให้อ่าน)
--
-- ที่เปลี่ยน:
--   1) esign_signer_unready_reason (ใหม่ ภายใน) — "พร้อม" = ตั้งรหัสลงนาม + รับทราบหน้าที่ + ไม่ถูกระงับ
--      ล็อกเพราะใส่รหัสผิด 15 นาทีนับว่าพร้อม (หายเอง) · กติกาเดียวกับที่ esign_sign_fleet_trip ตรวจตอนลงนาม
--   2) esign_fleet_trip_guard — ช่องที่ผู้ลงนามไม่พร้อมตกเป็นเซ็นสด + เก็บเหตุผลใน esign_fallback + audit
--      ไม่มีช่องออนไลน์เหลือ = ใบเซ็นสดทั้งใบ (esign_slots NULL เหมือนก่อนเปิดใช้)
--   3) set_esign_doc_type — ถอดด่านยืนยันทดลอง (ด่านผูกบัญชีผู้ลงนามยังอยู่)
--      esign_confirm_trial คงไว้ไม่แตะ ให้หน้าเว็บรุ่นก่อนที่ยังเปิดค้างเรียกได้ไม่ error
--   4) esign_trip_status — เพิ่ม fallback ต่อช่อง
--   5) esign_signer_readiness (ใหม่) — แอดมินของ อปท. นั้น/superadmin ดูความพร้อมรายคน (ไม่เห็นรหัส/เวลา/เหตุผลระงับ)
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (docs/ai/NOTES.md ข้อ 5): ข้อ 2–4 ดึงนิยามล่าสุดทั้งตัวมาแก้เฉพาะจุด
--    guard ← 20261025120000 · set_esign_doc_type ← 20261022110100 · esign_trip_status ← 20261023110000
-- ⚠️ ต้อง apply ก่อน merge หน้าเว็บ: หน้าตั้งค่ารุ่นใหม่ไม่มีปุ่มยืนยันทดลองแล้ว ถ้าฐานยังเป็นตัวเก่าจะเปิดใช้ไม่ได้
-- ผลต่อของที่ใช้งานอยู่: ทริปที่สร้างไปแล้วไม่เปลี่ยน · อปท. ที่ไม่ได้เปิดออนไลน์ไม่เปลี่ยน
--   อปท. ที่เปิดอยู่: คำขอใหม่ช่องที่ผู้ลงนามยังไม่พร้อมจะเป็นเซ็นสด (เดิมจะค้าง)
-- ทุกเส้นทางของ trigger มี RETURN

-- ── 1) ความพร้อมของผู้ลงนามหนึ่งคน (ภายใน ไม่ให้ client เรียก) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esign_signer_unready_reason(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_signer public.esign_signers%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'signatory_missing';
  END IF;
  SELECT * INTO v_signer FROM public.esign_signers WHERE user_id = p_user_id;
  IF NOT FOUND OR v_signer.pin_hash IS NULL OR v_signer.duty_ack_at IS NULL THEN
    RETURN 'pin_not_set';
  END IF;
  IF v_signer.suspended_at IS NOT NULL THEN
    RETURN 'suspended';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.esign_signer_unready_reason(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) trigger บน fleet_trips: ตรึงโหมดตอนสร้าง (ช่องที่ไม่พร้อมตกเป็นเซ็นสด) ─────────────────────────

CREATE OR REPLACE FUNCTION public.esign_fleet_trip_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_modes jsonb;
  v_final    jsonb := '{}'::jsonb;
  v_fallback jsonb := '{}'::jsonb;
  v_slot     text;
  v_mode     text;
  v_exp      jsonb;
  v_reason   text;
  v_online   boolean := false;
  v_sk1      boolean;
  v_total integer;
  v_revoked integer;
  v_ids   jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- client ส่งค่าเองมาก็ไม่รับ: ทริปเป็นโหมดออนไลน์ได้ทางเดียวคือ อปท. เปิดสวิตช์ไว้ตอนสร้าง
    NEW.esign_slots := NULL;
    NEW.esign_verify_code := NULL;
    NEW.esign_fallback := NULL;
    BEGIN
      -- บันทึกย้อนหลัง (completed) เป็นการจดหลังเหตุการณ์ ขออนุญาตไปแล้วบนกระดาษ ไม่เข้าระบบลงนามออนไลน์
      IF NEW.status IS DISTINCT FROM 'completed' THEN
        SELECT s.slot_modes INTO v_modes
        FROM public.esign_doc_type_settings s
        WHERE s.municipality_id = NEW.municipality_id AND s.doc_type = 'fleet_trip_request';
        IF v_modes IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_each_text(v_modes) e WHERE e.value = 'online'
        ) THEN
          -- เฟส 2: ช่องออนไลน์ที่ผู้ลงนามยังไม่พร้อม (ไม่มีในทะเบียน/ไม่ผูกบัญชี/ยังไม่ตั้งรหัส/ถูกระงับ) → เซ็นสด
          -- ไม่งั้นใบค้าง ไม่มีใครเซ็นได้ · ตรึงพร้อม esign_slots ตั้งรหัสทีหลังใบนี้ไม่เปลี่ยน (เจ้าของระบบเลือก)
          -- สก.๑ ที่ผู้ขอไม่ใช่นายก ไม่ใช้กับใบนี้อยู่แล้ว คงค่าเดิมไว้ ไม่นับเป็นช่องออนไลน์
          v_sk1 := public.esign_is_mayor_position(public.esign_expected_signer(NEW, 'requester') ->> 'position');
          FOR v_slot, v_mode IN SELECT e.key, e.value FROM jsonb_each_text(v_modes) e LOOP
            IF v_mode = 'online' AND (v_slot <> 'sk1' OR v_sk1) THEN
              v_exp := public.esign_expected_signer(NEW, v_slot);
              v_reason := COALESCE(v_exp ->> 'reason', public.esign_signer_unready_reason((v_exp ->> 'user_id')::uuid));
              IF v_reason IS NULL THEN
                v_online := true;
              ELSE
                v_mode := 'wet';
                v_fallback := v_fallback || jsonb_build_object(v_slot, v_reason);
              END IF;
            END IF;
            v_final := v_final || jsonb_build_object(v_slot, v_mode);
          END LOOP;
          IF v_online THEN
            NEW.esign_slots := v_final;
            NEW.esign_verify_code := replace(gen_random_uuid()::text, '-', '');
          END IF;
          IF v_fallback <> '{}'::jsonb THEN
            NEW.esign_fallback := v_fallback;
            -- ทุกการตัดสินของระบบต้องตรวจย้อนได้ (AGENTS.md) — ไม่ใส่ปลายทาง/วัตถุประสงค์
            PERFORM public.esign_audit(NEW.municipality_id, 'esign_slot_fallback', 'fleet_trip', NEW.id::text,
              'ผู้ลงนามยังไม่พร้อม ช่องนั้นเซ็นสด', jsonb_build_object('fallback', v_fallback, 'online', v_online));
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- ระบบลงนามเสียห้ามทำให้สร้างทริปไม่ได้ — ถือว่าเซ็นสดเหมือนก่อนมีระบบนี้
      RAISE WARNING 'esign stamp skipped (%): %', SQLSTATE, SQLERRM;
      NEW.esign_slots := NULL;
      NEW.esign_verify_code := NULL;
      NEW.esign_fallback := NULL;
    END;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.esign_slots := OLD.esign_slots;
    NEW.esign_verify_code := OLD.esign_verify_code;
    NEW.esign_fallback := OLD.esign_fallback;
    IF OLD.esign_slots IS NOT NULL
       AND public.esign_fleet_trip_payload(OLD) IS DISTINCT FROM public.esign_fleet_trip_payload(NEW)
       AND EXISTS (
         SELECT 1 FROM public.esign_signatures s
         WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = OLD.id
           AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
       ) THEN
      RAISE EXCEPTION 'ESIGN_TRIP_LOCKED: คำขอนี้มีลายเซ็นแล้ว แก้เนื้อหาไม่ได้ — ต้องถอนลายเซ็นก่อนแล้วเซ็นใหม่หลังแก้';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: ทริปที่เคยมีลายเซ็น (แม้ถอนแล้ว) — เฉพาะแอดมินของ อปท. นั้น/superadmin ลบได้ คนอื่นใช้ "ยกเลิก"
  SELECT count(*)::integer,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id))::integer,
         COALESCE(jsonb_agg(s.id ORDER BY s.signed_at), '[]'::jsonb)
    INTO v_total, v_revoked, v_ids
  FROM public.esign_signatures s
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = OLD.id;

  IF v_total > 0 THEN
    IF NOT public.esign_is_tenant_admin(OLD.municipality_id) THEN
      RAISE EXCEPTION 'ESIGN_TRIP_HAS_SIGNATURES: ทริปที่เคยมีลายเซ็นลบไม่ได้ ให้ยกเลิกแทน';
    END IF;
    -- ลายเซ็น/ภาพ/การถอนไม่ถูกลบ (ไม่มี FK ไปทริป + append-only) — บันทึกไว้ว่าใครลบและทิ้งหลักฐานอะไรไว้
    PERFORM public.esign_audit(OLD.municipality_id, 'esign_trip_deleted', 'fleet_trip', OLD.id::text,
      'ทริปที่มีลายเซ็นออนไลน์',
      jsonb_build_object('signatures', v_total, 'valid', v_total - v_revoked, 'revoked', v_revoked, 'signature_ids', v_ids));
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.esign_fleet_trip_guard() FROM PUBLIC, anon, authenticated;

-- ── 3) set_esign_doc_type: ถอดด่านยืนยันทดลอง ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_esign_doc_type(
  p_municipality_id uuid,
  p_doc_type        text,
  p_slot_modes      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_slots   text[] := ARRAY['requester', 'dept_head', 'authority', 'sk1'];
  v_key     text;
  v_val     text;
  v_modes   jsonb := '{}'::jsonb;
  v_any     boolean := false;
  v_old     jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_doc_type IS DISTINCT FROM 'fleet_trip_request' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unknown_doc_type');
  END IF;

  SELECT s.slot_modes INTO v_old
  FROM public.esign_doc_type_settings s
  WHERE s.municipality_id = p_municipality_id AND s.doc_type = p_doc_type;

  IF p_slot_modes IS NOT NULL THEN
    IF jsonb_typeof(p_slot_modes) <> 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_slot_modes');
    END IF;
    FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each_text(p_slot_modes) e LOOP
      IF NOT (v_key = ANY (v_slots)) OR v_val NOT IN ('online', 'wet') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_slot_modes');
      END IF;
    END LOOP;
    -- ครบทุกช่องเสมอ ช่องที่ไม่ระบุ = เซ็นสด
    FOREACH v_key IN ARRAY v_slots LOOP
      v_val := COALESCE(p_slot_modes ->> v_key, 'wet');
      v_modes := v_modes || jsonb_build_object(v_key, v_val);
      IF v_val = 'online' THEN v_any := true; END IF;
    END LOOP;
  END IF;

  IF NOT v_any THEN
    DELETE FROM public.esign_doc_type_settings
     WHERE municipality_id = p_municipality_id AND doc_type = p_doc_type;
    PERFORM public.esign_audit(p_municipality_id, 'esign_disable', 'esign_doc_type', p_doc_type, NULL,
      jsonb_build_object('previous', v_old));
    RETURN jsonb_build_object('ok', true, 'enabled', false);
  END IF;

  -- ประตู: G2 ผู้ลงนามของช่องที่เลือกออนไลน์ต้องผูกบัญชีจริงอย่างน้อยหนึ่งคน
  -- (G1 ประกาศ ถอดแล้ว 2026-10-22 · G4 ยืนยันทดลอง ถอดแล้ว 2026-10-31 เจ้าของระบบอนุมัติเฟส 2:
  --  ระบบไม่เคยตรวจว่าทดลองจริง และช่องที่ผู้ลงนามยังไม่พร้อมตกเป็นเซ็นสดเองตอนสร้างคำขอแล้ว)
  IF v_modes ->> 'authority' = 'online'
     AND public.esign_registry_linked_count(p_municipality_id, ARRAY['mayor', 'clerk', 'custom']) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_authority_unlinked');
  END IF;
  IF v_modes ->> 'dept_head' = 'online'
     AND public.esign_registry_linked_count(p_municipality_id, ARRAY['department_head']) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_dept_head_unlinked');
  END IF;

  INSERT INTO public.esign_doc_type_settings AS s (municipality_id, doc_type, slot_modes, enabled_by)
  VALUES (p_municipality_id, p_doc_type, v_modes, auth.uid())
  ON CONFLICT (municipality_id, doc_type) DO UPDATE
    SET slot_modes = EXCLUDED.slot_modes, enabled_by = EXCLUDED.enabled_by, updated_at = now();

  PERFORM public.esign_audit(p_municipality_id, 'esign_enable', 'esign_doc_type', p_doc_type, NULL,
    jsonb_build_object('previous', v_old, 'slot_modes', v_modes));
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'slot_modes', v_modes);
END;
$$;
REVOKE ALL ON FUNCTION public.set_esign_doc_type(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_esign_doc_type(uuid, text, jsonb) TO authenticated;

-- ── 4) esign_trip_status: ส่งเหตุผลที่ช่องตกเป็นเซ็นสดให้แผงลงนาม ─────────────────────────────
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
    'can_revoke_all', v_locked AND (v_is_manager OR v_is_requester)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.esign_trip_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_trip_status(uuid) TO authenticated;

-- ── 5) ความพร้อมรายคนสำหรับแอดมิน ─────────────────────────────────────────────────────────────
-- คืนเฉพาะคนในทะเบียนผู้ลงนาม (ผูกบัญชี ใช้อยู่วันนี้) + คนที่ขอดูเพิ่ม (เช่น คนในฟอร์มเจ้าหน้าที่) ที่สังกัด อปท. นี้
-- state: ready · pin_not_set · suspended — ไม่ส่งเวลา/เหตุผลระงับ/สถานะล็อก (แอดมินไม่จำเป็นต้องรู้)
-- ไม่มี DEFAULT: client ต้องส่งครบสองตัวเสมอ (บทเรียน B1)
CREATE OR REPLACE FUNCTION public.esign_signer_readiness(p_municipality_id uuid, p_profile_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today  date := (timezone('Asia/Bangkok', now()))::date;
  v_people jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF COALESCE(cardinality(p_profile_ids), 0) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many');
  END IF;

  WITH ids AS (
    SELECT s.profile_id AS id
    FROM public.document_signatories s
    WHERE s.municipality_id = p_municipality_id
      AND s.document_type = 'complaint'
      AND s.is_active
      AND s.profile_id IS NOT NULL
      AND s.effective_from <= v_today
      AND (s.effective_to IS NULL OR s.effective_to >= v_today)
    UNION
    SELECT unnest(COALESCE(p_profile_ids, ARRAY[]::uuid[]))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'profile_id', p.id,
           'state', COALESCE(public.esign_signer_unready_reason(p.id), 'ready')
         ) ORDER BY p.full_name NULLS LAST, p.id), '[]'::jsonb)
    INTO v_people
  FROM ids
  JOIN public.profiles p ON p.id = ids.id AND p.municipality_id = p_municipality_id;

  RETURN jsonb_build_object('ok', true, 'people', v_people);
END;
$$;
REVOKE ALL ON FUNCTION public.esign_signer_readiness(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_signer_readiness(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select position('esign_fallback' in pg_get_functiondef('public.esign_fleet_trip_guard'::regproc)) > 0;          → true
--   select position('gate_trial_missing' in pg_get_functiondef('public.set_esign_doc_type(uuid,text,jsonb)'::regprocedure)) = 0; → true
--   select position('esign_trip_deleted' in pg_get_functiondef('public.esign_fleet_trip_guard'::regproc)) > 0;      → true (ของ 20261025120000 ยังอยู่)
--   select has_function_privilege('anon', 'public.esign_signer_readiness(uuid,uuid[])', 'execute');                 → false
--   select has_function_privilege('authenticated', 'public.esign_signer_unready_reason(uuid)', 'execute');          → false
--   select count(*) from pg_trigger where tgname = 'trg_fleet_trips_esign_guard' and not tgisinternal;               → 1
