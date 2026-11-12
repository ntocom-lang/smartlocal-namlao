-- โหมดขั้นตอนขอใช้รถราย อปท. (P2) — ผอ.สำนัก/กองที่ได้รับมอบ (ข้อ ๑๒ ว.๔) ลงนามอนุญาตออนไลน์ได้
-- ต่อจาก P1 (20261121100000 + 20261121100100) · ไฟล์นี้มีแต่ฟังก์ชัน/trigger ไม่มี DDL ตาราง
--
-- เจ้าของระบบตัดสิน 2026-11-12:
--   - ใบที่ ผอ. เป็นผู้อนุมัติ: ผอ. ลงทั้งช่อง "ผอ.สำนัก/กอง" และช่อง "ผู้มีอำนาจอนุญาต" (2 ลายเซ็นแยกแถว
--     หน้าจอให้ใส่รหัสครั้งเดียวแล้วลงต่อกัน) ⇒ ฟังก์ชันลำดับช่อง/นับช่องของชุด esign ไม่ต้องแก้
--   - ฐานะใต้ชื่อในช่องผู้อนุญาต = "<ตำแหน่ง ผอ.> ปฏิบัติราชการแทน<ตำแหน่งนายก>" ไม่พิมพ์เลขคำสั่งบนใบ
--     (เลขที่/วันที่คำสั่งอยู่ในค่าตั้ง fleet_permit_settings และ audit)
--
-- ทำอะไร
--   (1) esign_expected_signer ช่อง 'authority': ใบ permit_mode='regulation' ที่ fleet_trip_permit_approver ตอบ
--       delegated_dept_head ⇒ ผู้ลงนามที่ถูกต้องคือ ผอ. ของกองนั้น (ไม่ใช่นายก)
--       ฟังก์ชันชุด esign ทุกตัว (trip_status / sign_fleet_trip / trip_turns / my_pending / trigger ตรึงช่อง)
--       เรียกฟังก์ชันนี้ตัวเดียว จึงได้ผลตามโดยไม่ต้องเขียนทับฟังก์ชันใหญ่
--       ใบโหมด queue (น้ำเลา) และใบที่ไม่เข้าเงื่อนไขมอบ = ผลเดิมทุกไบต์
--   (2) fleet_trip_permit_approver:
--       - กองของผู้อนุมัติ = กองในโปรไฟล์ของผู้ขอ (แผนอนุมัติ: "ผอ.กองของผู้ขอ") ไม่ใช่ dept_head_department_id /
--         fleet_trips.department_id ที่ผู้ขอเลือก/แก้เองได้ (RLS ไม่ล็อกสองคอลัมน์นี้) — ผลตรวจ migration-reviewer 2026-11-12:
--         ทางเดิมให้ผู้ขอเลือก ผอ.กองอื่นมาอนุมัติ และ ผอ. ที่ขอเองเลี่ยง self_request ได้ด้วยการเลือกกองอื่น
--         ช่อง dept_head (เสนอความเห็น) ยังเลือกกองได้เหมือนเดิม
--       - self_request นับทั้งผู้ขอ (requested_by) และผู้กรอก (created_by): ผอ. กรอกแทนลูกน้องแล้วอนุมัติเองไม่ได้
--       - เพิ่มคีย์ 'acting_title' (ฐานะปฏิบัติราชการแทน) ให้ใบพิมพ์/หน้าจอใช้ · ตรรกะอื่นเดิม
--       ⚠️ ทางบันทึกใบกระดาษของ P1 (fleet_record_paper_permit 'delegated_dept_head') ได้กติกาใหม่นี้ตามด้วย
--   (3) trigger trg_fleet_trips_early_permit_mode: ตรึง permit_mode ก่อน trg_fleet_trips_esign_guard
--       (BEFORE trigger รันตามลำดับชื่อ — esign guard ตรวจความพร้อมผู้ลงนามตอน INSERT ต้องเห็นโหมดจริงของใบ
--       ไม่งั้นตรวจความพร้อมของนายกแทน ผอ. แล้วตรึงช่องผิด) ใช้ฟังก์ชันตั้งค่าอย่างเดียวแยกจาก guard ของ P1
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (NOTES) — เนื้อเดิมคัดจากฐานจริง ตรวจ md5 แล้ว 2026-11-12:
--    esign_expected_signer      3c9293d0d6ab98b958dd28f5b3bea4cc (= 20261022100200)
--    fleet_trip_permit_approver 9e8c609f97bc82bcf1118e47d3560fb8 (= 20261121100100, ตัด CR แล้ว)
--    ด่านข้างล่างหยุดถ้าฐานไม่ใช่ฉบับนี้ (หรือฉบับที่ไฟล์นี้ลงไปแล้ว — รันซ้ำได้)

