-- 20261101120100_esign_trip_return_functions.sql
--
-- ปุ่ม "ส่งคืนผู้ขอ" + คงใบที่รถกลับแล้วไว้ในรายการรอลงนาม (เจ้าของระบบอนุมัติ 2569-11-01 "ลุย") — ต่อจาก 20261101120000
--
-- ปัญหาเดิม:
--   (ก) ผู้ลงนามที่ไม่เห็นด้วยทำได้แค่ไม่ลงนาม ผู้ขอไม่รู้ว่าใบค้างเพราะยังไม่ได้ดูหรือเพราะไม่เห็นด้วย
--   (ข) เจ้าของระบบตัดสินแล้วว่าออกรถก่อนเซ็นได้ แต่รถกลับแล้ว (completed) ใบหายจาก "รอลงนามของฉัน"
--       นายก/ปลัดที่ไม่มีสิทธิ์ยานพาหนะเต็มเปิดใบเองไม่ได้ (RLS fleet_trips) จึงตามลงนามทีหลังไม่ได้
--
-- ที่เปลี่ยน:
--   1) RLS + กันแก้ esign_trip_returns · ตัวช่วยภายใน esign_trip_open_return / esign_trip_return_round / esign_slot_signed / esign_trip_may_need_me
--   2) esign_return_fleet_trip (ใหม่) ผู้ลงนามที่ถึงคิว ส่งคืนพร้อมเหตุผล ไม่ใช้รหัสลงนาม เพราะไม่ใช่การลงลายมือชื่อ
--      ลายเซ็นในใบถูกถอนทั้งหมด (หลักฐานยังอยู่) ไม่แตะ fleet_trips.status และคิวรถ ใบที่ถูกส่งคืนยังออกรถได้
--   3) esign_resubmit_fleet_trip (ใหม่) ผู้ขอ/ผู้ดูแลรถกดส่งให้ลงนามต่อ ใช้เมื่อช่องผู้ขอเซ็นสด (ช่องออนไลน์ต้องลงนามใหม่)
--   4) esign_trip_status — ส่งคืนค้างอยู่ลงได้เฉพาะช่องผู้ขอ + can_return / waiting_for_return / last_return / returns_count / can_resubmit
--   5) esign_sign_fleet_trip — ตรวจด่านเดียวกันฝั่งลงนาม · ผู้ขอลงนามใหม่นับเป็นการส่งกลับ
--   6) esign_trip_turns — ด่านเดียวกัน + รวมใบ completed + ส่งเลขรอบ ให้ Telegram แจ้งรอบใหม่ได้
--   7) esign_my_pending — รวมใบ completed จนกว่าจะลงครบ · คัดใบที่เกี่ยวกับผู้เรียกก่อนนับเพดาน ใบเก่าไม่ดันใบใหม่ตก + รายการ returned
--   8) my_notification_feed — กระดิ่งแจ้งรอบใหม่หลังส่งคืน + ใบที่ถูกส่งคืนถึงผู้ขอ
--   9) esign_trip_return_dm (ใหม่) ให้ notify-telegram หาผู้ขอของใบที่ถูกส่งคืน ไม่คืนเหตุผล
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (docs/ai/NOTES.md ข้อ 5): ข้อ 4–8 ดึงนิยามล่าสุดทั้งตัวมาแก้เฉพาะจุด
--    esign_trip_status ← 20261031100100 · esign_sign_fleet_trip ← 20261022100200 · esign_trip_turns ← 20261030100100
--    esign_my_pending ← 20261023110000 · my_notification_feed ← 20261029110000
--    เทียบเนื้อฟังก์ชันกับฐานจริงแล้ว 2569-11-01 ตรงกันครบทั้ง 5 ตัว
-- ⚠️ เหตุผลส่งคืนเห็นได้เฉพาะคนที่ esign_trip_status ยอมให้เห็นใบนั้น ไม่ส่งออก Telegram/กระดิ่ง/หน้าตรวจสอบสาธารณะ
-- ผลต่อของที่ใช้งานอยู่: อปท. ที่เซ็นสดไม่กระทบ · อปท. ที่เปิดออนไลน์: ใบที่รถกลับแล้วแต่ลงไม่ครบกลับมาอยู่ในรายการรอลงนาม
-- ทุกเส้นทางของฟังก์ชันมี RETURN

