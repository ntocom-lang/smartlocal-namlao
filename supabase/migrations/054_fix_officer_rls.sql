-- 054_fix_officer_rls.sql
-- 1. Add officer to complaints RLS
-- 2. Add officer to profiles read policy
-- 3. Add staff to profiles CHECK constraint

-- ─── complaints: allow officer to read/update ───────────────────────────────
drop policy if exists "staff read own municipality complaints" on complaints;
create policy "staff read own municipality complaints"
  on complaints for select
  using (
    municipality_id = get_my_municipality_id()
    and get_my_role() in ('admin', 'officer', 'technician', 'viewer', 'council')
  );

drop policy if exists "staff update complaint status" on complaints;
create policy "staff update complaint status"
  on complaints for update
  using (
    municipality_id = get_my_municipality_id()
    and get_my_role() in ('admin', 'officer', 'technician')
  );

-- ─── profiles: allow officer to read all profiles in municipality ────────────
drop policy if exists "admins read all profiles" on profiles;
create policy "admins read all profiles"
  on profiles for select
  using (
    get_my_role() in ('superadmin', 'admin', 'officer', 'viewer', 'council')
    or id = auth.uid()
  );

-- ─── profiles: add staff to CHECK constraint ────────────────────────────────
alter table profiles
  drop constraint if exists profiles_role_check;

alter table profiles
  add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'officer', 'council', 'viewer', 'technician', 'staff', 'citizen'));
