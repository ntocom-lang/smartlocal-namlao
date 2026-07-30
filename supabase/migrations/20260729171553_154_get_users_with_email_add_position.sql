-- 154_get_users_with_email_add_position.sql
-- เพิ่ม position_id/position_name เข้า get_users_with_email — ต้อง DROP ก่อน CREATE
-- เพราะ Postgres ไม่ให้ CREATE OR REPLACE เปลี่ยนรายการคอลัมน์ของ RETURNS TABLE
--
-- หมายเหตุ: backfill จาก schema จริงบน Supabase ย้อนหลัง เนื้อหาคือฟังก์ชันเวอร์ชัน
-- ที่ apply จริงตอนนั้น (ยังไม่มีการแก้ไขเพิ่มเติมหลังจากนี้)

DROP FUNCTION IF EXISTS public.get_users_with_email(uuid, text[], text, integer, integer);

CREATE FUNCTION public.get_users_with_email(
  p_municipality_id uuid DEFAULT NULL,
  p_roles text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, email text, full_name text, role text, municipality_id uuid, municipality_name text,
  phone text, id_card text, job_title text, address text, address_province text, address_district text,
  address_subdistrict text, address_moo text, address_detail text, avatar_url text, providers text[],
  last_sign_in_at timestamptz, created_at timestamptz, staff_id uuid, staff_name text, staff_title text,
  department_id uuid, department_name text, is_dept_head boolean, position_id uuid, position_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_role text;
  v_muni uuid;
begin
  select p.role, p.municipality_id into v_role, v_muni
  from public.profiles p where p.id = auth.uid();

  if v_role is null or v_role not in ('admin', 'superadmin', 'officer') then
    raise exception 'Permission denied';
  end if;

  if v_role in ('admin', 'officer') and p_municipality_id is distinct from v_muni then
    raise exception 'Permission denied: municipality mismatch';
  end if;

  return query
  select
    p.id, coalesce(nullif(p.email, ''), u.email), p.full_name, p.role,
    p.municipality_id, m.name, p.phone, p.id_card, p.job_title, p.address,
    p.address_province, p.address_district, p.address_subdistrict,
    p.address_moo, p.address_detail, p.avatar_url,
    array(select distinct i.provider from auth.identities i where i.user_id = p.id),
    u.last_sign_in_at, p.created_at,
    s.id, s.name, s.title, p.department_id, dep.name, p.is_dept_head,
    p.position_id, pos.name
  from public.profiles p
  left join auth.users         u   on u.id = p.id
  left join public.municipalities m on m.id = p.municipality_id
  left join public.staff       s   on s.id = p.staff_id
  left join public.departments dep on dep.id = p.department_id
  left join public.positions   pos on pos.id = p.position_id
  where (
      (p_municipality_id is null and v_role = 'superadmin')
      or p.municipality_id = p_municipality_id
      or (
        p_municipality_id is not null and p.municipality_id is null
        and exists (select 1 from public.complaints c where c.user_id = p.id and c.municipality_id = p_municipality_id)
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
  limit coalesce(p_limit, 2147483647)
  offset p_offset;
end;
$$;
