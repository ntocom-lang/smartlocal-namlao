-- เพิ่ม 'staff' เข้า constraint (ถูกละเว้นใน migration 038)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'admin', 'officer', 'council', 'viewer', 'technician', 'staff', 'citizen'));
