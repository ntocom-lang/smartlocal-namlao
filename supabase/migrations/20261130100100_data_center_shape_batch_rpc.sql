-- 20261130100100_data_center_shape_batch_rpc.sql
--
-- ศูนย์รวมข้อมูลดิจิทัล — นำเข้า GIS เฟส 2 (ฟังก์ชัน) ต้องรันหลัง 20261130100000_data_center_shape_batch_columns.sql
--
-- มี 3 อย่าง
--   1) data_center_unified_pins(uuid)            เพิ่มคอลัมน์ผล shape (ให้แผนที่วาด "พื้นที่ทึบ" แยกจาก "เส้น")
--   2) data_center_import_batches(uuid)          รายการชุดการนำเข้า 50 ชุดล่าสุด (SECURITY INVOKER)
--   3) data_center_cancel_import_batch(uuid)     ยกเลิกการนำเข้าทั้งชุด = ลบจริงทั้งชุด (SECURITY INVOKER)
--
-- ═══ ด่านตรวจหัวไฟล์ ═══════════════════════════════════════════════════════════════════════════
-- ข้อ 1 เป็น DROP + CREATE (RETURNS TABLE เปลี่ยน ใช้ CREATE OR REPLACE ไม่ได้ ขึ้น 42P13) และ body ทั้งก้อน
-- ยกมาจาก 20260908140000_adhoc_analyst_grid.sql ซึ่งเป็น migration ล่าสุดในรีโปที่นิยามฟังก์ชันนี้
-- (docs/ai/NOTES.md ข้อ 5: ตั้งต้นจากรุ่นล่าสุดเสมอ และต้องตรงกับฐานจริง)
-- session ที่เขียนไฟล์นี้อ่านฐานจริงไม่ได้ จึงฝังด่าน md5 ไว้แทน: นำ prosrc บนฐานมาตัดคอมเมนต์ "--" และ
-- ช่องว่าง ASCII ทิ้ง แล้วเทียบ md5 กับรุ่นที่รู้จัก ไม่ตรง = RAISE แล้วทั้งก้อนย้อนกลับ ไม่มีอะไรถูกเขียนทับ
--   847cb27ae05bb560fdd5a3aa5ec117bd = body ของ 20260908140000 (คำนวณจากไฟล์ในรีโป ตรงกันทั้ง Node และ PostgreSQL)
--   1bbb0fcaf617f95a355187fe42fc4751 = body ของไฟล์นี้เอง (รันซ้ำได้) — เทสต์ test:datacenter-gis:db เฝ้าว่า 2 ค่านี้ตรงกับไฟล์จริง
-- ในโค้ดใช้ chr(45)||chr(45) แทนสตริงขีดสองตัว เพราะ SQL Editor อาจตัดคอมเมนต์โดยไม่ดูว่าอยู่ในสตริง
--
-- ═══ ข้อ 1: shape ═══════════════════════════════════════════════════════════════════════════════
-- เปลี่ยนจากรุ่นเดิมแค่ "เพิ่มคอลัมน์ผล shape ท้ายสุด" ทุกบรรทัดอื่นคงเดิม:
--   สาขา data_center_entries (สาธารณะ + เจ้าหน้าที่): ค่าจริงในคอลัมน์ ถ้า NULL (รายการก่อนเฟส 2) อนุมาน
--     route_points เป็น array >= 2 จุด → 'line' นอกนั้น → 'point' (ตรงกับที่หน้าเว็บตัดสินเองมาตลอด)
--     CASE ซ้อน 2 ชั้นโดยตั้งใจ: jsonb_array_length() กับค่าที่ไม่ใช่ array จะ error ต้องตรวจชนิดก่อนเสมอ
--   สาขาอื่น 4 สาขา (คำร้อง/สถานประกอบการ/โครงสร้างพื้นฐาน/โครงการก่อสร้าง): null::text ตายตัว
-- import_batch_id ไม่ออกทาง RPC นี้ (แผนที่ไม่ต้องใช้ และสายสาธารณะไม่ควรเห็นข้อมูลการทำงานภายใน)
--
-- ═══ ข้อ 2–3: ชุดการนำเข้า ══════════════════════════════════════════════════════════════════════
-- ทั้งคู่เป็น SECURITY INVOKER ให้ RLS ของ data_center_entries ตัดสินสิทธิ์ลบเอง ไม่เพิ่ม privilege surface
-- (บทเรียน 20260829090000: DEFINER + เชื่อ tenant id จากผู้เรียกจนรั่วข้ามเทศบาล)
-- ⚠️ แต่ "ขอบเขต อปท." ต้องตรวจในฟังก์ชันเอง: นโยบาย "dce public read active" (20260729183852) ให้ authenticated
--    ทุกคนอ่านแถว active ของทุก อปท. ได้ (ตั้งใจไว้ให้แผนที่สาธารณะ) ถ้าพึ่ง RLS อย่างเดียว เจ้าหน้าที่ อปท. อื่น
--    จะเห็นรายการชุดของเราได้ (เทสต์ test:datacenter-gis:db จับได้ตอนเขียนไฟล์นี้) — ไม่ใช่ superadmin = เฉพาะ อปท. ตัวเอง
-- ใครยกเลิกได้ = ใครที่นโยบาย DELETE เดิมให้ลบได้ (20260802071000 "dce admin delete own municipality"):
--   superadmin · admin ของ อปท. ตัวเอง · officer (หัวหน้ากอง) เฉพาะรายการของกองตัวเอง
--   staff/technician ลบไม่ได้ตามเดิม ต้องให้หัวหน้ากอง/ผู้ดูแลระบบยกเลิกให้ (เจ้าของระบบเลือก 2026-11-16 ไม่แก้ RLS)
-- ยกเลิกแบบ "ทั้งชุดหรือไม่ลบเลย": นับแถวของชุดที่ผู้เรียก "เห็น" ก่อน แล้วลบ ถ้าลบได้ไม่ครบ (สิทธิ์ลบไม่ถึงบางแถว
--   เช่น officer กับชุดที่แอดมินนำเข้าโดยไม่มีกอง) → RAISE ย้อนทั้งหมด ไม่ทิ้งชุดครึ่งๆ กลางๆ ไว้บนแผนที่
-- ลบจริง (ไม่ใช่ archived) ตรงกับปุ่มลบรายการเดิม — รูปที่อัปโหลดไป Drive ค้างอยู่เหมือนปุ่มลบเดิม
-- รายการชุดคืน created_by (uuid) ไม่ join profiles: profiles มี column-level GRANT บางคอลัมน์
--   (20260909140000, 20261109100000) INVOKER อ่าน full_name ไม่ได้เมื่อไรฟังก์ชันพังทั้งตัว หน้าเว็บหาชื่อเอง

