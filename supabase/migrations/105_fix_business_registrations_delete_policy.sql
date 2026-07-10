-- Drop the old policy
DROP POLICY IF EXISTS "admin_all_business_registrations" ON business_registrations;

-- Create the new policy using stable helper functions
CREATE POLICY "admin_all_business_registrations"
  ON business_registrations FOR ALL
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'technician')
      AND municipality_id = get_my_municipality_id()
    )
  );