DO $guard$
DECLARE
  v_missing text;
  v_md5     text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'public.fleet_trip_permit_guard()', 'public.fleet_permit_registry(uuid,text,uuid,text,date)',
    'public.fleet_permit_signer_of(public.document_signatories,text)', 'public.fleet_permit_today()',
    'public.fleet_permit_requester_is_mayor(public.fleet_trips)', 'public.esign_fleet_trip_guard()'
  ]) x
  WHERE to_regprocedure(x) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชัน P1: % — ต้องรัน 20261121100000 + 20261121100100 ก่อน', v_missing;
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
  FROM pg_proc p WHERE p.oid = to_regprocedure('public.esign_expected_signer(public.fleet_trips,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('3c9293d0d6ab98b958dd28f5b3bea4cc', '93a859bdf77a0a4f56311a72e94803b6') THEN
    RAISE EXCEPTION 'esign_expected_signer ในฐานไม่ใช่ฉบับที่ไฟล์นี้คัดมา (md5 %) — ดึงนิยามจริงมาเทียบก่อน', v_md5;
  END IF;

  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
  FROM pg_proc p WHERE p.oid = to_regprocedure('public.fleet_trip_permit_approver(public.fleet_trips,date)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('9e8c609f97bc82bcf1118e47d3560fb8', 'd36c3db1b5b01db839170c3f4c4dcbf8') THEN
    RAISE EXCEPTION 'fleet_trip_permit_approver ในฐานไม่ใช่ฉบับที่ไฟล์นี้คัดมา (md5 %) — ดึงนิยามจริงมาเทียบก่อน', v_md5;
  END IF;
END;
$guard$;

-- ── 1) ฐานะ "ปฏิบัติราชการแทน" ─────────────────────────────────────────────────────────────────
-- ตำแหน่งนายกมาจากทะเบียนผู้ลงนามกลาง (ช่อง mayor ที่มีผลวันนี้: title_override หรือตำแหน่งในโปรไฟล์)
-- ไม่มี (เช่น แถวนายกเป็นชื่อพิมพ์เองไม่มีตำแหน่ง) = สร้างจากชื่อ อปท. แบบเดียวกับ organizationHeadTitle() ใน fleetTripPrint.js
--   "องค์การบริหารส่วนตำบล X" → "นายกองค์การบริหารส่วนตำบล X" · "เทศบาลตำบล X" → "นายกเทศมนตรีตำบล X"
-- ไม่เข้ารูปแบบไหนเลยจึงใช้คำกลาง "ผู้บริหารท้องถิ่น"
CREATE OR REPLACE FUNCTION public.fleet_permit_acting_title(p_municipality_id uuid, p_title text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(NULLIF(btrim(p_title), ''), 'ผู้อำนวยการสำนัก/กอง')
    || ' ปฏิบัติราชการแทน'
    || COALESCE(
         NULLIF(btrim(public.fleet_permit_signer_of(
           public.fleet_permit_registry(p_municipality_id, 'mayor', NULL, NULL, public.fleet_permit_today()),
           NULL
         ) ->> 'title'), ''),
         (SELECT CASE
                   WHEN btrim(m.name) LIKE 'องค์การบริหารส่วนตำบล%' THEN 'นายก' || btrim(m.name)
                   WHEN btrim(m.name) LIKE 'เทศบาล_%' THEN 'นายกเทศมนตรี' || btrim(substr(btrim(m.name), 7))
                 END
            FROM public.municipalities m WHERE m.id = p_municipality_id),
         'ผู้บริหารท้องถิ่น'
       )
$$;
REVOKE ALL ON FUNCTION public.fleet_permit_acting_title(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 2) fleet_trip_permit_approver: เนื้อเดิมจาก 20261121100100 + กองจากโปรไฟล์ผู้ขอ + self_request รวมผู้กรอก + acting_title ──
-- department_id ในผล = กองของผู้ขอตามโปรไฟล์ (เดิม = กองที่ผู้ขอเลือกในช่อง ผอ.)
-- ผู้ขอไม่มีกองในโปรไฟล์ = no_department → กลับไปที่ผู้มีอำนาจ (ข้อมูลจริง 2026-11-12: ทุ่งแค้ว 40/40 มีกอง)
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
BEGIN
  SELECT * INTO v_set FROM public.fleet_permit_settings s WHERE s.municipality_id = p_trip.municipality_id;

  IF FOUND AND v_set.delegate_dept_heads THEN
    -- กองที่ผู้ขอสังกัดจริง (แอดมินเป็นผู้ตั้ง) — ไม่รับกองที่ผู้ขอเลือกเองในใบ
    SELECT pr.department_id INTO v_dept FROM public.profiles pr WHERE pr.id = v_requester;
    IF public.fleet_permit_requester_is_mayor(p_trip) THEN
      v_fallback := 'requester_is_executive';
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

-- ── 3) esign_expected_signer: เนื้อเดิมจาก 20261022100200 + กิ่งมอบ ผอ. ในช่อง authority ─────────────────
-- ผู้ลงนามที่ควรเป็นของช่องนั้นของทริปนั้น ณ ตอนนี้
-- requester/sk1 = ผู้ขอตัวจริง (requested_by, ถอยไป created_by เหมือนฟังก์ชันพิมพ์) · dept_head/authority = แถวที่มีผลวันนี้
-- ในทะเบียนผู้ลงนามกลาง (กติกาเดียวกับ pickSignatory ไม่ส่ง at: ลงนามตอนนี้ = คนที่ดำรงตำแหน่งตอนนี้)
-- ทะเบียนเป็นชื่อพิมพ์เอง (profile_id ว่าง) ลงนามออนไลน์ไม่ได้ → reason = signatory_not_linked
-- P2: ใบ regulation ที่เข้าเงื่อนไขมอบ (ข้อ ๑๒ ว.๔) ช่อง authority = ผอ. ของกอง ฐานะ "… ปฏิบัติราชการแทน…"
--     ผอ.ขอเอง / กองไม่มีผู้ลงนาม / ผู้ขอเป็นนายก / ก่อนวันที่คำสั่ง → fleet_trip_permit_approver ตอบ authority = นายกตามเดิม
--     ปิดการมอบทีหลัง = ใบที่ยังไม่ลงช่องนี้กลับไปรอนายก (อำนาจดูตอนลงนาม) ลายเซ็นที่ลงไปแล้วยังมีผล
-- คืน jsonb: {user_id, position, signed_as, registry_id} หรือ {reason, registry_id?}
CREATE OR REPLACE FUNCTION public.esign_expected_signer(p_trip public.fleet_trips, p_slot text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reg   public.document_signatories%ROWTYPE;
  v_uid   uuid;
  v_pos   text;
  v_title text;
  v_dept  uuid;
  v_role  text;
  v_today date := (timezone('Asia/Bangkok', now()))::date;
  v_appr  jsonb;
  v_acting boolean := false;
BEGIN
  IF p_slot IN ('requester', 'sk1') THEN
    v_uid := COALESCE(p_trip.requested_by, p_trip.created_by);
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('reason', 'requester_missing');
    END IF;
    v_pos := btrim(COALESCE(p_trip.requester_position, ''));
    IF v_pos = '' THEN
      SELECT btrim(COALESCE(NULLIF(btrim(pr.job_title), ''), pos.name, '')) INTO v_pos
      FROM public.profiles pr
      LEFT JOIN public.positions pos ON pos.id = pr.position_id
      WHERE pr.id = v_uid;
    END IF;
    RETURN jsonb_build_object('user_id', v_uid, 'position', COALESCE(v_pos, ''), 'signed_as', COALESCE(v_pos, ''));
  END IF;

  IF p_slot = 'dept_head' THEN
    -- เหมือน printTripRequest: หัวหน้ากองที่เลือกไว้ ถ้าไม่ได้เลือกใช้กองของทริป
    v_dept := COALESCE(p_trip.dept_head_department_id, p_trip.department_id);
    IF v_dept IS NULL THEN
      RETURN jsonb_build_object('reason', 'dept_head_missing');
    END IF;
    SELECT * INTO v_reg
    FROM public.document_signatories s
    WHERE s.municipality_id = p_trip.municipality_id
      AND s.document_type = 'complaint'
      AND s.signatory_role = 'department_head'
      AND s.department_id = v_dept
      AND s.is_active
      AND s.effective_from <= v_today
      AND (s.effective_to IS NULL OR s.effective_to >= v_today)
    ORDER BY s.created_at DESC
    LIMIT 1;
  ELSIF p_slot = 'authority' THEN
    IF p_trip.permit_mode = 'regulation' THEN
      v_appr := public.fleet_trip_permit_approver(p_trip, NULL);
      IF v_appr ->> 'kind' = 'delegated_dept_head' THEN
        v_acting := true;
        SELECT * INTO v_reg FROM public.document_signatories s WHERE s.id = (v_appr ->> 'registry_id')::uuid;
      END IF;
    END IF;
    IF NOT v_acting THEN
      -- เหมือน printTripRequest: ไม่ได้เลือก = นายก (mayor)
      v_role := COALESCE(p_trip.order_authority_role, 'mayor');
      SELECT * INTO v_reg
      FROM public.document_signatories s
      WHERE s.municipality_id = p_trip.municipality_id
        AND s.document_type = 'complaint'
        AND s.signatory_role = v_role
        AND s.department_id IS NULL
        AND s.custom_label IS NOT DISTINCT FROM p_trip.order_authority_label
        AND s.is_active
        AND s.effective_from <= v_today
        AND (s.effective_to IS NULL OR s.effective_to >= v_today)
      ORDER BY s.created_at DESC
      LIMIT 1;
    END IF;
  ELSE
    RETURN jsonb_build_object('reason', 'bad_slot');
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('reason', 'signatory_missing');
  END IF;
  IF v_reg.profile_id IS NULL THEN
    RETURN jsonb_build_object('reason', 'signatory_not_linked', 'registry_id', v_reg.id);
  END IF;

  SELECT btrim(COALESCE(NULLIF(btrim(pr.job_title), ''), pos.name, '')) INTO v_pos
  FROM public.profiles pr
  LEFT JOIN public.positions pos ON pos.id = pr.position_id
  WHERE pr.id = v_reg.profile_id;
  v_title := COALESCE(NULLIF(btrim(v_reg.title_override), ''), v_pos, '');
  IF v_acting THEN
    -- approver คำนวณจากแถวทะเบียนเดียวกันไว้แล้ว (title_override → ตำแหน่งในโปรไฟล์ → คำกลางชุดเดียวกัน)
    v_title := COALESCE(v_appr ->> 'acting_title', public.fleet_permit_acting_title(p_trip.municipality_id, v_title));
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_reg.profile_id,
    'position', COALESCE(v_pos, ''),
    'signed_as', v_title,
    'registry_id', v_reg.id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.esign_expected_signer(public.fleet_trips, text) FROM PUBLIC, anon, authenticated;

-- ── 4) ตรึง permit_mode ก่อน esign guard ตอน INSERT ─────────────────────────────────────────────
-- ลำดับ BEFORE INSERT บนฐานจริง (ตรวจ 2026-11-12): trg_fleet_guard_trip_write → trg_fleet_trip_requester_snapshot
--   → trg_fleet_trip_require_odometer → trg_fleet_trips_audit → [ตัวนี้] → trg_fleet_trips_esign_guard
--   → trg_fleet_trips_guard_overlap → trg_fleet_trips_permit_guard
-- ฟังก์ชันแยกที่ "ตั้งค่าอย่างเดียว" (ไม่ raise ไม่ audit) — ไม่เรียก fleet_trip_permit_guard ซ้ำ เพื่อกันผลข้างเคียงที่ P3
-- อาจเพิ่มในกิ่ง INSERT ของ guard ทำงานสองครั้งเงียบๆ (ผลตรวจ migration-reviewer 2026-11-12)
-- ⚠️ กติกาต้องตรงกับกิ่ง INSERT ของ fleet_trip_permit_guard (20261121100100) ทุกครั้ง: completed → queue, นอกนั้น = ค่าของ อปท.
--   guard ตัวท้าย (trg_fleet_trips_permit_guard) ยังตั้งซ้ำและกันออกรถตอนสร้างเป็นคำตัดสินสุดท้าย
--   เทสต์ tests/fleet-permit-db.test.mjs ตรวจว่าสองตัวได้ค่าเดียวกัน
CREATE OR REPLACE FUNCTION public.fleet_trip_permit_mode_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    NEW.permit_mode := 'queue';
  ELSE
    NEW.permit_mode := COALESCE(
      (SELECT s.permit_mode FROM public.fleet_permit_settings s WHERE s.municipality_id = NEW.municipality_id),
      'queue'
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_permit_mode_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_trips_early_permit_mode ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trips_early_permit_mode
BEFORE INSERT ON public.fleet_trips
FOR EACH ROW EXECUTE FUNCTION public.fleet_trip_permit_mode_stamp();

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select tgname from pg_trigger where tgrelid = 'public.fleet_trips'::regclass and not tgisinternal order by 1;
--     → trg_fleet_trips_early_permit_mode อยู่ระหว่าง trg_fleet_trips_audit กับ trg_fleet_trips_esign_guard
--   select md5(replace(prosrc, chr(13), '')) from pg_proc where proname = 'esign_expected_signer';  → 93a859bdf77a0a4f56311a72e94803b6
--   select has_function_privilege('authenticated', 'public.fleet_permit_acting_title(uuid,text)', 'execute');  → false
--   select has_function_privilege('anon', 'public.fleet_permit_acting_title(uuid,text)', 'execute');           → false
--   select md5(replace(prosrc, chr(13), '')) from pg_proc where proname = 'fleet_trip_permit_approver';  → d36c3db1b5b01db839170c3f4c4dcbf8
--   select has_function_privilege('authenticated', 'public.fleet_trip_permit_mode_stamp()', 'execute');           → false
