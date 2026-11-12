-- โหมดขั้นตอนขอใช้รถราย อปท. (P1) — ฟังก์ชัน/trigger/RPC (ต่อจาก 20261121100000_fleet_permit_tables.sql)
--
-- ตัวบท: ระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙ (ราชกิจจาฯ เล่ม ๑๔๓ ตอนพิเศษ ๖๘ ง)
--   ข้อ ๕  "หัวหน้าหน่วยงาน" = หัวหน้าหน่วยงานตามโครงสร้าง (สำนัก/กอง)
--   ข้อ ๑๒ ว.๓ การใช้ยานพาหนะส่วนกลางและรถรับรองต้องได้รับอนุญาตจากผู้บริหารท้องถิ่นก่อน
--   ข้อ ๑๒ ว.๔ ผู้บริหารท้องถิ่นอาจมอบหมายให้หัวหน้าหน่วยงานเป็นผู้อนุมัติการใช้ยานพาหนะส่วนกลาง
--   ข้อ ๑๒ ว.๖ ผู้ใช้เป็นผู้บริหารท้องถิ่น ให้ทำบันทึกไว้เป็นลายลักษณ์อักษร (ใบ สก.๑ ในระบบ)
--
-- กติกาที่ไฟล์นี้รักษา:
--   (1) อปท. ที่ไม่มีแถวตั้งค่า / ตั้ง queue = ทำงานเหมือนเดิมทุกอย่าง (trigger แค่ตรึง permit_mode='queue')
--   (2) ไม่แตะ status / approved_by / approval_method / คิวรถ (#168/#169) และไม่ CREATE OR REPLACE ฟังก์ชันเดิมตัวใด
--   (3) "อนุญาตแล้ว" มาจากคนเท่านั้น: ลายเซ็นออนไลน์ช่องผู้มีอำนาจ (approve) / สก.๑ ของนายก หรือแถวบันทึกใบกระดาษ
--       ชื่อผู้อนุญาตดึงจากทะเบียนผู้ลงนามที่ฝั่งเซิร์ฟเวอร์ ไม่รับข้อความชื่อจาก client
--   (4) ไม่ใช้ my_fleet() ตรวจสิทธิ์ (superadmin municipality_id เป็น NULL → 403 เงียบ) ใช้ อปท. จากแถวทริปแทน

-- ด่านก่อนเริ่ม (NOTES ข้อ 3): ต้องรันไฟล์ตารางก่อน และฟังก์ชันที่พึ่งต้องมีครบ
-- plpgsql ไม่ตรวจการเรียกฟังก์ชันตอน CREATE — ขาดตัวไหนจะไปพังตอนใช้งานจริงในโหมด regulation
DO $guard$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.fleet_permit_settings') IS NULL OR to_regclass('public.fleet_trip_permits') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง fleet_permit_settings / fleet_trip_permits — ต้องรัน 20261121100000_fleet_permit_tables.sql ก่อน';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_trips' AND column_name = 'permit_mode'
  ) THEN
    RAISE EXCEPTION 'ไม่พบ fleet_trips.permit_mode — ต้องรัน 20261121100000_fleet_permit_tables.sql ก่อน';
  END IF;
  -- CREATE TABLE IF NOT EXISTS ข้ามเงียบถ้าตารางเคยถูกสร้างจากฉบับก่อนเพิ่ม content_hash → INSERT จะพังตอนใช้งานจริง
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_trip_permits' AND column_name = 'content_hash'
  ) THEN
    RAISE EXCEPTION 'fleet_trip_permits ไม่มีคอลัมน์ content_hash — ตารางเป็นฉบับเก่า ตรวจก่อนรันต่อ';
  END IF;
  SELECT string_agg(x, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'public.esign_is_tenant_admin(uuid)', 'public.esign_audit(uuid,text,text,text,text,jsonb)',
    'public.esign_is_mayor_position(text)', 'public.esign_trip_open_return(uuid)',
    'public.esign_expected_signer(public.fleet_trips,text)', 'public.esign_fleet_trip_payload(public.fleet_trips)',
    'public.esign_content_hash(jsonb)', 'public.fleet_is_manager(uuid)', 'public.fleet_can_read(uuid)',
    'public.fleet_can_read_asset(uuid,uuid)', 'public.get_my_municipality_id()', 'public.get_my_role()'
  ]) x
  WHERE to_regprocedure(x) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ไม่พบฟังก์ชันที่ต้องใช้: %', v_missing;
  END IF;
