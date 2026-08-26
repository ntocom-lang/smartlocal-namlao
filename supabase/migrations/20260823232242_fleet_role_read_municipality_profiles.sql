-- กู้คืนจาก supabase_migrations.schema_migrations ของ production (umxssfahtuprnztlytdd)
-- เมื่อ 2026-08-28 — migration นี้ถูก apply ผ่าน Supabase MCP โดยไม่เคยมีไฟล์ต้นทางใน repo
-- ตั้งชื่อไฟล์ด้วย version เดิมของ remote เพื่อให้จับคู่กับประวัติที่บันทึกไว้แล้วพอดี
-- (อย่าเปลี่ยน version — จะทำให้ drift กลับมา)
--
-- ⚠️ ชิ้นส่วนสำคัญของระบบยานพาหนะ: ถ้าไฟล์นี้หายไปแล้วสร้าง DB ใหม่จาก migration
-- dropdown "ผู้ใช้รถ" จะว่างเปล่า และเจ้าหน้าที่จะมองไม่เห็นการจองของคนอื่นเลย

-- Fleet users (fleet_role IS NOT NULL) ต้องเห็นชื่อเพื่อนร่วมเทศบาลเดียวกัน เพื่อแสดงชื่อ
-- ผู้ใช้รถ/ผู้รับผิดชอบ ในระบบยานพาหนะ และเห็นการจองของคนอื่นในระบบจองรถ (ตามสิทธิ์ในเทศบาลเดียวกัน)
-- เดิม profiles SELECT policy ครอบคลุมแค่ role admin/viewer/council/officer/superadmin/technician
-- ทำให้ role='staff' ที่มี fleet_role (fleet_admin/fleet_staff) อ่านโปรไฟล์คนอื่นไม่ได้เลย แม้ query/FK ถูกต้อง

CREATE OR REPLACE FUNCTION public.get_my_fleet_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT fleet_role FROM public.profiles WHERE id = auth.uid()
$function$;

DROP POLICY IF EXISTS "fleet users read municipality profiles" ON public.profiles;
CREATE POLICY "fleet users read municipality profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  public.get_my_fleet_role() IS NOT NULL
  AND municipality_id = public.get_my_municipality_id()
);
