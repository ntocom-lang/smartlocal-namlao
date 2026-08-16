-- เพิ่ม department_id (FK จริง) ให้ civil_projects/infrastructure_works/business_registrations
-- เพื่อให้กรอง "งานของกองฉัน" แบบ default-แต่ override ได้ในหน้าเจ้าหน้าที่ ไม่ต้องเดา municipality_id
-- เพราะ join ผ่าน departments.municipality_id ตรงตามแถวเดิมอยู่แล้ว

ALTER TABLE public.civil_projects
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.infrastructure_works
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.business_registrations
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_civil_projects_department_id ON public.civil_projects(department_id);
CREATE INDEX IF NOT EXISTS idx_infrastructure_works_department_id ON public.infrastructure_works(department_id);
CREATE INDEX IF NOT EXISTS idx_business_registrations_department_id ON public.business_registrations(department_id);

-- Backfill civil_projects: department text เดิม (civil/sp/edu/finance/other) -> departments.code ที่ตรงกันจริง
-- 'other' ปล่อย NULL เพราะไม่มี department code ที่ตรงกันแบบไม่เดา
UPDATE public.civil_projects cp
SET department_id = d.id
FROM public.departments d
WHERE d.municipality_id = cp.municipality_id
  AND d.code = CASE cp.department
    WHEN 'civil'   THEN 'engineering'
    WHEN 'sp'      THEN 'general'
    WHEN 'edu'     THEN 'education'
    WHEN 'finance' THEN 'finance'
    ELSE NULL
  END
  AND cp.department_id IS NULL;

-- Backfill infrastructure_works: ทุก category (road/drainage/electrical/waterway/building/irrigation/other)
-- เป็นงานสายกองช่างทั้งหมด ไม่มี category ไหนแยกไปกองอื่นจริง จึง backfill เป็น engineering ได้ตรงไปตรงมา
UPDATE public.infrastructure_works iw
SET department_id = d.id
FROM public.departments d
WHERE d.municipality_id = iw.municipality_id
  AND d.code = 'engineering'
  AND iw.department_id IS NULL;

-- business_registrations: ไม่มีข้อมูลอ้างอิงที่ยืนยันได้ว่าเดิมกองไหนดูแล ปล่อย NULL ทั้งหมดโดยตั้งใจ
-- ให้เจ้าหน้าที่ตั้งเองทีละรายการทีหลัง;