END;
$guard$;

-- ── 0) บันทึกเพิ่มได้อย่างเดียว ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_permit_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'FLEET_PERMIT_APPEND_ONLY: บันทึกการอนุญาตแก้ไขหรือลบไม่ได้ ให้บันทึกยกเลิกพร้อมเหตุผลแทน'
    USING ERRCODE = 'P0001';
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_permit_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_trip_permits_append_only ON public.fleet_trip_permits;
CREATE TRIGGER trg_fleet_trip_permits_append_only
BEFORE UPDATE OR DELETE ON public.fleet_trip_permits
FOR EACH ROW EXECUTE FUNCTION public.fleet_permit_block_mutation();
DROP TRIGGER IF EXISTS trg_fleet_trip_permits_no_truncate ON public.fleet_trip_permits;
CREATE TRIGGER trg_fleet_trip_permits_no_truncate
BEFORE TRUNCATE ON public.fleet_trip_permits
FOR EACH STATEMENT EXECUTE FUNCTION public.fleet_permit_block_mutation();

-- ── 1) ตัวช่วยภายใน (ไม่เปิดให้ API) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_permit_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (timezone('Asia/Bangkok', now()))::date
$$;
REVOKE ALL ON FUNCTION public.fleet_permit_today() FROM PUBLIC, anon, authenticated;

-- แถวทะเบียนผู้ลงนามที่มีผล ณ วันที่ p_at (document_type 'complaint' = ทะเบียนกลาง)
-- วันนี้ = แถวที่ยังใช้อยู่ (เหมือน esign_expected_signer)
-- ย้อนหลัง = รวมแถวที่ถูกปิดไปแล้ว ถ้าปิด (updated_at เวลาไทย) ในหรือหลังวันนั้น — set_document_signatory ปิดแถวเก่า
--   (is_active=false, updated_at=เวลาเปลี่ยน) ตอนตั้งคนใหม่ ไม่งั้นปลัดเซ็นวันศุกร์ เปลี่ยนคนวันจันทร์ จะบันทึกใบวันศุกร์ไม่ได้
--   ความละเอียดระดับวัน (ใบกระดาษมีแค่วันที่) วันที่เปลี่ยนคนได้ทั้งสองแถว เลือกแถวที่เริ่มมีผลทีหลัง/ตั้งทีหลัง
--   ใกล้เคียงกติกา pickSignatory({at}) / prepare_complaint_print ที่ละเอียดถึงเวลา
-- ไม่พบ = แถวที่ทุกคอลัมน์เป็น NULL (ตรวจด้วย (r).id IS NULL)
CREATE OR REPLACE FUNCTION public.fleet_permit_registry(
  p_municipality_id uuid,
  p_role            text,
  p_department_id   uuid,
  p_custom_label    text,
  p_at              date
)
RETURNS public.document_signatories
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.*
  FROM public.document_signatories s
  WHERE s.municipality_id = p_municipality_id
    AND s.document_type = 'complaint'
    AND s.signatory_role = p_role
    AND (
      (p_role = 'department_head' AND s.department_id = p_department_id)
      OR (p_role <> 'department_head' AND s.department_id IS NULL AND s.custom_label IS NOT DISTINCT FROM p_custom_label)
    )
    AND (
      s.is_active
      OR (p_at < public.fleet_permit_today() AND (timezone('Asia/Bangkok', s.updated_at))::date >= p_at)
    )
    AND s.effective_from <= p_at
    AND (s.effective_to IS NULL OR s.effective_to >= p_at)
  ORDER BY s.effective_from DESC, s.created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.fleet_permit_registry(uuid, text, uuid, text, date) FROM PUBLIC, anon, authenticated;