DO $guard$
BEGIN
  IF to_regclass('public.esign_trip_returns') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261101120000_esign_trip_returns_table.sql ก่อน';
  END IF;
END;
$guard$;

-- ── 1) สิทธิ์และตัวช่วยภายใน ───────────────────────────────────────────────────────────
-- ไม่เปิดให้อ่านตรง: อ่านผ่าน esign_trip_status ที่ตรวจสิทธิ์ดูใบนั้นแล้วเท่านั้น
ALTER TABLE public.esign_trip_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.esign_trip_returns FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_esign_trip_returns_append_only ON public.esign_trip_returns;
CREATE TRIGGER trg_esign_trip_returns_append_only
BEFORE UPDATE OR DELETE ON public.esign_trip_returns
FOR EACH ROW EXECUTE FUNCTION public.esign_block_mutation();
DROP TRIGGER IF EXISTS trg_esign_trip_returns_no_truncate ON public.esign_trip_returns;
CREATE TRIGGER trg_esign_trip_returns_no_truncate
BEFORE TRUNCATE ON public.esign_trip_returns
FOR EACH STATEMENT EXECUTE FUNCTION public.esign_block_mutation();

-- แถว returned ที่ยังค้างอยู่ของใบนี้ (ไม่มี = ทุกช่องเป็น NULL)
CREATE OR REPLACE FUNCTION public.esign_trip_open_return(p_trip_id uuid)
RETURNS public.esign_trip_returns
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT last_event.*
  FROM (
    SELECT r.*
    FROM public.esign_trip_returns r
    WHERE r.doc_type = 'fleet_trip_request' AND r.doc_id = p_trip_id
    ORDER BY r.seq DESC
    LIMIT 1
  ) last_event
  WHERE last_event.kind = 'returned'
$$;
REVOKE ALL ON FUNCTION public.esign_trip_open_return(uuid) FROM PUBLIC, anon, authenticated;

