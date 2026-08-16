-- ตารางกลาง "ตำแหน่ง" ใช้ร่วมกันทุกเทศบาล (ไม่แยกตาม municipality_id)
-- ตาม "ตารางอ้างอิง: ตำแหน่ง → บทบาท" ที่บันทึกไว้ใน dev_journal
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in (
    'political_exec', 'council', 'top_admin', 'dept_head', 'operating_staff', 'field_technician'
  )),
  role text not null check (role in (
    'superadmin','admin','officer','technician','staff','viewer','council','citizen'
  )),
  department_hint text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.positions enable row level security;

drop policy if exists "staff and up can view positions" on public.positions;
create policy "staff and up can view positions"
on public.positions
for select
to authenticated
using (public.get_my_role() in ('staff','officer','technician','admin','superadmin','viewer','council'));

drop policy if exists "superadmin manage positions" on public.positions;
create policy "superadmin manage positions"
on public.positions
for all
to authenticated
using (public.get_my_role() = 'superadmin')
with check (public.get_my_role() = 'superadmin');

alter table public.profiles add column if not exists position_id uuid references public.positions(id) on delete set null;

-- Seed ตำแหน่งมาตรฐาน 25 ตำแหน่ง (7 ระดับ)
insert into public.positions (name, category, role, department_hint, sort_order) values
  ('นายกเทศมนตรี / นายกองค์การบริหารส่วนตำบล', 'political_exec', 'viewer', null, 10),
  ('รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล', 'political_exec', 'viewer', null, 20),
  ('ที่ปรึกษานายกเทศมนตรี', 'political_exec', 'viewer', null, 30),
  ('เลขานุการนายกเทศมนตรี', 'political_exec', 'viewer', null, 40),
  ('ประธานสภา', 'council', 'council', null, 110),
  ('รองประธานสภา', 'council', 'council', null, 120),
  ('เลขานุการสภา', 'council', 'council', null, 130),
  ('สมาชิกสภา', 'council', 'council', null, 140),
  ('ปลัดเทศบาล / ปลัดองค์การบริหารส่วนตำบล', 'top_admin', 'admin', null, 210),
  ('รองปลัดเทศบาล / รองปลัดองค์การบริหารส่วนตำบล', 'top_admin', 'admin', null, 220),
  ('หัวหน้าสำนักปลัด', 'dept_head', 'officer', 'สำนักปลัด', 310),
  ('ผู้อำนวยการกองคลัง', 'dept_head', 'officer', 'กองคลัง', 320),
  ('ผู้อำนวยการกองช่าง', 'dept_head', 'officer', 'กองช่าง', 330),
  ('ผู้อำนวยการกองการศึกษา ศาสนาและวัฒนธรรม', 'dept_head', 'officer', 'กองการศึกษา', 340),
  ('ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม', 'dept_head', 'officer', 'กองสาธารณสุขและสิ่งแวดล้อม', 350),
  ('ผู้อำนวยการกองสวัสดิการสังคม', 'dept_head', 'officer', 'กองสวัสดิการสังคม', 360),
  ('ผู้อำนวยการกองยุทธศาสตร์และงบประมาณ', 'dept_head', 'officer', 'กองยุทธศาสตร์และงบประมาณ', 370),
  ('หัวหน้าหน่วยตรวจสอบภายใน', 'dept_head', 'officer', 'ตรวจสอบภายใน', 380),
  ('นักวิชาการ', 'operating_staff', 'staff', null, 410),
  ('เจ้าพนักงาน', 'operating_staff', 'staff', null, 420),
  ('ครู/ผู้ดูแลเด็ก', 'operating_staff', 'staff', 'กองการศึกษา', 430),
  ('พนักงานจ้างทั่วไป/ผู้ช่วยเจ้าหน้าที่', 'operating_staff', 'staff', null, 440),
  ('นักวิชาการตรวจสอบภายใน', 'operating_staff', 'staff', 'ตรวจสอบภายใน', 450),
  ('นายช่างโยธา', 'field_technician', 'technician', 'กองช่าง', 510),
  ('ช่างไฟฟ้า', 'field_technician', 'technician', 'กองช่าง', 520),
  ('ช่างประปา', 'field_technician', 'technician', 'กองช่าง', 530),
  ('พนักงานขับเครื่องจักรกล', 'field_technician', 'technician', 'กองช่าง', 540)
on conflict do nothing;

