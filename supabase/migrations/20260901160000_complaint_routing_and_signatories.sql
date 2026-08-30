-- Single source of truth สำหรับเส้นทางคำร้องและผู้ลงนามในแบบพิมพ์
--
-- Deployment order:
--   1) apply migration นี้
--   2) ตรวจ preflight และตั้งค่าผู้ลงนามในหน้า Admin
--   3) deploy frontend ที่เรียก submit_citizen_complaint_v4
--
-- Migration เป็น additive: เก็บ category/department แบบ text เดิมไว้เพื่อให้ client เก่ายังทำงาน
-- และยังไม่บังคับ NOT NULL จนกว่าแต่ละ อปท. จะตรวจ mapping ครบแล้ว

ALTER TABLE public.complaint_categories
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES public.complaint_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS complaint_categories_department_idx
  ON public.complaint_categories (municipality_id, department_id);

CREATE INDEX IF NOT EXISTS complaints_category_id_idx
  ON public.complaints (category_id);

CREATE INDEX IF NOT EXISTS complaints_department_id_idx
  ON public.complaints (municipality_id, department_id, created_at DESC);

-- Backfill หมวดมาตรฐาน โดยใช้กองที่มีอยู่จริงในแต่ละ tenant เท่านั้น
-- หมวดสาธารณสุขจะเลือกกองสาธารณสุขก่อน ถ้า tenant ไม่มีจึง fallback สำนักปลัด
-- เพื่อรักษาความสามารถในการรับเรื่องเดิมไว้และให้ Admin แก้ภายหลังจากหน้า UI
WITH desired AS (
  SELECT
    category.id,
    category.municipality_id,
    CASE
      WHEN category.value IN (
        'light','road','road_concrete','road_asphalt','road_slurry','road_gravel',
        'drain','manhole','building','pipe_water','canal','dredge','waterway',
        'water_supply','flood','waste_water','suction'
      ) THEN 'engineering'
      WHEN category.value = 'tax' THEN 'finance'
      WHEN category.value IN ('trash','mosquito','animals','disease','pollution','odor') THEN 'health'
      ELSE 'general'
    END AS route_key
  FROM public.complaint_categories AS category
  WHERE category.department_id IS NULL
), resolved AS (
  SELECT
    desired.id AS category_id,
    (
      SELECT department.id
      FROM public.departments AS department
      WHERE department.municipality_id = desired.municipality_id
        AND department.is_active
        AND (
          (desired.route_key = 'engineering' AND (
            department.code = 'engineering' OR department.name = 'กองช่าง'
          ))
          OR (desired.route_key = 'finance' AND (
            department.code = 'finance' OR department.name = 'กองคลัง'
          ))
          OR (desired.route_key = 'health' AND (
            department.code IN ('health', 'public_health')
            OR department.name ILIKE '%สาธารณสุข%'
            OR department.code = 'general'
            OR department.name = 'สำนักปลัด'
          ))
          OR (desired.route_key = 'general' AND (
            department.code = 'general' OR department.name = 'สำนักปลัด'
          ))
        )
      ORDER BY
        CASE
          WHEN desired.route_key = 'health'
            AND (department.code IN ('health', 'public_health') OR department.name ILIKE '%สาธารณสุข%')
            THEN 0
          ELSE 1
        END,
        department.sort_order,
        department.id
      LIMIT 1
    ) AS department_id
  FROM desired
)
UPDATE public.complaint_categories AS category
SET department_id = resolved.department_id
FROM resolved
WHERE category.id = resolved.category_id
  AND resolved.department_id IS NOT NULL;

-- Backfill คำร้องเก่า: ผูก category ก่อน แล้วพยายามรักษากองที่บันทึกไว้เดิม
UPDATE public.complaints AS complaint
SET category_id = category.id
FROM public.complaint_categories AS category
WHERE complaint.category_id IS NULL
  AND category.municipality_id = complaint.municipality_id
  AND category.value = complaint.category;