-- ชื่อ + ฐานะของแถวทะเบียน (ผูกบัญชี = ชื่อในโปรไฟล์ / พิมพ์เอง = manual_name)
CREATE OR REPLACE FUNCTION public.fleet_permit_signer_of(p_reg public.document_signatories, p_fallback_title text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
  v_pos  text;
BEGIN
  IF p_reg.id IS NULL THEN
    RETURN jsonb_build_object('registry_id', NULL, 'name', NULL, 'title', p_fallback_title, 'profile_id', NULL);
  END IF;
  IF p_reg.profile_id IS NOT NULL THEN
    SELECT NULLIF(btrim(pr.full_name), ''),
           btrim(COALESCE(NULLIF(btrim(pr.job_title), ''), pos.name, ''))
      INTO v_name, v_pos
    FROM public.profiles pr
    LEFT JOIN public.positions pos ON pos.id = pr.position_id
    WHERE pr.id = p_reg.profile_id;
  ELSE
    v_name := NULLIF(btrim(p_reg.manual_name), '');
  END IF;
  RETURN jsonb_build_object(
    'registry_id', p_reg.id,
    'name', v_name,
    'title', COALESCE(NULLIF(btrim(p_reg.title_override), ''), NULLIF(v_pos, ''), p_fallback_title),
    'profile_id', p_reg.profile_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_permit_signer_of(public.document_signatories, text) FROM PUBLIC, anon, authenticated;

-- ผู้ขอเป็นนายกไหม — ตำแหน่งตามที่ระบบลงนามใช้ (ช่องในคำขอ ถ้าว่างถอยไปตำแหน่งในโปรไฟล์) ไม่ให้สองระบบตัดสินต่างกัน
CREATE OR REPLACE FUNCTION public.fleet_permit_requester_is_mayor(p_trip public.fleet_trips)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.esign_is_mayor_position(public.esign_expected_signer(p_trip, 'requester') ->> 'position')
$$;
REVOKE ALL ON FUNCTION public.fleet_permit_requester_is_mayor(public.fleet_trips) FROM PUBLIC, anon, authenticated;

-- ผู้อนุญาตที่ควรเป็นของใบนี้ ณ วันที่ p_at (NULL = วันนี้)
-- kind = 'delegated_dept_head' เมื่อ อปท. เปิดการมอบ (ข้อ ๑๒ ว.๔) และกองของใบมีผู้ลงนามในทะเบียน และไม่ใช่ ผอ. ขอเอง
-- นอกนั้น kind = 'authority' (ผู้มีอำนาจตามช่องแบบ ๓ ของใบ: ไม่ได้เลือก = นายก) พร้อม fallback_reason บอกเหตุที่ไม่ใช้การมอบ
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
  v_dept      uuid := COALESCE(p_trip.dept_head_department_id, p_trip.department_id);
  v_reg       public.document_signatories;
  v_fallback  text;
  v_role      text := COALESCE(p_trip.order_authority_role, 'mayor');
  v_label     text;
BEGIN
  SELECT * INTO v_set FROM public.fleet_permit_settings s WHERE s.municipality_id = p_trip.municipality_id;

  IF FOUND AND v_set.delegate_dept_heads THEN
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
      ELSIF v_reg.profile_id IS NOT NULL AND v_reg.profile_id = v_requester THEN
        v_fallback := 'self_request';
      ELSE
        RETURN public.fleet_permit_signer_of(v_reg, 'ผู้อำนวยการสำนัก/กอง')
          || jsonb_build_object(
               'kind', 'delegated_dept_head',
               'department_id', v_dept,
               'delegation_ref', v_set.delegation_ref,
               'delegation_date', v_set.delegation_date,
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

-- สถานะการอนุญาตของใบ (คำนวณทุกครั้ง ไม่มีคอลัมน์เก็บ)
--   not_required = ใบโหมด queue (รวมใบเก่าทุกใบและบันทึกย้อนหลัง)
--   authorized   = มีบันทึกใบกระดาษที่ยังไม่ถูกยกเลิก หรือมีลายเซ็นออนไลน์ที่ยังไม่ถูกถอน:
--                  ช่องผู้มีอำนาจ decision='approve' หรือ สก.๑ เมื่อผู้ขอเป็นนายก (ข้อ ๑๒ ว.๖)
--                  (ใบกระดาษนับเฉพาะเมื่อเนื้อหาคำขอตอนนี้ตรงกับตอนบันทึก — content_hash)
--   modified     = มีบันทึกใบกระดาษ แต่เนื้อหาคำขอถูกแก้หลังบันทึก ⇒ ต้องขออนุญาตใหม่
--   returned     = ใบออนไลน์ถูกส่งคืนผู้ขอและยังค้าง
--   waiting      = นอกนั้น
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
BEGIN
  IF p_trip.permit_mode IS DISTINCT FROM 'regulation' THEN
    RETURN jsonb_build_object('state', 'not_required');
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
      'state', 'authorized', 'via', 'esign', 'slot', v_sig.slot,
      'signer_name', v_sig.signer_name, 'signer_title', NULLIF(v_sig.signed_as, ''),
      'signed_at', v_sig.signed_at
    );
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
    );
  END IF;

  IF (public.esign_trip_open_return(p_trip.id)).id IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'returned');
  END IF;
  RETURN jsonb_build_object('state', 'waiting');
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_permit_state(public.fleet_trips) FROM PUBLIC, anon, authenticated;

