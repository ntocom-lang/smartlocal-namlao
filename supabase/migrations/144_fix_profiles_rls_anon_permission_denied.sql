-- 144_fix_profiles_rls_anon_permission_denied.sql — HOTFIX
--
-- production incident: guest (ไม่ล็อกอิน = role anon) ยื่นคำร้องไม่ได้ ได้ error
-- "permission denied for function profile_linked_to_municipality"
--
-- สาเหตุ: migration 139 สร้าง policy "admins read all profiles" และ
-- "technician read profiles" บนตาราง profiles โดยไม่ได้ใส่ `TO authenticated`
-- กำกับ — ตาม Postgres, policy ที่ไม่ระบุ TO จะผูกกับ PUBLIC คือใช้กับทุก role
-- รวมถึง anon ด้วย แม้เนื้อหา policy จะตั้งใจให้เฉพาะ admin/technician เห็นข้อมูล
-- ก็ตาม เมื่อ anon ยิง query ใดๆ ที่ทำให้ Postgres ต้อง evaluate policy นี้
-- (เช่น RETURNING ของ insert ที่เกี่ยวโยงไปแตะ profiles ผ่าน FK/trigger) Postgres
-- ต้องเช็คสิทธิ์ EXECUTE บนฟังก์ชัน profile_linked_to_municipality() ที่ policy
-- เรียกใช้ก่อนเสมอ — และ migration 139 revoke สิทธิ์นี้จาก anon ไว้แล้ว (ตั้งใจ)
-- ผลคือ anon ชน permission-denied ทันทีแม้ query จริงจะไม่เกี่ยวกับ branch
-- admin/technician เลยก็ตาม
--
-- บทเรียน: policy ที่เรียก SECURITY DEFINER function ที่จำกัดสิทธิ์ EXECUTE
-- เฉพาะ authenticated ต้องใส่ `TO authenticated` กำกับตัว policy เองด้วยเสมอ
-- ไม่งั้น anon จะโดน permission check ของฟังก์ชันนั้นไปด้วยทั้งที่ไม่ควรถูกเรียก

DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (
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
  FOR SELECT TO authenticated USING (
    get_my_role() = 'technician'
    AND (
      municipality_id = get_my_municipality_id()
      OR (municipality_id IS NULL AND profile_linked_to_municipality(profiles.id, get_my_municipality_id()))
    )
  );
