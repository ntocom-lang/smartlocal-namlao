-- Fix fdept_write policy: allow fleet_admin role to manage departments
DROP POLICY IF EXISTS "fdept_write" ON public.fleet_departments;

CREATE POLICY "fdept_write" ON public.fleet_departments FOR ALL
  USING (
    municipality_id = (SELECT mun_id FROM public.my_fleet())
    AND (
      (SELECT frole FROM public.my_fleet()) = 'fleet_admin'
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','superadmin')
    )
  );
