-- เพิ่มเลขที่คำร้องลำดับ (เช่น 00001, 00002, ...)
create sequence if not exists complaints_number_seq start 1;

alter table complaints
  add column if not exists complaint_number int unique default nextval('complaints_number_seq');

-- อัปเดตแถวที่มีอยู่แล้วให้มีเลข (ถ้ามี)
update complaints set complaint_number = nextval('complaints_number_seq')
where complaint_number is null;
