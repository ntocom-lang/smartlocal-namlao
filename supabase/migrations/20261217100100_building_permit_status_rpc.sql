-- 20261217100100_building_permit_status_rpc.sql
--
-- ไฟล์ 2 ของ 2 — ด่านกันแก้ตรง + RPC เปลี่ยนขั้นย่อยคำขออนุญาตก่อสร้าง + บันทึก audit_logs
-- ต้องรัน 20261217100000 (คอลัมน์) ก่อน
--
-- ใครทำอะไรได้ (set_building_permit_stage)
--   เกณฑ์เดียวกับ policy "staff update document_requests" (20260802071000):
--   superadmin ทั้งหมด · admin ทั้ง อปท. · officer เฉพาะกองตน (is_my_department) · staff เฉพาะเรื่องที่ถูกมอบหมาย
--   (staff ตรวจ อปท. เพิ่มอีกชั้น — เข้มกว่า policy เล็กน้อย ไม่กระทบใช้งานจริง)
--   ประชาชน/ผู้ไม่ล็อกอิน: อ่านได้ตาม RLS เดิม (เจ้าของคำขอเห็นแถวตัวเอง) แก้ไม่ได้
--
-- ทำไมต้องมีด่าน (trigger) นอกจาก RPC
--   policy UPDATE ของ document_requests เป็นระดับแถว — เจ้าหน้าที่ที่แก้แถวได้จะแก้คอลัมน์ใหม่ตรงๆ ได้ด้วย
--   (ข้าม audit_logs) และ policy INSERT เปิดให้ anon/ประชาชนยื่นคำขอ — ยัดวันหมดอายุปลอมมาตั้งแต่ยื่นได้
--   ด่านจึงห้าม anon/authenticated ตั้งหรือแก้ 6 คอลัมน์นี้เอง · RPC เป็น SECURITY DEFINER (เจ้าของ postgres)
--   คำสั่ง UPDATE ข้างในจึงทำงานเป็น postgres และผ่านด่านได้โดยไม่ต้องใช้ธง session
--   (SQL Editor/service_role แก้ข้อมูลด้วยมือได้ตามปกติ)
--
-- กติกาใน RPC
--   - ใช้ได้เฉพาะ document_type = 'building_permit'
--   - ขั้น: NULL (ย้อนไปรับคำขอ) / doc_check / site_inspection / review / issued / collected
--     ย้อนขั้นได้ (แก้กดผิด) — ค่าเดิมอยู่ใน audit_logs.metadata
--   - เลขที่/วันออก/วันหมดอายุ ส่งได้เฉพาะขั้น issued/collected · ย้อนไปขั้นก่อนออกใบ = ล้างทั้ง 3 ช่อง
--   - วันออกห้ามเป็นวันในอนาคต (เวลาไทย) · ปีต้องเป็น ค.ศ. 2000–2100 (กันกรอกปี พ.ศ.) · วันหมดอายุ > วันออก
--   - คำขอที่ถูกปฏิเสธ/ยกเลิก ตั้งขั้น issued/collected ไม่ได้
--   - ไม่เปลี่ยน status หลัก 4 ค่าเดิม และไม่ตัดสินอนุญาต — เป็นการแจ้งความคืบหน้าเท่านั้น
--   - ไม่มีอะไรเปลี่ยน = ไม่เขียน ไม่ลง audit
--   - เลขที่/วันที่: ค่าที่ส่งมาคือค่าใหม่ทั้งชุดเสมอ (ส่ง NULL = ล้างช่องนั้น) ไม่มี "คงค่าเดิมถ้าไม่ส่ง"
--     ⇒ หน้าเว็บต้องส่งค่าปัจจุบันกลับมาทุกครั้งที่ขั้นเป้าหมายเป็น issued/collected (BuildingPermitStagePanel เติมค่าเดิมในฟอร์มให้)
--     เลือกแบบนี้เพื่อให้ล้างช่องที่กรอกผิดได้ (ผลตรวจรอบ 1 ข้อ 4 ทาง ข) · ค่าเดิมอยู่ใน audit_logs.metadata เสมอ
--   - ไม่พบคำขอ กับ ไม่มีสิทธิ์ ตอบข้อความเดียวกัน (42501) — ไม่เปิดช่องให้ไล่เดาว่า id ไหนมีจริง
--
-- ไม่ CREATE OR REPLACE ฟังก์ชันเดิมตัวใด (ฟังก์ชันใหม่ 2 ตัว + trigger ใหม่ 1 ตัว)
-- ย้อนกลับ: DROP TRIGGER trg_guard_building_permit_status ON public.document_requests;
--           DROP FUNCTION public.set_building_permit_stage(uuid, text, text, date, date);
--           DROP FUNCTION public.guard_building_permit_status();

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_requests' AND column_name = 'permit_stage_by'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261217100000_building_permit_status_columns.sql ก่อน';
  END IF;
  IF to_regprocedure('public.is_my_department(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้องมี is_my_department (20260802060000) ก่อน';
  END IF;
END $$;

SET LOCAL lock_timeout = '5s';

-- ── 1) ด่านกันแก้ตรงจาก API ─────────────────────────────────────────────────────────
-- SECURITY INVOKER โดยตั้งใจ: current_user = บทบาทที่สั่ง INSERT/UPDATE จริง
--   anon/authenticated (ผ่าน API) → ห้าม · postgres (ใน RPC SECURITY DEFINER / SQL Editor) / service_role → ผ่าน
-- ⚠️ เป็นรายการห้าม (deny-list): ถ้าวันหน้าเพิ่ม role ใหม่ให้ API/PostgREST ใช้ ต้องเพิ่มชื่อ role นั้นที่นี่ด้วย
--   ไม่งั้น role ใหม่จะผ่านด่านนี้อัตโนมัติ
CREATE OR REPLACE FUNCTION public.guard_building_permit_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.permit_stage IS NOT NULL OR NEW.permit_no IS NOT NULL OR NEW.permit_issued_on IS NOT NULL
       OR NEW.permit_expires_on IS NOT NULL OR NEW.permit_stage_at IS NOT NULL OR NEW.permit_stage_by IS NOT NULL THEN
      RAISE EXCEPTION 'ตั้งสถานะใบอนุญาตก่อสร้างตอนยื่นคำขอไม่ได้'
        USING ERRCODE = '42501';
    END IF;
  ELSIF (NEW.permit_stage, NEW.permit_no, NEW.permit_issued_on, NEW.permit_expires_on, NEW.permit_stage_at, NEW.permit_stage_by)
        IS DISTINCT FROM
        (OLD.permit_stage, OLD.permit_no, OLD.permit_issued_on, OLD.permit_expires_on, OLD.permit_stage_at, OLD.permit_stage_by) THEN
    RAISE EXCEPTION 'แก้สถานะใบอนุญาตก่อสร้างได้ผ่านปุ่มในหน้าเจ้าหน้าที่เท่านั้น (set_building_permit_stage)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_building_permit_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_building_permit_status ON public.document_requests;
