-- รองรับผู้ลงนามที่ไม่มีบัญชีในระบบ โดยยังคง audit, tenant scope และช่วงวันที่เดิม
ALTER TABLE public.document_signatories
  ADD COLUMN IF NOT EXISTS manual_name text;

ALTER TABLE public.document_signatories
  ALTER COLUMN profile_id DROP NOT NULL;

ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_identity_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_identity_check CHECK (
    (profile_id IS NOT NULL AND manual_name IS NULL)
    OR (
      profile_id IS NULL
      AND NULLIF(btrim(manual_name), '') IS NOT NULL
    )
  );

ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_manual_name_length_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_manual_name_length_check CHECK (
    manual_name IS NULL OR char_length(manual_name) <= 250
  );

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

  IF p_signatory_role NOT IN ('department_head', 'clerk', 'mayor') THEN
    RAISE EXCEPTION 'บทบาทผู้ลงนามไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF (p_signatory_role = 'department_head' AND p_department_id IS NULL)
    OR (p_signatory_role IN ('clerk', 'mayor') AND p_department_id IS NOT NULL)
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

CREATE OR REPLACE FUNCTION public.prepare_complaint_print(
  p_complaint_id uuid,
  p_allow_blank_signatories boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_complaint public.complaints%ROWTYPE;
  v_department_name text;
  v_signatories jsonb := '{}'::jsonb;
  v_missing text[] := '{}'::text[];
  v_snapshot_id uuid;
  v_today date := timezone('Asia/Bangkok', now())::date;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อนพิมพ์เอกสาร' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_complaint
  FROM public.complaints
  WHERE id = p_complaint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบคำร้อง' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor.role <> 'superadmin' AND (
    v_actor.municipality_id IS DISTINCT FROM v_complaint.municipality_id
    OR CASE
      WHEN v_actor.role = 'admin' THEN false
      -- เพิ่ม channel = 'oss_counter': เคาน์เตอร์ OSS รับคำร้องแทนประชาชนได้ทุกประเภท
      -- จึงต้องพิมพ์ใบรับเรื่องคืนให้ผู้มาติดต่อได้ทันที แม้เรื่องจะ route ไปกองอื่น
      -- (ถ้าไม่มีข้อนี้ เจ้าหน้าที่สำนักปลัดจะพิมพ์ใบรับเรื่องของกองช่างไม่ได้เลย = งานหน้าเคาน์เตอร์พัง)
      WHEN v_actor.role IN ('officer', 'staff') THEN NOT (
        v_complaint.assigned_to = v_actor.id
        OR v_complaint.channel = 'oss_counter'
        OR (
          v_actor.department_id IS NOT NULL
          AND v_complaint.department_id = v_actor.department_id
        )
      )
      WHEN v_actor.role = 'technician' THEN v_complaint.assigned_to IS DISTINCT FROM v_actor.id
      ELSE true
    END
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์พิมพ์คำร้องนี้' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_department_name
  FROM public.departments
  WHERE id = v_complaint.department_id
    AND municipality_id = v_complaint.municipality_id;

  SELECT coalesce(jsonb_object_agg(
    resolved.signatory_role,
    jsonb_build_object(
      'assignment_id', resolved.assignment_id,
      'profile_id', resolved.profile_id,
      'name', resolved.full_name,
      'title', resolved.title,
      'authority_reference', resolved.authority_reference,
      'effective_from', resolved.effective_from,
      'effective_to', resolved.effective_to
    )
  ), '{}'::jsonb)
  INTO v_signatories
  FROM (
    SELECT DISTINCT ON (signatory.signatory_role)
      signatory.signatory_role,
      signatory.id AS assignment_id,
      profile.id AS profile_id,
      coalesce(
        NULLIF(btrim(signatory.manual_name), ''),
        NULLIF(btrim(profile.full_name), '')
      ) AS full_name,
      coalesce(
        NULLIF(btrim(signatory.title_override), ''),
        NULLIF(btrim(profile.job_title), ''),
        position.name
      ) AS title,
      signatory.authority_reference,
      signatory.effective_from,
      signatory.effective_to
    FROM public.document_signatories AS signatory
    LEFT JOIN public.profiles AS profile ON profile.id = signatory.profile_id
    LEFT JOIN public.positions AS position ON position.id = profile.position_id
    WHERE signatory.municipality_id = v_complaint.municipality_id
      AND (profile.id IS NULL OR profile.municipality_id = v_complaint.municipality_id)
      AND signatory.document_type = 'complaint'
      AND signatory.is_active
      AND signatory.effective_from <= v_today
      AND (signatory.effective_to IS NULL OR signatory.effective_to >= v_today)
      AND (
        (signatory.signatory_role = 'department_head'
          AND signatory.department_id = v_complaint.department_id)
        OR (signatory.signatory_role IN ('clerk', 'mayor')
          AND signatory.department_id IS NULL)
      )
      -- ตอนแต่งตั้งบังคับว่าต้องมีชื่อ แต่เจ้าตัวอาจมาล้าง full_name ในโปรไฟล์ทีหลัง
      -- ถ้าไม่กรองตรงนี้ role นั้นจะถูกนับว่า "มีผู้ลงนามแล้ว" แล้วพิมพ์วงเล็บเปล่าออกไปเป็นเอกสารราชการ
      AND coalesce(
        NULLIF(btrim(signatory.manual_name), ''),
        NULLIF(btrim(profile.full_name), '')
      ) IS NOT NULL
    ORDER BY signatory.signatory_role, signatory.effective_from DESC, signatory.created_at DESC
  ) AS resolved;

  SELECT coalesce(array_agg(required.role_key ORDER BY required.ordinal), '{}'::text[])
  INTO v_missing
  FROM (
    VALUES ('department_head'::text, 1), ('clerk'::text, 2), ('mayor'::text, 3)
  ) AS required(role_key, ordinal)
  WHERE NOT (v_signatories ? required.role_key);

  IF cardinality(v_missing) > 0 AND NOT p_allow_blank_signatories THEN
    RAISE EXCEPTION 'ยังตั้งค่าผู้ลงนามไม่ครบ: %', array_to_string(v_missing, ', ')
      USING ERRCODE = 'P0001', HINT = 'ตั้งค่าในหน้า Admin หรือเลือกพิมพ์แบบเว้นชื่อผู้ลงนาม';
  END IF;

  INSERT INTO public.complaint_print_snapshots (
    municipality_id, complaint_id, template_version, department_id,
    department_name, signatories, missing_roles, generated_by
  ) VALUES (
    v_complaint.municipality_id, v_complaint.id, 'council-complaint-v2',
    v_complaint.department_id, coalesce(v_department_name, v_complaint.department),
    v_signatories, v_missing, auth.uid()
  )
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_complaint.municipality_id, auth.uid(), v_actor.full_name, v_actor.role,
    'prepare_complaint_print', 'complaint', v_complaint.id::text,
    v_complaint.ref_no,
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'template_version', 'council-complaint-v2',
      'department_id', v_complaint.department_id,
      'missing_roles', to_jsonb(v_missing),
      'blank_signatories_allowed', p_allow_blank_signatories
    )
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'template_version', 'council-complaint-v2',
    'department_id', v_complaint.department_id,
    'department_name', coalesce(v_department_name, v_complaint.department),
    'signatories', v_signatories,
    'missing_roles', to_jsonb(v_missing),
    'ready', cardinality(v_missing) = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) TO authenticated;

