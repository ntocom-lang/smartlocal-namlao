-- เพิ่ม planned dates + สถานะใหม่ใน fleet_trips
ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS planned_departure timestamptz,
  ADD COLUMN IF NOT EXISTS planned_return     timestamptz;

-- ถ้ามี CHECK constraint บน status ให้ drop แล้ว recreate
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_status_check;

ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_status_check
  CHECK (status IN ('pending','approved','rejected','cancelled','in_progress','completed'));
