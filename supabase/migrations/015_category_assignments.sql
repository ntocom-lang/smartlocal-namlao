-- =====================================================
-- SmartLocal: ตาราง category_assignments + auto-assign trigger
-- =====================================================

-- 1. ตาราง mapping: category → technician
CREATE TABLE IF NOT EXISTS category_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  category        text NOT NULL,
  technician_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (municipality_id, category)
);

CREATE INDEX IF NOT EXISTS cat_assign_muni_idx ON category_assignments(municipality_id);

ALTER TABLE category_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin manage category assignments" ON category_assignments;
CREATE POLICY "admin manage category assignments"
  ON category_assignments FOR ALL
  USING (get_my_role() IN ('admin', 'superadmin'));

DROP POLICY IF EXISTS "technician read category assignments" ON category_assignments;
CREATE POLICY "technician read category assignments"
  ON category_assignments FOR SELECT
  USING (get_my_role() = 'technician');

-- 2. Trigger: auto-assign เมื่อมีคำร้องใหม่เข้า
CREATE OR REPLACE FUNCTION auto_assign_complaint()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  tech_id uuid;
BEGIN
  SELECT technician_id INTO tech_id
  FROM category_assignments
  WHERE municipality_id = NEW.municipality_id
    AND category        = NEW.category
    AND technician_id  IS NOT NULL;

  IF tech_id IS NOT NULL THEN
    NEW.assigned_to := tech_id;
    NEW.status      := 'received';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complaints_auto_assign ON complaints;
CREATE TRIGGER complaints_auto_assign
  BEFORE INSERT ON complaints
  FOR EACH ROW EXECUTE FUNCTION auto_assign_complaint();
