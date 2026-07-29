-- SmartLocal 126: events.audience (single value) -> events.audiences (array)
-- รองรับเลือกกลุ่มเป้าหมายได้หลายกลุ่มต่อ 1 กิจกรรม

ALTER TABLE events ADD COLUMN IF NOT EXISTS audiences text[];
UPDATE events SET audiences = ARRAY[audience]::text[] WHERE audiences IS NULL;
ALTER TABLE events ALTER COLUMN audiences SET NOT NULL;
ALTER TABLE events ALTER COLUMN audiences SET DEFAULT ARRAY['public']::text[];

DROP POLICY IF EXISTS "events select by audience" ON events;
CREATE POLICY "events select by audience" ON events FOR SELECT USING (
  get_my_role() = 'superadmin'
  OR 'public' = ANY(audiences)
  OR (
    get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician', 'kamnan')
    AND municipality_id = get_my_municipality_id()
    AND CASE
      WHEN get_my_role() = 'admin'      THEN true
      WHEN get_my_role() = 'officer'    THEN audiences && ARRAY['public','staff','council','management']
      WHEN get_my_role() = 'viewer'     THEN audiences && ARRAY['public','staff','management']
      WHEN get_my_role() = 'council'    THEN audiences && ARRAY['public','staff','council']
      WHEN get_my_role() = 'kamnan'     THEN audiences && ARRAY['public','staff','kamnan']
      WHEN get_my_role() = 'technician' THEN audiences && ARRAY['public','staff']
      WHEN get_my_role() = 'staff'      THEN audiences && ARRAY['public','staff']
      ELSE false
    END
  )
);

ALTER TABLE events DROP COLUMN audience;
-- History version aligned with linked Supabase project.
