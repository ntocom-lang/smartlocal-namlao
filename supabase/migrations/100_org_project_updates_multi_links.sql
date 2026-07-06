-- เปลี่ยนจาก link_url (single) เป็น links jsonb (array ของ {label, url})
ALTER TABLE public.org_project_updates
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;

-- migrate ข้อมูลเก่า (ถ้ามี)
UPDATE public.org_project_updates
  SET links = jsonb_build_array(jsonb_build_object('label', '', 'url', link_url))
  WHERE link_url IS NOT NULL AND link_url <> '';

ALTER TABLE public.org_project_updates DROP COLUMN IF EXISTS link_url;
