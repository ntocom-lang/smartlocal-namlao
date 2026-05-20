alter table municipalities
  add column if not exists latitude  numeric(9,6),
  add column if not exists longitude numeric(9,6);

-- อัปเดตพิกัดหน่วยงาน (เพิ่มหน่วยงานอื่นๆ ใน Supabase dashboard)
update municipalities set latitude = 18.330000, longitude = 100.320000 where slug = 'namlao';
