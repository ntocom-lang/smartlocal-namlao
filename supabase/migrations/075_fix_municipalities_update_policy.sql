-- Fix: ensure admin/superadmin/officer can update their own municipality
DROP POLICY IF EXISTS "admin can update municipalities" ON public.municipalities;
CREATE POLICY "admin can update municipalities" ON public.municipalities
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superadmin', 'officer')
        AND p.municipality_id = municipalities.id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superadmin', 'officer')
        AND p.municipality_id = municipalities.id
    )
  );

-- ตรวจสอบว่า admin มี municipality_id ตรงกับ tenant หรือไม่
-- (ถ้า query นี้ return 0 rows แสดงว่า profile ของ admin ยังไม่มี municipality_id)
-- SELECT id, role, municipality_id FROM public.profiles WHERE role IN ('admin','superadmin');
