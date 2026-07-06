-- เพิ่ม technician_id (ผู้รับผิดชอบ) ใน fleet_maintenance
ALTER TABLE public.fleet_maintenance
  ADD COLUMN IF NOT EXISTS technician_id uuid REFERENCES public.profiles(id);
