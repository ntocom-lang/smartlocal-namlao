-- ข้อ 3b ส่วนที่ 2 ตั้งค่าแจ้งเตือน (เจ้าของระบบอนุมัติ 2569-10-30) — ฟังก์ชันของ Telegram ส่วนตัว
-- ต้อง apply หลัง 20261030100000 (คอลัมน์ dm_muted)

BEGIN;

-- ── 1) เจ้าของบัญชีเลือกหมวดที่ปิดรับ ────────────────────────────────────────────────────────────
-- รับเฉพาะคีย์ที่รู้จัก (ค่าอื่นทิ้งเงียบๆ) · ยังไม่ผูก Telegram = error ให้หน้าเว็บโหลดสถานะใหม่
CREATE OR REPLACE FUNCTION public.set_my_telegram_dm_muted(p_muted text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_muted text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}')
    INTO v_muted
    FROM unnest(COALESCE(p_muted, '{}')) AS k
   WHERE k IN ('complaint', 'event', 'esign');

  UPDATE public.telegram_user_links
     SET dm_muted = v_muted
   WHERE user_id = v_uid
  RETURNING dm_muted INTO v_muted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram is not linked' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_muted;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_telegram_dm_muted(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_telegram_dm_muted(text[]) TO authenticated;

-- ── 2) ช่องลงนามของใบขอใช้รถที่ "ถึงคิว" ตอนนี้ และใครต้องลง ──────────────────────────────────────
-- notify-telegram (service role ไม่มี auth.uid()) ใช้หาผู้รับข้อความ "ถึงคิวลงนาม"
-- ⚠️ ตรรกะต้องตรงกับ can_sign ใน esign_trip_status() (20261023110000) ทุกเงื่อนไข ยกเว้นเทียบกับผู้เรียก:
--    โหมดออนไลน์ · ช่องเข้าเงื่อนไข (sk1 เฉพาะผู้ขอเป็นนายก) · ยังไม่ลง · ช่องก่อนหน้าลงครบ · ใบยังไม่ปิด
--    และสถานะชุดเดียวกับ esign_my_pending() — แก้ฝั่งนั้นต้องแก้ที่นี่ด้วย (CREATE OR REPLACE ทับทั้งฟังก์ชัน)
-- คืนแค่รหัสช่อง ป้าย และรหัสผู้ใช้ ไม่มีชื่อ
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
BEGIN
  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id;
  IF NOT FOUND OR v_trip.esign_slots IS NULL
     OR v_trip.status NOT IN ('pending', 'waitlisted', 'approved', 'in_progress') THEN
    RETURN v_turns;
  END IF;

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

    IF v_mode = 'online' AND v_applic AND NOT v_signed AND v_prereq_ok THEN
      v_exp := public.esign_expected_signer(v_trip, v_slot);
      IF v_exp ->> 'user_id' IS NOT NULL THEN
        v_turns := v_turns || jsonb_build_array(jsonb_build_object(
          'slot', v_slot,
          'label', public.esign_slot_label(v_slot),
          'user_id', v_exp ->> 'user_id'
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN v_turns;
END;
$$;

REVOKE ALL ON FUNCTION public.esign_trip_turns(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_trip_turns(uuid) TO service_role;

COMMENT ON FUNCTION public.esign_trip_turns(uuid) IS
  'ช่องลงนามใบขอใช้รถที่ถึงคิวตอนนี้ + รหัสผู้ต้องลง — service role (notify-telegram) เท่านั้น · ตรรกะคู่กับ esign_trip_status()';

COMMIT;
