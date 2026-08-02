-- Role Hardening: officer = ธุรการกอง ไม่ใช่ผู้ดูแลระบบ
-- ระบบและข้อมูลข้ามกองสงวนให้ admin/superadmin เท่านั้น

BEGIN;

-- 1) การตั้งค่าระดับเทศบาล
DROP POLICY IF EXISTS "admin can update municipalities" ON public.municipalities;
CREATE POLICY "admin can update municipalities" ON public.municipalities
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() = 'admin'
      AND id = public.get_my_municipality_id()
    )
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() = 'admin'
      AND id = public.get_my_municipality_id()
    )
  );

CREATE OR REPLACE FUNCTION public.update_municipality_logo(
  p_municipality_id uuid,
  p_logo_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_role <> 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities
  SET logo_url = p_logo_url
  WHERE id = p_municipality_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_municipality_qr(
  p_municipality_id uuid,
  p_qr_code_url text,
  p_qr_label text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_role <> 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities
  SET qr_code_url = p_qr_code_url,
      qr_label = p_qr_label
  WHERE id = p_municipality_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_municipality_settings(
  p_municipality_id uuid,
  p_system_name text,
  p_system_subtitle text,
  p_pwa_short_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_role <> 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities
  SET system_name = p_system_name,
      system_subtitle = p_system_subtitle,
      pwa_short_name = p_pwa_short_name
  WHERE id = p_municipality_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_municipality_logo(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_municipality_qr(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_municipality_settings(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_municipality_logo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_municipality_qr(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_municipality_settings(uuid, text, text, text) TO authenticated;

-- 2) สมุดรายชื่อบุคลากร: ธุรการกองเห็นบุคลากรในกองเดียวกัน และผู้ยื่นคำร้องที่เกี่ยวข้อง
DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() IN ('admin', 'viewer', 'council')
      AND (
        municipality_id = public.get_my_municipality_id()
        OR (
          municipality_id IS NULL
          AND public.profile_linked_to_municipality(profiles.id, public.get_my_municipality_id())
        )
      )
    )
    OR (
      public.get_my_role() = 'officer'
      AND (
        (
          municipality_id = public.get_my_municipality_id()
          AND department_id IS NOT NULL
          AND department_id = public.get_my_department_id()
        )
        OR public.profile_linked_to_municipality(profiles.id, public.get_my_municipality_id())
      )
    )
  );

-- 3) งานตั้งค่าการมอบหมายหมวดคำร้องเป็นหน้าที่ Admin
DROP POLICY IF EXISTS "admin manage category assignments" ON public.category_assignments;
CREATE POLICY "admin manage category assignments" ON public.category_assignments
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

-- 4) Audit Log เป็นข้อมูลกำกับดูแล ไม่เปิดให้ธุรการกองอ่านทั้งเทศบาล
DROP POLICY IF EXISTS "admin can read audit logs" ON public.audit_logs;
CREATE POLICY "admin can read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() = 'admin'
      AND municipality_id = public.get_my_municipality_id()
    )
  );

-- 5) ลบ policy เขียนแบนเนอร์ที่ยังอ้าง officer จาก schema drift แล้วสร้างสิทธิ์มาตรฐาน
DO $do$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT pol.polname
    FROM pg_catalog.pg_policy AS pol
    WHERE pol.polrelid = 'public.banners'::regclass
      AND pol.polcmd IN ('a', 'w', 'd', '*')
      AND (
        COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%officer%'
        OR COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%officer%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.banners', policy_row.polname);
  END LOOP;
END;
$do$;

DROP POLICY IF EXISTS "admin insert own municipality banners" ON public.banners;
DROP POLICY IF EXISTS "admin update own municipality banners" ON public.banners;
DROP POLICY IF EXISTS "admin delete own municipality banners" ON public.banners;

CREATE POLICY "admin insert own municipality banners" ON public.banners
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );
CREATE POLICY "admin update own municipality banners" ON public.banners
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );
CREATE POLICY "admin delete own municipality banners" ON public.banners
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

-- 6) หัวหน้ากองไม่ใช่ธุรการกอง: authority มาจาก profiles.is_dept_head
UPDATE public.positions
SET role = 'staff'
WHERE category = 'dept_head'
  AND role = 'officer';

COMMIT;
