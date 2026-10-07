-- ผู้ลงนาม: ระบุ "มีผลตั้งแต่" ย้อนหลังได้ไม่เกิน 30 วัน
--
-- ปัญหา (เจ้าของระบบแจ้ง 2569-10-07): ปลัดน้ำเลาคนใหม่เริ่มลงนามตั้งแต่ 5 ต.ค. แต่แอดมินตั้งในระบบ 6 ต.ค. 08:54
-- เอกสารที่เสร็จระหว่างนั้น (ตรวจแล้ว: คำร้องเลขที่ 166 ปิด 5 ต.ค. 16:35) จึงยังพิมพ์ชื่อปลัดคนเก่า
-- เพราะกติกาเดิม (20261006120000) ถือว่าแถวมีผลตั้งแต่ created_at = เวลาที่กดตั้ง
-- คำสั่ง: ให้ระบุวันมีผลได้ และเริ่มใช้ตามวันที่ตั้ง · ย้อนหลังได้ไม่เกิน 30 วัน · ไม่ทำตั้งล่วงหน้า
--
-- กติกาใหม่ (starts_at):
--   effective_from ก่อนวันที่กดตั้ง (เวลาไทย) = เริ่มมีผล 00:00 น. ของ effective_from ตามเวลาไทย
--   นอกนั้น = created_at เหมือนเดิม (ละเอียดถึงวินาที)
--   แถวเก่าหมดผลเมื่อแถวที่ตั้งทีหลังเริ่มมีผล (เดิม: เมื่อแถวที่ตั้งทีหลังถูกสร้าง)
-- แถวเดิมทั้ง 41 แถวบน production มี effective_from = วันที่กดตั้งทุกแถว (ตรวจ 2569-10-07)
-- ผลการเลือกผู้ลงนามของเอกสารทุกฉบับที่มีอยู่จึงไม่เปลี่ยน จนกว่าแอดมินจะตั้งวันย้อนหลังเอง
--
-- ด่านใน set_document_signatory_v4 (ลายเซ็นฟังก์ชันเดิม สิทธิ์เดิม):
--   1. ย้อนได้ไม่เกิน 30 วัน — กันพิมพ์เดือน/ปีผิดแล้วชื่อบนเอกสารเก่าเปลี่ยนเป็นวงกว้าง
--   2. ห้ามย้อนไปก่อนวันที่ "คนอื่น" ในช่องเดียวกันเริ่มมีผล — ไม่งั้นชื่อคนนั้นหายจากเอกสารทุกฉบับ
--      คนเดียวกัน (ชื่อที่พิมพ์ตรงกันเมื่อตัดช่องว่าง) ย้อนทับได้ — เช่นตั้งปลัดคนใหม่ซ้ำโดยเลือก 5 ต.ค.
--
-- ฟังก์ชันทั้งสองยกมาจากนิยามที่ใช้งานจริงบน production (md5(prosrc) 2569-10-07 ตรงกับ
-- 20261006120000_complaint_print_signatory_as_of.sql และ 20260904180000_signatory_vehicle_default_flag.sql)
-- แก้เฉพาะส่วนที่ระบุ ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน ห้ามตัดส่วนอื่นทิ้ง
-- สิทธิ์ (REVOKE/GRANT) คงเดิม — CREATE OR REPLACE ไม่ล้างสิทธิ์ของฟังก์ชันเดิม
-- ย้อนกลับ: รันส่วน CREATE OR REPLACE ของสองไฟล์ข้างบนซ้ำ (แถวที่ตั้งย้อนหลังไปแล้วจะกลับไปมีผลตาม created_at)
--
-- ฝั่งหน้าเว็บใช้กติกาเดียวกันที่ startsAt() ใน src/lib/documentSignatories.js — แก้ที่หนึ่งต้องแก้อีกที่ให้ตรงกัน

