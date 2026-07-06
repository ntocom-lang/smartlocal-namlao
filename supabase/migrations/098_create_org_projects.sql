-- org_projects: บันทึกโครงการระยะยาวขององค์กร (ไม่ใช่งานโยธา)
CREATE TABLE IF NOT EXISTS public.org_projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title           text NOT NULL,
  subtitle        text,
  category        text,
  description     text,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('planning','active','completed','suspended')),
  start_date      date,
  end_date        date,
  cover_image_url text,
  is_public       boolean NOT NULL DEFAULT true,
  tags            text[] DEFAULT '{}',
  sort_order      integer DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_projects_municipality_id_idx ON public.org_projects (municipality_id);
CREATE INDEX IF NOT EXISTS org_projects_status_idx ON public.org_projects (status);

-- org_project_updates: timeline / journal entries ของแต่ละโครงการ
CREATE TABLE IF NOT EXISTS public.org_project_updates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.org_projects(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  update_type     text NOT NULL DEFAULT 'milestone'
                  CHECK (update_type IN ('milestone','meeting','achievement','issue','decision','personnel','other')),
  title           text NOT NULL,
  body            text,
  update_date     date NOT NULL DEFAULT CURRENT_DATE,
  photos          text[] DEFAULT '{}',
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_project_updates_project_id_idx ON public.org_project_updates (project_id);

-- RLS: org_projects
ALTER TABLE public.org_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read active projects" ON public.org_projects
  FOR SELECT USING (is_public = true);

CREATE POLICY "staff read own municipality projects" ON public.org_projects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_projects.municipality_id
        AND profiles.role IN ('admin','superadmin','officer','staff','technician','viewer','council')
    )
  );

CREATE POLICY "staff insert projects" ON public.org_projects
  FOR INSERT WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_projects.municipality_id
        AND profiles.role IN ('admin','superadmin','officer','staff')
    )
  );

CREATE POLICY "admin update projects" ON public.org_projects
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_projects.municipality_id
        AND profiles.role IN ('admin','superadmin','officer')
    )
  );

CREATE POLICY "admin delete projects" ON public.org_projects
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_projects.municipality_id
        AND profiles.role IN ('admin','superadmin')
    )
  );

-- RLS: org_project_updates
ALTER TABLE public.org_project_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read updates of public projects" ON public.org_project_updates
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.org_projects WHERE org_projects.id = org_project_updates.project_id AND org_projects.is_public = true)
  );

CREATE POLICY "staff read updates own municipality" ON public.org_project_updates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_project_updates.municipality_id
        AND profiles.role IN ('admin','superadmin','officer','staff','technician','viewer','council')
    )
  );

CREATE POLICY "staff insert updates" ON public.org_project_updates
  FOR INSERT WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_project_updates.municipality_id
        AND profiles.role IN ('admin','superadmin','officer','staff')
    )
  );

CREATE POLICY "admin delete updates" ON public.org_project_updates
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.municipality_id = org_project_updates.municipality_id
        AND profiles.role IN ('admin','superadmin','officer')
    )
  );
