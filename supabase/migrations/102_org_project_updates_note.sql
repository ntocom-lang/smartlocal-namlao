-- เปลี่ยนจาก links jsonb เป็น note text ธรรมดา
ALTER TABLE public.org_project_updates ADD COLUMN IF NOT EXISTS note text;
