-- 20261124100000_fleet_permit_sk1_registry.sql
--
-- โหมดขั้นตอนขอใช้รถ (P4) — หน้าลงนาม/ฟอร์มใช้เกณฑ์ "นายกตัวจริงตามทะเบียน" เดียวกับฐาน + ผูกเหตุผล ว.๕ กับสิ่งที่ผู้ลงนามเห็น
-- ต่อจาก P3 (20261123100100_fleet_position_car_functions.sql รันบนฐานจริงแล้ว 2026-11-12)
--
-- ปัญหาเดิม:
--   (ก) P3 ให้ fleet_trip_permit_state นับ สก.๑ เฉพาะ "ตำแหน่งขึ้นต้นนายก และบัญชี = นายกในทะเบียนผู้ลงนาม"
--       แต่ฝั่งลงนาม (esign_trip_status / esign_sign_fleet_trip / esign_trip_turns / esign_trip_may_need_me) ยังดูแค่ข้อความตำแหน่ง
--       ⇒ คนที่พิมพ์ตำแหน่ง "นายก…" เห็นปุ่ม สก.๑ ลงได้ แต่ลายเซ็นไม่นับ ใบค้าง "รออนุญาต" โดยไม่รู้สาเหตุ
--   (ข) เหตุผลความจำเป็น ว.๕ ไม่อยู่ใน payload ของลายเซ็น — ผู้อนุญาตเปิดหน้าลงนามค้างตอนเหตุผลว่าง/ชุดเก่า
--       ผู้ขอแก้ระหว่างนั้น ลายเซ็นยังนับ ทั้งที่ผู้อนุญาตไม่เคยเห็นเหตุผลชุดที่ล็อก
--
-- กติกาที่ไฟล์นี้รักษา:
--   (1) ใบ permit_mode='queue' (น้ำเลาและใบเก่าทุกใบ) ผลเหมือนเดิมทุกจุด — fleet_trip_sk1_applies ใช้เกณฑ์ข้อความเดิมตรงตัว
--   (2) ใบ regulation: ช่อง สก.๑ ใช้ได้เมื่อผู้ขอเป็นนายกในทะเบียน ณ วันนี้ หรือมีลายเซ็น สก.๑ ที่ยังไม่ถอนอยู่แล้ว
--       (ทะเบียนเปลี่ยนทีหลัง ลายเซ็นเดิมยังแสดง — การนับว่าอนุญาตแล้วหรือไม่ยังเป็นของ fleet_trip_permit_state ที่ดูทะเบียน ณ วันลงนาม)
--   (3) ไม่แก้ esign_fleet_trip_payload (hash ลายเซ็นเก่าทุกใบจะไม่ตรง) — เหตุผลเทียบด้วยพารามิเตอร์ p_reason_hash แทน
--   (4) ไม่เพิ่มขั้นตอนให้เจ้าหน้าที่: ไม่มีช่อง/ปุ่มใหม่ หน้าลงนามคำนวณ hash จากข้อความที่แสดงอยู่เอง
--   (5) เขียนทับ 7 ฟังก์ชันทั้งตัว (NOTES ข้อ 5) ด่านด้านล่างเทียบ md5 กับรุ่นตั้งต้นก่อน ไม่ตรง = หยุด
--       ตั้งต้นจาก: esign_trip_may_need_me/esign_trip_status/esign_sign_fleet_trip/esign_trip_turns ← 20261101120100
--       esign_sign_fleet_trip_stamped ← 20261023100100 · fleet_position_car_check ← 20261123100100 · esign_verify ← 20261022100200
--   (6) ทั้งไฟล์อยู่ใน transaction เดียว (DROP+CREATE ของฟังก์ชันลงนามต้องไม่ค้างครึ่งทาง)

BEGIN;