CREATE OR REPLACE FUNCTION public.prepare_complaint_print(p_complaint_id uuid, p_allow_blank_signatories boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_complaint public.complaints%ROWTYPE;
  v_department_name text;
  v_signatories jsonb := '{}'::jsonb;
  v_missing text[] := '{}'::text[];
  v_snapshot_id uuid;
  -- เวลาที่ใช้เลือกผู้ลงนาม: ปิดเรื่องแล้ว = เวลาปิด · ยังไม่ปิด = ตอนนี้ (กำหนดหลังโหลดคำร้อง)
  v_as_of timestamptz;
  v_as_of_date date;
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

  -- สถานะที่ถือว่าเรื่องจบแล้ว ตรงกับ complaintWorkflow.js (FINISHED_STATUSES + 'done' ขั้นเก่า) และ 'rejected'
  -- คำร้องที่ปิดก่อนระบบเริ่มบันทึก closed_at ใช้ updated_at แทน
  v_as_of := CASE
    WHEN v_complaint.status IN ('closed', 'completed', 'done', 'rejected')
      THEN coalesce(v_complaint.closed_at, v_complaint.updated_at, now())
    ELSE now()
  END;
  v_as_of_date := timezone('Asia/Bangkok', v_as_of)::date;

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
  -- ผู้ลงนาม ณ v_as_of (ปิดเรื่องแล้ว = ตอนปิด · ยังไม่ปิด = ตอนนี้) — เจ้าของระบบสั่ง 2569-10-06
  -- (เดิมเลือกแถวที่ is_active ณ วันนี้ เปลี่ยนปลัดแล้วคำร้องที่ปิดไปแล้วทุกใบเปลี่ยนชื่อตาม)
  -- กติกาต้องตรงกับ pickSignatory แบบมี at ใน src/lib/documentSignatories.js:
  --   แถวมีผลตั้งแต่ starts_at จนถึงเวลาที่แถวที่ตั้งทีหลังในช่องเดียวกันเริ่มมีผล หรือเวลาที่ถูกปิด
  --   (updated_at) แล้วแต่อันไหนก่อน · แถวที่ยังใช้อยู่ไม่มีเวลาหมด
  --   starts_at = created_at (เวลาที่แอดมินกดตั้ง) ยกเว้นแอดมินระบุวันมีผลย้อนหลัง (effective_from ก่อนวันที่กดตั้ง)
  --   = 00:00 น. ของ effective_from ตามเวลาไทย — เจ้าของระบบสั่ง 2569-10-07 (ปลัดน้ำเลามีผล 5 ต.ค. ตั้งในระบบ 6 ต.ค.)
  --   คำร้องที่ปิดก่อนเริ่มตั้งทะเบียนช่องนั้น = ผู้ลงนามคนแรกของช่อง (ใกล้ความจริงที่สุดที่ระบบรู้)
  FROM (
    SELECT DISTINCT ON (ranked.signatory_role)
      ranked.signatory_role,
      ranked.assignment_id,
      ranked.profile_id,
      ranked.full_name,
      ranked.title,
      ranked.authority_reference,
      ranked.effective_from,
      ranked.effective_to
    FROM (
      SELECT
        slot.*,
        CASE
          WHEN slot.starts_at <= v_as_of
            AND (slot.valid_until IS NULL OR v_as_of < slot.valid_until)
            AND (slot.effective_from IS NULL OR slot.effective_from <= v_as_of_date)
            AND (slot.effective_to IS NULL OR slot.effective_to >= v_as_of_date)
            THEN 0
          WHEN v_as_of < slot.first_starts_at AND slot.starts_at = slot.first_starts_at
            THEN 1
        END AS pick_rank
      FROM (
        SELECT
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
          signatory.effective_to,
          signatory.created_at,
          signatory_start.starts_at,
          CASE WHEN signatory.is_active THEN NULL ELSE LEAST(
            signatory.updated_at,
            (
              SELECT min(CASE
                  WHEN later.effective_from < timezone('Asia/Bangkok', later.created_at)::date
                    THEN later.effective_from::timestamp AT TIME ZONE 'Asia/Bangkok'
                  ELSE later.created_at
                END)
              FROM public.document_signatories AS later
              WHERE later.municipality_id = signatory.municipality_id
                AND later.document_type = signatory.document_type
                AND later.signatory_role = signatory.signatory_role
                AND later.department_id IS NOT DISTINCT FROM signatory.department_id
                AND later.custom_label IS NOT DISTINCT FROM signatory.custom_label
                AND later.created_at > signatory.created_at
            )
          ) END AS valid_until,
          min(signatory_start.starts_at) OVER (PARTITION BY signatory.signatory_role) AS first_starts_at
        FROM public.document_signatories AS signatory
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN signatory.effective_from < timezone('Asia/Bangkok', signatory.created_at)::date
              THEN signatory.effective_from::timestamp AT TIME ZONE 'Asia/Bangkok'
            ELSE signatory.created_at
          END AS starts_at
        ) AS signatory_start
        LEFT JOIN public.profiles AS profile ON profile.id = signatory.profile_id
        LEFT JOIN public.positions AS position ON position.id = profile.position_id
        WHERE signatory.municipality_id = v_complaint.municipality_id
          AND (profile.id IS NULL OR profile.municipality_id = v_complaint.municipality_id)
          AND signatory.document_type = 'complaint'
          AND (
            (signatory.signatory_role = 'department_head'
              AND signatory.department_id = v_complaint.department_id)
            OR (signatory.signatory_role IN ('clerk', 'mayor')
              AND signatory.department_id IS NULL)
          )
      ) AS slot
    ) AS ranked
    WHERE ranked.pick_rank IS NOT NULL
      -- ตอนแต่งตั้งบังคับว่าต้องมีชื่อ แต่เจ้าตัวอาจมาล้าง full_name ในโปรไฟล์ทีหลัง
      -- ถ้าไม่กรองตรงนี้ role นั้นจะถูกนับว่า "มีผู้ลงนามแล้ว" แล้วพิมพ์วงเล็บเปล่าออกไปเป็นเอกสารราชการ
      -- ⚠️ กรองหลังเลือกคนแล้ว — คนที่ดำรงตำแหน่งตอนนั้นไม่มีชื่อ = เว้นช่องให้เขียนมือ ห้ามเอาคนอื่นมาแทน
      AND ranked.full_name IS NOT NULL
    ORDER BY ranked.signatory_role, ranked.pick_rank, ranked.created_at DESC
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
      'blank_signatories_allowed', p_allow_blank_signatories,
      'signatories_as_of', v_as_of
    )
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'template_version', 'council-complaint-v2',
    'department_id', v_complaint.department_id,
    'department_name', coalesce(v_department_name, v_complaint.department),
    'signatories', v_signatories,
    'missing_roles', to_jsonb(v_missing),
    'ready', cardinality(v_missing) = 0,
    'signatories_as_of', v_as_of
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_document_signatory_v4(
  p_municipality_id uuid,
  p_signatory_role text,
  p_department_id uuid DEFAULT NULL,
  p_profile_id uuid DEFAULT NULL,
  p_manual_name text DEFAULT NULL,
  p_title_override text DEFAULT NULL,
  p_authority_reference text DEFAULT NULL,
  p_effective_from date DEFAULT (timezone('Asia/Bangkok', now())::date),
  p_effective_to date DEFAULT NULL,
  p_custom_label text DEFAULT NULL,
  p_is_vehicle_order_default boolean DEFAULT false
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
  -- หน้าจอส่ง p_effective_from เป็น NULL เมื่อแอดมินไม่ได้เปลี่ยนวัน (= วันนี้) แล้วให้ DB เป็นคนกำหนดวันที่ตามเวลา Asia/Bangkok
  -- เหตุผล: นาฬิกา/timezone ของเครื่องผู้ใช้เชื่อไม่ได้ ถ้าเครื่องล้ำไปวันหน้าจะโดน 22007
  -- โดยที่ผู้ใช้ไม่มีทางเดาสาเหตุ — ส่งวันที่จริงมาเฉพาะตอนแอดมินเลือกวันมีผลย้อนหลัง (2569-10-07)
  v_effective_from date := coalesce(p_effective_from, v_today);
  -- ย้อนหลังได้ไม่เกิน 30 วัน — เจ้าของระบบเลือก 2569-10-07 (หน้าจอใช้ SIGNATORY_BACKDATE_LIMIT_DAYS ค่าเดียวกัน)
  v_earliest date := timezone('Asia/Bangkok', now())::date - 30;
  v_thai_months text[] := ARRAY['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  v_new_identity text;
  v_shadowed_name text;
  v_shadowed_date date;
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

  -- หัวหน้ากองไม่ใช่ผู้มีอำนาจสั่งใช้รถ — อำนาจสั่งใช้รถเป็นของผู้บริหารท้องถิ่น
  -- หรือผู้รับมอบอำนาจตามคำสั่ง การติ๊กให้หัวหน้ากองคือระบุผู้ไม่มีอำนาจลงในเอกสาร
  IF p_is_vehicle_order_default AND p_signatory_role = 'department_head' THEN
    RAISE EXCEPTION 'หัวหน้ากองตั้งเป็นผู้มีอำนาจสั่งใช้รถไม่ได้' USING ERRCODE = '22023';
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

  -- กันพิมพ์เดือน/ปีผิดแล้วชื่อบนเอกสารที่เสร็จไปแล้วเปลี่ยนเป็นวงกว้าง
  IF v_effective_from < v_earliest THEN
    RAISE EXCEPTION 'วันที่มีผลย้อนหลังได้ไม่เกิน 30 วัน (เลือกได้ตั้งแต่ % % %)',
      extract(day FROM v_earliest)::int, v_thai_months[extract(month FROM v_earliest)::int],
      extract(year FROM v_earliest)::int + 543
      USING ERRCODE = '22007';
  END IF;

  -- ย้อนหลังแล้วต้องไม่กลบช่วงของ "คนอื่น" ทั้งช่วง — แถวที่ตั้งทีหลังมีผลทับแถวที่เริ่มหลังวันมีผลของมันทั้งหมด
  -- ถ้าคนนั้นไม่ใช่คนเดียวกับที่กำลังตั้ง ชื่อของเขาจะหายจากเอกสารทุกฉบับในช่วงที่เขาดำรงตำแหน่ง
  -- คนเดียวกัน = ชื่อที่พิมพ์ตรงกันเมื่อตัดช่องว่างทั้งหมด (ตั้งคนเดิมซ้ำเพื่อเลื่อนวันมีผลย้อนไปได้)
  -- starts_at ของแถวเดิมใช้กติกาเดียวกับ prepare_complaint_print ข้างบน
  IF v_effective_from < v_today THEN
    v_new_identity := regexp_replace(
      coalesce(v_manual_name, (SELECT full_name FROM public.profiles WHERE id = p_profile_id), ''),
      '[[:space:]]', '', 'g');

    SELECT shadowed.full_name, timezone('Asia/Bangkok', shadowed.starts_at)::date
    INTO v_shadowed_name, v_shadowed_date
    FROM (
      SELECT
        coalesce(NULLIF(btrim(existing.manual_name), ''), NULLIF(btrim(profile.full_name), ''), '') AS full_name,
        CASE
          WHEN existing.effective_from < timezone('Asia/Bangkok', existing.created_at)::date
            THEN existing.effective_from::timestamp AT TIME ZONE 'Asia/Bangkok'
          ELSE existing.created_at
        END AS starts_at
      FROM public.document_signatories AS existing
      LEFT JOIN public.profiles AS profile ON profile.id = existing.profile_id
      WHERE existing.municipality_id = p_municipality_id
        AND existing.document_type = 'complaint'
        AND existing.signatory_role = p_signatory_role
        AND existing.department_id IS NOT DISTINCT FROM p_department_id
        AND existing.custom_label IS NOT DISTINCT FROM v_custom_label
    ) AS shadowed
    WHERE shadowed.starts_at >= v_effective_from::timestamp AT TIME ZONE 'Asia/Bangkok'
      AND regexp_replace(shadowed.full_name, '[[:space:]]', '', 'g') <> v_new_identity
    ORDER BY shadowed.starts_at
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'ย้อนวันที่มีผลไปถึงวันที่ % % % ไม่ได้ เพราะ % เริ่มมีผลในช่องนี้หลังวันนั้น ชื่อของคนนั้นจะหายจากเอกสารทุกฉบับ — เลือกวันหลังวันที่ % % %',
        extract(day FROM v_effective_from)::int, v_thai_months[extract(month FROM v_effective_from)::int],
        extract(year FROM v_effective_from)::int + 543,
        coalesce(NULLIF(v_shadowed_name, ''), 'ผู้ลงนามคนก่อน'),
        extract(day FROM v_shadowed_date)::int, v_thai_months[extract(month FROM v_shadowed_date)::int],
        extract(year FROM v_shadowed_date)::int + 543
        USING ERRCODE = '22007';
    END IF;
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

  -- ติ๊กได้แถวเดียวต่อ อปท. — ย้ายเครื่องหมายมาที่แถวใหม่ ต้องปลดของแถวเดิมก่อนเสมอ
  IF p_is_vehicle_order_default THEN
    UPDATE public.document_signatories
    SET is_vehicle_order_default = false, updated_at = now()
    WHERE municipality_id = p_municipality_id
      AND is_active
      AND is_vehicle_order_default;
  END IF;

  INSERT INTO public.document_signatories (
    municipality_id, document_type, signatory_role, department_id, profile_id,
    manual_name, title_override, authority_reference, effective_from, effective_to,
    created_by, custom_label, is_vehicle_order_default
  ) VALUES (
    p_municipality_id, 'complaint', p_signatory_role, p_department_id, p_profile_id,
    v_manual_name, v_title_override, NULLIF(btrim(p_authority_reference), ''),
    v_effective_from, p_effective_to, auth.uid(), v_custom_label, p_is_vehicle_order_default
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
      'is_vehicle_order_default', p_is_vehicle_order_default,
      'effective_from', v_effective_from,
      'effective_to', p_effective_to,
      -- ตั้งวันมีผลย้อนหลัง = ชื่อบนเอกสารที่เสร็จตั้งแต่วันนั้นเปลี่ยนตาม ต้องค้นย้อนได้ว่าใครตั้งเมื่อไร
      'backdated', v_effective_from < v_today,
      -- เลขที่คำสั่ง/หนังสือรักษาราชการแทนเป็นเลขเอกสารราชการ ไม่ใช่ข้อมูลส่วนบุคคล จึงเก็บเต็มไว้ใน
      -- audit trail ได้ (สตง./ป.ป.ช. ต้องตรวจย้อนได้ว่าใครลงนามโดยอาศัยอำนาจตามหนังสือฉบับใด)
      -- ส่วนชื่อผู้ลงนามยังคงไม่สำเนาลง metadata — อ่านจาก document_signatories/print snapshot แทน
      'authority_reference', NULLIF(btrim(p_authority_reference), '')
    )
  );

  RETURN v_result;
END;
$$;