-- Backfill: จับคู่ job_title เดิมของบัญชีจริงเข้ากับตำแหน่งมาตรฐาน
-- เรียงจากเจาะจงไปกว้างเสมอ กัน "รอง..." ไปแมตช์ผิดเป็นตำแหน่งหลัก
update public.profiles set position_id = (select id from public.positions where name = 'รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล')
where position_id is null and (job_title ilike '%รองนายกเทศมนตรี%' or job_title ilike '%รองนายกองค์การบริหารส่วนตำบล%');

update public.profiles set position_id = (select id from public.positions where name = 'นายกเทศมนตรี / นายกองค์การบริหารส่วนตำบล')
where position_id is null and (job_title ilike '%นายกเทศมนตรี%' or job_title ilike '%นายกองค์การบริหารส่วนตำบล%') and job_title not ilike '%รอง%';

update public.profiles set position_id = (select id from public.positions where name = 'เลขานุการนายกเทศมนตรี')
where position_id is null and job_title ilike '%เลขานุการนายก%';

update public.profiles set position_id = (select id from public.positions where name = 'ที่ปรึกษานายกเทศมนตรี')
where position_id is null and job_title ilike '%ที่ปรึกษานายก%';

update public.profiles set position_id = (select id from public.positions where name = 'รองประธานสภา')
where position_id is null and job_title ilike '%รองประธานสภา%';

update public.profiles set position_id = (select id from public.positions where name = 'ประธานสภา')
where position_id is null and job_title ilike '%ประธานสภา%' and job_title not ilike '%รอง%';

update public.profiles set position_id = (select id from public.positions where name = 'เลขานุการสภา')
where position_id is null and job_title ilike '%เลขานุการสภา%';

update public.profiles set position_id = (select id from public.positions where name = 'สมาชิกสภา')
where position_id is null and job_title ilike '%สมาชิกสภา%';

update public.profiles set position_id = (select id from public.positions where name = 'รองปลัดเทศบาล / รองปลัดองค์การบริหารส่วนตำบล')
where position_id is null and (job_title ilike '%รองปลัดเทศบาล%' or job_title ilike '%รองปลัดองค์การบริหารส่วนตำบล%' or job_title ilike '%รองปลัด อบต%');

update public.profiles set position_id = (select id from public.positions where name = 'ปลัดเทศบาล / ปลัดองค์การบริหารส่วนตำบล')
where position_id is null and (job_title ilike '%ปลัดเทศบาล%' or job_title ilike '%ปลัดองค์การบริหารส่วนตำบล%' or job_title ilike '%ปลัด อบต%') and job_title not ilike '%รอง%';

update public.profiles set position_id = (select id from public.positions where name = 'หัวหน้าสำนักปลัด')
where position_id is null and job_title ilike '%หัวหน้าสำนักปลัด%';

update public.profiles set position_id = (select id from public.positions where name = 'ผู้อำนวยการกองคลัง')
where position_id is null and (job_title ilike '%ผู้อำนวยการกองคลัง%' or job_title ilike '%หัวหน้ากองคลัง%' or job_title ilike '%หัวหน้าฝ่ายคลัง%');

update public.profiles set position_id = (select id from public.positions where name = 'ผู้อำนวยการกองช่าง')
where position_id is null and (job_title ilike '%ผู้อำนวยการกองช่าง%' or job_title ilike '%หัวหน้ากองช่าง%');

update public.profiles set position_id = (select id from public.positions where name = 'ผู้อำนวยการกองการศึกษา ศาสนาและวัฒนธรรม')
where position_id is null and job_title ilike '%ผู้อำนวยการกองการศึกษา%';

update public.profiles set position_id = (select id from public.positions where name = 'ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม')
where position_id is null and job_title ilike '%กองสาธารณสุข%';

update public.profiles set position_id = (select id from public.positions where name = 'ผู้อำนวยการกองสวัสดิการสังคม')
where position_id is null and job_title ilike '%กองสวัสดิการสังคม%';

update public.profiles set position_id = (select id from public.positions where name = 'ผู้อำนวยการกองยุทธศาสตร์และงบประมาณ')
where position_id is null and job_title ilike '%กองยุทธศาสตร์%';

update public.profiles set position_id = (select id from public.positions where name = 'หัวหน้าหน่วยตรวจสอบภายใน')
where position_id is null and job_title ilike '%หัวหน้าหน่วยตรวจสอบ%';
;