DO $guard$
DECLARE
  v_missing text;
  v_drift   text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'public.fleet_permit_requester_is_mayor(public.fleet_trips)',
    'public.fleet_permit_requester_is_registered_mayor(public.fleet_trips)',
    'public.fleet_trip_position_car(public.fleet_trips)', 'public.fleet_position_car_core(uuid,uuid,uuid)',
    'public.fleet_permit_registry(uuid,text,uuid,text,date)', 'public.fleet_permit_today()',
    'public.esign_is_mayor_position(text)', 'public.esign_expected_signer(public.fleet_trips,text)'
  ]) x
  WHERE to_regprocedure(x) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชันที่ต้องใช้: % — ต้องรัน P3 (20261123100100) ก่อน', v_missing;
  END IF;

  -- เทียบเนื้อหลังยุบช่องว่าง (CRLF/LF ให้ผลเท่ากัน) · รับรุ่นที่ไฟล์นี้ลงไปแล้วด้วย (h_after) ⇒ รันซ้ำได้
  -- ฟังก์ชันลงนามสองตัวเปลี่ยนรายการพารามิเตอร์ ⇒ รุ่นก่อน/หลังใช้ลายมือชื่อคนละแบบ อย่างใดอย่างหนึ่งต้องมีและตรง
  -- ⚠️ แก้เนื้อฟังก์ชันส่วน 2–8 ของไฟล์นี้เมื่อไร ต้องคำนวณ h_after ใหม่ (เทสต์ DB รันไฟล์นี้ 2 รอบ จะล้มเตือนเอง)
  SELECT string_agg(e.grp, ', ') INTO v_drift
  FROM (VALUES
    ('esign_trip_may_need_me', 'public.esign_trip_may_need_me(public.fleet_trips,uuid,boolean)', '6125470b43d9f7ccccca4967fc2769c0',
       'public.esign_trip_may_need_me(public.fleet_trips,uuid,boolean)', '920bbab44ee58b4e7c327209063b346a'),
    ('esign_trip_status', 'public.esign_trip_status(uuid)', 'a44dfe69cf200a3a2946499432b859f9',
       'public.esign_trip_status(uuid)', '9a44024cb5f2c78cee7840e619a11e32'),
    ('esign_sign_fleet_trip', 'public.esign_sign_fleet_trip(uuid,text,text,text)', 'c270074b8a0fddeaf35fa8ad8fc4c711',
       'public.esign_sign_fleet_trip(uuid,text,text,text,text)', '31b8102ae191822b3f4732c463130d0a'),
    ('esign_sign_fleet_trip_stamped', 'public.esign_sign_fleet_trip_stamped(uuid,text,text,text,uuid,text)', 'e64529319c43100db195ce9491d1c536',
       'public.esign_sign_fleet_trip_stamped(uuid,text,text,text,uuid,text,text)', 'afdf3e13d8a23f4b28f9ef576275a0e1'),
    ('esign_trip_turns', 'public.esign_trip_turns(uuid)', 'e3c24b11985c5c8be412a9d0cb89a347',
       'public.esign_trip_turns(uuid)', '57f8655af0dd0ae5f198c0d445551d54'),
    ('fleet_position_car_check', 'public.fleet_position_car_check(uuid,uuid,uuid)', 'e8f17868a90ef44c70262d2d1896e687',
       'public.fleet_position_car_check(uuid,uuid,uuid)', 'e7d352fa399a11c5f2b58a2de28409f4'),
    ('esign_verify', 'public.esign_verify(text)', 'ebb3512d6834ba13bbbb9aecd2b5b6aa',
       'public.esign_verify(text)', '3999f89abe76ef5d708c470d277505c6')
  ) AS e(grp, sig_before, h_before, sig_after, h_after)
  WHERE NOT EXISTS (
          SELECT 1 FROM pg_proc p
          WHERE p.oid = to_regprocedure(e.sig_before)
            AND md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = e.h_before)
    AND NOT EXISTS (
          SELECT 1 FROM pg_proc p
          WHERE p.oid = to_regprocedure(e.sig_after)
            AND md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = e.h_after);
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'ฟังก์ชันบนฐานไม่ใช่รุ่นที่ไฟล์นี้ตั้งต้น: % — หยุดหาสาเหตุก่อน ห้ามเขียนทับ (NOTES ข้อ 5)', v_drift;
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- ── 1) ช่อง สก.๑ ใช้กับใบนี้ไหม (ใหม่) ─────────────────────────────────────────────────────────────
-- queue: เกณฑ์ข้อความตำแหน่งเดิมตรงตัว (COALESCE '' เหมือน v_requester_pos ของรุ่นเดิม — esign_is_mayor_position(NULL/'') = false)
-- regulation: ตำแหน่งขึ้นต้นนายก AND (นายกในทะเบียน ณ วันนี้ OR มีลายเซ็น สก.๑ ที่ยังไม่ถอน)
--   ไม่ผูกทะเบียน (นายกชื่อพิมพ์เอง/พิมพ์ตำแหน่งปลอม) ⇒ ไม่มีช่อง สก.๑ ให้ลง ต้องไปช่องผู้มีอำนาจ/ใบกระดาษ (คู่มือ 11.7 ข้อ 6.3)
CREATE OR REPLACE FUNCTION public.fleet_trip_sk1_applies(p_trip public.fleet_trips)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_trip.permit_mode IS DISTINCT FROM 'regulation' THEN
      public.esign_is_mayor_position(COALESCE(public.esign_expected_signer(p_trip, 'requester') ->> 'position', ''))
    ELSE COALESCE(
      public.fleet_permit_requester_is_mayor(p_trip)
      AND (
        public.fleet_permit_requester_is_registered_mayor(p_trip)
        OR EXISTS (
          SELECT 1 FROM public.esign_signatures s
          WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = p_trip.id AND s.slot = 'sk1'
            AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
        )
      ), false)
  END
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_sk1_applies(public.fleet_trips) FROM PUBLIC, anon, authenticated;

