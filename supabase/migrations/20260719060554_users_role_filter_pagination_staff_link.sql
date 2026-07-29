-- SmartLocal 120: แยกหน้า "จัดการเจ้าหน้าที่" ออกจาก "ผู้ใช้งานประชาชน"
-- 1. เพิ่ม profiles.staff_id เชื่อมบัญชี login เข้ากับแถวข้อมูลสาธารณะในตาราง staff
--    (แก้ปัญหา: บัญชี viewer ของนายกกับข้อมูล "นายก" ที่โชว์หน้าเว็บเป็นคนละแถวไม่เชื่อมกัน)
-- 2. ต่อยอด get_users_with_email() เดิม เพิ่ม role filter + search + pagination
--    กัน "จัดการเจ้าหน้าที่" โหลดผู้ใช้ทุกคน (citizen+staff ปน) มาทีเดียวไม่มี limit

-- ─── 1. เชื่อม profiles ↔ staff ───────────────────────────────────────────────
alter table profiles
  add column if not exists staff_id uuid references staff(id) on delete set null;

-- ─── 2. ขยาย get_users_with_email() ───────────────────────────────────────────
-- ต้อง drop signature เดิม (1 arg) ก่อน ไม่งั้น Postgres จะมองเป็นคนละ overload
-- แล้วเรียกแบบ 1 arg เดิมจะ ambiguous ระหว่าง 2 ฟังก์ชัน
drop function if exists public.get_users_with_email(uuid);

create or replace function public.get_users_with_email(
  p_municipality_id uuid default null,
  p_roles           text[] default null,   -- null = ทุก role, ['citizen'] เฉพาะประชาชน, ฯลฯ
  p_search          text default null,     -- ค้นหาชื่อ/เบอร์/เลขบัตร (ILIKE)
  p_limit           int default null,      -- null = ไม่จำกัด (ใช้กับหน้าเจ้าหน้าที่ dataset เล็ก)
  p_offset          int default 0
)
returns table (
  id                uuid,
  email             text,
  full_name         text,
  role              text,
  municipality_id   uuid,
  municipality_name text,
  phone             text,
  id_card           text,
  job_title         text,
  address           text,
  avatar_url        text,
  providers         text[],
  last_sign_in_at   timestamptz,
  created_at        timestamptz,
  staff_id          uuid,
  staff_name        text,
  staff_title       text
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
    p.avatar_url,
    array(
      select distinct i.provider
      from auth.identities i where i.user_id = p.id
    ) as providers,
    u.last_sign_in_at,
    p.created_at,
    s.id   as staff_id,
    s.name as staff_name,
    s.title as staff_title
  from public.profiles p
  left join auth.users        u on u.id = p.id
  left join public.municipalities m on m.id = p.municipality_id
  left join public.staff      s on s.id = p.staff_id
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
