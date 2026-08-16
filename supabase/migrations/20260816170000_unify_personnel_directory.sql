-- Single Source of Truth สำหรับบุคลากรและผู้ดำรงตำแหน่ง
-- แหล่งหลัก: profiles + positions
-- ตาราง staff เดิมยังคงไว้ชั่วคราวเพื่อ rollback ระหว่าง deploy แต่ไม่มี UI เขียนข้อมูลใหม่

CREATE INDEX IF NOT EXISTS profiles_municipality_position_idx
  ON public.profiles (municipality_id, position_id)
  WHERE position_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_public_personnel_directory(
  p_municipality_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  title text,
  role text,
  photo_url text,
  phone text,
  display_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    profile.id,
    profile.full_name AS name,
    position.name AS title,
    CASE
      WHEN position.name ~ '^(นายกเทศมนตรี|นายกองค์การบริหารส่วนตำบล)' THEN 'mayor'
      WHEN position.name ~ '^รองนายก' THEN 'deputy_mayor'
      WHEN position.name ~ '^ปลัด' THEN 'clerk'
      WHEN position.category = 'dept_head' THEN 'dept_head'
      ELSE 'staff'
    END::text AS role,
    profile.avatar_url AS photo_url,
    NULL::text AS phone,
    position.sort_order AS display_order
  FROM public.profiles AS profile
  JOIN public.positions AS position ON position.id = profile.position_id
  WHERE profile.municipality_id = p_municipality_id
    AND NULLIF(BTRIM(profile.full_name), '') IS NOT NULL
    AND position.category IN ('political_exec', 'top_admin', 'dept_head')
  ORDER BY position.sort_order, profile.full_name;
$$;

COMMENT ON FUNCTION public.get_public_personnel_directory(uuid) IS
  'ข้อมูลผู้ดำรงตำแหน่งที่เผยแพร่ได้จาก profiles + positions; ไม่ส่งเบอร์โทรส่วนตัว';

REVOKE ALL ON FUNCTION public.get_public_personnel_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_personnel_directory(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_personnel_signatories(
  p_municipality_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  title text,
  role text,
  photo_url text,
  phone text,
  display_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = auth.uid()
      AND (
        actor.role = 'superadmin'
        OR (
          actor.municipality_id = p_municipality_id
          AND actor.role IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council')
        )
      )
  ) THEN
    RAISE EXCEPTION 'personnel directory access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    profile.full_name AS name,
    position.name AS title,
    CASE
      WHEN position.name ~ '^(นายกเทศมนตรี|นายกองค์การบริหารส่วนตำบล)' THEN 'mayor'
      WHEN position.name ~ '^รองนายก' THEN 'deputy_mayor'
      WHEN position.name ~ '^ปลัด' THEN 'clerk'
      WHEN position.category = 'dept_head' THEN 'dept_head'
      ELSE 'staff'
    END::text AS role,
    profile.avatar_url AS photo_url,
    profile.phone,
    position.sort_order AS display_order
  FROM public.profiles AS profile
  JOIN public.positions AS position ON position.id = profile.position_id
  WHERE profile.municipality_id = p_municipality_id
    AND NULLIF(BTRIM(profile.full_name), '') IS NOT NULL
    AND position.category IN ('political_exec', 'top_admin', 'dept_head')
  ORDER BY position.sort_order, profile.full_name;
END;
$$;

COMMENT ON FUNCTION public.get_personnel_signatories(uuid) IS
  'รายชื่อผู้ดำรงตำแหน่งสำหรับเอกสารภายใน ตรวจสิทธิ์เทศบาลของผู้เรียก';

REVOKE ALL ON FUNCTION public.get_personnel_signatories(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personnel_signatories(uuid) TO authenticated;

COMMENT ON TABLE public.staff IS
  'DEPRECATED 2026-08-16: ใช้ profiles + positions ผ่าน personnel directory RPC; เก็บชั่วคราวเพื่อ rollback เท่านั้น';