-- ── 2) trigger: ตรึงโหมดตอนยื่น + ไม่ให้บันทึกออกรถก่อนได้รับอนุญาต ─────────────────────────────
-- ชื่อ trg_fleet_trips_permit_guard เรียงหลัง trg_fleet_guard_trip_write / trg_fleet_trips_esign_guard /
-- trg_fleet_trips_guard_overlap (BEFORE trigger ทำงานตามลำดับชื่อ) ⇒ ตรวจหลังด่านสถานะและคิวเดิมผ่านแล้ว
CREATE OR REPLACE FUNCTION public.fleet_trip_permit_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_state jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- client ส่งค่ามาเองไม่รับ · บันทึกย้อนหลัง (completed) เป็นการจดหลังเหตุการณ์ = queue เสมอ
    IF NEW.status = 'completed' THEN
      NEW.permit_mode := 'queue';
    ELSE
      NEW.permit_mode := COALESCE(
        (SELECT s.permit_mode FROM public.fleet_permit_settings s WHERE s.municipality_id = NEW.municipality_id),
        'queue'
      );
    END IF;
    IF NEW.permit_mode = 'regulation' AND NEW.status = 'in_progress' THEN
      RAISE EXCEPTION 'FLEET_PERMIT_REQUIRED: ยังไม่ได้รับอนุญาตจากผู้มีอำนาจ บันทึกออกรถไม่ได้'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- โหมดของใบเปลี่ยนไม่ได้หลังยื่น (สลับโหมด อปท. แล้วใบที่ค้างใช้โหมดเดิมของตัวเอง)
  NEW.permit_mode := OLD.permit_mode;

  IF NEW.permit_mode = 'regulation'
     AND NEW.status = 'in_progress'
     AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    v_state := public.fleet_trip_permit_state(NEW);
    IF v_state ->> 'state' IS DISTINCT FROM 'authorized' THEN
      RAISE EXCEPTION 'FLEET_PERMIT_REQUIRED: ยังไม่ได้รับอนุญาตจากผู้มีอำนาจ บันทึกออกรถไม่ได้'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fleet_trip_permit_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fleet_trips_permit_guard ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trips_permit_guard
BEFORE INSERT OR UPDATE ON public.fleet_trips
FOR EACH ROW EXECUTE FUNCTION public.fleet_trip_permit_guard();

