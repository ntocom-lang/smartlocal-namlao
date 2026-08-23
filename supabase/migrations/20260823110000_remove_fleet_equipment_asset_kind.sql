-- "ครุภัณฑ์" (asset_kind = 'equipment') ไม่เกี่ยวกับระบบยานพาหนะและเชื้อเพลิงนี้ — ครุภัณฑ์ทั่วไป
-- (โต๊ะ/เก้าอี้/คอมพิวเตอร์) จัดการแยกอยู่คนละเมนูอยู่แล้ว เหลือแค่ยานพาหนะ (มีทะเบียนรถ) กับ
-- เครื่องยนต์ (ปั๊มน้ำ/เครื่องปั่นไฟ ไม่มีทะเบียนแต่ยังใช้เชื้อเพลิง) เท่านั้นในระบบนี้
-- ตรวจแล้วว่า fleet_vehicles ยังไม่มีข้อมูลแถวไหนเลยในทุกเทศบาล ปลอดภัยที่จะบีบ constraint แคบลง
alter table public.fleet_vehicles
  drop constraint if exists fleet_vehicles_asset_kind_check,
  drop constraint if exists fleet_vehicles_identifier_check;

alter table public.fleet_vehicles
  add constraint fleet_vehicles_asset_kind_check
    check (asset_kind in ('vehicle', 'engine')),
  add constraint fleet_vehicles_identifier_check
    check (
      (asset_kind = 'vehicle' and nullif(btrim(license_plate), '') is not null)
      or
      (asset_kind = 'engine' and nullif(btrim(asset_code), '') is not null)
    ) not valid;
