-- แถวผู้ลงนามที่แอดมินสร้างเอง (signatory_role = 'custom')
--
-- ที่ต้องมี: บทบาทเดิมเป็นชุดตายตัว อปท. ที่มีรองนายกหลายคนรับมอบอำนาจคนละเรื่อง
-- หรืออยากมีผู้ลงนามสำหรับเอกสารอื่น ต้องรอ migration ใหม่ทุกครั้ง
--
-- mayor / clerk / department_head ยังเป็นบทบาทของระบบต่อไป ห้ามให้ลบหรือเปลี่ยนชื่อ
-- เพราะ prepare_complaint_print resolve ผู้ลงนามบนแบบพิมพ์คำร้องจากชื่อบทบาทเหล่านี้ตรงๆ
-- ส่วน custom ถูก whitelist ของฟังก์ชันนั้นกรองออกอยู่แล้ว (เหมือน vehicle_authority)
-- จึงไม่มีทางหลุดไปลงนามในคำร้อง และไม่ถูกนับว่า "ตั้งค่าผู้ลงนามไม่ครบ"

ALTER TABLE public.document_signatories
  ADD COLUMN IF NOT EXISTS custom_label text;

COMMENT ON COLUMN public.document_signatories.custom_label IS
  'ชื่อแถวที่แอดมินตั้งเอง ใช้เฉพาะ signatory_role = custom และเป็นตัวระบุแถวที่เอกสารอ้างถึง (คู่กับ signatory_role)';

ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_role_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_role_check
  CHECK (signatory_role IN ('department_head', 'clerk', 'mayor', 'vehicle_authority', 'custom'));

ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_role_scope_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_role_scope_check
  CHECK (
    (signatory_role = 'department_head' AND department_id IS NOT NULL)
    OR (signatory_role IN ('clerk', 'mayor', 'vehicle_authority', 'custom') AND department_id IS NULL)
  );

-- custom ต้องมีชื่อ บทบาทอื่นต้องไม่มี — ชื่อนี้เป็นตัวระบุแถว ถ้าปล่อยว่างได้
-- จะมีแถว custom ไร้ชื่อหลายแถวที่เอกสารอ้างถึงแยกกันไม่ออก
ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_custom_label_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_custom_label_check
  CHECK (
    (signatory_role = 'custom' AND btrim(coalesce(custom_label, '')) <> ''
      AND char_length(custom_label) <= 100)
    OR (signatory_role <> 'custom' AND custom_label IS NULL)
  );

-- index เดิมบังคับ 1 แถว active ต่อ (อปท., เอกสาร, บทบาท, กอง) ซึ่งทำให้ custom
-- มีได้แถวเดียวทั้ง อปท. — เติม custom_label เข้าไปเพื่อให้ custom มีได้หลายแถว
-- ตราบใดที่ชื่อไม่ซ้ำ ส่วน mayor/clerk/vehicle_authority ยังคง 1 แถวเหมือนเดิม
-- (label เป็น NULL ทั้งหมด จึง coalesce เป็น '' ค่าเดียวกัน)
DROP INDEX IF EXISTS public.document_signatories_one_active_scope_idx;
CREATE UNIQUE INDEX IF NOT EXISTS document_signatories_one_active_scope_idx
  ON public.document_signatories (
    municipality_id,
    document_type,
    signatory_role,
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(custom_label, '')
  )
  WHERE is_active;

