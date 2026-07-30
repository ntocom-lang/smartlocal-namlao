-- ============================================================
-- 151_data_center_entries.sql
-- ศูนย์รวมข้อมูลดิจิทัล (Data Center) — คลังพิกัด/สถานที่ทุกชนิดในเขตเทศบาล
-- จัดหมวดหมู่ 2 ชั้น (group_name -> category) เป็น text อิสระ ไม่ผูก constraint ตายตัว
-- เพื่อให้แต่ละเทศบาลเพิ่มหมวดใหม่เองได้โดยไม่ต้องรอ migration
--
-- หมายเหตุ: ไฟล์นี้ backfill จาก schema จริงบน Supabase ย้อนหลัง (ตาราง+RLS+RPC
-- ถูก apply ตรงผ่าน Supabase MCP ตอนพัฒนาฟีเจอร์ ไม่ได้มีไฟล์ migration ในโปรเจกต์
-- ตั้งแต่แรก) เนื้อหาฟังก์ชัน data_center_unified_pins ด้านล่างคือเวอร์ชันล่าสุดที่ใช้งาน
-- จริงบน production แล้ว (รวม fix เรื่อง anon เห็นข้ามเทศบาลที่แก้ทีหลัง) ไม่ใช่เวอร์ชันแรกที่เคย apply
-- ============================================================

CREATE TABLE IF NOT EXISTS public.data_center_entries (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  group_name      text          NOT NULL,  -- กลุ่มหลัก เช่น "สาธารณสุข", "สถานประกอบการ"
  category        text          NOT NULL,  -- ประเภทย่อย เช่น "โรงพยาบาลรัฐ", "ร้านอาหาร"
  name            text          NOT NULL,  -- ชื่อสถานที่จริง
  description     text,
  latitude        numeric       NOT NULL,
  longitude       numeric       NOT NULL,
  photo_urls      text[]        DEFAULT '{}',
  external_url    text,
  status          text          NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by      uuid          REFERENCES auth.users(id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- ผูก location geography + sync ผ่าน trigger function เดิม (มาจาก 055_enable_postgis.sql)
ALTER TABLE public.data_center_entries
  ADD COLUMN IF NOT EXISTS location geography(POINT, 4326);

CREATE TRIGGER trg_dce_sync_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.data_center_entries
  FOR EACH ROW EXECUTE FUNCTION sync_location_from_latlng();

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dce_location    ON public.data_center_entries USING gist (location);
CREATE INDEX IF NOT EXISTS idx_dce_municipality ON public.data_center_entries (municipality_id);
CREATE INDEX IF NOT EXISTS idx_dce_muni_group   ON public.data_center_entries (municipality_id, group_name);

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.data_center_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dce staff read own municipality" ON public.data_center_entries FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = ANY (ARRAY['staff','officer','admin','viewer','council'])
        AND municipality_id = get_my_municipality_id())
  );

CREATE POLICY "dce staff insert own municipality" ON public.data_center_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = ANY (ARRAY['staff','officer','admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  );

CREATE POLICY "dce staff update own municipality" ON public.data_center_entries FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = ANY (ARRAY['staff','officer','admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  )
  WITH CHECK (
    get_my_role() = ANY (ARRAY['staff','officer','admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  );

CREATE POLICY "dce admin delete own municipality" ON public.data_center_entries FOR DELETE
  TO authenticated
  USING (
    get_my_role() = ANY (ARRAY['admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  );

-- ── RPC: data_center_unified_pins ─────────────────────────────
-- รวมพิกัดจาก 4 ตารางเดิม (คำร้อง/สถานประกอบการ/โครงสร้างพื้นฐาน/โครงการก่อสร้าง) +
-- data_center_entries เอง เป็น layer เดียวบนแผนที่ — SECURITY DEFINER ตาม pattern เดิม
-- (133_lock_complaints_near_heatmap.sql) กัน RLS รั่วเวลารวมหลายตารางเข้าด้วยกัน
--
-- กติกาสิทธิ์:
--   - superadmin: เชื่อ _municipality_id ที่ส่งมา (null = ทุกเทศบาล)
--   - staff-tier ที่ login แล้ว: บังคับเป็นเทศบาลตัวเองเสมอ ไม่สนใจ param ที่ส่งมา
--     กันกรณีพยายามส่ง municipality_id ปลอมมาดูข้ามเทศบาล
--   - anon/guest (ไม่มี role): เชื่อ param ที่ส่งมา เพราะ endpoint นี้ตั้งใจให้ประชาชนดูได้
--     ต่อเทศบาล (public-by-design) — ต่างจากกรณี staff ที่ต้องล็อกด้วย role จริงเท่านั้น
CREATE OR REPLACE FUNCTION public.data_center_unified_pins(_municipality_id uuid DEFAULT NULL)
RETURNS TABLE (
  source_table text, source_id uuid, group_name text, category text, title text,
  status text, latitude double precision, longitude double precision, created_at timestamptz
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
         c.latitude::double precision, c.longitude::double precision, c.created_at
    from public.complaints c
    where c.latitude is not null and (v_muni is null or c.municipality_id = v_muni)
  union all
  select 'business_registrations', b.id, 'สถานประกอบการ', b.business_type, b.business_name, b.status,
         b.latitude::double precision, b.longitude::double precision, b.created_at
    from public.business_registrations b
    where v_muni is null or b.municipality_id = v_muni
  union all
  select 'infrastructure_works', i.id, 'โครงสร้างพื้นฐาน', i.category, i.title, i.status,
         i.latitude::double precision, i.longitude::double precision, i.created_at
    from public.infrastructure_works i
    where v_muni is null or i.municipality_id = v_muni
  union all
  select 'civil_projects', p.id, 'โครงการก่อสร้าง', p.project_type, p.title, p.status,
         p.latitude::double precision, p.longitude::double precision, p.created_at
    from public.civil_projects p
    where p.latitude is not null and (v_muni is null or p.municipality_id = v_muni)
  union all
  select 'data_center_entries', d.id, d.group_name, d.category, d.name, d.status,
         d.latitude::double precision, d.longitude::double precision, d.created_at
    from public.data_center_entries d
    where v_muni is null or d.municipality_id = v_muni;
end;
$$;

GRANT EXECUTE ON FUNCTION public.data_center_unified_pins(uuid) TO anon, authenticated;
