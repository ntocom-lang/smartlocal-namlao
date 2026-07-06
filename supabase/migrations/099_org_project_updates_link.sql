ALTER TABLE public.org_project_updates
  ADD COLUMN IF NOT EXISTS link_url text;
