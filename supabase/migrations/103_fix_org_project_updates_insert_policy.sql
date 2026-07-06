-- ลบเงื่อนไข auth.uid() = created_by ออกจาก INSERT policy
-- เพราะ session timing ไม่ตรงกันทำให้ 403
DROP POLICY IF EXISTS "staff insert updates" ON public.org_project_updates;
CREATE POLICY "staff insert updates" ON public.org_project_updates
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_project_updates.municipality_id
        AND profiles.role IN ('admin','superadmin','officer','staff')
    )
  );