-- จำนวนครั้งที่ใบนี้เคยถูกส่งคืน = เลขรอบที่ใช้แยก key ของ Telegram/กระดิ่ง
CREATE OR REPLACE FUNCTION public.esign_trip_return_round(p_trip_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::integer
  FROM public.esign_trip_returns r
  WHERE r.doc_type = 'fleet_trip_request' AND r.doc_id = p_trip_id AND r.kind = 'returned'
$$;
REVOKE ALL ON FUNCTION public.esign_trip_return_round(uuid) FROM PUBLIC, anon, authenticated;

-- ช่องนี้มีลายเซ็นที่ยังไม่ถูกถอนไหม
CREATE OR REPLACE FUNCTION public.esign_slot_signed(p_trip_id uuid, p_slot text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.esign_signatures s
    WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = p_trip_id AND s.slot = p_slot
      AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
  )
$$;
REVOKE ALL ON FUNCTION public.esign_slot_signed(uuid, text) FROM PUBLIC, anon, authenticated;

-- ตัวคัดก่อนเข้า esign_trip_status: ใบนี้อาจมีงานของผู้เรียกไหม ตัวตัดสินจริงยังเป็น can_sign / can_resubmit
-- รายการรอลงนามรวมใบที่จบทริปแล้ว ถ้าไม่คัดก่อนต้องเรียก esign_trip_status ทุกใบที่เคยลงครบไปแล้วด้วย
-- ช่อง ผอ.กอง/ผู้มีอำนาจ ดูลำดับด้วย: ใบเก่าที่ผู้ขอไม่เคยลงนามต้องไม่กินเพดานของผู้ลงนามช่องหลัง
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

-- ── 2) ส่งคืนผู้ขอ ─────────────────────────────────────────────────────────────────────
-- ใครส่งคืนได้: ผู้ลงนามตัวจริงของช่อง ผอ.กอง/ผู้มีอำนาจ เมื่อถึงคิวตัวเองเท่านั้น (เงื่อนไขเดียวกับ can_return)
-- ผล: ถอนลายเซ็นที่ลงแล้วทุกช่อง (ผู้ขอต้องแก้ได้ และผู้ลงนามต้องเห็นเนื้อหาชุดใหม่) · แถวเดิมไม่ถูกแก้ แค่เพิ่มแถวถอน
-- ไม่ตัดสินแทนคน: ไม่เปลี่ยนสถานะคำขอ ไม่ปล่อยคิวรถ ไม่ใช่คำสั่งไม่อนุญาต ผู้ขอเป็นคนเลือกว่าจะแก้หรือยกเลิก
-- ส่งคืนซ้ำโดยคนเดิม = ตอบ ok + already (กดซ้ำ/สัญญาณหลุดแล้วลองใหม่ได้)
CREATE OR REPLACE FUNCTION public.esign_return_fleet_trip(
  p_trip_id uuid,
  p_slot    text,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_trip   public.fleet_trips%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_exp    jsonb;
  v_open   public.esign_trip_returns%ROWTYPE;
  v_name   text;
  v_id     uuid;
  v_at     timestamptz;
  v_n      integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.rpc_rate_limit_hit('esign_return', 20, interval '5 minutes') THEN
    RAISE EXCEPTION 'ส่งคืนถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reason');
  END IF;
  IF p_slot IS NULL OR NOT (p_slot = ANY (ARRAY['dept_head', 'authority'])) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_slot');
  END IF;

  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_trip.esign_slots IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_online');
  END IF;
  IF COALESCE(v_trip.esign_slots ->> p_slot, 'wet') <> 'online' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'slot_not_online');
  END IF;
  IF v_trip.status IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'trip_closed');
  END IF;

  v_exp := public.esign_expected_signer(v_trip, p_slot);
  IF v_exp ->> 'user_id' IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_exp ->> 'reason', 'signatory_missing'));
  END IF;
  IF (v_exp ->> 'user_id')::uuid <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_your_slot');
  END IF;
  IF COALESCE(v_trip.requested_by, v_trip.created_by) = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'code', 'self_return');
  END IF;

  v_open := public.esign_trip_open_return(v_trip.id);
  IF v_open.id IS NOT NULL THEN
    IF v_open.actor_id = v_uid AND v_open.slot = p_slot THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'return_id', v_open.id, 'revoked', 0);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'already_returned');
  END IF;

  IF public.esign_slot_signed(v_trip.id, p_slot) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_signed');
  END IF;
  -- ลำดับเดียวกับการลงนาม: ยังไม่ถึงคิวตัวเองส่งคืนไม่ได้
  IF (COALESCE(v_trip.esign_slots ->> 'requester', 'wet') = 'online' AND NOT public.esign_slot_signed(v_trip.id, 'requester'))
     OR (p_slot = 'authority' AND COALESCE(v_trip.esign_slots ->> 'dept_head', 'wet') = 'online'
         AND NOT public.esign_slot_signed(v_trip.id, 'dept_head')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wait_previous');
  END IF;

  SELECT btrim(COALESCE(p.full_name, '')) INTO v_name FROM public.profiles p WHERE p.id = v_uid;

  INSERT INTO public.esign_revocations (signature_id, municipality_id, revoked_by, revoked_by_name, reason)
  SELECT s.id, s.municipality_id, v_uid, COALESCE(v_name, ''), left('ส่งคืนผู้ขอ: ' || v_reason, 500)
  FROM public.esign_signatures s
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id
    AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.esign_trip_returns (municipality_id, doc_type, doc_id, kind, slot, actor_id, actor_name, actor_position, reason)
  VALUES (v_trip.municipality_id, 'fleet_trip_request', v_trip.id, 'returned', p_slot, v_uid, COALESCE(v_name, ''), COALESCE(v_exp ->> 'signed_as', ''), v_reason)
  RETURNING id, created_at INTO v_id, v_at;

  PERFORM public.esign_audit(v_trip.municipality_id, 'esign_return', 'fleet_trip', v_trip.id::text, p_slot,
    jsonb_build_object('slot', p_slot, 'revoked', v_n, 'reason', v_reason, 'return_id', v_id));

  RETURN jsonb_build_object('ok', true, 'already', false, 'return_id', v_id, 'returned_at', v_at, 'revoked', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.esign_return_fleet_trip(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_return_fleet_trip(uuid, text, text) TO authenticated;

-- ── 3) ส่งให้ลงนามต่อ (ช่องผู้ขอเซ็นสด) ────────────────────────────────────────────────
-- ใครกดได้: ผู้ขอตัวจริง หรือผู้ดูแลรถ (กติกาเดียวกับถอนทั้งใบ) · ช่องผู้ขอออนไลน์ต้องลงนามใหม่แทน ไม่งั้นข้ามลายเซ็นผู้ขอได้
-- ไม่มีการส่งคืนค้างอยู่ = ตอบ ok + already
CREATE OR REPLACE FUNCTION public.esign_resubmit_fleet_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_trip public.fleet_trips%ROWTYPE;
  v_open public.esign_trip_returns%ROWTYPE;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF NOT (COALESCE(v_trip.requested_by, v_trip.created_by) = v_uid OR public.fleet_is_manager(v_trip.municipality_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_trip.esign_slots IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_online');
  END IF;
  IF v_trip.status IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'trip_closed');
  END IF;

  v_open := public.esign_trip_open_return(v_trip.id);
  IF v_open.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  IF COALESCE(v_trip.esign_slots ->> 'requester', 'wet') = 'online' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'sign_instead');
  END IF;

  SELECT btrim(COALESCE(p.full_name, '')) INTO v_name FROM public.profiles p WHERE p.id = v_uid;
  INSERT INTO public.esign_trip_returns (municipality_id, doc_type, doc_id, kind, actor_id, actor_name)
  VALUES (v_trip.municipality_id, 'fleet_trip_request', v_trip.id, 'resubmitted', v_uid, COALESCE(v_name, ''));
  PERFORM public.esign_audit(v_trip.municipality_id, 'esign_resubmit', 'fleet_trip', v_trip.id::text, NULL,
    jsonb_build_object('return_id', v_open.id, 'by', 'button'));
  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public.esign_resubmit_fleet_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_resubmit_fleet_trip(uuid) TO authenticated;

-- ── 4) esign_trip_status: ส่งคืนค้างอยู่ลงได้เฉพาะช่องผู้ขอ ─────────────────────────
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

-- ── 5) esign_sign_fleet_trip: ด่านเดียวกันฝั่งลงนาม ─────────────────────────────────
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

