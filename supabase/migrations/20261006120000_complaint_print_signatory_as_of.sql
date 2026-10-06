-- ใบคำร้อง: ผู้ลงนามล็อกตอนปิดเรื่อง — คำร้องที่ปิดแล้วใช้คนที่ดำรงตำแหน่งตอนปิด คำร้องที่ยังไม่ปิดใช้คนปัจจุบัน
--
-- ปัญหา (เจ้าของระบบแจ้ง 2569-10-06): เปลี่ยนปลัดวันนี้ แล้วคำร้องเก่าที่พิมพ์ซ้ำเปลี่ยนเป็นชื่อปลัดคนใหม่ทุกใบ
-- เพราะ prepare_complaint_print เลือกแถวที่ is_active ณ วันนี้เสมอ
-- คำสั่ง: "เปลี่ยนตอนไหนก็ใช้ตั้งแต่ตอนนั้น อย่ายุ่งของเก่า ชื่อใครชื่อมัน"
--   และ "เรื่องที่ยังไม่เสร็จวันนี้ใช้ชื่อคนใหม่ เพราะคนเก่าออกไปแล้ว กลับมาลงชื่อไม่ได้"
--
-- ไม่ต้องเพิ่มคอลัมน์หรือเติมข้อมูลย้อนหลัง — การเปลี่ยนผู้ลงนามทุกครั้งปิดแถวเก่า (is_active = false,
-- updated_at = เวลาที่เปลี่ยน) แล้วสร้างแถวใหม่ (created_at = เวลาเดียวกัน) ประวัติจึงอยู่ครบในตารางอยู่แล้ว
-- (ตรวจข้อมูลจริง 2569-10-06: ปลัดน้ำเลา แถวเก่า updated_at = แถวใหม่ created_at = 08:54 ตรงกันพอดี)
--
-- ฟังก์ชันนี้ยกมาจากนิยามที่ใช้งานจริงบน production (pg_get_functiondef 2569-10-06 ตรงกับ
-- 20260901170000_manual_document_signatories.sql) แก้เฉพาะส่วนเลือกผู้ลงนาม + เพิ่ม signatories_as_of
-- ใน audit/ค่าที่คืน ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน ห้ามตัดส่วนอื่นทิ้ง
-- สิทธิ์ (REVOKE/GRANT) คงเดิม — CREATE OR REPLACE ไม่ล้างสิทธิ์ของฟังก์ชันเดิม
--
-- ฝั่งหน้าเว็บ (ใบคำขอ E-Service / ใบ บย. / รถรับ-ส่ง / ใบขอใช้รถ) ใช้กติกาเดียวกันที่
-- pickSignatory(..., { at }) ใน src/lib/documentSignatories.js — แก้ที่หนึ่งต้องแก้อีกที่ให้ตรงกัน

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
  --   แถวมีผลตั้งแต่ created_at (เวลาที่แอดมินกดตั้ง) จนถึงเวลาที่มีแถวใหม่มาแทนในช่องเดียวกัน หรือเวลาที่ถูกปิด
  --   (updated_at) แล้วแต่อันไหนก่อน — set_document_signatory_v4 ปิดแถวเก่าในธุรกรรมเดียวกับที่สร้างแถวใหม่
  --   สองค่านี้จึงเท่ากันพอดี · แถวที่ยังใช้อยู่ไม่มีเวลาหมด
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
          WHEN slot.created_at <= v_as_of
            AND (slot.valid_until IS NULL OR v_as_of < slot.valid_until)
            AND (slot.effective_from IS NULL OR slot.effective_from <= v_as_of_date)
            AND (slot.effective_to IS NULL OR slot.effective_to >= v_as_of_date)
            THEN 0
          WHEN v_as_of < slot.first_created_at AND slot.created_at = slot.first_created_at
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
          CASE WHEN signatory.is_active THEN NULL ELSE LEAST(
            signatory.updated_at,
            (
              SELECT min(later.created_at)
              FROM public.document_signatories AS later
              WHERE later.municipality_id = signatory.municipality_id
                AND later.document_type = signatory.document_type
                AND later.signatory_role = signatory.signatory_role
                AND later.department_id IS NOT DISTINCT FROM signatory.department_id
                AND later.custom_label IS NOT DISTINCT FROM signatory.custom_label
                AND later.created_at > signatory.created_at
            )
          ) END AS valid_until,
          min(signatory.created_at) OVER (PARTITION BY signatory.signatory_role) AS first_created_at
        FROM public.document_signatories AS signatory
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