-- v3: เพิ่ม p_custom_label เข้ามา ยกตัว v2 มาทั้งดุ้นแล้วแก้เฉพาะส่วนที่เกี่ยวกับ label
-- ทำเป็นเวอร์ชันใหม่แทนการเติมพารามิเตอร์ให้ v2 เพราะ PostgREST เลือก overload จาก
-- ชุดชื่อ argument ที่ client ส่งมา การมีสองตัวที่ต่างกันแค่พารามิเตอร์ท้ายสุด
-- ทำให้ได้ PGRST202 "Could not find the function" ซึ่งอ่านไม่ออกว่าเกิดจากอะไร
CREATE OR REPLACE FUNCTION public.set_document_signatory_v3(
  p_municipality_id uuid,
  p_signatory_role text,
  p_department_id uuid DEFAULT NULL,
  p_profile_id uuid DEFAULT NULL,
  p_manual_name text DEFAULT NULL,
  p_title_override text DEFAULT NULL,
  p_authority_reference text DEFAULT NULL,
  p_effective_from date DEFAULT (timezone('Asia/Bangkok', now())::date),
  p_effective_to date DEFAULT NULL,
  p_custom_label text DEFAULT NULL
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
  v_custom_label text := NULLIF(btrim(p_custom_label), '');
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

  IF p_signatory_role NOT IN ('department_head', 'clerk', 'mayor', 'vehicle_authority', 'custom') THEN
    RAISE EXCEPTION 'บทบาทผู้ลงนามไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  -- แถวที่แอดมินสร้างเองต้องมีชื่อกำกับ เพราะชื่อนี้เป็นตัวระบุแถว (ใบขออนุญาตใช้รถ
  -- อ้างถึงผู้ลงนามด้วยคู่ role+label ไม่ใช่ id ซึ่งเปลี่ยนทุกครั้งที่เปลี่ยนตัวคน)
  IF (p_signatory_role = 'custom') <> (v_custom_label IS NOT NULL) THEN
    RAISE EXCEPTION 'ชื่อผู้ลงนามที่กำหนดเองต้องระบุเฉพาะบทบาทที่สร้างเอง' USING ERRCODE = '22023';
  END IF;

  IF char_length(coalesce(v_custom_label, '')) > 100 THEN
    RAISE EXCEPTION 'ชื่อผู้ลงนามที่กำหนดเองยาวเกิน 100 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  IF (p_signatory_role = 'department_head' AND p_department_id IS NULL)
    OR (p_signatory_role IN ('clerk', 'mayor', 'vehicle_authority', 'custom') AND p_department_id IS NOT NULL)
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
    AND custom_label IS NOT DISTINCT FROM v_custom_label
    AND is_active;

  INSERT INTO public.document_signatories (
    municipality_id, document_type, signatory_role, department_id, profile_id,
    manual_name, title_override, authority_reference, effective_from, effective_to,
    created_by, custom_label
  ) VALUES (
    p_municipality_id, 'complaint', p_signatory_role, p_department_id, p_profile_id,
    v_manual_name, v_title_override, NULLIF(btrim(p_authority_reference), ''),
    v_effective_from, p_effective_to, auth.uid(), v_custom_label
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
      'custom_label', v_custom_label,
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

REVOKE ALL ON FUNCTION public.set_document_signatory_v3(
  uuid, text, uuid, uuid, text, text, text, date, date, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_signatory_v3(
  uuid, text, uuid, uuid, text, text, text, date, date, text
) TO authenticated;

-- ปิดทางเรียก v2 เหมือนที่เคยทำกับ v1 ตอนขึ้น v2 — เหลือทางเดียวไม่ให้เขียนข้าม
-- กติกาใหม่ของ custom_label ได้ (ตัวฟังก์ชันยังอยู่ เผื่อต้องย้อนดูของเดิม)
REVOKE EXECUTE ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) FROM authenticated;

-- ตัวเดิมระบุแถวด้วย (บทบาท, กอง) ซึ่งเจาะจงแถว custom แถวใดแถวหนึ่งไม่ได้
CREATE OR REPLACE FUNCTION public.clear_document_signatory_v2(
  p_municipality_id uuid,
  p_signatory_role text,
  p_department_id uuid DEFAULT NULL,
  p_custom_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_custom_label text := NULLIF(btrim(p_custom_label), '');
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND
    OR v_actor.role NOT IN ('admin', 'superadmin')
    OR (v_actor.role <> 'superadmin' AND v_actor.municipality_id <> p_municipality_id)
  THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ยกเลิกผู้ลงนาม' USING ERRCODE = '42501';
  END IF;

  UPDATE public.document_signatories
  SET is_active = false, updated_at = now()
  WHERE municipality_id = p_municipality_id
    AND document_type = 'complaint'
    AND signatory_role = p_signatory_role
    AND department_id IS NOT DISTINCT FROM p_department_id
    AND custom_label IS NOT DISTINCT FROM v_custom_label
    AND is_active;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_label, metadata
  ) VALUES (
    p_municipality_id, auth.uid(), v_actor.full_name, v_actor.role,
    'clear_document_signatory', 'document_signatory',
    coalesce(v_custom_label, p_signatory_role),
    jsonb_build_object('department_id', p_department_id, 'custom_label', v_custom_label)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_document_signatory_v2(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_document_signatory_v2(uuid, text, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.clear_document_signatory(uuid, text, uuid) FROM authenticated;