-- ── 6) esign_trip_turns: ตรรกะคู่กับ can_sign ───────────────────────────────────────
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

-- ── 7) esign_my_pending: รวมใบที่รถกลับแล้วจนกว่าจะลงครบ ────────────────────────────
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
    SELECT t.id, t.status, t.destination, t.purpose, t.planned_departure, t.vehicle_id,
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
          'planned_departure', v_trip.planned_departure
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

-- ── 8) my_notification_feed: แจ้งรอบใหม่และใบที่ถูกส่งคืน ───────────────────────────
CREATE OR REPLACE FUNCTION public.my_notification_feed(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text := public.get_my_role();
  v_muni       uuid := public.get_my_municipality_id();
  v_today      date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_categories jsonb := '[]'::jsonb;
  v_items      jsonb := '[]'::jsonb;
  v_signer     jsonb;
  v_pending    jsonb;
  v_badge      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  -- บุคลากรของ อปท. นี้เท่านั้น (superadmin ได้ทุก อปท.) — ประชาชนมีแค่คำร้อง ซึ่งหน้าเว็บดึงเอง
  IF p_municipality_id IS NULL OR NOT (
    v_role = 'superadmin'
    OR (v_role IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council', 'kamnan') AND v_muni = p_municipality_id)
  ) THEN
    RETURN jsonb_build_object('ok', true, 'categories', v_categories, 'items', v_items);
  END IF;

  -- 1) รอลงนามของฉัน — เฉพาะคนที่ตั้งรหัสลงนามแล้วและไม่ถูกระงับ · ถึงคิวใครตัดสินโดย esign_my_pending
  v_signer := public.esign_my_signer_overview();
  v_pending := public.esign_my_pending();
  IF COALESCE((v_signer ->> 'pin_set')::boolean, false) AND NOT COALESCE((v_signer ->> 'suspended')::boolean, false) THEN
    v_categories := v_categories || to_jsonb('esign'::text);
    -- รอบใหม่หลังส่งคืนใช้ key ใหม่ ไม่งั้นคนที่เคยอ่านแล้วจะไม่เห็นว่าถึงคิวอีกครั้ง (รอบแรกคงรูปเดิม รายการเก่าไม่เด้งซ้ำ)
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'esign',
      'key', 'esign:' || (i ->> 'trip_id') || ':' || (i ->> 'slot')
        || CASE WHEN COALESCE((i ->> 'round')::integer, 0) > 0 THEN ':r' || (i ->> 'round') ELSE '' END,
      'ref', i ->> 'trip_id',
      'status', CASE WHEN COALESCE((i -> 'last_return' ->> 'open')::boolean, false) THEN 'returned' ELSE i ->> 'decision' END,
      'detail', CASE WHEN COALESCE((i -> 'last_return' ->> 'open')::boolean, false) THEN i -> 'last_return' ->> 'label' ELSE i ->> 'slot_label' END,
      'at', i ->> 'planned_departure'
    )), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(COALESCE(v_pending -> 'items', '[]'::jsonb)) AS i;
  END IF;

  -- ใบที่ถูกส่งคืนแต่ช่องผู้ขอเซ็นสด: ผู้ขออาจไม่มีรหัสลงนาม จึงต้องแจ้งแม้ไม่เข้าเงื่อนไขข้างบน · ไม่ส่งเหตุผลเข้ากระดิ่ง
  IF jsonb_array_length(COALESCE(v_pending -> 'returned', '[]'::jsonb)) > 0 THEN
    IF NOT v_categories ? 'esign' THEN
      v_categories := v_categories || to_jsonb('esign'::text);
    END IF;
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'esign',
      'key', 'esign-return:' || (i ->> 'trip_id') || ':r' || (i ->> 'round'),
      'ref', i ->> 'trip_id',
      'status', 'returned',
      'detail', i -> 'last_return' ->> 'label',
      'at', i ->> 'planned_departure'
    )), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_pending -> 'returned') AS i;
  END IF;

  -- 2) กิจกรรมที่มอบหมายให้ฉัน (ยังไม่ผ่านไป) — บทบาทชุดเดียวกับ policy "event assignments read internal"
  --    (รายการจริงกรองด้วย RLS อีกชั้น ชุดบทบาทนี้ใช้แค่ตัดสินว่าโชว์สวิตช์ปิดเสียงหมวดนี้ไหม)
  IF v_role IN ('superadmin', 'admin', 'officer', 'viewer', 'council', 'staff', 'technician') THEN
    v_categories := v_categories || to_jsonb('event'::text);
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'event',
      'key', 'event:' || ea.id,
      'ref', e.id,
      'status', ea.task,
      'detail', to_char(e.event_date, 'YYYY-MM-DD'),
      'at', ea.assigned_at
    ) ORDER BY e.event_date, ea.assigned_at), '[]'::jsonb)
    INTO v_items
    FROM public.event_assignments ea
    JOIN public.events e ON e.id = ea.event_id
    WHERE ea.profile_id = v_uid
      AND ea.municipality_id = p_municipality_id
      AND COALESCE(e.end_date, e.event_date) >= v_today;
  END IF;

  -- 3) คำขอ E-Service รอรับเรื่อง — RLS "read document_requests" ตัดสินว่าเห็นใบไหน
  --    (แอดมิน = ทั้ง อปท. · หัวหน้ากอง = กองตัวเอง · staff = ใบที่มอบหมายให้ · พัสดุ = ใบยืมของกอง)
  --    ไม่นับใบที่ตัวเองยื่นในฐานะประชาชน
  IF v_role IN ('superadmin', 'admin', 'officer', 'staff') THEN
    v_categories := v_categories || to_jsonb('eservice'::text);
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'eservice',
      'key', 'eservice:' || r.id || ':' || r.status,
      'ref', r.id,
      'status', r.status,
      'detail', r.document_type,
      'at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT d.id, d.status, d.document_type, d.created_at
      FROM public.document_requests d
      WHERE d.municipality_id = p_municipality_id
        AND d.status = 'pending'
        AND d.user_id IS DISTINCT FROM v_uid
      ORDER BY d.created_at DESC
      LIMIT 30
    ) r;
  END IF;

  -- 4) รถรับ-ส่งผู้ป่วย — เฉพาะแอดมิน/ผู้ประสานงาน/คนขับของ อปท. ที่เปิดใช้บริการ · ตารางไม่เปิด RLS ให้อ่านตรง
  --    จึงได้แค่จำนวนงานจาก RPC เดิม (key รวมจำนวนไว้ หน้าเว็บเด้งเฉพาะตอนจำนวนเพิ่ม)
  IF public.my_patient_transport_role(p_municipality_id) IN ('admin', 'coordinator', 'driver')
     AND COALESCE((public.patient_booking_info(p_municipality_id) ->> 'enabled')::boolean, false) THEN
    v_categories := v_categories || to_jsonb('patient'::text);
    v_badge := public.patient_booking_staff_work_badge(p_municipality_id);
    IF COALESCE((v_badge ->> 'total')::int, 0) > 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'category', 'patient',
        'key', 'patient:' || (v_badge ->> 'pending') || ':' || (v_badge ->> 'driver'),
        'ref', NULL,
        'status', 'pending',
        'detail', v_badge ->> 'total',
        'at', now()
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'categories', v_categories, 'items', v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.my_notification_feed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notification_feed(uuid) TO authenticated;

