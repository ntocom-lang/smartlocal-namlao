-- เพิ่ม column สำหรับเก็บ URL ไฟล์แนบ (array of text)
alter table complaints
  add column if not exists attachments text[] default '{}';
