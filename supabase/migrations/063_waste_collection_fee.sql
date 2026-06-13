-- 063_waste_collection_fee.sql
-- เพิ่มค่าเก็บขยะมูลฝอยใน fee_schedule

-- อัปเดต default ของ column
alter table municipalities
  alter column fee_schedule
  set default '{"residence_cert":0,"personal_cert":0,"conduct_cert":0,"tax_notice":0,"waste_collection":0,"other":0}';

-- เติม key waste_collection ให้ row ที่มีอยู่แล้ว (ถ้ายังไม่มี key นี้)
update municipalities
set fee_schedule = fee_schedule || '{"waste_collection": 0}'::jsonb
where not (fee_schedule ? 'waste_collection');
