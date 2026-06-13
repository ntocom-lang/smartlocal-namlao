-- ── 052: Department-based complaint workflow ──────────────────────────────────

-- 1. เพิ่ม column ใน complaints
alter table complaints
  add column if not exists department       text,
  add column if not exists due_date         date,
  add column if not exists progress_note    text,
  add column if not exists rejection_reason text,
  add column if not exists closed_at        timestamptz;

-- 2. เพิ่ม column ใน profiles
alter table profiles
  add column if not exists department   text,
  add column if not exists is_dept_head boolean default false;

-- 3. สร้าง complaint_timeline
create table if not exists complaint_timeline (
  id           uuid        primary key default gen_random_uuid(),
  complaint_id uuid        not null references complaints(id) on delete cascade,
  status       text        not null,
  note         text,
  actor_name   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_complaint_timeline_cid
  on complaint_timeline(complaint_id, created_at desc);

-- RLS: ประชาชนเห็น timeline ของตัวเอง, staff เห็นของ municipality ตัวเอง
alter table complaint_timeline enable row level security;

create policy "timeline_select" on complaint_timeline
  for select using (
    exists (
      select 1 from complaints c
      join profiles p on p.id = auth.uid()
      where c.id = complaint_timeline.complaint_id
        and c.municipality_id = p.municipality_id
    )
    or exists (
      select 1 from complaints c
      where c.id = complaint_timeline.complaint_id
        and c.user_id = auth.uid()
    )
  );

create policy "timeline_insert" on complaint_timeline
  for insert with check (
    exists (
      select 1 from complaints c
      join profiles p on p.id = auth.uid()
      where c.id = complaint_timeline.complaint_id
        and c.municipality_id = p.municipality_id
    )
  );

-- 4. Drop constraint เก่า แล้วสร้างใหม่รองรับทั้งค่าเก่าและใหม่
alter table complaints drop constraint if exists complaints_status_check;

alter table complaints
  add constraint complaints_status_check
  check (status in (
    'new', 'in_progress', 'done', 'closed', 'rejected',
    'pending', 'received', 'completed'
  ));

-- Migrate สถานะเก่า → ใหม่
update complaints set status = 'new'         where status = 'pending';
update complaints set status = 'in_progress' where status = 'received';
update complaints set status = 'done'        where status = 'completed';

-- 5. Auto-route department จาก category
update complaints
set department = case
  when category in (
    'light','road','road_concrete','road_asphalt','road_slurry','road_gravel',
    'drain','building','pipe_water','canal','dredge','waterway','water_supply','flood'
  ) then 'กองช่าง'
  when category in ('tax') then 'กองคลัง'
  else 'สำนักปลัด'
end
where department is null;
