-- data_center_unified_pins ไม่เคยกรอง status ของ data_center_entries เลย (ต่างจากแหล่งอื่นที่มีสถานะ
-- ในความหมายคนละแบบ) ทำให้รายการที่แอดมินตั้งเป็น "ไม่ใช้งาน" (archived) ยังโผล่บนแผนที่จริงอยู่ —
-- เพิ่มเงื่อนไข status='active' เฉพาะส่วนนี้ ให้ตรงกับปุ่ม "ใช้งาน/ไม่ใช้งาน" ใน DataCenterOverview.jsx
DROP FUNCTION IF EXISTS public.data_center_unified_pins(uuid);

CREATE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz,
  description text, route_points jsonb, route_color text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare v_muni uuid; v_role text;
begin
  v_role := public.get_my_role();

  if v_role is not null and v_role not in ('superadmin','admin','officer','staff','technician','viewer','council') then
    raise exception 'Permission denied';
  end if;

  v_muni := case
    when v_role = 'superadmin' then _municipality_id
    when v_role is null then _municipality_id
    else public.get_my_municipality_id()
  end;

  return query
  select 'complaints'::text, c.id, 'คำร้อง'::text, c.category, c.subject, c.status,
         c.latitude::double precision, c.longitude::double precision, c.created_at,
         c.detail, null::jsonb, null::text
    from public.complaints c
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
  union all
  select 'business_registrations', b.id, 'สถานประกอบการ', b.business_type, b.business_name, b.status,
         b.latitude::double precision, b.longitude::double precision, b.created_at,
         b.description, null::jsonb, null::text
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at,
         i.description, null::jsonb, null::text
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at,
         p.description, null::jsonb, null::text
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at,
         d.description, d.route_points, d.route_color
    from public.data_center_entries d
    where d.status = 'active' and (v_muni is null or d.municipality_id = v_muni);
end;
$$;

GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;
