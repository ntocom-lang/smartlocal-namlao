-- 139_hotfix_profiles_rls_infinite_recursion.sql — HOTFIX
--
-- migration 138 ทำให้เกิด infinite recursion บน profiles RLS (production incident:
-- "login ไรก็เป็น ประชาชน ทั้งหมด")
--
-- สาเหตุ: policy "admins read all profiles"/"technician read profiles" ใส่
-- EXISTS (SELECT 1 FROM complaints ...) ตรงๆ ใน USING clause — subquery นี้รันด้วย
-- role ผู้เรียกจริง (authenticated) ไม่ใช่ SECURITY DEFINER จึงไป trigger RLS ของ
-- ตาราง complaints ต่อ ซึ่ง policy บน complaints (เช่น "users read own complaints")
-- ก็ query กลับมาที่ profiles อีกที -> วนลูปไม่รู้จบ -> ทุก query อ่าน profiles
-- (รวมถึงอ่านโปรไฟล์ตัวเอง) error 42P17 ทันที -> แอปเห็น data เป็น null ->
-- AuthContext.jsx fallback role เป็น 'citizen' ให้ทุกคนไม่ว่า role จริงจะเป็นอะไร
--
-- บทเรียน: EXISTS ที่อ้างตารางอื่นภายใน RLS policy โดยตรง จะไป trigger RLS ของ
-- ตารางนั้นด้วยเสมอ (ไม่ bypass) ถ้าตารางนั้นมี policy ที่ join กลับมาที่ตารางเรา
-- อีกที จะเกิด recursion — ต้องห่อด้วย SECURITY DEFINER function เท่านั้น
-- (แบบเดียวกับ get_users_with_email/get_my_role/get_my_municipality_id)

CREATE OR REPLACE FUNCTION public.profile_linked_to_municipality(p_profile_id uuid, p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.user_id = p_profile_id AND c.municipality_id = p_municipality_id
  );
$$;
REVOKE EXECUTE ON FUNCTION public.profile_linked_to_municipality(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.profile_linked_to_municipality(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'viewer', 'council')
      AND (
        municipality_id = get_my_municipality_id()
        OR (municipality_id IS NULL AND profile_linked_to_municipality(profiles.id, get_my_municipality_id()))
      )
    )
  );

DROP POLICY IF EXISTS "technician read profiles" ON public.profiles;
CREATE POLICY "technician read profiles" ON public.profiles
  FOR SELECT USING (
    get_my_role() = 'technician'
    AND (
      municipality_id = get_my_municipality_id()
      OR (municipality_id IS NULL AND profile_linked_to_municipality(profiles.id, get_my_municipality_id()))
    )
  );
-- History version aligned with linked Supabase project.
