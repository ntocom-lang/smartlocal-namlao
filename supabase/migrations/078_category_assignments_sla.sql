-- 078: เพิ่ม sla_days ใน category_assignments สำหรับกำหนดระยะเวลาดำเนินการ (LPA)
alter table category_assignments
  add column if not exists sla_days int default 3;
