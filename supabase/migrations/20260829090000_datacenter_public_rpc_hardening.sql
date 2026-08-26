-- 20260829090000_datacenter_public_rpc_hardening.sql
--
-- [ช่องโหว่ที่ปิด] data_center_unified_pins() เป็น SECURITY DEFINER (ข้าม RLS ทุกตารางที่มันอ่าน)
-- และถูก GRANT EXECUTE ให้ทั้ง anon และ PUBLIC — เดิมเมื่อผู้เรียก "ไม่มี role" (get_my_role() คืน NULL
-- คือคนที่ไม่ได้ล็อกอิน) ฟังก์ชันจะเชื่อค่า _municipality_id ที่ผู้เรียกส่งเข้ามาตรงๆ:
--
--     v_muni := case ... when v_role is null then _municipality_id ... end;
--     ... where v_muni is null or c.municipality_id = v_muni
--
-- ส่ง _municipality_id => NULL เข้ามา เงื่อนไข "v_muni is null" จะเป็นจริงกับทุกแถวของทุกเทศบาล
-- ผลคือใครก็ตามที่หยิบ anon key ออกจาก JS bundle (ซึ่งเป็นค่าสาธารณะโดยธรรมชาติ) เรียก RPC นี้
-- ครั้งเดียวจะได้คำร้องของประชาชนข้ามเทศบาลทั้งหมด พร้อม complaints.subject + complaints.detail
-- (ข้อความที่ประชาชนพิมพ์เอง มักมีชื่อ/ที่อยู่/เบอร์โทร) + ละติจูด/ลองจิจูดของจุดที่ร้อง
-- โดยข้าม RLS ของ public.complaints ไปทั้งหมด — เข้าข่ายการเปิดเผยข้อมูลส่วนบุคคลโดยไม่มีฐานทางกฎหมาย
-- ทดสอบยืนยันบนฐานข้อมูลจริงแล้ว (set role anon; select ... from data_center_unified_pins(null))
-- ได้ 41 แถว เป็นคำร้อง 27 เรื่อง ข้าม 2 เทศบาล
--
-- [บั๊กที่เก็บไปพร้อมกัน] ประชาชนที่ "ล็อกอินแล้ว" (profiles.role = 'citizen') โดน guard เดิม
--     if v_role is not null and v_role not in ('superadmin','admin',...) then raise exception
-- ดีดออกด้วย Permission denied → เปิด /data-center/public แล้วแผนที่ว่างเปล่า ขณะที่คนไม่ล็อกอิน
-- กลับเห็นปกติ ซึ่งกลับหัวกลับหางกับที่ควรเป็น
--
-- [ทางแก้] แยกโค้ดเป็น 2 สายชัดเจน แทนการคำนวณ v_muni รวมกันแล้วหวังว่าเงื่อนไข where จะกรองถูก:
--   สายสาธารณะ (ไม่ใช่ staff: anon, citizen, หรือ role อะไรก็ตามที่ไม่อยู่ในลิสต์ staff)
--     - บังคับต้องระบุ _municipality_id ห้ามเป็น NULL (ตัดช่องทาง "ขอทุกเทศบาล" ทิ้งทั้งเส้น)
--     - คืนเฉพาะ data_center_entries ที่ status='active' เท่านั้น ตรงกับ RLS "dce public read active"
--       ที่เปิดให้ anon อ่านตารางนี้อยู่แล้ว = ฟังก์ชันนี้ไม่ได้ให้สิทธิ์เกินกว่าที่ตารางให้เอง
--     - ไม่แตะ complaints / business_registrations / infrastructure_works / civil_projects เลย
--       ตรวจแล้วว่าไม่กระทบ UI: DataCenterMapView แสดงหมุดเฉพาะที่อยู่ใน activeCategories และฝั่ง
--       ประชาชนถูกล็อก effectiveTab='dce' จึงไม่มีทางติ๊กหมวดคำร้อง/โครงการได้ตั้งแต่แรก
--       (หมุดพวกนี้ถูกดึงมาแล้วทิ้งเปล่าๆ มาตลอด ไม่เคยแสดงผลจริงฝั่งสาธารณะ)
--   สายเจ้าหน้าที่ (superadmin/admin/officer/staff/technician/viewer/council)
--     - พฤติกรรมเดิมทุกประการ รวมทั้ง superadmin ที่ส่ง _municipality_id = NULL เพื่อดูข้ามเทศบาล
--       ได้ตามดีไซน์ และการกรองหมวดเฉพาะกิจ (is_adhoc) ที่เพิ่มไว้ใน 20260827120000
--     - เพิ่ม guard ใหม่: ไม่ใช่ superadmin แต่ get_my_municipality_id() เป็น NULL (โปรไฟล์ผิดปกติ)
--       เดิมจะหลุดไปเข้าเงื่อนไข "v_muni is null" แล้วเห็นทุกเทศบาล — เปลี่ยนเป็น raise exception