COMMENT ON COLUMN public.document_signatories.manual_name IS
  'ชื่อผู้ลงนามที่ Admin กรอกเองเมื่อบุคคลนั้นไม่มีบัญชีในระบบ; ใช้ร่วมกับ title_override';

-- set_document_signatory รุ่นแรกยังคงอยู่เพื่อไม่ทำ client เก่าพัง แต่ไม่มีโค้ดใดเรียกแล้ว
-- และเป็นทางเขียนที่สองที่ข้ามกติกา manual signer ทั้งชุด จึงถอนสิทธิ์เรียกออก
-- (ไม่ DROP FUNCTION เพราะ audit_logs อ้าง action เดิมไว้ และ DROP จะย้อนกลับยากถ้าต้องใช้)
REVOKE EXECUTE ON FUNCTION public.set_document_signatory(
  uuid, text, uuid, uuid, text, text, date, date
) FROM authenticated;

-- ประเภทคำร้องที่เปิดใช้งานแต่ไม่มีกอง = submit_citizen_complaint_v4 ปฏิเสธคำร้องของประชาชน
-- ทั้งหมดในหมวดนั้น เดิมกันไว้เฉพาะฝั่ง Browser ซึ่งเชื่อถือไม่ได้ จึงย้ายมาบังคับที่ DB
--
-- ผลข้างเคียงที่ผู้ดูแลต้องรู้: script โคลน tenant ใหม่ (แบบ 20260829113107_seed_demo_tenant.sql)
-- ที่คัดลอก complaint_categories มาโดยไม่ map department_id จะล้มทันที — ต้อง map กองของ
-- tenant ปลายทางให้ครบก่อน insert ซึ่งเป็นพฤติกรรมที่ถูกต้องกว่าการปล่อยให้หมวดไร้กองหลุดเข้าไป
CREATE OR REPLACE FUNCTION public.guard_active_category_requires_department()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.is_active AND NEW.department_id IS NULL THEN
    RAISE EXCEPTION 'ประเภทคำร้อง "%" เปิดใช้งานอยู่ จึงต้องระบุกอง/ส่วนราชการรับผิดชอบ', NEW.label
      USING ERRCODE = '23502',
            HINT = 'เลือกกองในหน้า Admin > ประเภทคำร้อง หรือปิดใช้งานหมวดนี้ก่อน';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_active_category_requires_department
  ON public.complaint_categories;
