-- เพิ่มข้อมูลติดต่อและ social media ให้ municipalities
alter table municipalities
  add column if not exists phone       text,
  add column if not exists address     text,
  add column if not exists website_url text,
  add column if not exists facebook_url text,
  add column if not exists line_oa_url  text;
