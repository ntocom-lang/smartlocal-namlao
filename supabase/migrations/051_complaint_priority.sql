-- เพิ่ม priority field ใน complaints table
alter table complaints
  add column if not exists priority text not null default 'normal'
  check (priority in ('urgent', 'normal', 'low'));

-- index สำหรับ filter + sort
create index if not exists idx_complaints_priority on complaints(priority);
