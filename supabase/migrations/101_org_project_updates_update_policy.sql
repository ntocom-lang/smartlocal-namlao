-- เพิ่ม UPDATE policy ที่ขาดหายไปจาก 098
CREATE POLICY "staff update updates" ON public.org_project_updates
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_project_updates.municipality_id
        AND profiles.role IN ('admin','superadmin','officer','staff')
    )
  );
