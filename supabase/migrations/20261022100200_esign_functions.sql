-- 20261022100200_esign_functions.sql
--
-- [เฟสฟังก์ชัน] ลงนามออนไลน์รายเรื่อง (ชุด A เฟส ๑) — RLS, trigger, ฟังก์ชัน ต้อง apply หลัง 20261022100000 และ 20261022100100
-- ฟังก์ชันใหม่ล้วน ไม่มี CREATE OR REPLACE ทับของเดิม (NOTES.md ข้อ 5) ไม่แก้ฟังก์ชัน/trigger ที่มีอยู่แม้แต่ตัวเดียว
-- ทดสอบพฤติกรรมด้วย PostgreSQL จำลอง: tests/esign-db.test.mjs
--
-- ── ภาพรวม ───────────────────────────────────────────────────────────────────────────────────
-- เรื่องเดียวที่รองรับ: ใบขออนุญาตใช้ยานพาหนะ แบบ ๓ พร้อมบันทึกรับรอง สก.๑ (doc_type = 'fleet_trip_request')
-- ช่องลงนามที่ออนไลน์ได้ ๔ ช่อง: requester (ผู้ขอ) · dept_head (ผอ.กอง/ผู้แทน) · authority (ผู้มีอำนาจสั่งใช้) · sk1 (สก.๑ — นายกลงนามเอง)
-- ช่อง "ผู้ขับรถ" ไม่อยู่ในระบบลงนาม (ผู้ขับถูกกำหนดทีหลังการขอ) — เซ็นสดต่อไป
-- ลำดับ: requester → dept_head → authority (ช่องที่ตั้งเป็นเซ็นสดหรือไม่เข้าเงื่อนไขถูกข้าม) · sk1 ไม่ขึ้นกับลำดับ
--
-- ── สิ่งที่ฟังก์ชันชุดนี้ "ไม่ทำ" (เส้นที่ห้ามข้าม — AGENTS.md ระบบอัจฉริยะ) ───────────────────────
-- ไม่ลงนามแทนใคร: ผู้ลงนามต้องเป็นบัญชีเดียวกับตัวบุคคลที่ทะเบียนผู้ลงนามกลาง/คำขอระบุ และใส่รหัสลงนามของตัวเอง
-- ไม่ตัดสินอนุญาตแทนคน · ไม่แตะ approved_by / approval_method ของทริปเลย (คิวอัตโนมัติ #168/#169 คนละเรื่องกับลายเซ็น)
-- ไม่เปิดสวิตช์ให้ อปท. เอง: ไม่มีแถวใน esign_doc_type_settings = ทุกทริปเป็นเซ็นสดเหมือนเดิมทุกประการ
--
-- ── ผลต่อของที่ใช้งานอยู่ (ก่อนมีแอดมินเปิดสวิตช์) ───────────────────────────────────────────────
-- trigger ตัวเดียวบน fleet_trips (trg_fleet_trips_esign_guard):
--   INSERT  อ่านตารางตั้งค่า ไม่เจอแถว = ไม่ทำอะไร · ทุกอย่างในนั้นห่อด้วย EXCEPTION → ผิดพลาดก็ถือว่าเซ็นสด ไม่ทำให้สร้างทริปไม่ได้
--   UPDATE  คืนค่าคอลัมน์ esign_* ตามเดิม · ทริปที่ไม่ใช่โหมดออนไลน์ผ่านทันที ไม่คิดอะไรเพิ่ม
--   DELETE  ทริปที่ไม่มีลายเซ็นผ่านทันที
-- ชื่อ trigger เรียงอยู่หลัง trg_fleet_trip_requester_snapshot/trg_fleet_guard_trip_write และก่อน trg_fleet_trips_guard_overlap
-- เนื้อหา "คำขอ" ที่ล็อกหลังลงนาม ไม่รวมฟิลด์ที่เปลี่ยนตามการเดินทาง (รถ ผู้ขับ เวลาออกจริง เลขไมล์ สถานะ) ทริปจึงเดินต่อได้ปกติ
--
-- ── ความปลอดภัย ──────────────────────────────────────────────────────────────────────────────
-- รหัสลงนาม 6 หลัก เก็บเป็น bcrypt (pgcrypto ใน schema extensions) ผิด 5 ครั้งล็อก 15 นาที · ตอบเป็นค่าคืน ไม่ raise
-- เพื่อให้ตัวนับครั้งที่ผิด commit ได้ (ถ้า raise ธุรกรรมจะ rollback แล้วตัวนับไม่ขยับ)
-- ฟังก์ชันสาธารณะ esign_verify ใช้ rpc_rate_limit_hit เดิม ตอบ found:false แบบเดียวกันทุกกรณี และไม่ส่ง id/ปลายทาง/วัตถุประสงค์
-- ฟังก์ชันภายในทุกตัว REVOKE จาก PUBLIC/anon/authenticated

DO $guard$
BEGIN
  IF to_regclass('public.esign_signatures') IS NULL OR to_regclass('public.esign_signers') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261022100100_esign_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL OR to_regprocedure('extensions.gen_salt(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ extensions.crypt / extensions.gen_salt (pgcrypto ใน schema extensions) — ตรวจ schema ของ extension ก่อน apply';
  END IF;
  IF to_regprocedure('public.rpc_rate_limit_hit(text,integer,interval)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ rpc_rate_limit_hit — ต้องรัน 20260905170000 ก่อน';
  END IF;
  IF to_regprocedure('public.fleet_can_read(uuid)') IS NULL OR to_regprocedure('public.fleet_is_manager(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ fleet_can_read / fleet_is_manager';
  END IF;
END;
$guard$;

-- ── 1) RLS และสิทธิ์ ─────────────────────────────────────────────────────────────────────────
-- เขียนได้ทางฟังก์ชัน SECURITY DEFINER เท่านั้น (ไม่มี INSERT/UPDATE/DELETE grant ให้ใคร)
-- esign_signers เก็บ pin_hash จึงไม่มี policy และไม่ GRANT SELECT เลย — อ่านสถานะของตัวเองผ่าน esign_my_signer_state()
ALTER TABLE public.esign_tenant_policy     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_doc_type_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_signers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_signatures        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_revocations       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.esign_tenant_policy, public.esign_doc_type_settings, public.esign_signers,
  public.esign_signatures, public.esign_revocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.esign_tenant_policy, public.esign_doc_type_settings,
  public.esign_signatures, public.esign_revocations TO authenticated;

DROP POLICY IF EXISTS "admin read esign tenant policy" ON public.esign_tenant_policy;
CREATE POLICY "admin read esign tenant policy" ON public.esign_tenant_policy
FOR SELECT TO authenticated
USING (
  public.get_my_role() = 'superadmin'
  OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
);

DROP POLICY IF EXISTS "fleet staff read esign doc type settings" ON public.esign_doc_type_settings;
CREATE POLICY "fleet staff read esign doc type settings" ON public.esign_doc_type_settings
FOR SELECT TO authenticated
USING (public.fleet_can_read(municipality_id));

-- doc_type มีค่าเดียว (fleet_trip_request) จึงตรวจสิทธิ์ด้วยสิทธิ์อ่านยานพาหนะ — เพิ่มประเภทเอกสารใหม่ต้องแก้ policy นี้ด้วย
DROP POLICY IF EXISTS "fleet staff read esign signatures" ON public.esign_signatures;
CREATE POLICY "fleet staff read esign signatures" ON public.esign_signatures
FOR SELECT TO authenticated
USING (doc_type = 'fleet_trip_request' AND public.fleet_can_read(municipality_id));

DROP POLICY IF EXISTS "fleet staff read esign revocations" ON public.esign_revocations;
CREATE POLICY "fleet staff read esign revocations" ON public.esign_revocations
FOR SELECT TO authenticated
USING (public.fleet_can_read(municipality_id));

-- ── 2) ดัชนีและข้อบังคับของคอลัมน์ใหม่บน fleet_trips ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS esign_signatures_doc_idx
  ON public.esign_signatures (doc_type, doc_id, slot, signed_at DESC);
CREATE INDEX IF NOT EXISTS esign_signatures_muni_time_idx
  ON public.esign_signatures (municipality_id, signed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS fleet_trips_esign_verify_code_key
  ON public.fleet_trips (esign_verify_code) WHERE esign_verify_code IS NOT NULL;

ALTER TABLE public.fleet_trips DROP CONSTRAINT IF EXISTS fleet_trips_esign_code_format;
ALTER TABLE public.fleet_trips ADD CONSTRAINT fleet_trips_esign_code_format
  CHECK (esign_verify_code IS NULL OR esign_verify_code ~ '^[0-9a-f]{32}$');

-- สองคอลัมน์ออกมาเป็นคู่เสมอ (ทริปโหมดออนไลน์ต้องมีรหัสตรวจสอบ ทริปเซ็นสดต้องไม่มี)
ALTER TABLE public.fleet_trips DROP CONSTRAINT IF EXISTS fleet_trips_esign_pair;
ALTER TABLE public.fleet_trips ADD CONSTRAINT fleet_trips_esign_pair
  CHECK ((esign_slots IS NULL) = (esign_verify_code IS NULL));

-- ── 3) ลายเซ็นและการถอนแก้/ลบไม่ได้ ───────────────────────────────────────────────────────────
-- ใช้ trigger (ไม่ใช่แค่ REVOKE) เพราะเจ้าของตาราง/service_role ยังแก้ได้ถ้าไม่มีด่านนี้
-- ลายเซ็นที่ผิดแก้ด้วยการ "ถอน" แล้วลงใหม่ ไม่ใช่การแก้แถวเดิม
CREATE OR REPLACE FUNCTION public.esign_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'ESIGN_APPEND_ONLY: % ของ % ทำไม่ได้ — หลักฐานการลงนามเพิ่มได้อย่างเดียว', TG_OP, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_esign_signatures_append_only ON public.esign_signatures;
CREATE TRIGGER trg_esign_signatures_append_only
BEFORE UPDATE OR DELETE ON public.esign_signatures
FOR EACH ROW EXECUTE FUNCTION public.esign_block_mutation();
DROP TRIGGER IF EXISTS trg_esign_signatures_no_truncate ON public.esign_signatures;
CREATE TRIGGER trg_esign_signatures_no_truncate
BEFORE TRUNCATE ON public.esign_signatures
FOR EACH STATEMENT EXECUTE FUNCTION public.esign_block_mutation();

DROP TRIGGER IF EXISTS trg_esign_revocations_append_only ON public.esign_revocations;
CREATE TRIGGER trg_esign_revocations_append_only
BEFORE UPDATE OR DELETE ON public.esign_revocations
FOR EACH ROW EXECUTE FUNCTION public.esign_block_mutation();
DROP TRIGGER IF EXISTS trg_esign_revocations_no_truncate ON public.esign_revocations;
CREATE TRIGGER trg_esign_revocations_no_truncate
BEFORE TRUNCATE ON public.esign_revocations
FOR EACH STATEMENT EXECUTE FUNCTION public.esign_block_mutation();

REVOKE ALL ON FUNCTION public.esign_block_mutation() FROM PUBLIC, anon, authenticated;

-- ── 4) ตัวช่วยภายใน (ไม่เปิดให้ API) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esign_audit(
  p_municipality_id uuid,
  p_action          text,
  p_resource_type   text,
  p_resource_id     text,
  p_label           text,
  p_metadata        jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
  v_role text;
BEGIN
  SELECT p.full_name, p.role INTO v_name, v_role FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    p_municipality_id, auth.uid(), v_name, v_role, p_action,
    p_resource_type, p_resource_id, p_label, p_metadata
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_is_tenant_admin(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND public.get_my_municipality_id() = p_municipality_id),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.esign_slot_label(p_slot text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE p_slot
    WHEN 'requester' THEN 'ผู้ขออนุญาต'
    WHEN 'dept_head' THEN 'ผู้อำนวยการสำนัก/กอง หรือผู้แทน'
    WHEN 'authority' THEN 'ผู้มีอำนาจสั่งใช้ยานพาหนะ'
    WHEN 'sk1'       THEN 'ผู้บริหารท้องถิ่น (บันทึกรับรอง สก.๑)'
    ELSE p_slot
  END
$$;

-- เหมือน MAYOR_POSITION ใน src/lib/fleetTripPrint.js: ขึ้นต้น "นายก" แต่ไม่ใช่ "นายกรัฐมนตรี" (รองนายกไม่เข้า)
CREATE OR REPLACE FUNCTION public.esign_is_mayor_position(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(btrim(p_text) ~ '^นายก(?!รัฐมนตรี)', false)
$$;

-- เนื้อหา "คำขอ" ที่ลายเซ็นรับรอง — เฉพาะสิ่งที่ผู้ขออนุญาตกรอกก่อนเดินทาง
-- ไม่รวมฟิลด์ที่เปลี่ยนตามการเดินทางจริง (รถ ผู้ขับ เวลาออก/กลับจริง เลขไมล์ สถานะ) ไม่งั้นเริ่มทริปแล้วลายเซ็นพัง
-- เวลาแปลงเป็น UTC ในสตริงรูปแบบคงที่ ไม่ให้ hash เพี้ยนตาม timezone ของ session
CREATE OR REPLACE FUNCTION public.esign_fleet_trip_payload(p_trip public.fleet_trips)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'template', 'fleet-form3-v1',
    'trip_id', p_trip.id,
    'municipality_id', p_trip.municipality_id,
    'requested_by', COALESCE(p_trip.requested_by, p_trip.created_by),
    'requester_position', btrim(COALESCE(p_trip.requester_position, '')),
    'destination', btrim(COALESCE(p_trip.destination, '')),
    'destination_locality', btrim(COALESCE(p_trip.destination_locality, '')),
    'destination_province', btrim(COALESCE(p_trip.destination_province, '')),
    'purpose', btrim(COALESCE(p_trip.purpose, '')),
    'passengers', p_trip.passengers,
    'planned_departure', to_char(p_trip.planned_departure AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'planned_return', to_char(p_trip.planned_return AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'document_date', to_char(p_trip.document_date, 'YYYY-MM-DD'),
    'dept_head_department_id', p_trip.dept_head_department_id,
    'order_authority_role', p_trip.order_authority_role,
    'order_authority_label', p_trip.order_authority_label
  )
$$;

CREATE OR REPLACE FUNCTION public.esign_content_hash(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex')
$$;

-- ผู้ลงนามที่ควรเป็นของช่องนั้นของทริปนั้น ณ ตอนนี้
-- requester/sk1 = ผู้ขอตัวจริง (requested_by, ถอยไป created_by เหมือนฟังก์ชันพิมพ์) · dept_head/authority = แถวที่มีผลวันนี้
-- ในทะเบียนผู้ลงนามกลาง (กติกาเดียวกับ pickSignatory ไม่ส่ง at: ลงนามตอนนี้ = คนที่ดำรงตำแหน่งตอนนี้)
-- ทะเบียนเป็นชื่อพิมพ์เอง (profile_id ว่าง) ลงนามออนไลน์ไม่ได้ → reason = signatory_not_linked
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

  RETURN jsonb_build_object(
    'user_id', v_reg.profile_id,
    'position', COALESCE(v_pos, ''),
    'signed_as', v_title,
    'registry_id', v_reg.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.esign_audit(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_is_tenant_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_slot_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_is_mayor_position(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_fleet_trip_payload(public.fleet_trips) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_content_hash(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_expected_signer(public.fleet_trips, text) FROM PUBLIC, anon, authenticated;

-- ── 5) trigger บน fleet_trips: ตรึงโหมดตอนสร้าง + ล็อกเนื้อหาคำขอหลังมีลายเซ็น ─────────────────────
-- ทุกเส้นทางมี RETURN (NOTES.md ข้อ 5)
CREATE OR REPLACE FUNCTION public.esign_fleet_trip_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_modes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- client ส่งค่าเองมาก็ไม่รับ: ทริปเป็นโหมดออนไลน์ได้ทางเดียวคือ อปท. เปิดสวิตช์ไว้ตอนสร้าง
    NEW.esign_slots := NULL;
    NEW.esign_verify_code := NULL;
    BEGIN
      -- บันทึกย้อนหลัง (completed) เป็นการจดหลังเหตุการณ์ ขออนุญาตไปแล้วบนกระดาษ ไม่เข้าระบบลงนามออนไลน์
      IF NEW.status IS DISTINCT FROM 'completed' THEN
        SELECT s.slot_modes INTO v_modes
        FROM public.esign_doc_type_settings s
        WHERE s.municipality_id = NEW.municipality_id AND s.doc_type = 'fleet_trip_request';
        IF v_modes IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_each_text(v_modes) e WHERE e.value = 'online'
        ) THEN
          NEW.esign_slots := v_modes;
          NEW.esign_verify_code := replace(gen_random_uuid()::text, '-', '');
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- ระบบลงนามเสียห้ามทำให้สร้างทริปไม่ได้ — ถือว่าเซ็นสดเหมือนก่อนมีระบบนี้
      RAISE WARNING 'esign stamp skipped (%): %', SQLSTATE, SQLERRM;
      NEW.esign_slots := NULL;
      NEW.esign_verify_code := NULL;
    END;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.esign_slots := OLD.esign_slots;
    NEW.esign_verify_code := OLD.esign_verify_code;
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

  -- DELETE: ทริปที่เคยมีลายเซ็น (แม้ถอนแล้ว) ลบไม่ได้ ใช้ "ยกเลิก" แทน
  IF EXISTS (
    SELECT 1 FROM public.esign_signatures s WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'ESIGN_TRIP_HAS_SIGNATURES: ทริปที่เคยมีลายเซ็นลบไม่ได้ ให้ยกเลิกแทน';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_fleet_trips_esign_guard ON public.fleet_trips;
CREATE TRIGGER trg_fleet_trips_esign_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.fleet_trips
FOR EACH ROW EXECUTE FUNCTION public.esign_fleet_trip_guard();

REVOKE ALL ON FUNCTION public.esign_fleet_trip_guard() FROM PUBLIC, anon, authenticated;

-- ── 6) แอดมิน อปท.: ประตูและสวิตช์ ───────────────────────────────────────────────────────────
-- ทุกฟังก์ชันตอบ {ok, code} ไม่ raise (ยกเว้นผู้ใช้ไม่ล็อกอิน/สิทธิ์ไม่พอที่ตอบ forbidden)

-- G1: ประกาศของ อปท. + หนังสือให้ความเห็นชอบ (หรือคำชี้แจงว่าไม่ต้องขอ) ตาม พ.ร.ฎ.ธุรกรรมอิเล็กทรอนิกส์ภาครัฐ ม.๗
CREATE OR REPLACE FUNCTION public.set_esign_policy(
  p_municipality_id   uuid,
  p_announcement_no   text,
  p_announcement_date date,
  p_approval_ref      text,
  p_announcement_url  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_no   text := btrim(COALESCE(p_announcement_no, ''));
  v_ref  text := btrim(COALESCE(p_approval_ref, ''));
  v_url  text := NULLIF(btrim(COALESCE(p_announcement_url, '')), '');
  v_today date := (timezone('Asia/Bangkok', now()))::date;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF char_length(v_no) < 1 OR char_length(v_no) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_announcement_no');
  END IF;
  IF p_announcement_date IS NULL OR p_announcement_date > v_today THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_announcement_date');
  END IF;
  IF char_length(v_ref) < 3 OR char_length(v_ref) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_approval_ref');
  END IF;
  IF v_url IS NOT NULL AND (char_length(v_url) > 1000 OR v_url !~* '^https?://') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_announcement_url');
  END IF;

  INSERT INTO public.esign_tenant_policy AS t
    (municipality_id, announcement_no, announcement_date, approval_ref, announcement_url, adopted_by)
  VALUES (p_municipality_id, v_no, p_announcement_date, v_ref, v_url, auth.uid())
  ON CONFLICT (municipality_id) DO UPDATE
    SET announcement_no = EXCLUDED.announcement_no,
        announcement_date = EXCLUDED.announcement_date,
        approval_ref = EXCLUDED.approval_ref,
        announcement_url = EXCLUDED.announcement_url,
        adopted_by = EXCLUDED.adopted_by,
        updated_at = now();

  PERFORM public.esign_audit(p_municipality_id, 'esign_set_policy', 'esign_policy', p_municipality_id::text, v_no,
    jsonb_build_object('announcement_date', p_announcement_date, 'approval_ref', v_ref));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- G4: แอดมินยืนยันว่าผู้ลงนามได้ลองใช้ชุดทดสอบแล้ว (หน้าจอชุดทดสอบมาในชุด B — ตรงนี้เก็บเฉพาะคำยืนยัน)
CREATE OR REPLACE FUNCTION public.esign_confirm_trial(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  UPDATE public.esign_tenant_policy
     SET trial_confirmed_at = now(), updated_at = now()
   WHERE municipality_id = p_municipality_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_policy_missing');
  END IF;
  PERFORM public.esign_audit(p_municipality_id, 'esign_confirm_trial', 'esign_policy', p_municipality_id::text, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ตรวจว่ามีผู้ลงนามที่ผูกบัญชีจริงอยู่ในทะเบียน (วันนี้) สำหรับบทบาทเหล่านั้นหรือไม่ — ใช้เป็นประตู G2 ตอนเปิดสวิตช์
CREATE OR REPLACE FUNCTION public.esign_registry_linked_count(p_municipality_id uuid, p_roles text[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::int
  FROM public.document_signatories s
  WHERE s.municipality_id = p_municipality_id
    AND s.document_type = 'complaint'
    AND s.signatory_role = ANY (p_roles)
    AND s.is_active
    AND s.profile_id IS NOT NULL
    AND s.effective_from <= (timezone('Asia/Bangkok', now()))::date
    AND (s.effective_to IS NULL OR s.effective_to >= (timezone('Asia/Bangkok', now()))::date)
$$;

-- เปิด/ปิดลงนามออนไลน์ของเรื่องหนึ่ง และเลือกรายช่อง · p_slot_modes NULL หรือไม่มีช่องไหนเป็น online = ปิด (ลบแถว)
-- ปิดสวิตช์มีผลกับคำขอใหม่เท่านั้น: ทริปที่สร้างไปแล้วคงโหมดเดิมที่ตรึงไว้ ลายเซ็นเดิมยังตรวจสอบได้
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
  v_policy  public.esign_tenant_policy%ROWTYPE;
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

  -- ประตู: G1 ประกาศ · G4 ทดลองแล้ว · G2 ผู้ลงนามของช่องที่เลือกออนไลน์ต้องผูกบัญชีจริง
  SELECT * INTO v_policy FROM public.esign_tenant_policy WHERE municipality_id = p_municipality_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_policy_missing');
  END IF;
  IF v_policy.trial_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_trial_missing');
  END IF;
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

-- สถานะประตูสำหรับหน้าตั้งค่า (แอดมิน/ผู้ดูแลระบบยานพาหนะ อ่านได้)
CREATE OR REPLACE FUNCTION public.esign_gate_status(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_policy public.esign_tenant_policy%ROWTYPE;
  v_modes  jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL
     OR NOT (public.esign_is_tenant_admin(p_municipality_id) OR public.fleet_can_read(p_municipality_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT * INTO v_policy FROM public.esign_tenant_policy WHERE municipality_id = p_municipality_id;
  SELECT s.slot_modes INTO v_modes
  FROM public.esign_doc_type_settings s
  WHERE s.municipality_id = p_municipality_id AND s.doc_type = 'fleet_trip_request';
  RETURN jsonb_build_object(
    'ok', true,
    'policy', CASE WHEN v_policy.municipality_id IS NULL THEN NULL ELSE jsonb_build_object(
      'announcement_no', v_policy.announcement_no,
      'announcement_date', v_policy.announcement_date,
      'approval_ref', v_policy.approval_ref,
      'announcement_url', v_policy.announcement_url,
      'trial_confirmed_at', v_policy.trial_confirmed_at
    ) END,
    'slot_modes', v_modes,
    'authority_linked', public.esign_registry_linked_count(p_municipality_id, ARRAY['mayor', 'clerk', 'custom']),
    'dept_head_linked', public.esign_registry_linked_count(p_municipality_id, ARRAY['department_head'])
  );
END;
$$;

-- ── 7) ผู้ลงนาม: รหัสลงนาม สถานะ ระงับ ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esign_my_signer_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s public.esign_signers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('pin_set', false, 'duty_acked', false, 'suspended', false, 'locked_until', NULL);
  END IF;
  SELECT * INTO v_s FROM public.esign_signers WHERE user_id = auth.uid();
  RETURN jsonb_build_object(
    'pin_set', COALESCE(v_s.pin_hash IS NOT NULL, false),
    'duty_acked', COALESCE(v_s.duty_ack_at IS NOT NULL, false),
    'suspended', COALESCE(v_s.suspended_at IS NOT NULL, false),
    'locked_until', CASE WHEN v_s.locked_until > now() THEN v_s.locked_until ELSE NULL END
  );
END;
$$;

-- ตั้ง/เปลี่ยนรหัสลงนาม 6 หลัก · ครั้งแรกต้องกดรับทราบหน้าที่ของเจ้าของลายมือชื่อ (พ.ร.บ.ธุรกรรมฯ ม.๒๗)
-- เปลี่ยนรหัสต้องใส่รหัสเดิม (ใช้ตัวนับผิด/ล็อกชุดเดียวกับตอนลงนาม)
CREATE OR REPLACE FUNCTION public.set_esign_pin(
  p_pin         text,
  p_current_pin text DEFAULT NULL,
  p_ack_duty    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_s    public.esign_signers%ROWTYPE;
  v_muni uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.rpc_rate_limit_hit('esign_pin', 10, interval '5 minutes') THEN
    RAISE EXCEPTION 'ลองถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;
  IF COALESCE(public.get_my_role(), '') NOT IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  -- ต้องเป็นตัวเลข 6 หลัก และไม่ใช่รหัสที่เดาง่าย (เลขซ้ำทั้งชุด หรือเรียงติดกัน)
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_pin');
  END IF;
  IF p_pin ~ '^(.)\1{5}$' OR p_pin IN ('012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321', '543210') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'weak_pin');
  END IF;

  SELECT * INTO v_s FROM public.esign_signers WHERE user_id = v_uid FOR UPDATE;
  IF FOUND AND v_s.pin_hash IS NOT NULL THEN
    IF v_s.locked_until IS NOT NULL AND v_s.locked_until > now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'pin_locked', 'locked_until', v_s.locked_until);
    END IF;
    IF p_current_pin IS NULL OR extensions.crypt(p_current_pin, v_s.pin_hash) <> v_s.pin_hash THEN
      UPDATE public.esign_signers
         SET failed_count = failed_count + 1,
             locked_until = CASE WHEN failed_count + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
             updated_at = now()
       WHERE user_id = v_uid;
      RETURN jsonb_build_object('ok', false, 'code', 'bad_pin');
    END IF;
  END IF;

  IF (NOT FOUND OR v_s.duty_ack_at IS NULL) AND NOT COALESCE(p_ack_duty, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duty_ack_required');
  END IF;

  INSERT INTO public.esign_signers AS s (user_id, pin_hash, pin_set_at, duty_ack_at, duty_ack_version)
  VALUES (v_uid, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now(),
          CASE WHEN COALESCE(p_ack_duty, false) THEN now() END,
          CASE WHEN COALESCE(p_ack_duty, false) THEN 'v1' END)
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        pin_set_at = EXCLUDED.pin_set_at,
        failed_count = 0,
        locked_until = NULL,
        duty_ack_at = COALESCE(s.duty_ack_at, EXCLUDED.duty_ack_at),
        duty_ack_version = COALESCE(s.duty_ack_version, EXCLUDED.duty_ack_version),
        updated_at = now();

  PERFORM public.esign_audit(v_muni, 'esign_set_pin', 'esign_signer', v_uid::text, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- "ระงับการลงนามของฉัน" — ใช้ทันทีเมื่อสงสัยว่ารหัสรั่ว ไม่ต้องใส่รหัส (ม.๒๗ ให้เจ้าของแจ้งโดยมิชักช้า)
-- เปิดคืนได้โดยแอดมิน อปท. เท่านั้น (esign_reinstate_signer)
CREATE OR REPLACE FUNCTION public.esign_suspend_me(p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_muni   uuid;
  v_reason text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 500);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  INSERT INTO public.esign_signers AS s (user_id, suspended_at, suspended_reason)
  VALUES (v_uid, now(), v_reason)
  ON CONFLICT (user_id) DO UPDATE
    SET suspended_at = COALESCE(s.suspended_at, now()),
        suspended_reason = COALESCE(s.suspended_reason, EXCLUDED.suspended_reason),
        updated_at = now();
  PERFORM public.esign_audit(v_muni, 'esign_suspend', 'esign_signer', v_uid::text, NULL,
    jsonb_build_object('reason', v_reason));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_reinstate_signer(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_muni uuid;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND OR v_muni IS NULL OR NOT public.esign_is_tenant_admin(v_muni) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  UPDATE public.esign_signers
     SET suspended_at = NULL, suspended_reason = NULL, failed_count = 0, locked_until = NULL, updated_at = now()
   WHERE user_id = p_user_id;
  PERFORM public.esign_audit(v_muni, 'esign_reinstate', 'esign_signer', p_user_id::text, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 8) สถานะลายเซ็นของทริป (หน้าจอใช้แสดงช่อง/ปุ่มลงนาม) ──────────────────────────────────────
-- ผู้เรียกที่เห็นได้: ผู้ที่อ่านข้อมูลยานพาหนะได้ · ผู้ขอตัวจริง · ผู้ลงนามของช่องใดช่องหนึ่งของทริปนี้
-- ไม่ใช่ = {found:false} เหมือนไม่พบ
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
      'blocked', CASE WHEN v_mode = 'online' AND v_applic AND NOT v_signed THEN v_exp ->> 'reason' END,
      'expected_name', v_exp_name,
      'signature', CASE WHEN v_signed THEN jsonb_build_object(
        'signer_name', v_sig.signer_name,
        'signer_position', v_sig.signer_position,
        'signed_as', v_sig.signed_as,
        'decision', v_sig.decision,
        'signed_at', v_sig.signed_at,
        'content_matches', v_sig.content_hash = v_hash
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
    'integrity', v_integrity
  );
END;
$$;

-- ── 9) ลงนาม ─────────────────────────────────────────────────────────────────────────────────
-- ล็อกแถวทริประหว่างลงนาม (FOR UPDATE) → สองคำสั่งพร้อมกันไม่มีทางลงช่องเดียวกันซ้ำสองแถว
-- ลงซ้ำโดยคนเดิมที่ลงไปแล้ว = ตอบ ok + already (กดซ้ำ/สัญญาณหลุดแล้วลองใหม่ได้ ไม่ต้องใส่รหัสอีก)
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

-- ── 10) ถอนลายเซ็น ───────────────────────────────────────────────────────────────────────────
-- ใครถอนได้: ผู้ดูแลระบบยานพาหนะ · ผู้ขอตัวจริง (ถอนทั้งหมดเพื่อแก้คำขอ) · เจ้าของลายเซ็นช่องนั้นเอง (ระบุ p_slot)
-- ถอนช่อง requester/dept_head = ถอนช่องหลังๆ ในสายด้วย (ผู้ลงนามเห็นเนื้อหาชุดเก่า) · แถวเดิมไม่ถูกแก้ แค่เพิ่มแถวถอน
-- ถอนแล้วทริปไม่มีลายเซ็นที่ใช้ได้ → ทริปแก้เนื้อหาได้อีก (trigger ล็อกเปิด) แล้วต่างคนต่างลงนามใหม่
CREATE OR REPLACE FUNCTION public.esign_revoke_fleet_trip(
  p_trip_id uuid,
  p_reason  text,
  p_slot    text DEFAULT NULL
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
  v_name   text;
  v_chain  text[] := ARRAY['requester', 'dept_head', 'authority'];
  v_targets text[];
  v_idx    int;
  v_n      int;
  v_own    boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reason');
  END IF;
  IF p_slot IS NOT NULL AND NOT (p_slot = ANY (ARRAY['requester', 'dept_head', 'authority', 'sk1'])) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_slot');
  END IF;

  SELECT * INTO v_trip FROM public.fleet_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF p_slot IS NOT NULL THEN
    v_own := EXISTS (
      SELECT 1 FROM public.esign_signatures s
      WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = p_slot AND s.signer_id = v_uid
        AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
    );
  END IF;
  IF NOT (
    public.fleet_is_manager(v_trip.municipality_id)
    OR COALESCE(v_trip.requested_by, v_trip.created_by) = v_uid
    OR v_own
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  IF p_slot IS NULL THEN
    v_targets := ARRAY['requester', 'dept_head', 'authority', 'sk1'];
  ELSIF p_slot = 'sk1' THEN
    v_targets := ARRAY['sk1'];
  ELSE
    v_idx := array_position(v_chain, p_slot);
    v_targets := v_chain[v_idx:array_length(v_chain, 1)];
  END IF;

  SELECT btrim(COALESCE(p.full_name, '')) INTO v_name FROM public.profiles p WHERE p.id = v_uid;

  INSERT INTO public.esign_revocations (signature_id, municipality_id, revoked_by, revoked_by_name, reason)
  SELECT s.id, s.municipality_id, v_uid, COALESCE(v_name, ''), v_reason
  FROM public.esign_signatures s
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = v_trip.id AND s.slot = ANY (v_targets)
    AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    PERFORM public.esign_audit(v_trip.municipality_id, 'esign_revoke', 'fleet_trip', v_trip.id::text, p_slot,
      jsonb_build_object('slots', to_jsonb(v_targets), 'revoked', v_n, 'reason', v_reason));
  END IF;
  RETURN jsonb_build_object('ok', true, 'revoked', v_n);
END;
$$;

-- ── 11) หน้าตรวจสอบสาธารณะ (สแกน QR/กรอกรหัส) ────────────────────────────────────────────────
-- เห็น: ชื่ออปท. ประเภทเอกสาร วันที่เอกสาร สถานะ ผู้ลงนาม+ตำแหน่ง+เวลา ที่ลงนามแล้ว
-- ไม่เห็น: id ของทริป ปลายทาง วัตถุประสงค์ จำนวน/รายชื่อผู้โดยสาร เหตุผลการถอน ชื่อผู้ถอน
-- ตอบ {found:false} แบบเดียวกันทุกกรณี (รหัสผิดรูป/ไม่มี) ไม่ใบ้ว่าใกล้เคียง
-- state: modified = เนื้อหาปัจจุบันไม่ตรงกับที่ลงนาม · complete = ลงครบทุกช่องออนไลน์ · partial · unsigned
-- ไม่ใส่ STABLE: ข้างในเรียก rpc_rate_limit_hit ซึ่งเขียนตารางนับ (VOLATILE)
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

-- ── 12) สิทธิ์เรียกฟังก์ชัน ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.set_esign_policy(uuid, text, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_confirm_trial(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_registry_linked_count(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_esign_doc_type(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_gate_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_signer_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_esign_pin(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_suspend_me(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_reinstate_signer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_trip_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_sign_fleet_trip(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_revoke_fleet_trip(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_verify(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_esign_policy(uuid, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_confirm_trial(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_esign_doc_type(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_gate_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_signer_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_esign_pin(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_suspend_me(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_reinstate_signer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_trip_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_sign_fleet_trip(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_revoke_fleet_trip(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_verify(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select has_function_privilege('anon', 'public.esign_verify(text)', 'execute');                       → true
--   select has_function_privilege('anon', 'public.esign_sign_fleet_trip(uuid,text,text,text)', 'execute'); → false
--   select has_function_privilege('anon', 'public.esign_expected_signer(public.fleet_trips,text)', 'execute'); → false
--   select has_table_privilege('authenticated', 'public.esign_signers', 'select');                         → false
--   select public.esign_verify('ไม่ใช่รหัส');                                                            → {"found": false}
--   select count(*) from pg_trigger where tgname = 'trg_fleet_trips_esign_guard' and not tgisinternal;     → 1