-- ── 3) RPC ค่าตั้ง (แอดมิน อปท. ตั้ง · ผู้ใช้โมดูลยานพาหนะอ่าน) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_permit_settings_get(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_set  public.fleet_permit_settings%ROWTYPE;
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL
     OR NOT (public.esign_is_tenant_admin(p_municipality_id) OR public.fleet_can_read(p_municipality_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT * INTO v_set FROM public.fleet_permit_settings s WHERE s.municipality_id = p_municipality_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'permit_mode', 'queue', 'delegate_dept_heads', false,
      'delegation_ref', NULL, 'delegation_date', NULL, 'updated_at', NULL, 'updated_by_name', NULL,
      'can_edit', public.esign_is_tenant_admin(p_municipality_id)
    );
  END IF;
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_set.updated_by;
  RETURN jsonb_build_object(
    'ok', true, 'permit_mode', v_set.permit_mode, 'delegate_dept_heads', v_set.delegate_dept_heads,
    'delegation_ref', v_set.delegation_ref, 'delegation_date', v_set.delegation_date,
    'updated_at', v_set.updated_at, 'updated_by_name', v_name,
    'can_edit', public.esign_is_tenant_admin(p_municipality_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fleet_permit_settings_set(
  p_municipality_id     uuid,
  p_permit_mode         text,
  p_delegate_dept_heads boolean,
  p_delegation_ref      text,
  p_delegation_date     date
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old  public.fleet_permit_settings%ROWTYPE;
  v_ref  text := NULLIF(btrim(COALESCE(p_delegation_ref, '')), '');
  v_del  boolean := COALESCE(p_delegate_dept_heads, false);
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_permit_mode IS NULL OR p_permit_mode NOT IN ('queue', 'regulation') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_mode');
  END IF;
  IF v_ref IS NOT NULL AND char_length(v_ref) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_delegation_ref');
  END IF;
  IF p_delegation_date IS NOT NULL AND p_delegation_date > public.fleet_permit_today() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_delegation_date');
  END IF;
  IF v_del AND (v_ref IS NULL OR p_delegation_date IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'delegation_evidence_required');
  END IF;
  -- ด่าน (กับดักแบบ NOTES ข้อ 13): ทะเบียนยังไม่มีนายกที่มีชื่อ ณ วันนี้ = ไม่มีใครอนุญาตได้เลย ใบทุกใบจะออกรถไม่ได้
  -- (ช่องผู้มีอำนาจของแบบ ๓ ไม่ได้เลือก = นายก) ⇒ ไม่ให้เปิด regulation จนกว่าจะตั้งผู้ลงนามช่องนายก
  IF p_permit_mode = 'regulation' AND NULLIF(btrim(public.fleet_permit_signer_of(
       public.fleet_permit_registry(p_municipality_id, 'mayor', NULL, NULL, public.fleet_permit_today()), NULL
     ) ->> 'name'), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_authority_missing');
  END IF;

  SELECT * INTO v_old FROM public.fleet_permit_settings s WHERE s.municipality_id = p_municipality_id FOR UPDATE;

  INSERT INTO public.fleet_permit_settings AS s (
    municipality_id, permit_mode, delegate_dept_heads, delegation_ref, delegation_date, updated_by, updated_at
  ) VALUES (
    p_municipality_id, p_permit_mode, v_del, v_ref, p_delegation_date, auth.uid(), now()
  )
  ON CONFLICT (municipality_id) DO UPDATE SET
    permit_mode = EXCLUDED.permit_mode,
    delegate_dept_heads = EXCLUDED.delegate_dept_heads,
    delegation_ref = EXCLUDED.delegation_ref,
    delegation_date = EXCLUDED.delegation_date,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  PERFORM public.esign_audit(
    p_municipality_id, 'fleet_permit_settings_updated', 'fleet_permit_settings', p_municipality_id::text,
    'ขั้นตอนขอใช้รถ',
    jsonb_build_object(
      'old', CASE WHEN v_old.municipality_id IS NULL THEN NULL ELSE jsonb_build_object(
        'permit_mode', v_old.permit_mode, 'delegate_dept_heads', v_old.delegate_dept_heads,
        'delegation_ref', v_old.delegation_ref, 'delegation_date', v_old.delegation_date) END,
      'new', jsonb_build_object(
        'permit_mode', p_permit_mode, 'delegate_dept_heads', v_del,
        'delegation_ref', v_ref, 'delegation_date', p_delegation_date)
    )
  );

  RETURN public.fleet_permit_settings_get(p_municipality_id);
END;
$$;

-- ── 4) RPC สถานะการอนุญาตรายใบ (หน้ารายการ/รายละเอียดทริป) ───────────────────────────────────
-- เห็นเฉพาะใบที่ผู้เรียกอ่านได้ตาม policy fleet_trips_select (ใช้ อปท. จากแถว ไม่ใช้ my_fleet) หรือแอดมิน อปท.
CREATE OR REPLACE FUNCTION public.fleet_trip_permit_info(p_trip_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_items   jsonb := '[]'::jsonb;
  v_trip    public.fleet_trips%ROWTYPE;
  v_state   jsonb;
  v_manager boolean;
  v_open    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_trip_ids IS NULL OR cardinality(p_trip_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'items', v_items);
  END IF;
  IF cardinality(p_trip_ids) > 300 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many');
  END IF;

  FOR v_trip IN
    SELECT t.*
    FROM public.fleet_trips t
    WHERE t.id = ANY (p_trip_ids)
      AND (
        public.fleet_can_read_asset(t.municipality_id, t.vehicle_id)
        OR public.esign_is_tenant_admin(t.municipality_id)
        OR (t.municipality_id = public.get_my_municipality_id() AND v_uid IN (t.driver_id, t.requested_by, t.created_by))
      )
  LOOP
    IF v_trip.permit_mode IS DISTINCT FROM 'regulation' THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'trip_id', v_trip.id, 'permit_mode', 'queue', 'state', 'not_required'));
      CONTINUE;
    END IF;
    v_state := public.fleet_trip_permit_state(v_trip);
    v_manager := public.fleet_is_manager(v_trip.municipality_id);
    v_open := v_trip.status IN ('pending', 'waitlisted', 'approved');
    v_items := v_items || jsonb_build_array(
      v_state || jsonb_build_object(
        'trip_id', v_trip.id,
        'permit_mode', 'regulation',
        'approver', public.fleet_trip_permit_approver(v_trip, NULL),
        'can_record', v_manager AND v_open AND (v_state ->> 'state') <> 'authorized',
        'can_void', v_manager AND v_open AND (v_state ->> 'via') IS NOT DISTINCT FROM 'paper'
      )
    );
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

-- ── 5) RPC บันทึก/ยกเลิกการอนุญาตจากใบกระดาษ (ผู้ดูแลรถ) ─────────────────────────────────────────
-- p_basis: 'authority' (ผู้มีอำนาจตามช่องแบบ ๓) หรือ 'delegated_dept_head' (ผอ.สำนัก/กองที่ได้รับมอบ)
-- ชื่อ/ฐานะผู้อนุญาตมาจากทะเบียนผู้ลงนาม ณ วันที่ลงนาม ไม่รับจาก client
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
  IF (public.fleet_trip_permit_state(v_trip) ->> 'state') = 'authorized' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_authorized');
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
                       'self_recorded', COALESCE(auth.uid() IN (v_trip.requested_by, v_trip.created_by), false))
  );
  RETURN jsonb_build_object('ok', true, 'permit_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fleet_void_paper_permit(p_permit_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_permit   public.fleet_trip_permits%ROWTYPE;
  v_trip     public.fleet_trips%ROWTYPE;
  v_reason   text := btrim(COALESCE(p_reason, ''));
  v_rec_name text;
  v_id       uuid;
BEGIN
  IF auth.uid() IS NULL OR p_permit_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT * INTO v_permit FROM public.fleet_trip_permits g WHERE g.id = p_permit_id AND g.kind = 'granted';
  IF NOT FOUND OR NOT public.fleet_is_manager(v_permit.municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT * INTO v_trip FROM public.fleet_trips t WHERE t.id = v_permit.trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  -- ออกรถไปแล้ว = การอนุญาตนั้นถูกใช้ไปแล้ว เก็บไว้เป็นหลักฐาน ห้ามยกเลิกย้อนหลัง
  IF v_trip.status NOT IN ('pending', 'waitlisted', 'approved') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_status');
  END IF;
  IF EXISTS (SELECT 1 FROM public.fleet_trip_permits v WHERE v.voids_id = v_permit.id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_voided');
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_reason');
  END IF;

  SELECT p.full_name INTO v_rec_name FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.fleet_trip_permits (municipality_id, trip_id, kind, voids_id, reason, recorded_by, recorded_by_name)
  VALUES (v_permit.municipality_id, v_permit.trip_id, 'voided', v_permit.id, v_reason, auth.uid(), COALESCE(v_rec_name, ''))
  RETURNING id INTO v_id;

  -- เหตุผลเป็นข้อความอิสระ ไม่ใส่ลง audit metadata (เก็บในตารางที่ RLS ปิดแล้ว)
  PERFORM public.esign_audit(
    v_permit.municipality_id, 'fleet_permit_voided', 'fleet_trip', v_permit.trip_id::text, 'ยกเลิกบันทึกการอนุญาตใช้รถ',
    jsonb_build_object('permit_id', v_permit.id, 'void_id', v_id)
  );
  RETURN jsonb_build_object('ok', true, 'void_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fleet_permit_settings_get(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_permit_settings_set(uuid, text, boolean, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_trip_permit_info(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_record_paper_permit(uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_void_paper_permit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_permit_settings_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_permit_settings_set(uuid, text, boolean, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_trip_permit_info(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_record_paper_permit(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_void_paper_permit(uuid, text) TO authenticated;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select tgname from pg_trigger where tgrelid = 'public.fleet_trips'::regclass and not tgisinternal order by 1;
--     → มี trg_fleet_trips_permit_guard ต่อท้าย trg_fleet_trips_guard_overlap
--   select has_function_privilege('anon', 'public.fleet_trip_permit_info(uuid[])', 'execute');   → false
--   select count(*) from public.fleet_trips where permit_mode <> 'queue';                          → 0

-- ให้ PostgREST เห็นฟังก์ชันใหม่ทันที (ไม่ต้องรอรอบ reload ของมันเอง)
NOTIFY pgrst, 'reload schema';
