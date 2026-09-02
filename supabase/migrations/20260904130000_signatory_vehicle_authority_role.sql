-- บทบาท "ผู้มีอำนาจสั่งใช้รถ" (vehicle_authority) สำหรับกรณีนายกมอบอำนาจการสั่งใช้
-- รถส่วนกลางให้ผู้อื่น (รองนายก ปลัด รองปลัด ฯลฯ) ตามคำสั่งมอบอำนาจของ อปท.
--
-- ทำไมต้องเป็นบทบาทแยก ไม่ใช่แก้ชื่อในแถว mayor:
--   unique index document_signatories_one_active_scope_idx บังคับให้ mayor มีแถว active
--   ได้แถวเดียวต่อ อปท. และแถวนั้นถูก prepare_complaint_print ใช้พิมพ์แบบคำร้องด้วย
--   ถ้าเอาผู้รับมอบอำนาจไปทับแถว mayor คำร้องทุกใบจะกลายเป็นคนคนนั้นลงนามไปด้วย
--   ทั้งที่คำสั่งมอบอำนาจครอบคลุมแค่การสั่งใช้รถ — เป็นการระบุผู้ลงนามผิดตัวในเอกสารราชการ
--
-- prepare_complaint_print ไม่ต้องแก้: มันกรองด้วย whitelist
--   (signatory_role = 'department_head' AND ...) OR (signatory_role IN ('clerk','mayor') AND ...)
--   และนับ "ขาดผู้ลงนาม" จาก VALUES list คงที่ 3 บทบาท แถว vehicle_authority จึงถูกมองข้าม
--   ทั้งตอนพิมพ์และตอนนับว่าตั้งค่าครบหรือยัง โดยอัตโนมัติ
--
-- การมอบอำนาจเป็นข้อยกเว้น ไม่ใช่ค่าปกติ — ไม่ตั้งแถวนี้ = ใบแบบ 3 ใช้นายกตามเดิม

-- CHECK เดิมประกาศ inline ใน CREATE TABLE จึงไม่มีชื่อที่กำหนดเอง (Postgres ตั้งให้เป็น
-- document_signatories_check, _check1, ... ตามลำดับที่ประกาศ ซึ่งเดาไม่ได้และอาจต่างกัน
-- ระหว่างฐานข้อมูลที่ apply migration คนละรอบ) จึงต้องค้นจากนิยามจริงแล้วค่อย drop
DO $do$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.document_signatories'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) LIKE '%signatory_role%department_head%'
        OR pg_get_constraintdef(oid) LIKE '%department_head%signatory_role%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.document_signatories DROP CONSTRAINT %I', v_name);
  END LOOP;
END
$do$;

-- ตั้งชื่อเองคราวนี้ เพื่อให้ migration รอบหน้าแก้ได้ตรงๆ ไม่ต้องเดาชื่ออีก
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_role_check
  CHECK (signatory_role IN ('department_head', 'clerk', 'mayor', 'vehicle_authority'));

-- vehicle_authority เป็นผู้ลงนามระดับหน่วยงานเหมือนนายก/ปลัด จึงต้องไม่ผูกกับกอง
-- ถ้าลืมข้อนี้ CHECK เดิมจะปัดตกทุกการบันทึกบทบาทใหม่ด้วย 23514 ที่อ่านไม่ออกว่าเกิดจากอะไร
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_role_scope_check
  CHECK (
    (signatory_role = 'department_head' AND department_id IS NOT NULL)
    OR (signatory_role IN ('clerk', 'mayor', 'vehicle_authority') AND department_id IS NULL)
  );

-- ช่อง "ผู้มีอำนาจสั่งใช้รถ" บนแบบ 3 เลือกบทบาทใหม่นี้ได้ด้วย
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_order_authority_role_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_order_authority_role_check
  CHECK (order_authority_role IS NULL OR order_authority_role IN ('mayor', 'clerk', 'vehicle_authority'))
  NOT VALID;

-- คัดลอกฟังก์ชันเดิมมาทั้งตัวแล้วแก้เฉพาะรายชื่อบทบาท 2 จุด (การตรวจสิทธิ์ ขอบเขตกอง
-- การปิดแถวเก่า และ audit log คงเดิมทุกบรรทัด) — ห้ามใส่ placeholder ใน CREATE OR REPLACE

