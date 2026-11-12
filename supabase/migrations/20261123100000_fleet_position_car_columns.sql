-- โหมดขั้นตอนขอใช้รถ (P3) — ผู้มีรถประจำตำแหน่งขอใช้ยานพาหนะส่วนกลาง (เฟส 1: คอลัมน์)
-- ต่อด้วย 20261123100100_fleet_position_car_functions.sql (แยกไฟล์ตาม NOTES ข้อ 3)
--
-- ตัวบท: ระเบียบ มท. ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙ ข้อ ๑๒ ว.๕
--   ผู้มีรถประจำตำแหน่ง ห้ามใช้ยานพาหนะส่วนกลาง เว้นแต่มีความจำเป็นเฉพาะคราว
--   ต้องขออนุมัติจากผู้บริหารท้องถิ่น และระบุเหตุผล (เจ้าของระบบอนุมัติ 2026-11-12)
--
-- 2 คอลัมน์ ไม่บังคับทั้งคู่ — อปท. ที่ไม่ได้ผูกผู้ถือรถ = ไม่เปลี่ยนอะไรเลย
--   fleet_vehicles.holder_position_id  ตำแหน่งที่ถือรถประจำตำแหน่งคันนี้ (ผูกตำแหน่ง ไม่ผูกตัวคน
--                                      เปลี่ยนตัวคนแล้วระบบตามเอง — เจ้าของเลือกทาง A)
--   fleet_trips.position_car_reason    เหตุผลความจำเป็นของผู้มีรถประจำตำแหน่ง (ข้อ ๑๒ ว.๕)
--
-- FK holder_position_id → positions: fleet_vehicles ยังไม่มีความสัมพันธ์กับ positions เส้นอื่น
-- ⇒ ไม่เกิด PGRST201 (กับดักที่ custodian_department_id เลี่ยงไว้เพราะมี FK ไป departments แล้ว)
-- positions ทุกแถวผูก อปท. (ตรวจฐานจริง 2026-11-12: 126 แถว ไม่มีแถวใช้ร่วม) ⇒ ไฟล์ฟังก์ชันบังคับ อปท. เดียวกับรถ
--
-- ไม่มีข้อมูลประชาชน (ตำแหน่ง/เหตุผลราชการของเจ้าหน้าที่ อปท.)
-- สิทธิ์ตามตารางเดิม (column privilege มาจาก table-level grant ไม่ต้อง GRANT เพิ่ม)

DO $guard$
BEGIN
  IF to_regclass('public.fleet_permit_settings') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ fleet_permit_settings — ต้องรัน P1 (20261121100000/100100) ก่อน';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_vehicles' AND column_name = 'regulation_category'
  ) THEN
    RAISE EXCEPTION 'ไม่พบ fleet_vehicles.regulation_category — ต้องรัน 20261018100000_fleet_vehicle_register_fields.sql ก่อน';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'municipality_id'
  ) THEN
    RAISE EXCEPTION 'ไม่พบ positions.municipality_id — โครงสร้างตำแหน่งไม่ตรงกับที่ออกแบบไว้ หยุดตรวจก่อน';
  END IF;
END;
$guard$;

-- ADD COLUMN/FK ต้องได้ lock เต็มบน fleet_trips/fleet_vehicles — มี transaction ค้างอยู่ = ยอมแพ้ใน 5 วินาที ไม่ขวางคำสั่งอ่านทั้งระบบ
SET lock_timeout = '5s';

-- ADD COLUMN + CHECK ในคำสั่งเดียว (รันซ้ำได้: IF NOT EXISTS ข้ามทั้งคอลัมน์และ constraint ที่ติดมา)
ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS holder_position_id uuid
    REFERENCES public.positions(id) ON DELETE SET NULL
    CONSTRAINT fleet_vehicles_holder_only_position_car
      CHECK (holder_position_id IS NULL OR regulation_category = 'position');

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS position_car_reason text
    CONSTRAINT fleet_trips_position_car_reason_len
      CHECK (position_car_reason IS NULL OR char_length(btrim(position_car_reason)) BETWEEN 5 AND 500);

CREATE INDEX IF NOT EXISTS fleet_vehicles_holder_position_idx
  ON public.fleet_vehicles (municipality_id, holder_position_id)
  WHERE holder_position_id IS NOT NULL;

COMMENT ON COLUMN public.fleet_vehicles.holder_position_id IS
  'ตำแหน่งที่ถือรถประจำตำแหน่งคันนี้ (positions.id อปท. เดียวกับรถ) ใช้ตรวจข้อ 12 ว.5 — ใส่ได้เฉพาะ regulation_category=position';
COMMENT ON COLUMN public.fleet_trips.position_car_reason IS
  'เหตุผลความจำเป็นเฉพาะคราวของผู้มีรถประจำตำแหน่งที่ขอใช้ยานพาหนะส่วนกลาง (ระเบียบ มท. ยานพาหนะ อปท. 2569 ข้อ 12 ว.5) ล็อกหลังมีลายเซ็น/บันทึกการอนุญาต';

RESET lock_timeout;
