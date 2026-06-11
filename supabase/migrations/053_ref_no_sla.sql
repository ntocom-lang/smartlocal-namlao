-- ── 053: ref_no auto-generation + SLA ─────────────────────────────────────────

-- 1. ตาราง sequence แยกต่อ municipality × ปี พ.ศ.
create table if not exists complaint_seq (
  municipality_id uuid not null references municipalities(id) on delete cascade,
  year_be         int  not null,
  last_seq        int  not null default 0,
  primary key (municipality_id, year_be)
);

-- 2. เพิ่ม column ref_no ใน complaints
alter table complaints
  add column if not exists ref_no text;

-- 3. Trigger function — ดึง slug ของ municipality แล้วสร้าง ref_no
create or replace function generate_complaint_ref_no()
returns trigger language plpgsql security definer as $$
declare
  v_slug text;
  v_year int;
  v_seq  int;
begin
  select upper(left(slug, 4)) into v_slug
    from municipalities where id = new.municipality_id;

  if v_slug is null then v_slug := 'RC'; end if;

  v_year := extract(year from now())::int + 543;

  insert into complaint_seq (municipality_id, year_be, last_seq)
  values (new.municipality_id, v_year, 1)
  on conflict (municipality_id, year_be)
  do update set last_seq = complaint_seq.last_seq + 1
  returning last_seq into v_seq;

  new.ref_no := v_slug || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;

-- 4. Trigger — ยิงเฉพาะ INSERT ที่ยังไม่มี ref_no
drop trigger if exists trg_complaint_ref_no on complaints;
create trigger trg_complaint_ref_no
  before insert on complaints
  for each row
  when (new.ref_no is null)
  execute function generate_complaint_ref_no();
