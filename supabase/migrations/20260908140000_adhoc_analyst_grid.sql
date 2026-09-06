-- หมวดเฉพาะกิจ: viewer/council ได้จุดกลางกริดประมาณ 100 เมตรจาก RPC
-- ใช้สูตรเดียวกับ buildOdorPoints() ใน src/lib/odorAnalytics.js โดยอ้างจุดกำเนิด (0,0)
-- พิกัดต้นฉบับยังเก็บไว้สำหรับแอดมินและผู้รับผิดชอบ กริดไม่ได้ทำให้ข้อมูลเป็นนิรนาม
-- คัด body จาก 20260908120000 และคง photo_urls / tenant scope / สิทธิ์เดิมทุกสาขา

DO $$
BEGIN
  IF to_regprocedure('public.data_center_unified_pins(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply data_center_unified_pins migrations first';
  END IF;
  IF pg_get_function_result('public.data_center_unified_pins(uuid)'::regprocedure)
       NOT LIKE '%photo_urls text[]%' THEN
    RAISE EXCEPTION 'Apply 20260908120000_datacenter_pins_photo_urls first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz,
  description text, route_points jsonb, route_color text, extra_data jsonb, photo_urls text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare
  v_muni uuid;
  v_role text;
  v_is_staff boolean;
  v_analyst boolean;   -- viewer/council: เห็นเพื่อวิเคราะห์ ไม่เห็น free-text
begin
  v_role := public.get_my_role();
  v_is_staff := v_role in ('superadmin','admin','officer','staff','technician','viewer','council');
  v_analyst := v_role in ('viewer','council');

  if not coalesce(v_is_staff, false) then
    if _municipality_id is null then
      raise exception 'municipality_id is required for public access';
    end if;

    return query
    select 'data_center_entries'::text, d.id, d.group_name, d.category, d.name, d.status,
           d.latitude::double precision, d.longitude::double precision, d.created_at,
           d.description, d.route_points, d.route_color, null::jsonb, d.photo_urls
      from public.data_center_entries d
      where d.status = 'active'
        and d.municipality_id = _municipality_id;
    return;
  end if;

  v_muni := case when v_role = 'superadmin' then _municipality_id
                 else public.get_my_municipality_id() end;

  if v_role <> 'superadmin' and v_muni is null then
    raise exception 'ไม่พบสังกัดเทศบาลของผู้ใช้รายนี้';
  end if;

  return query
  select 'complaints'::text, c.id, 'คำร้อง'::text, c.category,
         case when v_analyst then coalesce(cat.label, c.category) else c.subject end,
         c.status,
         case when privacy.use_grid then grid.latitude else c.latitude::double precision end,
         case when privacy.use_grid then
           (floor(c.longitude::double precision / grid.lng_step) + 0.5) * grid.lng_step
           else c.longitude::double precision end,
         c.created_at,
         case when v_analyst then null else c.detail end,
         null::jsonb, null::text,
         case
           when public.complaint_category_is_adhoc(c.municipality_id, c.category)
           then public.adhoc_pin_answers(coalesce(c.extra_data, '{}'::jsonb))
           else null::jsonb
         end,
         null::text[]
    from public.complaints c
    left join public.complaint_categories cat
      on cat.municipality_id = c.municipality_id and cat.value = c.category
    cross join lateral (
      select v_analyst and public.complaint_category_is_adhoc(c.municipality_id, c.category)
        as use_grid
    ) privacy
    cross join lateral (
      -- พิกัดว่าง/นอกกรอบ/NaN/Infinity ไม่คำนวณ cos() และไม่คืนพิกัดดิบให้ analyst
      select case when privacy.use_grid
        and c.latitude::double precision between 5 and 21
        and c.longitude::double precision between 96 and 106
        then (floor(c.latitude::double precision / (100.0::double precision / 111320.0)) + 0.5)
          * (100.0::double precision / 111320.0)
        else null::double precision end as latitude
    ) cell
    cross join lateral (
      -- ใช้ latitude ของเซลล์กำหนดความกว้าง เพื่อให้ทุกจุดในแถวกริดเดียวกันตรงกัน
      select cell.latitude, case when cell.latitude is not null then
        100.0::double precision / (111320.0 * greatest(0.01, cos(radians(cell.latitude))))
        else null::double precision end as lng_step
    ) grid
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
      and (
        not public.complaint_category_is_adhoc(c.municipality_id, c.category)
        or v_role in ('admin', 'superadmin')
        or c.assigned_to = auth.uid()
        or v_analyst
      )
  union all
  select 'business_registrations', b.id, 'สถานประกอบการ', b.business_type, b.business_name, b.status,
         b.latitude::double precision, b.longitude::double precision, b.created_at,
         b.description, null::jsonb, null::text, null::jsonb, null::text[]
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at,
         i.description, null::jsonb, null::text, null::jsonb, null::text[]
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at,
         p.description, null::jsonb, null::text, null::jsonb, null::text[]
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at,
         d.description, d.route_points, d.route_color, null::jsonb, d.photo_urls
    from public.data_center_entries d
    where d.status = 'active' and (v_muni is null or d.municipality_id = v_muni);
end;
$$;

REVOKE ALL ON FUNCTION public.data_center_unified_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.data_center_unified_pins(uuid) IS
  'หมุดศูนย์ข้อมูลตามสิทธิ์และสังกัดเดิม: viewer/council ได้พิกัดกลางกริดประมาณ 100 เมตรเฉพาะหมวดเฉพาะกิจ โดยสูตรตรงกับรายงานกลิ่น; พิกัดเฉพาะกิจที่ว่างหรือนอกกรอบประเทศไทยเป็น null สำหรับ analyst; ไม่คืน subject/detail ให้ analyst; photo_urls คืนเฉพาะ data_center_entries; แอดมินและผู้รับผิดชอบยังได้พิกัดต้นฉบับ';
