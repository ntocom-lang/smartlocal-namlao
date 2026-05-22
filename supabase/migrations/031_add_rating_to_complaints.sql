-- เพิ่มคะแนนความพึงพอใจใน complaints (1-5 ดาว, ให้ได้ครั้งเดียวหลัง completed)
alter table complaints
  add column if not exists rating smallint check (rating >= 1 and rating <= 5);