-- ── 9) ผู้รับข้อความ "ใบถูกส่งคืน" ให้ notify-telegram (service role ไม่มี auth.uid()) ──
-- คืนแค่รหัสกับป้ายช่อง ไม่มีชื่อคนและเหตุผล · ไม่มีการส่งคืนค้างอยู่ = NULL
CREATE OR REPLACE FUNCTION public.esign_trip_return_dm(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_trip public.fleet_trips%ROWTYPE;
  v_open public.esign_trip_returns%ROWTYPE;
BEGIN
  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id;
  IF NOT FOUND OR v_trip.esign_slots IS NULL OR v_trip.status IN ('rejected', 'cancelled') THEN
    RETURN NULL;
  END IF;
  v_open := public.esign_trip_open_return(p_trip_id);
  IF v_open.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'return_id', v_open.id,
    'label', public.esign_slot_label(v_open.slot),
    'user_id', COALESCE(v_trip.requested_by, v_trip.created_by)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.esign_trip_return_dm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_trip_return_dm(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) from public.esign_trip_returns;                                                                → 0
--   select has_function_privilege('anon', 'public.esign_return_fleet_trip(uuid,text,text)', 'execute');            → false
--   select has_function_privilege('authenticated', 'public.esign_return_fleet_trip(uuid,text,text)', 'execute');   → true
--   select has_function_privilege('authenticated', 'public.esign_trip_return_dm(uuid)', 'execute');                → false
--   select has_table_privilege('authenticated', 'public.esign_trip_returns', 'select');                            → false