-- ── 2) esign_trip_may_need_me ← 20261101120100 ต่างแค่เงื่อนไขช่อง สก.๑ ────────────────────────────
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
       AND public.fleet_trip_sk1_applies(p_trip) THEN
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

-- ── 3) esign_trip_status ← 20261101120100 ต่างแค่ v_applic ของช่อง สก.๑ ─────────────────────────────
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
    v_applic := (v_slot <> 'sk1') OR public.fleet_trip_sk1_applies(v_trip);
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

-- ── 4) esign_sign_fleet_trip ← 20261101120100 + p_reason_hash ──────────────────────────────────────
-- เปลี่ยนรายการพารามิเตอร์ ⇒ ต้อง DROP ก่อน (CREATE OR REPLACE ตัวใหม่จะกลายเป็น overload คู่ ชื่อเดียวกันเรียกกำกวม)
-- ไม่มี view/trigger อ้างฟังก์ชันนี้ · ตัวห่อ _stamped (ส่วน 5) เรียกด้วยตำแหน่ง ⇒ ผูกใหม่ตอนรันเอง ทั้งไฟล์อยู่ใน transaction เดียว
-- ที่ต่างจากรุ่นตั้งต้น: (ก) ช่อง สก.๑ ใช้ fleet_trip_sk1_applies 2 จุด (ข) ด่านเหตุผล ว.๕ ก่อนตรวจรหัส
DROP FUNCTION IF EXISTS public.esign_sign_fleet_trip(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.esign_sign_fleet_trip(
  p_trip_id     uuid,
  p_slot        text,
  p_pin         text,
  p_decision    text DEFAULT NULL,
  p_reason_hash text DEFAULT NULL
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
  v_reason    text;
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
  IF p_slot = 'sk1' AND NOT public.fleet_trip_sk1_applies(v_trip) THEN
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

  -- เหตุผลความจำเป็น ว.๕ (P4) — ตรวจก่อนรหัส: ไม่ผ่านต้องไม่นับเป็นรหัสผิด
  -- เหตุผลไม่อยู่ใน payload ของลายเซ็น (กติกา (5) ของ P3) ⇒ หน้าลงนามส่ง SHA-256 ของข้อความที่ผู้ลงนามเห็นมาเทียบ
  -- กันกรณีเปิดหน้าลงนามค้างไว้ แล้วผู้ขอกรอก/แก้เหตุผลระหว่างนั้น (trigger ล็อกเหตุผลจับไม่ได้เพราะยังไม่มีลายเซ็น)
  -- เทียบกับค่าดิบในคอลัมน์ (trigger ตัดช่องว่างหัวท้ายให้แล้ว) NULL = ข้อความว่าง
  -- ตรวจเฉพาะใบ ว.๕ (regulation + ผู้ขอมีรถประจำตำแหน่ง) — ใบอื่น (รวมใบ queue ทุกใบ) ไม่ดู p_reason_hash เลย ผลเหมือนเดิมทุกกรณี
  -- ช่องที่ล็อกเหตุผล (ผอ./ผู้มีอำนาจ/สก.๑): ไม่มีเหตุผล = ไม่ให้ลง (ลงได้ = เหตุผลถูกล็อกเป็นค่าว่าง ใบค้างจนต้องถอนลายเซ็น)
  -- ไม่ส่ง hash / ส่งค่าว่าง = เปิดหน้าลงนามตอนเหตุผลยังว่าง หรือหน้าเว็บรุ่นเก่า ⇒ ให้รีเฟรช (ล้มแบบปิด)
  -- ช่องผู้ขอไม่ตรวจ (ผู้ขอเป็นผู้เขียนเหตุผลเอง) · แถวทริปล็อก FOR UPDATE ข้างบนแล้ว เหตุผลเปลี่ยนระหว่างตรวจกับ INSERT ไม่ได้
  v_reason := COALESCE(v_trip.position_car_reason, '');
  IF p_slot <> 'requester' AND v_trip.permit_mode = 'regulation'
     AND public.fleet_trip_position_car(v_trip) IS NOT NULL THEN
    IF NULLIF(btrim(v_reason), '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'reason_required');
    END IF;
    IF NULLIF(lower(btrim(COALESCE(p_reason_hash, ''))), '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'reload_required');
    END IF;
    IF lower(btrim(p_reason_hash)) <> encode(sha256(convert_to(v_reason, 'UTF8')), 'hex') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'reason_changed');
    END IF;
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
       AND (v_s <> 'sk1' OR public.fleet_trip_sk1_applies(v_trip)) THEN
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
REVOKE ALL ON FUNCTION public.esign_sign_fleet_trip(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_sign_fleet_trip(uuid, text, text, text, text) TO authenticated;

-- ── 5) esign_sign_fleet_trip_stamped ← 20261023100100 + p_reason_hash (ส่งต่อให้ตัวใน) ─────────────────────
-- หน้าเว็บเรียกตัวนี้ตัวเดียว · DEFAULT NULL ⇒ หน้าเว็บรุ่นเก่าที่ส่ง 6 พารามิเตอร์ยังเรียกได้ (ได้ reload_required เฉพาะใบ ว.๕)
DROP FUNCTION IF EXISTS public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.esign_sign_fleet_trip_stamped(
  p_trip_id     uuid,
  p_slot        text,
  p_pin         text,
  p_decision    text,
  p_image_id    uuid,
  p_png_base64  text,
  p_reason_hash text DEFAULT NULL
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

  v_res := public.esign_sign_fleet_trip(p_trip_id, p_slot, p_pin, p_decision, p_reason_hash);

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
REVOKE ALL ON FUNCTION public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text, text) TO authenticated;

-- ── 6) esign_trip_turns ← 20261101120100 ต่างแค่ v_applic ของช่อง สก.๑ (Telegram แจ้งคนถัดไปตามเกณฑ์เดียวกัน) ─
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
    v_applic := (v_slot <> 'sk1') OR public.fleet_trip_sk1_applies(v_trip);

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

-- ── 7) fleet_position_car_check ← 20261123100100 + requester_registered_mayor ─────────────────────────
-- ฟอร์มขอใช้รถใช้ตัดสินว่าผู้ขอเป็น "นายกตัวจริง" (ทาง สก.๑ ไม่ล็อกผู้มีอำนาจ) ด้วยเกณฑ์เดียวกับ fleet_permit_requester_is_registered_mayor
-- ฝั่งทะเบียน — ส่วนข้อความตำแหน่งฟอร์มเทียบเองจากช่องในฟอร์ม (ยังไม่บันทึก) · คืนแค่ true/false ไม่คืนชื่อบุคคล
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
    'position_car', public.fleet_position_car_core(p_municipality_id, COALESCE(p_requested_by, auth.uid()), p_vehicle_id),
    'requester_registered_mayor', COALESCE(
      (public.fleet_permit_registry(p_municipality_id, 'mayor', NULL, NULL, public.fleet_permit_today())).profile_id
        = COALESCE(p_requested_by, auth.uid()),
      false)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_position_car_check(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_position_car_check(uuid, uuid, uuid) TO authenticated;

-- ── 8) esign_verify (หน้าตรวจ QR สาธารณะ) ← 20261022100200 ต่างแค่ v_applic ของช่อง สก.๑ ─────────────────
-- ไม่แก้ = ใบ regulation ที่ผู้ขอพิมพ์ตำแหน่งนายกเอง ในแอปขึ้น "ลงนามครบ" แต่หน้า QR ขึ้น partial ตลอดไป (migration-reviewer P4 ข้อ 2)
-- เรียกได้ทั้ง anon/authenticated เหมือนเดิม · helper ถูกเรียกในฐานะเจ้าของฟังก์ชัน (SECURITY DEFINER) ไม่ต้องเปิดสิทธิ์ helper
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
    v_applic := (v_slot <> 'sk1') OR public.fleet_trip_sk1_applies(v_trip);
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

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select to_regprocedure('public.esign_sign_fleet_trip(uuid,text,text,text)');                         → NULL (รุ่นเก่าถูกถอน)
--   select to_regprocedure('public.esign_sign_fleet_trip_stamped(uuid,text,text,text,uuid,text)');       → NULL
--   select has_function_privilege('authenticated', 'public.esign_sign_fleet_trip_stamped(uuid,text,text,text,uuid,text,text)', 'execute'); → true
--   select has_function_privilege('anon', 'public.esign_sign_fleet_trip_stamped(uuid,text,text,text,uuid,text,text)', 'execute');          → false
--   select has_function_privilege('authenticated', 'public.fleet_trip_sk1_applies(public.fleet_trips)', 'execute');                       → false

NOTIFY pgrst, 'reload schema';

COMMIT;
