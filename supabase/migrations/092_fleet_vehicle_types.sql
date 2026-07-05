-- ตารางประเภทยานพาหนะ (กำหนดเองต่อ municipality)
CREATE TABLE IF NOT EXISTS public.fleet_vehicle_types (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality_id uuid    NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  value           text    NOT NULL,
  label           text    NOT NULL,
  sort_order      int     DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fvtype_mun_val ON public.fleet_vehicle_types(municipality_id, value);
ALTER TABLE public.fleet_vehicle_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fvtype_read" ON public.fleet_vehicle_types;
CREATE POLICY "fvtype_read" ON public.fleet_vehicle_types FOR SELECT
  USING (
    municipality_id = (SELECT mun_id FROM public.my_fleet())
    AND (
      (SELECT frole FROM public.my_fleet()) IS NOT NULL
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','superadmin','officer')
    )
  );

DROP POLICY IF EXISTS "fvtype_write" ON public.fleet_vehicle_types;
CREATE POLICY "fvtype_write" ON public.fleet_vehicle_types FOR ALL
  USING (
    municipality_id = (SELECT mun_id FROM public.my_fleet())
    AND (
      (SELECT frole FROM public.my_fleet()) = 'fleet_admin'
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','superadmin')
    )
  )
  WITH CHECK (
    municipality_id = (SELECT mun_id FROM public.my_fleet())
    AND (
      (SELECT frole FROM public.my_fleet()) = 'fleet_admin'
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','superadmin')
    )
  );
