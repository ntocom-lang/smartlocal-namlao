-- เพิ่ม telegram_group_id ให้ municipalities
alter table municipalities
  add column if not exists telegram_group_id text;
-- Archived: this legacy file had no migration version and was ignored by Supabase CLI.
