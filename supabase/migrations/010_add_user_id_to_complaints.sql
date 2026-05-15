-- เพิ่ม user_id ใน complaints เพื่อให้ประชาชนตรวจสอบคำร้องของตัวเองได้
alter table complaints
  add column if not exists user_id uuid references profiles(id) on delete set null;

create index if not exists complaints_user_idx on complaints(user_id);
