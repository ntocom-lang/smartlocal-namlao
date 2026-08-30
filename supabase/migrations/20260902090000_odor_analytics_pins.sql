-- 20260902090000_odor_analytics_pins.sql
--
-- [ปัญหา P0] ผู้บริหาร (viewer/council) ไม่เห็นหมุดคำร้องหมวดเฉพาะกิจ (is_adhoc, ตอนนี้คือ odor)
-- บนแผนที่ศูนย์ข้อมูลเลย ทั้งที่หมวดนี้ถูกออกแบบมาเพื่อ "เก็บข้อมูลไปวิเคราะห์การกระจายตัวของกลิ่น"
-- โดยเฉพาะ — ยืนยันด้วย E2E แล้วว่า admin เห็น ES-69-0013 แต่ viewer ไม่เห็นรายการเดียวกัน
-- ต้นเหตุอยู่ที่ 20260827120000_restrict_odor_adhoc_visibility.sql ที่ตัด viewer/council ออกจาก
-- หมวดเฉพาะกิจทุกเส้นทางพร้อมกัน (list_complaints_for_staff, get_complaint_private_detail และ
-- data_center_unified_pins) ซึ่งถูกต้องแล้วสำหรับ 2 ตัวแรก (รายการคำร้อง = ข้อมูลผู้แจ้งเต็มก้อน)
-- แต่กว้างเกินไปสำหรับหมุดบนแผนที่ ที่ผู้บริหารต้องใช้ตัดสินใจเชิงนโยบาย
--
-- [ทางแก้] แยก "สายวิเคราะห์" (viewer/council) ออกจาก "สายปฏิบัติงาน" (admin/officer/staff/technician)
-- ในฟังก์ชันเดียวกัน: สายวิเคราะห์เห็นหมุดเฉพาะกิจได้ แต่ได้เฉพาะข้อมูลที่ใช้วิเคราะห์จริงเท่านั้น
--   ส่งให้: พิกัด, วันเวลาที่แจ้ง, หมวด, สถานะ และคำตอบแบบ structured (4 คีย์ whitelist)
--   ไม่ส่ง: subject/detail (free-text ที่ประชาชนพิมพ์เอง มักมีชื่อ/บ้านเลขที่/เบอร์โทร),
--           reporter_name, phone, user_id — ฟังก์ชันนี้ไม่เคยคืน 3 ตัวหลังอยู่แล้ว
--
-- [รูรั่วที่ปิดพร้อมกัน] เดิม viewer/council ได้ c.detail ดิบของคำร้อง "หมวดปกติ" จากฟังก์ชันนี้
-- ทั้งที่ list_complaints_for_staff (20260827120000) ตัด detail/latitude/longitude ของ viewer ทิ้ง
-- ไปแล้ว = ช่องทางเดียวกัน 2 มาตรฐาน ใครเปิดหน้าแผนที่ก็อ่าน free-text ได้ครบทุกคำร้อง
-- รอบนี้ให้ viewer/council ได้ title = ชื่อหมวด และ description = NULL ทุกแถวของ complaints
--
-- [ไม่เปลี่ยน] anon/citizen (สายสาธารณะ) ยังเห็นเฉพาะ data_center_entries ที่ status='active'
-- ตามที่ 20260829090000 วางไว้ทุกประการ, officer/staff ที่ไม่ถูก assign ยังไม่เห็นหมวดเฉพาะกิจ,
-- technician เห็นเฉพาะงานที่ถูก assign เหมือนเดิม
--
-- เปลี่ยนโครง RETURNS TABLE (เพิ่มคอลัมน์ extra_data) จึงต้อง DROP ก่อน CREATE

-- payload แบบ whitelist: รับ extra_data ทั้งก้อนแล้วคืนเฉพาะคีย์ที่เป็นคำตอบเชิงวิเคราะห์
-- คีย์ที่ไม่รู้จัก (เช่นที่ client รุ่นอนาคตเผลอยัดเข้ามา) ตกหายที่นี่เสมอ ไม่หลุดออกทางแผนที่
CREATE OR REPLACE FUNCTION public.adhoc_pin_answers(p_extra jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'odor_intensity',
      CASE WHEN jsonb_typeof(p_extra -> 'odor_intensity') = 'number'
      THEN p_extra -> 'odor_intensity' END,
    'odor_time_range',
      CASE WHEN jsonb_typeof(p_extra -> 'odor_time_range') = 'string'
      THEN p_extra -> 'odor_time_range' END,
    'wind_direction',
      CASE WHEN jsonb_typeof(p_extra -> 'wind_direction') = 'string'
      THEN p_extra -> 'wind_direction' END,
    'health_effect',
      CASE WHEN jsonb_typeof(p_extra -> 'health_effect') = 'string'
      THEN p_extra -> 'health_effect' END
  )) || jsonb_build_object('acknowledged', (p_extra ->> 'acknowledged_at') IS NOT NULL)
$$;

REVOKE ALL ON FUNCTION public.adhoc_pin_answers(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adhoc_pin_answers(jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.adhoc_pin_answers(jsonb) IS
  'คืนเฉพาะคำตอบ structured ของคำร้องหมวดเฉพาะกิจสำหรับแสดงบนแผนที่ (whitelist 4 คีย์ + acknowledged) ไม่มี free-text และไม่มีข้อมูลผู้แจ้ง';

DROP FUNCTION IF EXISTS public.data_center_unified_pins(uuid);

CREATE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz,
  description text, route_points jsonb, route_color text, extra_data jsonb
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
           d.description, d.route_points, d.route_color, null::jsonb
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
         end
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
         b.description, null::jsonb, null::text, null::jsonb
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at,
         i.description, null::jsonb, null::text, null::jsonb
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at,
         p.description, null::jsonb, null::text, null::jsonb
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at,
         d.description, d.route_points, d.route_color, null::jsonb
    from public.data_center_entries d
    where d.status = 'active' and (v_muni is null or d.municipality_id = v_muni);
end;
$$;

REVOKE ALL ON FUNCTION public.data_center_unified_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.data_center_unified_pins(uuid) IS
  'หมุดรวมของแผนที่ศูนย์ข้อมูล: anon/citizen เห็นเฉพาะ data_center_entries ที่ active ของเทศบาลที่ระบุ; admin/officer/staff/technician เห็นตาม scope เดิม; viewer/council เห็นหมุดคำร้องรวมหมวดเฉพาะกิจเพื่อวิเคราะห์ แต่ตัด free-text (subject/detail) ออกทั้งหมด และได้คำตอบ structured ผ่าน adhoc_pin_answers()';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   set local role authenticated; -- พร้อม JWT ของ viewer
--   select source_table, title, description, extra_data
--     from public.data_center_unified_pins('<municipality_id>')
--    where source_table = 'complaints';
--   ต้องได้ description เป็น NULL ทุกแถว และ extra_data มีเฉพาะ 5 คีย์ที่ whitelist ไว้