-- ห่อทั้งไฟล์เป็นธุรกรรมเดียว: ด่านด้านล่าง RAISE เมื่อไรไม่มีอะไรถูกเขียน และถ้าพังหลัง DROP จะย้อนกลับครบ
-- (SQL Editor รันเป็นธุรกรรมเดียวอยู่แล้ว แต่ psql -f ที่ไม่มี ON_ERROR_STOP จะรันต่อหลัง RAISE — BEGIN/COMMIT กันกรณีนั้น)
BEGIN;

DO $$
DECLARE
  v_md5 text;
  v_rec record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'data_center_entries' AND column_name = 'shape'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'data_center_entries' AND column_name = 'import_batch_id'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261130100000_data_center_shape_batch_columns.sql ก่อน (ยังไม่มีคอลัมน์ shape/import_batch_id)';
  END IF;

  IF to_regprocedure('public.data_center_unified_pins(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ public.data_center_unified_pins(uuid) บนฐานนี้';
  END IF;

  SELECT md5(regexp_replace(regexp_replace(p.prosrc, chr(45) || chr(45) || '[^\n]*', '', 'g'), '[ \t\r\n]+', '', 'g'))
    INTO v_md5
    FROM pg_proc p
   WHERE p.oid = 'public.data_center_unified_pins(uuid)'::regprocedure;

  IF v_md5 NOT IN ('847cb27ae05bb560fdd5a3aa5ec117bd', '1bbb0fcaf617f95a355187fe42fc4751') THEN
    RAISE EXCEPTION 'นิยาม data_center_unified_pins บนฐานไม่ตรงกับ 20260908140000 (md5 %) หยุดทั้งก้อน ห้ามเขียนทับ ให้เทียบ pg_get_functiondef กับไฟล์ในรีโปก่อน', v_md5;
  END IF;

  -- ฟังก์ชันชื่อซ้ำที่อาจมีอยู่แล้วบนฐาน: ร่างรอบแรกของงานนี้ (ก่อนมีด่านตรวจ อปท.) เคยถูกรันบนฐานจริงไปก่อน
  --   data_center_import_batches()            ร่างเดิมไม่มีพารามิเตอร์ ไม่ตรวจ อปท. → authenticated ทุกคนเห็นชุดข้าม อปท. ได้
  --   data_center_cancel_import_batch(uuid)   ร่างเดิมใช้ชื่อพารามิเตอร์ p_batch_id (CREATE OR REPLACE เปลี่ยนชื่อพารามิเตอร์ไม่ได้ 42P13)
  -- ไฟล์นี้ DROP แล้วสร้างใหม่ "เฉพาะ" เมื่อ body บนฐานเป็นร่างเดิมที่รู้จัก หรือเป็นรุ่นของไฟล์นี้เอง (รันซ้ำได้)
  -- ถ้าเป็นอย่างอื่น = มีคนแก้/สร้างเองบนฐาน → RAISE หยุดทั้งก้อน ห้ามลบทิ้งโดยไม่รู้ที่มา
  FOR v_rec IN
    SELECT t.sig, t.draft_md5, t.final_md5,
           (SELECT md5(regexp_replace(regexp_replace(p.prosrc, chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g'),
                                      '[ ' || chr(9) || chr(13) || chr(10) || ']+', '', 'g'))
              FROM pg_proc p WHERE p.oid = to_regprocedure(t.sig)::oid) AS cur_md5
      FROM (VALUES
        ('public.data_center_import_batches()',          'd27b2a22caa4d0d0a7b50a3dcc4de5d7', NULL::text),
        ('public.data_center_cancel_import_batch(uuid)', '09fa3a1e19491aefe69b511f4a1cebd1',  'a326ea9880abfb238126095553b47131'),
        ('public.data_center_import_batches(uuid)',      NULL::text,          '364d4ae4c7740100c7235936e82b81f4')
      ) AS t(sig, draft_md5, final_md5)
  LOOP
    IF v_rec.cur_md5 IS NOT NULL
       AND v_rec.cur_md5 IS DISTINCT FROM v_rec.draft_md5
       AND v_rec.cur_md5 IS DISTINCT FROM v_rec.final_md5 THEN
      RAISE EXCEPTION 'ฟังก์ชัน % บนฐานมีเนื้อหาที่ไม่รู้จัก (md5 %) หยุดทั้งก้อน ห้ามลบทิ้ง ให้เทียบ pg_get_functiondef กับที่มาก่อน', v_rec.sig, v_rec.cur_md5;
    END IF;
  END LOOP;
END;
$$;

-- ═══ 1) data_center_unified_pins + shape ══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.data_center_unified_pins(uuid);

CREATE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz,
  description text, route_points jsonb, route_color text, extra_data jsonb, photo_urls text[],
  shape text
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
           d.description, d.route_points, d.route_color, null::jsonb, d.photo_urls,
           coalesce(d.shape, case
             when jsonb_typeof(d.route_points) is distinct from 'array' then 'point'
             when jsonb_array_length(d.route_points) >= 2 then 'line'
             else 'point' end)
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
         null::text[],
         null::text
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
         b.description, null::jsonb, null::text, null::jsonb, null::text[], null::text
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at,
         i.description, null::jsonb, null::text, null::jsonb, null::text[], null::text
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at,
         p.description, null::jsonb, null::text, null::jsonb, null::text[], null::text
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at,
         d.description, d.route_points, d.route_color, null::jsonb, d.photo_urls,
         coalesce(d.shape, case
           when jsonb_typeof(d.route_points) is distinct from 'array' then 'point'
           when jsonb_array_length(d.route_points) >= 2 then 'line'
           else 'point' end)
    from public.data_center_entries d
    where d.status = 'active' and (v_muni is null or d.municipality_id = v_muni);
end;
$$;

-- DROP ลบ grant เดิมไปด้วย ต้องให้ใหม่ทุกครั้ง ไม่งั้นแผนที่ทั้งระบบขึ้น 42501
REVOKE ALL ON FUNCTION public.data_center_unified_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.data_center_unified_pins(uuid) IS
  'หมุดศูนย์ข้อมูลตามสิทธิ์และสังกัดเดิม: viewer/council ได้พิกัดกลางกริดประมาณ 100 เมตรเฉพาะหมวดเฉพาะกิจ โดยสูตรตรงกับรายงานกลิ่น; พิกัดเฉพาะกิจที่ว่างหรือนอกกรอบประเทศไทยเป็น null สำหรับ analyst; ไม่คืน subject/detail ให้ analyst; photo_urls คืนเฉพาะ data_center_entries; แอดมินและผู้รับผิดชอบยังได้พิกัดต้นฉบับ; shape (point/line/polygon) มีค่าเฉพาะ data_center_entries โดย NULL ในตารางอนุมานจาก route_points';

-- ═══ 2) data_center_import_batches ════════════════════════════════════════════════════════════
-- _municipality_id ไม่มี DEFAULT (บังคับระบุ) · RLS ตัดขอบเขตจริง: staff-tier อ่านได้เฉพาะ อปท. ตัวเอง
-- viewer/council ไม่ได้รับ เพราะไม่มีงานนำเข้า/ยกเลิก · ประชาชนไม่ได้รับ (ถึง RLS จะให้อ่านแถว active ได้ก็ตาม)

