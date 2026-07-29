-- 124_users_rpc_structured_address.sql
-- เพิ่มคอลัมน์ที่อยู่แบบโครงสร้าง (address_province/district/subdistrict/moo/detail) ใน get_users_with_email()

drop function if exists public.get_users_with_email(uuid, text[], text, int, int);

create or replace function public.get_users_with_email(
  p_municipality_id uuid default null,
  p_roles           text[] default null,
  p_search          text default null,
  p_limit           int default null,
  p_offset          int default 0
)
returns table (
  id                  uuid,
  email               text,
  full_name           text,
  role                text,
  municipality_id     uuid,
  municipality_name   text,
  phone               text,
  id_card             text,
  job_title           text,
  address             text,
  address_province    text,
  address_district    text,
  address_subdistrict text,
  address_moo         text,
  address_detail      text,
  avatar_url          text,
  providers           text[],
  last_sign_in_at     timestamptz,
  created_at          timestamptz,
  staff_id            uuid,
  staff_name          text,
  staff_title         text,
  department_id       uuid,
  department_name     text,
  is_dept_head        boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_muni uuid;
begin
  select p.role, p.municipality_id into v_role, v_muni
  from public.profiles p where p.id = auth.uid();

  if v_role not in ('admin', 'superadmin', 'officer') then
    raise exception 'Permission denied';
  end if;

  if v_role in ('admin', 'officer') and p_municipality_id is distinct from v_muni then
    raise exception 'Permission denied: municipality mismatch';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(p.email, ''), u.email) as email,
    p.full_name,
    p.role,
    p.municipality_id,
    m.name as municipality_name,
    p.phone,
    p.id_card,
    p.job_title,
    p.address,
    p.address_province,
    p.address_district,
    p.address_subdistrict,
    p.address_moo,
    p.address_detail,
    p.avatar_url,
    array(
      select distinct i.provider
      from auth.identities i where i.user_id = p.id
    ) as providers,
    u.last_sign_in_at,
    p.created_at,
    s.id   as staff_id,
    s.name as staff_name,
    s.title as staff_title,
    p.department_id,
    dep.name as department_name,
    p.is_dept_head
  from public.profiles p
  left join auth.users        u on u.id = p.id
  left join public.municipalities m on m.id = p.municipality_id
  left join public.staff      s on s.id = p.staff_id
  left join public.departments dep on dep.id = p.department_id
  where
    (
      (p_municipality_id is null and v_role = 'superadmin')
      or p.municipality_id = p_municipality_id
      or (
        p_municipality_id is not null
        and p.municipality_id is null
        and exists (
          select 1 from public.complaints c
          where c.user_id = p.id and c.municipality_id = p_municipality_id
        )
      )
    )
    and (p_roles is null or p.role = any(p_roles))
    and (
      p_search is null or p_search = ''
      or p.full_name ilike '%' || p_search || '%'
      or p.phone     ilike '%' || p_search || '%'
      or p.id_card   ilike '%' || p_search || '%'
    )
  order by p.created_at desc
  limit  coalesce(p_limit, 2147483647)
  offset p_offset;
end;
$$;

grant execute on function public.get_users_with_email(uuid, text[], text, int, int) to authenticated;
-- History version aligned with linked Supabase project.
