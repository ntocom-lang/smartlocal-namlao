ALTER TABLE civil_projects DROP CONSTRAINT IF EXISTS civil_projects_project_type_check;
ALTER TABLE civil_projects ADD CONSTRAINT civil_projects_project_type_check CHECK (project_type IN ('road','drain','bridge','light','waterway','building','irrigation','water_supply','other','park'));