-- ร่างเดิม (ไม่มีพารามิเตอร์) ต้องถอนด้วย ไม่งั้นค้างเป็น overload ที่รั่วข้าม อปท. ทั้งที่ตัวใหม่ปิดแล้ว
DROP FUNCTION IF EXISTS public.data_center_import_batches();
DROP FUNCTION IF EXISTS public.data_center_import_batches(uuid);

CREATE FUNCTION public.data_center_import_batches(_municipality_id uuid)
RETURNS TABLE (
  batch_id uuid, item_count int, point_count int, line_count int, polygon_count int,
  sample_names text[], created_by uuid, imported_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
declare
  v_role text := public.get_my_role();
begin
  if v_role is null or v_role not in ('superadmin','admin','officer','staff','technician') then
    raise exception 'ไม่มีสิทธิ์ดูชุดการนำเข้า' using errcode = '42501';
  end if;
  if _municipality_id is null then
    raise exception 'ต้องระบุ municipality_id';
  end if;
  if v_role <> 'superadmin' and _municipality_id is distinct from public.get_my_municipality_id() then
    raise exception 'ดูได้เฉพาะชุดการนำเข้าของหน่วยงานตัวเอง' using errcode = '42501';
  end if;

  return query
  select d.import_batch_id,
         count(*)::int,
         count(*) filter (where d.shape = 'point')::int,
         count(*) filter (where d.shape = 'line')::int,
         count(*) filter (where d.shape = 'polygon')::int,
         (array_agg(d.name order by d.created_at, d.id))[1:3],
         (array_agg(d.created_by order by d.created_at, d.id))[1],
         min(d.created_at)
    from public.data_center_entries d
   where d.municipality_id = _municipality_id
     and d.import_batch_id is not null
   group by d.import_batch_id
   order by min(d.created_at) desc
   limit 50;
end;
$$;

REVOKE ALL ON FUNCTION public.data_center_import_batches(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.data_center_import_batches(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.data_center_import_batches(uuid) TO authenticated;

COMMENT ON FUNCTION public.data_center_import_batches(uuid) IS
  'ชุดการนำเข้าไฟล์ 50 ชุดล่าสุดของ อปท. (จำนวน/แยกชนิดรูปทรง/ชื่อตัวอย่าง 3 รายการ/ผู้นำเข้า/เวลา) SECURITY INVOKER ขอบเขตตาม RLS ของ data_center_entries';

-- ═══ 3) data_center_cancel_import_batch ═══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.data_center_cancel_import_batch(uuid);

CREATE FUNCTION public.data_center_cancel_import_batch(_batch_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
declare
  v_role text := public.get_my_role();
  v_muni uuid;
  v_total int;
  v_deleted int;
begin
  -- ด่านนี้แค่ให้ข้อความที่อ่านรู้เรื่อง สิทธิ์จริงคือนโยบาย DELETE ของตาราง (ลบไม่ครบ = ย้อนทั้งหมดด้านล่าง)
  if v_role is null or v_role not in ('superadmin','admin','officer') then
    raise exception 'ยกเลิกการนำเข้าทั้งชุดได้เฉพาะผู้ดูแลระบบ หรือหัวหน้ากองของกองเจ้าของข้อมูล' using errcode = '42501';
  end if;
  if _batch_id is null then
    raise exception 'ต้องระบุเลขชุดการนำเข้า';
  end if;

  -- ขอบเขต อปท. (ดูหมายเหตุ "dce public read active" ด้านบน) — superadmin = ทุก อปท.
  v_muni := case when v_role = 'superadmin' then null else public.get_my_municipality_id() end;
  if v_role <> 'superadmin' and v_muni is null then
    raise exception 'ไม่พบสังกัดเทศบาลของผู้ใช้รายนี้';
  end if;

  select count(*) into v_total
    from public.data_center_entries
   where import_batch_id = _batch_id
     and (v_muni is null or municipality_id = v_muni);

  if v_total = 0 then
    raise exception 'ไม่พบชุดการนำเข้านี้ (อาจถูกยกเลิกไปแล้ว)' using errcode = 'P0002';
  end if;

  delete from public.data_center_entries
   where import_batch_id = _batch_id
     and (v_muni is null or municipality_id = v_muni);
  get diagnostics v_deleted = row_count;

  if v_deleted > v_total then
    -- มีแถวเข้ามาในชุดระหว่างนับกับลบ = ชุดนี้ยังนำเข้าไม่เสร็จ (insert ไหลเป็นก้อนละ 50 แถว) ย้อนทั้งหมด ลองใหม่ทีหลัง
    raise exception 'ชุดนี้ยังนำเข้าไม่เสร็จ (มีรายการเพิ่มเข้ามาระหว่างยกเลิก) ยังไม่ลบอะไร กรุณารอให้นำเข้าเสร็จแล้วลองใหม่'
      using errcode = '55000';
  elsif v_deleted < v_total then
    raise exception 'สิทธิ์ลบได้ % จาก % รายการของชุดนี้ ยกเลิกทั้งหมดแล้ว ไม่ลบบางส่วน ให้ผู้ดูแลระบบเป็นผู้ยกเลิก', v_deleted, v_total
      using errcode = '42501';
  end if;

  return v_deleted;
end;
$$;

REVOKE ALL ON FUNCTION public.data_center_cancel_import_batch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.data_center_cancel_import_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.data_center_cancel_import_batch(uuid) TO authenticated;

COMMENT ON FUNCTION public.data_center_cancel_import_batch(uuid) IS
  'ยกเลิกการนำเข้าไฟล์ทั้งชุด = ลบจริงทุกแถวที่ import_batch_id ตรงกัน แบบทั้งชุดหรือไม่ลบเลย SECURITY INVOKER สิทธิ์ตามนโยบาย DELETE เดิม (superadmin/admin/officer ของกองเจ้าของ) คืนจำนวนที่ลบ';

NOTIFY pgrst, 'reload schema';

COMMIT;
