-- เพิ่ม telegram_group_id ให้ municipalities
alter table municipalities
  add column if not exists telegram_group_id text;
