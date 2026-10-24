-- เฟส 1: เพิ่มคอลัมน์ก่อนกฎ/RPC ตาม docs/ai/NOTES.md หัวข้อ 3
BEGIN;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS positions_municipality_department_sort_idx
  ON public.positions (municipality_id, department_id, sort_order, name);

NOTIFY pgrst, 'reload schema';
COMMIT;