UPDATE public.complaints AS complaint
SET department_id = department.id
FROM public.departments AS department
WHERE complaint.department_id IS NULL
  AND department.municipality_id = complaint.municipality_id
  AND complaint.department IS NOT NULL
  AND lower(btrim(complaint.department)) IN (
    lower(btrim(department.name)),
    lower(btrim(coalesce(department.short_name, ''))),
    lower(btrim(coalesce(department.code, '')))
  );

UPDATE public.complaints AS complaint
SET department_id = category.department_id
FROM public.complaint_categories AS category
WHERE complaint.department_id IS NULL
  AND complaint.category_id = category.id
  AND category.municipality_id = complaint.municipality_id
  AND category.department_id IS NOT NULL;

UPDATE public.complaints AS complaint
SET department = department.name
FROM public.departments AS department
WHERE complaint.department_id = department.id
  AND complaint.municipality_id = department.municipality_id
  AND complaint.department IS DISTINCT FROM department.name;

CREATE OR REPLACE FUNCTION public.guard_complaint_routing_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category public.complaint_categories%ROWTYPE;
  v_department public.departments%ROWTYPE;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT * INTO v_department
    FROM public.departments
    WHERE id = NEW.department_id;

    IF NOT FOUND OR v_department.municipality_id <> NEW.municipality_id THEN
      RAISE EXCEPTION 'กอง/หน่วยงานไม่อยู่ในสังกัดเดียวกับข้อมูลนี้' USING ERRCODE = '23503';
    END IF;
  END IF;

  -- complaint_categories มี value แต่ complaints มีทั้ง value เดิมและ category_id ใหม่
  IF TG_TABLE_NAME = 'complaint_categories' THEN
    RETURN NEW;
  END IF;

  -- SECURITY DEFINER submit RPC รุ่นเดิม bypass RLS จึงต้องกัน user_id spoof ที่ trigger ด้วย
  -- ใช้ IS DISTINCT FROM เพื่อให้ anonymous (auth.uid() = NULL) ส่ง user_id ของผู้อื่นไม่ได้
  IF TG_OP = 'INSERT'
    AND auth.role() IN ('anon', 'authenticated')
    AND NEW.user_id IS NOT NULL
    AND NEW.user_id IS DISTINCT FROM auth.uid()
  THEN
    RAISE EXCEPTION 'user_id ไม่ตรงกับผู้ใช้ที่ login' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_category
  FROM public.complaint_categories
  WHERE municipality_id = NEW.municipality_id
    AND value = NEW.category
  ORDER BY is_active DESC, sort_order, id
  LIMIT 1;

  IF FOUND THEN
    NEW.category_id := v_category.id;
    IF v_category.department_id IS NOT NULL THEN
      NEW.department_id := v_category.department_id;
      SELECT * INTO v_department
      FROM public.departments
      WHERE id = v_category.department_id
        AND municipality_id = NEW.municipality_id;
      NEW.department := v_department.name;
    END IF;
  ELSIF NEW.category_id IS NOT NULL THEN
    RAISE EXCEPTION 'ประเภทคำร้องไม่อยู่ในสังกัดเดียวกับคำร้อง' USING ERRCODE = '23503';
  END IF;

  -- รองรับ client เก่าที่ยังส่ง department เป็น text ระหว่าง deploy แบบ rolling
  IF NEW.department_id IS NULL AND NULLIF(btrim(NEW.department), '') IS NOT NULL THEN
    SELECT * INTO v_department
    FROM public.departments
    WHERE municipality_id = NEW.municipality_id
      AND lower(btrim(NEW.department)) IN (
        lower(btrim(name)),
        lower(btrim(coalesce(short_name, ''))),
        lower(btrim(coalesce(code, '')))
      )
    ORDER BY sort_order, id
    LIMIT 1;

    IF FOUND THEN
      NEW.department_id := v_department.id;
      NEW.department := v_department.name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_complaint_category_department_scope
  ON public.complaint_categories;