DROP FUNCTION IF EXISTS public.data_center_unified_pins(uuid);

CREATE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz,
  description text, route_points jsonb, route_color text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare
  v_muni uuid;
  v_role text;
  v_is_staff boolean;
begin
  v_role := public.get_my_role();
  v_is_staff := v_role in ('superadmin','admin','officer','staff','technician','viewer','council');

  -- สายสาธารณะ: ไม่ล็อกอิน / citizen / role นอกลิสต์
  if not coalesce(v_is_staff, false) then
    if _municipality_id is null then
      raise exception 'municipality_id is required for public access';
    end if;

    return query
    select 'data_center_entries'::text, d.id, d.group_name, d.category, d.name, d.status,
           d.latitude::double precision, d.longitude::double precision, d.created_at,
           d.description, d.route_points, d.route_color
      from public.data_center_entries d
      where d.status = 'active'
        and d.municipality_id = _municipality_id;
    return;
  end if;

  -- สายเจ้าหน้าที่: เหมือนเดิมทุกประการ
  v_muni := case when v_role = 'superadmin' then _municipality_id
                 else public.get_my_municipality_id() end;

  if v_role <> 'superadmin' and v_muni is null then
    raise exception 'ไม่พบสังกัดเทศบาลของผู้ใช้รายนี้';
  end if;

  return query
  select 'complaints'::text, c.id, 'คำร้อง'::text, c.category, c.subject, c.status,
         c.latitude::double precision, c.longitude::double precision, c.created_at,
         c.detail, null::jsonb, null::text
    from public.complaints c
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
      and (
        not public.complaint_category_is_adhoc(c.municipality_id, c.category)
        or v_role in ('admin', 'superadmin')
        or c.assigned_to = auth.uid()
      )
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

-- PUBLIC (=X/postgres ใน proacl) ครอบคลุมทุก role รวมถึง role ที่จะถูกสร้างในอนาคต — ไม่เคยตั้งใจให้
-- กว้างขนาดนั้น ตัดทิ้งแล้วให้เฉพาะ 2 role ที่ใช้จริง (anon = แผนที่สาธารณะ, authenticated = ที่เหลือ)
REVOKE ALL ON FUNCTION public.data_center_unified_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;

-- data_center_group_icons: จำกัดคอลัมน์ที่ anon อ่านได้
-- RLS ของตารางนี้เป็น "dce icons public read" USING (true) เพราะ anon ไม่มี tenant context ให้ RLS
-- ใช้ตัดสินได้ (แผนที่สาธารณะของทุกเทศบาลต้องอ่านไอคอนของตัวเองให้ได้โดยไม่ต้องล็อกอิน) — คงไว้ตามเดิม
-- เพราะของที่เห็นข้ามเทศบาลคือ "ชื่อกลุ่ม + อิโมจิ" ซึ่งไม่ใช่ข้อมูลส่วนบุคคล และเป็นข้อมูลที่แผนที่
-- สาธารณะของแต่ละเทศบาลเปิดเผยเองอยู่แล้ว
-- แต่ SELECT * ปัจจุบันพ่วง updated_by (uuid ของผู้ใช้ในระบบ) กับ id/updated_at ออกไปด้วยโดยไม่จำเป็น
-- — client (src/lib/dataCenterGroupIcon.js: fetchGroupIconOverrides) ใช้จริงแค่ 4 คอลัมน์ล่างนี้
REVOKE SELECT ON public.data_center_group_icons FROM anon;
GRANT SELECT (municipality_id, group_name, category, emoji)
  ON public.data_center_group_icons TO anon;
