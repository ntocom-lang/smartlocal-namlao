-- เฟส 2/2 ของการกันคิวรถให้ครอบคลุมเหตุการณ์จริง (ต้องรัน 20260913150000 ก่อน)
--
-- ปัญหาที่พบหลังเปิดอนุมัติคิวอัตโนมัติ (#168)
--   1. คิวต่อกันพอดี (A คืน 12:00 / B ออก 12:00) อนุมัติทั้งคู่ — A กลับช้านิดเดียว B ก็ไม่มีรถ
--   2. รถที่ยังไม่คืนเกินเวลาที่ขอ ระบบไม่รู้ เพราะเทียบกับ "เวลากลับตามคำขอ" อย่างเดียว
--   3. ผู้ขับรถคนเดียวถูกอนุมัติให้ขับสองคันพร้อมกันได้ (ตรวจแต่คิวรถ ไม่ตรวจคิวคน)
--   4. รถกำลังซ่อม/ปลดประจำการ ยังได้รับอนุมัติอัตโนมัติ
--   5. พ.ร.บ./ประกัน/ภาษี/ตรวจสภาพ หมดอายุ ยังได้รับอนุมัติอัตโนมัติ
--   6. ขอใช้รถย้อนหลัง หรือขอยาวหลายวันจนกินคิวคนอื่น ได้รับอนุมัติอัตโนมัติ
--   7. หน้าจอเช็คคิวเองด้วยตรรกะคนละชุดกับ DB และมองไม่เห็นคิวของกองอื่น (RLS)
--      แถมนับรถที่ "กำลังเดินทาง" ว่าไม่ว่างโดยไม่ดูเวลา ขอสัปดาห์หน้าก็ขึ้นการ์ดคิวชน
--
-- โครงสร้าง: ตัดสินที่ fleet_trip_queue_reasons() ที่เดียว แล้วให้ทั้ง trigger และ RPC ของหน้าจอเรียกใช้
--   hard (ผู้ดูแลอนุมัติเองก็ไม่ได้): vehicle_busy · driver_busy · vehicle_unavailable
--   soft (ไม่อนุมัติอัตโนมัติ แต่ผู้ดูแลอนุมัติเองได้): vehicle_tight · driver_tight ·
--        vehicle_not_returned · past_departure · long_duration · vehicle_documents_expired
--
-- สมมติฐานค่ากติกา (แก้ที่ fleet_trip_rules() ที่เดียว):
--   เวลาเผื่อระหว่างคิว 30 นาที · อนุมัติอัตโนมัติได้ไม่เกิน 72 ชั่วโมงต่อคำขอ · ยื่นย้อนหลังได้ไม่เกิน 15 นาที
--
-- ⚠️ body ของ fleet_trips_guard_overlap คัดจาก #168 (hash ตรวจใน DO block) แล้วเขียนใหม่ทั้งตัว

DO $guard$
DECLARE
  v_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fleet_trips' AND column_name = 'waitlist_reasons'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260913150000 ก่อน';
  END IF;

  SELECT md5(prosrc) INTO v_hash FROM pg_proc WHERE proname = 'fleet_trips_guard_overlap';
  IF v_hash IS DISTINCT FROM '0f4e7b0009fc88a9e40cb147f5e649b1' THEN
    RAISE EXCEPTION 'schema drift: fleet_trips_guard_overlap body ไม่ตรงกับ #168 (hash=%), ต้องตรวจก่อน apply', v_hash;
  END IF;
END;
$guard$;

-- ── ค่ากติกา ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_trip_rules()
 RETURNS TABLE(queue_buffer interval, max_auto_duration interval, past_grace interval)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- queue_buffer: คิวรถ/คนขับต้องห่างกันอย่างน้อยเท่านี้ ถึงจะอนุมัติอัตโนมัติ (เผื่อกลับช้า/ส่งกุญแจ)
  -- max_auto_duration: ขอนานกว่านี้ให้ผู้ดูแลพิจารณา (กันคำขอยาวหลายวันกินคิวคนอื่นโดยไม่มีใครเห็น)
  -- past_grace: เวลาออกย้อนหลังได้ไม่เกินนี้ (กรอกฟอร์มช้าไม่กี่นาทียังนับว่าปกติ)
  SELECT interval '30 minutes', interval '72 hours', interval '15 minutes'
$function$;

-- ── ช่วงเวลาที่ทริปอื่น "กินคิว" จริง ──────────────────────────────────────────
-- ทริปที่กำลังเดินทาง: เริ่มที่ออกจริง (ถ้าออกก่อนกำหนด) และจบที่ max(เวลากลับตามคำขอ, ตอนนี้)
-- เพราะรถยังไม่คืน ต่อให้เลยเวลาที่ขอไว้แล้วก็ยังใช้ไม่ได้
-- ช่วงของทริปอื่นถูกขยายด้วย p_buffer ทั้งสองข้าง = คิวใหม่ต้องห่างจากคิวเดิมอย่างน้อย p_buffer
CREATE OR REPLACE FUNCTION public.fleet_trip_conflicts(
  p_vehicle_id uuid, p_driver_id uuid,
  p_from timestamptz, p_to timestamptz,
  p_exclude_trip uuid, p_buffer interval
)
 RETURNS TABLE(kind text, trip_id uuid, conflict_from timestamptz, conflict_to timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH windows AS (
    SELECT t.id, t.vehicle_id, t.driver_id,
      CASE WHEN t.status = 'in_progress'
        THEN LEAST(COALESCE(t.started_at, t.planned_departure), COALESCE(t.planned_departure, t.started_at))
        ELSE t.planned_departure END AS w_from,
      CASE WHEN t.status = 'in_progress'
        THEN GREATEST(COALESCE(t.planned_return, now()), now())
        ELSE t.planned_return END AS w_to
    FROM public.fleet_trips t
    WHERE t.status IN ('pending', 'approved', 'in_progress')
      AND t.id IS DISTINCT FROM p_exclude_trip
      AND ((p_vehicle_id IS NOT NULL AND t.vehicle_id = p_vehicle_id)
        OR (p_driver_id IS NOT NULL AND t.driver_id = p_driver_id))
  )
  SELECT 'vehicle'::text, w.id, w.w_from, w.w_to
    FROM windows w
   WHERE p_vehicle_id IS NOT NULL AND w.vehicle_id = p_vehicle_id
     AND w.w_from IS NOT NULL AND w.w_to > w.w_from
     AND tstzrange(w.w_from - p_buffer, w.w_to + p_buffer, '[)') && tstzrange(p_from, p_to, '[)')
  UNION ALL
  SELECT 'driver'::text, w.id, w.w_from, w.w_to
    FROM windows w
   WHERE p_driver_id IS NOT NULL AND w.driver_id = p_driver_id
     AND w.w_from IS NOT NULL AND w.w_to > w.w_from
     AND tstzrange(w.w_from - p_buffer, w.w_to + p_buffer, '[)') && tstzrange(p_from, p_to, '[)')
$function$;

-- ── เหตุผลที่คำขอหนึ่งรายการ "ยังไม่ควรได้คิว" — จุดตัดสินจุดเดียว ──────────────────────
CREATE OR REPLACE FUNCTION public.fleet_trip_queue_reasons(
  p_vehicle_id uuid, p_driver_id uuid,
  p_from timestamptz, p_to timestamptz,
  p_exclude_trip uuid
)
 RETURNS TABLE(reason text, severity text, conflict_from timestamptz, conflict_to timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_buffer interval;
  v_max_duration interval;
  v_past_grace interval;
  v_found boolean;
  v_status text;
  v_first_expiry date;
  v_end_date date;
  v_exact_vehicle uuid[] := ARRAY[]::uuid[];
  v_exact_driver uuid[] := ARRAY[]::uuid[];
  v_row record;
BEGIN
  SELECT r.queue_buffer, r.max_auto_duration, r.past_grace
    INTO v_buffer, v_max_duration, v_past_grace
  FROM public.fleet_trip_rules() r;

  -- ใช้ตัวแปรเดี่ยว ไม่ใช้ record — SELECT INTO record ที่ไม่เจอแถวแล้วอ่านฟิลด์จะ error
  SELECT v.status,
         LEAST(COALESCE(v.act_expiry, 'infinity'::date), COALESCE(v.insurance_expiry, 'infinity'::date),
               COALESCE(v.registration_expiry, 'infinity'::date), COALESCE(v.inspection_expiry, 'infinity'::date))
    INTO v_status, v_first_expiry
  FROM public.fleet_vehicles v WHERE v.id = p_vehicle_id;
  v_found := FOUND;

  IF v_found AND COALESCE(v_status, '') <> 'active' THEN
    reason := 'vehicle_unavailable'; severity := 'hard'; conflict_from := NULL; conflict_to := NULL;
    RETURN NEXT;
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RETURN;
  END IF;

  -- hard: ทับกันจริง (ไม่มีเวลาเผื่อ)
  FOR v_row IN
    SELECT c.kind, c.trip_id, c.conflict_from, c.conflict_to
      FROM public.fleet_trip_conflicts(p_vehicle_id, p_driver_id, p_from, p_to, p_exclude_trip, interval '0') c
     ORDER BY c.conflict_from
  LOOP
    reason := v_row.kind || '_busy'; severity := 'hard';
    conflict_from := v_row.conflict_from; conflict_to := v_row.conflict_to;
    RETURN NEXT;
    IF v_row.kind = 'vehicle' THEN v_exact_vehicle := array_append(v_exact_vehicle, v_row.trip_id);
    ELSE v_exact_driver := array_append(v_exact_driver, v_row.trip_id); END IF;
  END LOOP;

  -- soft: ไม่ทับ แต่ห่างกันน้อยกว่าเวลาเผื่อ
  FOR v_row IN
    SELECT c.kind, c.trip_id, c.conflict_from, c.conflict_to
      FROM public.fleet_trip_conflicts(p_vehicle_id, p_driver_id, p_from, p_to, p_exclude_trip, v_buffer) c
     ORDER BY c.conflict_from
  LOOP
    IF (v_row.kind = 'vehicle' AND v_row.trip_id = ANY(v_exact_vehicle))
       OR (v_row.kind = 'driver' AND v_row.trip_id = ANY(v_exact_driver)) THEN
      CONTINUE;
    END IF;
    reason := v_row.kind || '_tight'; severity := 'soft';
    conflict_from := v_row.conflict_from; conflict_to := v_row.conflict_to;
    RETURN NEXT;
  END LOOP;

  -- soft: รถยังไม่คืนจากทริปที่เลยเวลากลับแล้ว — ไม่รู้ว่าจะคืนเมื่อไร ต้องให้คนตัดสิน
  -- ตั้งใจให้กระทบทุกคำขอของรถคันนั้นจนกว่าจะบันทึก "กลับถึง" บังคับให้ปิดทริปที่ค้าง
  FOR v_row IN
    SELECT COALESCE(t.started_at, t.planned_departure) AS w_from, t.planned_return AS w_to
      FROM public.fleet_trips t
     WHERE t.vehicle_id = p_vehicle_id
       AND t.status = 'in_progress'
       AND t.id IS DISTINCT FROM p_exclude_trip
       AND t.planned_return < now()
  LOOP
    reason := 'vehicle_not_returned'; severity := 'soft';
    conflict_from := v_row.w_from; conflict_to := v_row.w_to;
    RETURN NEXT;
  END LOOP;

  IF p_from < now() - v_past_grace THEN
    reason := 'past_departure'; severity := 'soft'; conflict_from := NULL; conflict_to := NULL;
    RETURN NEXT;
  END IF;

  IF p_to - p_from > v_max_duration THEN
    reason := 'long_duration'; severity := 'soft'; conflict_from := NULL; conflict_to := NULL;
    RETURN NEXT;
  END IF;

  -- วันหมดอายุคือวันสุดท้ายที่ยังใช้ได้ — หมดก่อนวันกลับ (เวลาไทย) = ระหว่างทริปไม่มีความคุ้มครอง
  v_end_date := (p_to AT TIME ZONE 'Asia/Bangkok')::date;
  IF v_found AND v_first_expiry < v_end_date THEN
    reason := 'vehicle_documents_expired'; severity := 'soft'; conflict_from := NULL; conflict_to := NULL;
    RETURN NEXT;
  END IF;
END;
$function$;

-- ── trigger: ตัดสินคิว ─────────────────────────────────────────────────────────
-- ⚠️ พึ่งลำดับ trigger: BEFORE trigger ของตารางเดียวกันรันตามลำดับชื่อ
--   trg_fleet_guard_trip_write → trg_fleet_trip_requester_snapshot → trg_fleet_trips_guard_overlap
--   guard รันก่อนตอนสถานะยังเป็น pending จึงไม่เติม approved_by/approval_method ให้
CREATE OR REPLACE FUNCTION public.fleet_trips_guard_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_auto_decide boolean;
  v_row record;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  -- คำขอใหม่ที่ส่งมาเป็น pending = ให้ระบบตัดสินคิวเอง
  v_auto_decide := TG_OP = 'INSERT' AND NEW.status = 'pending';

  -- waitlist_reasons ตั้งได้ที่นี่ที่เดียว ค่าจาก client ถูกทิ้งเสมอ
  -- (ต้องทำก่อน RETURN ตัวแรก ไม่งั้น UPDATE สถานะที่ไม่กินคิวจะปลอมเหตุผลได้)
  IF TG_OP = 'INSERT' THEN
    NEW.waitlist_reasons := NULL;
  ELSE
    NEW.waitlist_reasons := OLD.waitlist_reasons;
  END IF;

  -- สนใจเฉพาะสถานะที่กินคิวรถ (waitlisted/cancelled/rejected/completed ไม่กินคิว)
  IF NEW.status NOT IN ('pending', 'approved', 'in_progress') THEN
    RETURN NEW;
  END IF;

  -- บันทึกย้อนหลัง/ทริปเก่าที่ไม่มีช่วงเวลาจอง — ไม่มีอะไรให้ชน
  IF NEW.planned_departure IS NULL OR NEW.planned_return IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE ที่ไม่ได้แตะรถ ผู้ขับ หรือช่วงเวลา (อนุมัติ/ออกเดินทาง/กลับถึง) ผ่านเสมอ
  -- ยกเว้นสถานะเดิมไม่ได้กินคิว (waitlisted → approved) ต้องตรวจใหม่ทุกครั้ง
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('pending', 'approved', 'in_progress')
     AND NEW.vehicle_id        IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.driver_id         IS NOT DISTINCT FROM OLD.driver_id
     AND NEW.planned_departure IS NOT DISTINCT FROM OLD.planned_departure
     AND NEW.planned_return    IS NOT DISTINCT FROM OLD.planned_return
  THEN
    RETURN NEW;
  END IF;

  -- ล็อกคิวรถ (แถวรถ) และคิวผู้ขับรถ (advisory lock ต่อคน) ให้คำขอที่ยื่นพร้อมกันเข้าคิวทีละราย
  -- ใช้ advisory lock กับผู้ขับแทนการล็อกแถว profiles เพื่อไม่ไปขวางการแก้โปรไฟล์
  PERFORM 1 FROM public.fleet_vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
  IF NEW.driver_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('fleet_trip_driver:' || NEW.driver_id::text, 0));
  END IF;

  FOR v_row IN
    SELECT q.reason, q.severity, q.conflict_from, q.conflict_to
      FROM public.fleet_trip_queue_reasons(NEW.vehicle_id, NEW.driver_id,
             NEW.planned_departure, NEW.planned_return, NEW.id) q
  LOOP
    IF NOT v_auto_decide THEN
      -- คนสั่งเอง (อนุมัติ/แก้ไข/จองแทนที่): บล็อกเฉพาะเหตุ hard ส่วน soft เป็นดุลพินิจผู้ดูแล
      IF v_row.severity <> 'hard' THEN
        CONTINUE;
      END IF;
      IF v_row.reason = 'vehicle_busy' THEN
        RAISE EXCEPTION 'รถคันนี้ถูกจองช่วง % ถึง % ไว้แล้ว กรุณาเปลี่ยนเวลาหรือเลือกรถคันอื่น',
          to_char(v_row.conflict_from AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
          to_char(v_row.conflict_to   AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
          USING ERRCODE = '23P01';
      ELSIF v_row.reason = 'driver_busy' THEN
        RAISE EXCEPTION 'FLEET_TRIP_DRIVER_BUSY: ผู้ขับรถติดภารกิจอื่นช่วง % ถึง %',
          to_char(v_row.conflict_from AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
          to_char(v_row.conflict_to   AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
          USING ERRCODE = '23P01';
      ELSE
        RAISE EXCEPTION 'FLEET_TRIP_VEHICLE_UNAVAILABLE' USING ERRCODE = '23P01';
      END IF;
    END IF;

    IF NOT (v_row.reason = ANY(v_reasons)) THEN
      v_reasons := array_append(v_reasons, v_row.reason);
    END IF;
  END LOOP;

  IF NOT v_auto_decide THEN
    RETURN NEW;
  END IF;

  IF cardinality(v_reasons) > 0 THEN
    -- ไม่ RAISE: เก็บคำขอไว้ให้ผู้ดูแลจัดสรร พร้อมเหตุผล ฝั่งแอปแจ้ง Telegram (fleet_trip_waitlisted)
    NEW.status := 'waitlisted';
    NEW.waitlist_reasons := v_reasons;
    RETURN NEW;
  END IF;

  -- approved_by ต้องเป็น NULL — ไม่มีคนอนุมัติ ใบแบบ 3 จะเว้นช่อง "อนุมัติ" ให้ผู้มีอำนาจติ๊กเอง
  NEW.status := 'approved';
  NEW.approved_at := now();
  NEW.approved_by := NULL;
  NEW.approval_method := 'auto';
  RETURN NEW;
END;
$function$;

-- ── RPC ของหน้าจอ: ตรวจคิวก่อนส่ง ด้วยตรรกะเดียวกับ DB และเห็นคิวทุกกอง ─────────────────
-- คืนแค่เหตุผลกับช่วงเวลา ไม่คืนชื่อผู้ขอ/ปลายทางของทริปกองอื่น (เจ้าหน้าที่กองอื่นไม่จำเป็นต้องรู้)
CREATE OR REPLACE FUNCTION public.fleet_trip_availability(
  p_vehicle_id uuid, p_driver_id uuid,
  p_from timestamptz, p_to timestamptz,
  p_exclude_trip uuid DEFAULT NULL
)
 RETURNS TABLE(reason text, severity text, conflict_from timestamptz, conflict_to timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid;
  v_role text;
  v_driver uuid := p_driver_id;
  v_exclude uuid := p_exclude_trip;
BEGIN
  SELECT f.mun_id, f.frole INTO v_mun, v_role FROM public.my_fleet() f;
  IF v_mun IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fleet_vehicles v WHERE v.id = p_vehicle_id AND v.municipality_id = v_mun) THEN
    RAISE EXCEPTION 'FLEET_ASSET_TENANT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  -- ผู้ขับ/ทริปที่ยกเว้น ต้องอยู่ใน อปท. เดียวกัน ไม่งั้นใช้ RPC นี้สืบคิวของ อปท. อื่นได้
  IF v_driver IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_driver AND p.municipality_id = v_mun
  ) THEN
    v_driver := NULL;
  END IF;
  IF v_exclude IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_trips t WHERE t.id = v_exclude AND t.municipality_id = v_mun
  ) THEN
    v_exclude := NULL;
  END IF;

  RETURN QUERY
    SELECT q.reason, q.severity, q.conflict_from, q.conflict_to
      FROM public.fleet_trip_queue_reasons(p_vehicle_id, v_driver, p_from, p_to, v_exclude) q;
END;
$function$;

-- รถที่ว่างและพร้อมใช้ในช่วงเวลานั้น (สำหรับปุ่ม "เปลี่ยนเป็นรถคันนี้" ในการ์ดคิวชน)
-- นับเฉพาะเหตุที่เกี่ยวกับตัวรถ ไม่นับเหตุของคำขอ (ย้อนหลัง/นานเกิน) หรือของผู้ขับ
CREATE OR REPLACE FUNCTION public.fleet_available_vehicles(
  p_from timestamptz, p_to timestamptz, p_exclude_trip uuid DEFAULT NULL
)
 RETURNS TABLE(vehicle_id uuid)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_mun uuid;
  v_role text;
  v_exclude uuid := p_exclude_trip;
BEGIN
  SELECT f.mun_id, f.frole INTO v_mun, v_role FROM public.my_fleet() f;
  IF v_mun IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_exclude IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_trips t WHERE t.id = v_exclude AND t.municipality_id = v_mun
  ) THEN
    v_exclude := NULL;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RETURN;
  END IF;

  -- ⚠️ เรียกตัวตัดสินทีละคัน — พอสำหรับ อปท. (รถหลักสิบคัน) ถ้าวันหนึ่งมีหลายร้อยคันต้องเขียนเป็น set-based
  RETURN QUERY
    SELECT v.id
      FROM public.fleet_vehicles v
     WHERE v.municipality_id = v_mun
       AND v.asset_kind = 'vehicle'
       AND v.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.fleet_trip_queue_reasons(v.id, NULL, p_from, p_to, v_exclude) q
          WHERE q.reason IN ('vehicle_busy', 'vehicle_unavailable', 'vehicle_tight',
                             'vehicle_not_returned', 'vehicle_documents_expired')
       );
END;
$function$;

-- ── สิทธิ์ ───────────────────────────────────────────────────────────────────
-- ตัวภายในเรียกได้เฉพาะจาก trigger/RPC ที่เป็น SECURITY DEFINER เท่านั้น
REVOKE ALL ON FUNCTION public.fleet_trip_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_trip_conflicts(uuid, uuid, timestamptz, timestamptz, uuid, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_trip_queue_reasons(uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.fleet_trip_availability(uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_trip_availability(uuid, uuid, timestamptz, timestamptz, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fleet_available_vehicles(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_available_vehicles(timestamptz, timestamptz, uuid) TO authenticated;