CREATE TRIGGER trg_guard_complaint_category_department_scope
BEFORE INSERT OR UPDATE OF municipality_id, department_id
ON public.complaint_categories
FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_routing_scope();

DROP TRIGGER IF EXISTS trg_resolve_complaint_routing
  ON public.complaints;
CREATE TRIGGER trg_resolve_complaint_routing
BEFORE INSERT OR UPDATE OF municipality_id, category, category_id, department, department_id
ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.guard_complaint_routing_scope();

-- ผู้ลงนามเป็นการมอบหมายที่ชัดเจน แยกจาก RBAC, position และ assigned technician
CREATE TABLE IF NOT EXISTS public.document_signatories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  document_type       text NOT NULL DEFAULT 'complaint'
    CHECK (document_type IN ('complaint')),
  signatory_role      text NOT NULL
    CHECK (signatory_role IN ('department_head', 'clerk', 'mayor')),
  department_id       uuid REFERENCES public.departments(id) ON DELETE RESTRICT,
  profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title_override      text,
  authority_reference text,
  effective_from      date NOT NULL DEFAULT (timezone('Asia/Bangkok', now())::date),
  effective_to        date,
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (signatory_role = 'department_head' AND department_id IS NOT NULL)
    OR (signatory_role IN ('clerk', 'mayor') AND department_id IS NULL)
  ),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (title_override IS NULL OR length(title_override) <= 250),
  CHECK (authority_reference IS NULL OR length(authority_reference) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_signatories_one_active_scope_idx
  ON public.document_signatories (
    municipality_id,
    document_type,
    signatory_role,
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE is_active;

CREATE INDEX IF NOT EXISTS document_signatories_profile_idx
  ON public.document_signatories (profile_id, is_active);

ALTER TABLE public.document_signatories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read own municipality document signatories"
  ON public.document_signatories;
CREATE POLICY "staff read own municipality document signatories"
ON public.document_signatories
FOR SELECT TO authenticated
USING (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council')
    AND municipality_id = public.get_my_municipality_id()
  )
);

DROP POLICY IF EXISTS "admin manage own municipality document signatories"
  ON public.document_signatories;
CREATE POLICY "admin manage own municipality document signatories"
ON public.document_signatories
FOR ALL TO authenticated
USING (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
)
WITH CHECK (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
);

-- Frontend อ่านผ่าน RLS แต่แก้ไขได้เฉพาะ SECURITY DEFINER RPC ด้านล่าง
REVOKE ALL ON TABLE public.document_signatories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.document_signatories TO authenticated;

CREATE TABLE IF NOT EXISTS public.complaint_print_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  complaint_id    uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  template_version text NOT NULL,
  department_id   uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  department_name text,
  signatories     jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_roles   text[] NOT NULL DEFAULT '{}'::text[],
  generated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS complaint_print_snapshots_complaint_time_idx
  ON public.complaint_print_snapshots (complaint_id, generated_at DESC);

ALTER TABLE public.complaint_print_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read complaint print snapshots"
  ON public.complaint_print_snapshots;
CREATE POLICY "admin read complaint print snapshots"
ON public.complaint_print_snapshots
FOR SELECT TO authenticated
USING (
  public.get_my_role() = 'superadmin'
  OR (
    public.get_my_role() = 'admin'
    AND municipality_id = public.get_my_municipality_id()
  )
);

REVOKE ALL ON TABLE public.complaint_print_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.complaint_print_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public.set_document_signatory(
  p_municipality_id uuid,
  p_signatory_role text,
  p_profile_id uuid,
  p_department_id uuid DEFAULT NULL,
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

  IF NOT EXISTS (
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

  IF p_signatory_role = 'department_head'
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_profile_id AND department_id = p_department_id
    )
    AND NULLIF(btrim(p_authority_reference), '') IS NULL
  THEN
    RAISE EXCEPTION 'ผู้ลงนามอยู่นอกกอง ต้องระบุเลขที่คำสั่ง/หนังสือรักษาราชการแทน'
      USING ERRCODE = '23514';
  END IF;

  -- รุ่นนี้เก็บผู้ลงนามปัจจุบันหนึ่งคนต่อ scope; ไม่รับการตั้งล่วงหน้าเพราะจะทำให้
  -- ผู้ลงนามเดิมถูกปิดก่อนวันที่รายการใหม่เริ่มมีผล
  IF p_effective_from IS NULL OR p_effective_from > v_today THEN
    RAISE EXCEPTION 'วันที่เริ่มมีผลต้องไม่เกินวันปัจจุบัน' USING ERRCODE = '22007';
  END IF;

  IF p_effective_to IS NOT NULL
    AND (p_effective_to < p_effective_from OR p_effective_to < v_today)
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
    title_override, authority_reference, effective_from, effective_to,
    created_by
  ) VALUES (
    p_municipality_id, 'complaint', p_signatory_role, p_department_id, p_profile_id,
    NULLIF(btrim(p_title_override), ''), NULLIF(btrim(p_authority_reference), ''),
    p_effective_from, p_effective_to, auth.uid()
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
      'profile_id', p_profile_id,
      'department_id', p_department_id,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'authority_reference', NULLIF(btrim(p_authority_reference), '')
    )
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_document_signatory(
  p_municipality_id uuid,
  p_signatory_role text,
  p_department_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
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
    AND is_active;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_label, metadata
  ) VALUES (
    p_municipality_id, auth.uid(), v_actor.full_name, v_actor.role,
    'clear_document_signatory', 'document_signatory', p_signatory_role,
    jsonb_build_object('department_id', p_department_id)
  );
END;
$$;

-- ใช้เฉพาะแบบพิมพ์ของคำร้อง: resolve ผู้ลงนาม, ตรวจสิทธิ์, snapshot และ audit ใน transaction เดียว
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
      WHEN v_actor.role IN ('officer', 'staff') THEN NOT (
        v_complaint.assigned_to = v_actor.id
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
      profile.full_name,
      coalesce(
        NULLIF(btrim(signatory.title_override), ''),
        NULLIF(btrim(profile.job_title), ''),
        position.name
      ) AS title,
      signatory.authority_reference,
      signatory.effective_from,
      signatory.effective_to
    FROM public.document_signatories AS signatory
    JOIN public.profiles AS profile ON profile.id = signatory.profile_id
    LEFT JOIN public.positions AS position ON position.id = profile.position_id
    WHERE signatory.municipality_id = v_complaint.municipality_id
      AND profile.municipality_id = v_complaint.municipality_id
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

-- RPC รุ่นใหม่ไม่รับ department จาก Browser; resolve category + department ใน DB เท่านั้น
CREATE OR REPLACE FUNCTION public.submit_citizen_complaint_v4(
  p_id              uuid,
  p_municipality_id uuid,
  p_category        text,
  p_form_type       text,
  p_village         text,
  p_detail          text,
  p_phone           text,
  p_reporter_name   text,
  p_latitude        double precision,
  p_longitude       double precision,
  p_user_id         uuid,
  p_channel         text,
  p_issue_type      text DEFAULT NULL,
  p_extra_data      jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, ref_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category public.complaint_categories%ROWTYPE;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id ไม่ตรงกับผู้ใช้ที่ login' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL OR p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'ข้อมูลอ้างอิงคำร้องไม่ครบ' USING ERRCODE = '22023';
  END IF;

  IF p_channel NOT IN ('citizen_online', 'oss_counter') THEN
    RAISE EXCEPTION 'ช่องทางรับคำร้องไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(p_detail), '') IS NULL
    OR char_length(btrim(p_detail)) < 10
    OR char_length(p_detail) > 5000
  THEN
    RAISE EXCEPTION 'รายละเอียดคำร้องต้องมี 10-5000 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(p_phone), '') IS NULL OR char_length(p_phone) > 30 THEN
    RAISE EXCEPTION 'เบอร์โทรติดต่อไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF char_length(coalesce(p_reporter_name, '')) > 250
    OR char_length(coalesce(p_village, '')) > 250
    OR char_length(coalesce(p_issue_type, '')) > 250
  THEN
    RAISE EXCEPTION 'ข้อมูลข้อความยาวเกินขอบเขตที่กำหนด' USING ERRCODE = '22023';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
    OR (p_latitude IS NOT NULL AND (p_latitude < -90 OR p_latitude > 90))
    OR (p_longitude IS NOT NULL AND (p_longitude < -180 OR p_longitude > 180))
  THEN
    RAISE EXCEPTION 'พิกัดไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  IF p_extra_data IS NOT NULL AND (
    jsonb_typeof(p_extra_data) <> 'object'
    OR pg_column_size(p_extra_data) > 65536
  ) THEN
    RAISE EXCEPTION 'ข้อมูลประกอบคำร้องไม่ถูกต้องหรือมีขนาดเกิน 64 KB' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_category
  FROM public.complaint_categories
  WHERE municipality_id = p_municipality_id
    AND value = p_category
    AND is_active
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ประเภทคำร้องนี้ยังไม่เปิดใช้งาน' USING ERRCODE = '22023';
  END IF;

  IF v_category.department_id IS NULL THEN
    RAISE EXCEPTION 'ประเภทคำร้องนี้ยังไม่ได้กำหนดกองรับผิดชอบ' USING ERRCODE = '23502';
  END IF;

  INSERT INTO public.complaints (
    id, municipality_id, category_id, category, form_type, village, detail, phone,
    reporter_name, latitude, longitude, user_id, channel, department_id,
    issue_type, extra_data
  ) VALUES (
    p_id, p_municipality_id, v_category.id, p_category, p_form_type, p_village,
    p_detail, p_phone, p_reporter_name, p_latitude, p_longitude, p_user_id,
    p_channel, v_category.department_id, p_issue_type, p_extra_data
  );

  RETURN QUERY
  SELECT complaint.id, complaint.ref_no
  FROM public.complaints AS complaint
  WHERE complaint.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_signatory(
  uuid, text, uuid, uuid, text, text, date, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_signatory(
  uuid, text, uuid, uuid, text, text, date, date
) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_document_signatory(uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_document_signatory(uuid, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.prepare_complaint_print(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_complaint_print(uuid, boolean)
  TO authenticated;

REVOKE ALL ON FUNCTION public.submit_citizen_complaint_v4(
  uuid, uuid, text, text, text, text, text, text,
  double precision, double precision, uuid, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_citizen_complaint_v4(
  uuid, uuid, text, text, text, text, text, text,
  double precision, double precision, uuid, text, text, jsonb
) TO anon, authenticated;

COMMENT ON TABLE public.document_signatories IS
  'การกำหนดผู้ลงนามเอกสารอย่างชัดเจน แยกจาก RBAC/ตำแหน่ง/ผู้รับผิดชอบงาน';
COMMENT ON TABLE public.complaint_print_snapshots IS
  'Snapshot ชื่อและตำแหน่งผู้ลงนามทุกครั้งที่เตรียมแบบพิมพ์ เพื่อ audit และกันประวัติเปลี่ยนตามบุคลากรปัจจุบัน';

-- Preflight หลัง apply (อ่านอย่างเดียว):
-- SELECT municipality_id, value, label FROM public.complaint_categories
-- WHERE is_active AND department_id IS NULL ORDER BY municipality_id, sort_order;
-- SELECT m.id, m.name, d.id AS department_id, d.name AS department_name
-- FROM public.municipalities m CROSS JOIN public.departments d
-- WHERE d.municipality_id = m.id AND d.is_active
--   AND NOT EXISTS (
--     SELECT 1 FROM public.document_signatories s
--     WHERE s.municipality_id = m.id AND s.is_active
--       AND s.signatory_role = 'department_head' AND s.department_id = d.id
--   );