CREATE TRIGGER trg_guard_building_permit_status
  BEFORE INSERT OR UPDATE OF permit_stage, permit_no, permit_issued_on, permit_expires_on, permit_stage_at, permit_stage_by
  ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_building_permit_status();

-- ── 2) RPC เปลี่ยนขั้นย่อย ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_building_permit_stage(
  p_request_id uuid,
  p_stage      text,
  p_permit_no  text DEFAULT NULL,
  p_issued_on  date DEFAULT NULL,
  p_expires_on date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_muni   uuid;
  v_req    public.document_requests%ROWTYPE;
  v_today  date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_stage  text := nullif(btrim(coalesce(p_stage, '')), '');
  v_no     text := nullif(btrim(coalesce(p_permit_no, '')), '');
  v_issued date := p_issued_on;
  v_exp    date := p_expires_on;
  v_actor  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  IF v_stage IS NOT NULL AND v_stage NOT IN ('doc_check', 'site_inspection', 'review', 'issued', 'collected') THEN
    RAISE EXCEPTION 'ขั้นไม่ถูกต้อง: %', v_stage USING ERRCODE = '22023';
  END IF;

  -- ตรวจสิทธิ์ก่อน (ไม่ล็อก) แล้วค่อยล็อกแถว — ผู้ไม่มีสิทธิ์ล็อกแถวคนอื่นไม่ได้
  -- coalesce(…, false): ค่าใดเป็น NULL (role/อปท./กอง/assigned_to) ต้อง = ปฏิเสธ
  --   plpgsql "IF NOT (NULL)" ไม่เข้าเงื่อนไข = ปล่อยผ่าน ต่างจาก RLS ที่ถือ NULL = ปฏิเสธ (ผลตรวจรอบ 1 ข้อ 1:
  --   staff กองใดก็ได้กับคำขอที่ assigned_to ยังว่าง เคยผ่านได้) · แบบเดียวกับ change_complaint_category
  SELECT * INTO v_req FROM public.document_requests WHERE id = p_request_id;
  v_role := public.get_my_role();
  v_muni := public.get_my_municipality_id();
  IF NOT FOUND OR NOT coalesce(
       v_role = 'superadmin'
       OR (v_role = 'admin'   AND v_req.municipality_id = v_muni)
       OR (v_role = 'officer' AND public.is_my_department(v_req.municipality_id, v_req.department_id))
       OR (v_role = 'staff'   AND v_req.municipality_id = v_muni AND v_req.assigned_to = v_uid),
     false) THEN
    RAISE EXCEPTION 'ไม่พบคำขอนี้ หรือไม่มีสิทธิ์แก้สถานะคำขอนี้' USING ERRCODE = '42501';
  END IF;

  -- ล็อกแถวแล้วอ่านซ้ำ (กันกดพร้อมกันสองคน) · กอง/ผู้รับผิดชอบเปลี่ยนระหว่างนี้ = ตรวจสิทธิ์ซ้ำ
  SELECT * INTO v_req FROM public.document_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(
       v_role = 'superadmin'
       OR (v_role = 'admin'   AND v_req.municipality_id = v_muni)
       OR (v_role = 'officer' AND public.is_my_department(v_req.municipality_id, v_req.department_id))
       OR (v_role = 'staff'   AND v_req.municipality_id = v_muni AND v_req.assigned_to = v_uid),
     false) THEN
    RAISE EXCEPTION 'ไม่พบคำขอนี้ หรือไม่มีสิทธิ์แก้สถานะคำขอนี้' USING ERRCODE = '42501';
  END IF;

  IF v_req.document_type IS DISTINCT FROM 'building_permit' THEN
    RAISE EXCEPTION 'ใช้ได้เฉพาะคำขออนุญาตก่อสร้าง' USING ERRCODE = '22023';
  END IF;

  IF v_stage IN ('issued', 'collected') THEN
    IF v_req.status IN ('rejected', 'cancelled') THEN
      RAISE EXCEPTION 'คำขอนี้ถูกปฏิเสธ/ยกเลิกแล้ว ตั้งเป็น "ออกใบอนุญาตแล้ว" ไม่ได้' USING ERRCODE = '22023';
    END IF;
    IF v_no IS NOT NULL AND length(v_no) > 60 THEN
      RAISE EXCEPTION 'เลขที่ใบอนุญาตยาวเกิน 60 ตัวอักษร' USING ERRCODE = '22023';
    END IF;
    IF (v_issued IS NOT NULL AND v_issued NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
       OR (v_exp IS NOT NULL AND v_exp NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31') THEN
      RAISE EXCEPTION 'ปีของวันที่ไม่ถูกต้อง — ช่องวันที่ใช้ปี ค.ศ. (เช่น 2026 ไม่ใช่ 2569)' USING ERRCODE = '22023';
    END IF;
    IF v_issued IS NOT NULL AND v_issued > v_today THEN
      RAISE EXCEPTION 'วันออกใบอนุญาตเป็นวันในอนาคตไม่ได้' USING ERRCODE = '22023';
    END IF;
    IF v_issued IS NOT NULL AND v_exp IS NOT NULL AND v_exp <= v_issued THEN
      RAISE EXCEPTION 'วันหมดอายุต้องอยู่หลังวันออกใบอนุญาต' USING ERRCODE = '22023';
    END IF;
  ELSIF v_no IS NOT NULL OR v_issued IS NOT NULL OR v_exp IS NOT NULL THEN
    RAISE EXCEPTION 'กรอกเลขที่/วันที่ใบอนุญาตได้เมื่อขั้นเป็น "ออกใบอนุญาตแล้ว" หรือ "รับใบแล้ว"' USING ERRCODE = '22023';
  END IF;

  -- ไม่มีอะไรเปลี่ยน → ไม่เขียน ไม่ลง audit
  IF (v_stage, v_no, v_issued, v_exp)
     IS NOT DISTINCT FROM (v_req.permit_stage, v_req.permit_no, v_req.permit_issued_on, v_req.permit_expires_on) THEN
    RETURN jsonb_build_object('changed', false, 'stage', v_req.permit_stage);
  END IF;

  UPDATE public.document_requests
  SET permit_stage      = v_stage,
      permit_no         = v_no,
      permit_issued_on  = v_issued,
      permit_expires_on = v_exp,
      permit_stage_at   = now(),
      permit_stage_by   = v_uid
  WHERE id = v_req.id;

  SELECT coalesce(nullif(btrim(full_name), ''), 'เจ้าหน้าที่') INTO v_actor
  FROM public.profiles WHERE id = v_uid;

  -- ไม่ใส่ชื่อ/ที่อยู่ผู้ยื่นใน audit (PDPA) — อ้างด้วย id คำขอ + เลขที่ใบ
  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_req.municipality_id, v_uid, v_actor, v_role, 'building_permit_stage',
    'document_request', v_req.id::text, coalesce(v_no, v_req.permit_no, 'คำขออนุญาตก่อสร้าง'),
    jsonb_build_object(
      'from', jsonb_build_object('stage', v_req.permit_stage, 'permit_no', v_req.permit_no,
                                 'issued_on', v_req.permit_issued_on, 'expires_on', v_req.permit_expires_on),
      'to',   jsonb_build_object('stage', v_stage, 'permit_no', v_no,
                                 'issued_on', v_issued, 'expires_on', v_exp)
    )
  );

  RETURN jsonb_build_object('changed', true, 'stage', v_stage, 'permit_no', v_no,
                            'issued_on', v_issued, 'expires_on', v_exp);
END;
$$;

REVOKE ALL ON FUNCTION public.set_building_permit_stage(uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_building_permit_stage(uuid, text, text, date, date) TO authenticated;

COMMENT ON FUNCTION public.set_building_permit_stage(uuid, text, text, date, date) IS
  'เปลี่ยนขั้นย่อยคำขออนุญาตก่อสร้าง + เลขที่/วันออก/วันหมดอายุ (กรอกตามใบจริง) — สิทธิ์ตาม policy staff update document_requests · ลง audit_logs ทุกครั้งที่เปลี่ยน · ไม่ตัดสินอนุญาต';

-- ── 3) ตรวจท้ายไฟล์ ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_building_permit_status' AND tgrelid = 'public.document_requests'::regclass
  ) THEN
    RAISE EXCEPTION 'trigger trg_guard_building_permit_status ไม่ขึ้น';
  END IF;
  IF has_function_privilege('anon', 'public.set_building_permit_stage(uuid, text, text, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ยังเรียก set_building_permit_stage ได้';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_building_permit_stage(uuid, text, text, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated เรียก set_building_permit_stage ไม่ได้';
  END IF;
  -- RPC ต้องเป็นของ postgres: ด่าน trigger ปล่อยผ่านเพราะ UPDATE ในนี้ทำงานเป็นเจ้าของฟังก์ชัน
  -- ถ้าเจ้าของเป็น role อื่น (เช่น authenticated) ปุ่มจะชนด่านตัวเองทุกครั้ง หรือร้ายกว่าคือด่านไม่มีผล
  IF (SELECT proowner::regrole::text FROM pg_catalog.pg_proc
      WHERE oid = 'public.set_building_permit_stage(uuid, text, text, date, date)'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION 'เจ้าของ set_building_permit_stage ไม่ใช่ postgres — ด่าน trigger ใช้ current_user ของเจ้าของฟังก์ชัน';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
