-- 138_fix_profiles_pii_and_complaint_userid_spoof.sql
--
-- [1] profiles: "admins read all profiles"/"technician read profiles" มีเงื่อนไข
-- "municipality_id IS NULL" แบบไม่มีเงื่อนไขต่อ ทำให้ staff/officer/viewer/council/
-- technician ของเทศบาลใดก็ได้ อ่านโปรไฟล์ citizen ที่ยังไม่ผูก municipality ได้ทั้งหมด
-- (ไม่ join กลับไปเช็คว่า citizen คนนั้นเกี่ยวข้องกับเทศบาลตัวเองจริงไหม)
-- แก้ให้ใช้ pattern เดียวกับ get_users_with_email (EXISTS ผ่าน complaints)

DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'viewer', 'council')
      AND (
        municipality_id = get_my_municipality_id()
        OR (
          municipality_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.complaints c
            WHERE c.user_id = profiles.id AND c.municipality_id = get_my_municipality_id()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "technician read profiles" ON public.profiles;
CREATE POLICY "technician read profiles" ON public.profiles
  FOR SELECT USING (
    get_my_role() = 'technician'
    AND (
      municipality_id = get_my_municipality_id()
      OR (
        municipality_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.complaints c
          WHERE c.user_id = profiles.id AND c.municipality_id = get_my_municipality_id()
        )
      )
    )
  );

-- [2] complaints: "anyone can submit complaint" WITH CHECK(true) ไม่กัน user_id spoof
-- ผู้โจมตีที่รู้ profiles.id ของเหยื่อ ใส่เป็น user_id ตอนยื่นคำร้องได้ ทำให้คำร้องไปโผล่ใน
-- "คำร้องของฉัน" ของเหยื่อ

DROP POLICY IF EXISTS "anyone can submit complaint" ON public.complaints;
CREATE POLICY "anyone can submit complaint" ON public.complaints
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
