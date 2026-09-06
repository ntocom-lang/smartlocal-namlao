-- เพิ่ม photo_urls เข้า data_center_unified_pins() เพื่อให้การ์ดรายละเอียดหมุดบนแผนที่แสดงรูป
-- ของสถานที่ได้ (เสาไฟ/กล้อง/บ่อน้ำ ตัวไหน สภาพเป็นยังไง) — เดิมฟอร์มให้แนบรูปได้ 5 รูปและเก็บลง
-- data_center_entries.photo_urls อยู่แล้ว แต่ RPC ไม่เคยส่งกลับมา รูปจึงไม่เคยถูกใช้งานเลย
--
-- ⚠️ ห้ามใช้ CREATE OR REPLACE กับฟังก์ชันนี้ เพราะ RETURNS TABLE เปลี่ยน (เพิ่มคอลัมน์)
--    Postgres จะขึ้น 42P13 ต้อง DROP ก่อนเสมอ — body ด้านล่างคัดจากนิยามตัวจริงในฐานข้อมูล
--    (pg_get_functiondef ณ วันที่ทำ migration นี้ ตรงกับ 20260902090000 ทุกบรรทัด) ไม่ใช่เขียนใหม่
--    ห้ามใส่ placeholder หรือย่อ body เด็ดขาด ฟังก์ชันนี้ถูกเรียกจากแผนที่ทั้งฝั่งประชาชนและเจ้าหน้าที่
--
-- ⚠️ PDPA: photo_urls ต้องมีค่าเฉพาะสาขา data_center_entries เท่านั้น สาขาอื่นบังคับ null::text[]
--    ตายตัว — complaints/business_registrations ก็มีรูปแนบของประชาชนผู้แจ้ง (ภาพบ้าน ทรัพย์สิน
--    บางใบติดหน้าคน) ถ้าเผลอ union เข้ามาคือเปิดรูปเหล่านั้นออกสู่แผนที่สาธารณะ
--    รูปของ data_center_entries เป็นรูปสถานที่สาธารณะที่เจ้าหน้าที่ถ่ายลงระบบเอง คนละชนิดกัน

DROP FUNCTION IF EXISTS public.data_center_unified_pins(uuid);

CREATE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
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

  -- สายสาธารณะ: ไม่ล็อกอิน / citizen / role นอกลิสต์ (คงเดิมจาก 20260829090000 ทุกบรรทัด)
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
         -- viewer/council: ชื่อหมวดแทนหัวเรื่องที่ประชาชนพิมพ์เอง (fallback เป็น value ถ้าหมวดถูกลบ)
         case when v_analyst then coalesce(cat.label, c.category) else c.subject end,
         c.status,
         c.latitude::double precision, c.longitude::double precision, c.created_at,
         case when v_analyst then null else c.detail end,
         null::jsonb, null::text,
         case
           when public.complaint_category_is_adhoc(c.municipality_id, c.category)
           then public.adhoc_pin_answers(coalesce(c.extra_data, '{}'::jsonb))
           else null::jsonb
         end,
         -- รูปแนบของคำร้องเป็นของผู้แจ้ง ไม่ส่งออกแผนที่ (ดูหมายเหตุ PDPA ด้านบน)
         null::text[]
    from public.complaints c
    left join public.complaint_categories cat
      on cat.municipality_id = c.municipality_id and cat.value = c.category
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
      and (
        not public.complaint_category_is_adhoc(c.municipality_id, c.category)
        or v_role in ('admin', 'superadmin')
        or c.assigned_to = auth.uid()
        -- ใหม่: ผู้บริหารเห็นหมุดเฉพาะกิจได้ แต่ได้เฉพาะพิกัด/เวลา/คำตอบ structured ตาม select ข้างบน
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

-- DROP FUNCTION ลบ grant เดิมไปด้วย ต้องให้สิทธิ์ใหม่ทุกครั้ง ไม่งั้นแผนที่ทั้งระบบขึ้น 42501
REVOKE ALL ON FUNCTION public.data_center_unified_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.data_center_unified_pins(uuid) IS
  'หมุดรวมของแผนที่ศูนย์ข้อมูล: anon/citizen เห็นเฉพาะ data_center_entries ที่ active ของเทศบาลที่ระบุ; admin/officer/staff/technician เห็นตาม scope เดิม; viewer/council เห็นหมุดคำร้องรวมหมวดเฉพาะกิจเพื่อวิเคราะห์ แต่ตัด free-text (subject/detail) ออกทั้งหมด และได้คำตอบ structured ผ่าน adhoc_pin_answers(); photo_urls คืนเฉพาะสาขา data_center_entries เท่านั้น (รูปสถานที่ที่เจ้าหน้าที่ถ่ายลงระบบ) สาขาอื่นเป็น null เสมอเพื่อไม่ให้รูปแนบของผู้แจ้งหลุดออกแผนที่';
