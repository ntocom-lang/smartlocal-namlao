-- ตัด "เครื่องยนต์" (asset_kind = 'engine') ออกอีกชั้น — ระบบยานพาหนะและเชื้อเพลิงนี้ดูแลเฉพาะ
-- ยานพาหนะที่มีทะเบียนรถเท่านั้น เหลือ asset_kind ที่อนุญาตแค่ 'vehicle' ค่าเดียว
-- ตรวจแล้วว่า fleet_vehicles ยังไม่มีข้อมูลแถวไหนเลยในทุกเทศบาล (เหมือนตอนตัด equipment ก่อนหน้า) ปลอดภัย
alter table public.fleet_vehicles
  drop constraint if exists fleet_vehicles_asset_kind_check,
  drop constraint if exists fleet_vehicles_identifier_check;

alter table public.fleet_vehicles
  add constraint fleet_vehicles_asset_kind_check
    check (asset_kind = 'vehicle'),
  add constraint fleet_vehicles_identifier_check
    check (nullif(btrim(license_plate), '') is not null) not valid;