CREATE TRIGGER trg_active_category_requires_department
BEFORE INSERT OR UPDATE OF is_active, department_id
ON public.complaint_categories
FOR EACH ROW EXECUTE FUNCTION public.guard_active_category_requires_department();

-- ─────────────────────────────────────────────────────────────────────────────
-- PREFLIGHT บังคับก่อน deploy frontend v4 (อ่านอย่างเดียว รันได้ทั้งก่อนและหลัง apply)
--
-- (1) ต้องได้ 0 แถว "ทุก อปท." ไม่ใช่แค่ tenant ที่ล็อกอินอยู่ — ถ้ามีแถวไหนเหลือ
--     ประชาชนของ อปท. นั้นจะส่งคำร้องหมวดนั้นไม่ได้เลยทันทีที่ frontend v4 ขึ้น
-- SELECT m.name AS municipality, c.value, c.label
-- FROM public.complaint_categories c
-- JOIN public.municipalities m ON m.id = c.municipality_id
-- WHERE c.is_active AND c.department_id IS NULL
-- ORDER BY m.name, c.sort_order;
--
-- (2) อปท. ที่ยังไม่มีกองใช้งานเลย = ข้อ (1) แก้ไม่ได้จนกว่าจะตั้งโครงสร้างหน่วยงานก่อน
-- SELECT m.id, m.name
-- FROM public.municipalities m
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.departments d
--   WHERE d.municipality_id = m.id AND d.is_active
-- );
--
-- (3) คำร้องเดิมที่ยังไม่มีกอง — พิมพ์ได้แต่จะไม่มีชื่อหัวหน้ากองในแบบพิมพ์
-- SELECT m.name AS municipality, count(*) AS complaints_without_department
-- FROM public.complaints c
-- JOIN public.municipalities m ON m.id = c.municipality_id
-- WHERE c.department_id IS NULL
-- GROUP BY m.name ORDER BY 2 DESC;
--
-- (4) ช่องผู้ลงนามที่ยังว่างอยู่ทุก อปท.
-- SELECT m.name AS municipality, r.role_key, d.name AS department_name
-- FROM public.municipalities m
-- CROSS JOIN (VALUES ('mayor'), ('clerk'), ('department_head')) AS r(role_key)
-- LEFT JOIN public.departments d
--   ON r.role_key = 'department_head' AND d.municipality_id = m.id AND d.is_active
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.document_signatories s
--   WHERE s.municipality_id = m.id AND s.is_active
--     AND s.document_type = 'complaint'
--     AND s.signatory_role = r.role_key
--     AND s.department_id IS NOT DISTINCT FROM d.id
-- )
-- ORDER BY m.name, r.role_key, d.name;
