-- updated_at เป็น NOT NULL DEFAULT now() (ตั้งค่าตั้งแต่ตอนสร้างระเบียนอยู่แล้ว) จึงรีเซ็ตเป็น NULL ไม่ได้
-- ค่าที่ถูกต้องสำหรับ "ยังไม่เคยถูกแก้ไขจริง" คือ updated_at = created_at (เวลาเดียวกับตอนสร้าง) และ updated_by = NULL
-- ต้องปิด trigger ชั่วคราวระหว่างรีเซ็ต ไม่งั้น trigger fleet_set_updated_at จะเขียนทับด้วย now() ทันที

ALTER TABLE public.fleet_fuel_records DISABLE TRIGGER trg_fleet_fuel_records_updated_at;
ALTER TABLE public.fleet_maintenance   DISABLE TRIGGER trg_fleet_maintenance_updated_at;

UPDATE public.fleet_fuel_records SET updated_at = created_at, updated_by = NULL WHERE updated_by IS NULL;
UPDATE public.fleet_maintenance   SET updated_at = created_at, updated_by = NULL WHERE updated_by IS NULL;

ALTER TABLE public.fleet_fuel_records ENABLE TRIGGER trg_fleet_fuel_records_updated_at;
ALTER TABLE public.fleet_maintenance   ENABLE TRIGGER trg_fleet_maintenance_updated_at;