CREATE OR REPLACE FUNCTION public.set_document_signatory_v2(
  p_municipality_id uuid,
  p_signatory_role text,
  p_department_id uuid DEFAULT NULL,
  p_profile_id uuid DEFAULT NULL,
  p_manual_name text DEFAULT NULL,
  p_title_override text DEFAULT NULL,
  p_authority_reference text DEFAULT NULL,
  p_effective_from date DEFAULT (timezone('Asia/Bangkok', now())::date),
  p_effective_to date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_result uuid;
  v_today date := timezone('Asia/Bangkok', now())::date;
  v_manual_name text := NULLIF(btrim(p_manual_name), '');
  v_title_override text := NULLIF(btrim(p_title_override), '');
  -- หน้าจอส่ง p_effective_from เป็น NULL เสมอ แล้วให้ DB เป็นคนกำหนดวันที่ตามเวลา Asia/Bangkok
  -- เหตุผล: นาฬิกา/timezone ของเครื่องผู้ใช้เชื่อไม่ได้ ถ้าเครื่องล้ำไปวันหน้าจะโดน 22007
  -- โดยที่ผู้ใช้ไม่มีทางเดาสาเหตุ (หน้าจอไม่มีช่องวันที่ให้แก้แล้ว)
  -- ยังรับค่าที่ส่งมาจริงได้อยู่ เผื่อ script/หน้าจออื่นในอนาคตต้องระบุวันเอง
  v_effective_from date := coalesce(p_effective_from, v_today);
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND
    OR v_actor.role NOT IN ('admin', 'superadmin')
    OR (v_actor.role <> 'superadmin' AND v_actor.municipality_id <> p_municipality_id)
  THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์กำหนดผู้ลงนาม' USING ERRCODE = '42501';
  END IF;

  IF p_signatory_role NOT IN ('department_head', 'clerk', 'mayor', 'vehicle_authority') THEN
    RAISE EXCEPTION 'บทบาทผู้ลงนามไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF (p_signatory_role = 'department_head' AND p_department_id IS NULL)
    OR (p_signatory_role IN ('clerk', 'mayor', 'vehicle_authority') AND p_department_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'ขอบเขตกองของผู้ลงนามไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF (p_profile_id IS NULL) = (v_manual_name IS NULL) THEN
    RAISE EXCEPTION 'ต้องเลือกบุคลากรหรือกรอกชื่อเองอย่างใดอย่างหนึ่ง' USING ERRCODE = '22023';
  END IF;

  IF v_manual_name IS NOT NULL AND v_title_override IS NULL THEN
    RAISE EXCEPTION 'ผู้ลงนามที่กรอกชื่อเองต้องระบุตำแหน่งที่พิมพ์' USING ERRCODE = '23502';
  END IF;

  IF char_length(coalesce(v_manual_name, '')) > 250
    OR char_length(coalesce(v_title_override, '')) > 250
    OR char_length(coalesce(p_authority_reference, '')) > 500
  THEN
    RAISE EXCEPTION 'ชื่อ ตำแหน่ง หรือหนังสืออ้างอิงยาวเกินขอบเขต' USING ERRCODE = '22023';
  END IF;

  IF p_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id
      AND municipality_id = p_municipality_id
      AND NULLIF(btrim(full_name), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ไม่พบบุคลากรในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments
    WHERE id = p_department_id
      AND municipality_id = p_municipality_id
      AND is_active
  ) THEN
    RAISE EXCEPTION 'ไม่พบกอง/หน่วยงานในสังกัดนี้' USING ERRCODE = '23503';
  END IF;

  -- v1 เคยบังคับว่าหัวหน้ากองที่มาจาก profile นอกกองต้องแนบเลขที่คำสั่งรักษาราชการแทน
  -- ตัดออกตามการตัดสินใจของผู้ดูแลระบบ: ตัวคำสั่งจริงอยู่ในแฟ้มบุคคลของ อปท. อยู่แล้ว
  -- และการรักษาราชการแทนเปลี่ยนบ่อยกว่าที่จะให้ระบบบังคับกรอกทุกครั้ง
  -- ผู้ดูแลจะพิมพ์คำว่า "รักษาราชการแทน ..." ลงในช่องชื่อตำแหน่งที่พิมพ์เอง เมื่อจำเป็น
  -- p_authority_reference ยังคงไว้ในลายเซ็นฟังก์ชันและคอลัมน์ เผื่อกลับมาบังคับใช้ภายหลัง
  -- โดยไม่ต้องแก้ signature (frontend ไม่ส่งค่านี้แล้ว จึงตกเป็น DEFAULT NULL)

  IF v_effective_from > v_today THEN
    RAISE EXCEPTION 'วันที่เริ่มมีผลต้องไม่เกินวันปัจจุบัน' USING ERRCODE = '22007';
  END IF;

  IF p_effective_to IS NOT NULL
    AND (p_effective_to < v_effective_from OR p_effective_to < v_today)
  THEN
    RAISE EXCEPTION 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้นหรือวันปัจจุบัน' USING ERRCODE = '22007';
  END IF;

  UPDATE public.document_signatories
  SET is_active = false, updated_at = now()
  WHERE municipality_id = p_municipality_id
    AND document_type = 'complaint'
    AND signatory_role = p_signatory_role
    AND department_id IS NOT DISTINCT FROM p_department_id
    AND is_active;

  INSERT INTO public.document_signatories (
    municipality_id, document_type, signatory_role, department_id, profile_id,
    manual_name, title_override, authority_reference, effective_from, effective_to,
    created_by
  ) VALUES (
    p_municipality_id, 'complaint', p_signatory_role, p_department_id, p_profile_id,
    v_manual_name, v_title_override, NULLIF(btrim(p_authority_reference), ''),
    v_effective_from, p_effective_to, auth.uid()
  )
  RETURNING id INTO v_result;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    p_municipality_id, auth.uid(), v_actor.full_name, v_actor.role,
    'set_document_signatory', 'document_signatory', v_result::text,
    p_signatory_role,
    jsonb_build_object(
      'identity_source', CASE WHEN p_profile_id IS NULL THEN 'manual' ELSE 'profile' END,
      'profile_id', p_profile_id,
      'department_id', p_department_id,
      'effective_from', v_effective_from,
      'effective_to', p_effective_to,
      -- เลขที่คำสั่ง/หนังสือรักษาราชการแทนเป็นเลขเอกสารราชการ ไม่ใช่ข้อมูลส่วนบุคคล จึงเก็บเต็มไว้ใน
      -- audit trail ได้ (สตง./ป.ป.ช. ต้องตรวจย้อนได้ว่าใครลงนามโดยอาศัยอำนาจตามหนังสือฉบับใด)
      -- ส่วนชื่อผู้ลงนามยังคงไม่สำเนาลง metadata — อ่านจาก document_signatories/print snapshot แทน
      'authority_reference', NULLIF(btrim(p_authority_reference), '')
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) TO authenticated;
