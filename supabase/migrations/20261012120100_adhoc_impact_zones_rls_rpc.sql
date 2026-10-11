-- วงรัศมีเรื่องเฉพาะกิจ (เฟส 1) ภาค 2: ดัชนี + RLS + สิทธิ์ + ฟังก์ชันตรวจสิทธิ์ + audit + ตัวนับคำร้องในแต่ละวง
-- ตารางสร้างไว้ใน 20261012120000 (แยกไฟล์ตามเฟส ดู docs/ai/NOTES.md ข้อ 3)
--
-- ใครทำอะไรได้ (เจ้าของระบบตัดสิน 2569-10-12):
--   ดู   : superadmin · admin · ผู้บริหาร (viewer/council) ของ อปท. เดียวกัน · "ผู้รับผิดชอบ"
--   แก้  : superadmin · admin · "ผู้รับผิดชอบ"   (ผู้บริหารดูได้อย่างเดียว)
--   ประชาชน/ไม่ล็อกอิน : ไม่เห็นอะไรเลย (ไม่มีสิทธิ์ที่ตาราง ไม่ใช่แค่ซ่อนปุ่ม)
--   เจ้าหน้าที่ทั่วไปที่ไม่ใช่ผู้รับผิดชอบ : ไม่เห็น — ตรงกับหมุดเฉพาะกิจที่เขาก็ไม่เห็นอยู่แล้ว
--
-- "ผู้รับผิดชอบ" = เจ้าหน้าที่ที่ถูกมอบ (complaints.assigned_to) คำร้องหมวดเฉพาะกิจอย่างน้อย 1 เรื่องใน อปท. นั้น
-- ระบบไม่มีการตั้งผู้รับผิดชอบรายหมวด ใช้ผู้ที่ trigger รับเรื่องอัตโนมัติมอบให้จริง
-- (ต้นเหตุเดียวกับที่ data_center_unified_pins ให้เห็นหมุดเฉพาะกิจเฉพาะ assigned_to = ตัวเอง)

CREATE INDEX IF NOT EXISTS adhoc_impact_zones_muni_idx
  ON public.adhoc_impact_zones (municipality_id, is_active, created_at DESC);

-- ── ฟังก์ชันตรวจสิทธิ์ ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adhoc_overlay_is_responsible(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.complaints c
     WHERE c.assigned_to = auth.uid()
       AND c.municipality_id = p_municipality_id
       AND public.complaint_category_is_adhoc(c.municipality_id, c.category)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_adhoc_overlay(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.get_my_role() = 'superadmin' THEN true
    WHEN public.get_my_municipality_id() IS DISTINCT FROM p_municipality_id THEN false
    WHEN public.get_my_role() IN ('admin', 'viewer', 'council') THEN true
    WHEN public.get_my_role() IN ('officer', 'staff', 'technician')
      THEN public.adhoc_overlay_is_responsible(p_municipality_id)
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.can_manage_adhoc_overlay(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.get_my_role() = 'superadmin' THEN true
    WHEN public.get_my_municipality_id() IS DISTINCT FROM p_municipality_id THEN false
    WHEN public.get_my_role() = 'admin' THEN true
    WHEN public.get_my_role() IN ('officer', 'staff', 'technician')
      THEN public.adhoc_overlay_is_responsible(p_municipality_id)
    ELSE false
  END
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.adhoc_impact_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "adhoc zones view" ON public.adhoc_impact_zones;
DROP POLICY IF EXISTS "adhoc zones insert" ON public.adhoc_impact_zones;
DROP POLICY IF EXISTS "adhoc zones update" ON public.adhoc_impact_zones;
DROP POLICY IF EXISTS "adhoc zones delete" ON public.adhoc_impact_zones;

CREATE POLICY "adhoc zones view" ON public.adhoc_impact_zones
  FOR SELECT TO authenticated
  USING (public.can_view_adhoc_overlay(municipality_id));

CREATE POLICY "adhoc zones insert" ON public.adhoc_impact_zones
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_adhoc_overlay(municipality_id)
    AND public.complaint_category_is_adhoc(municipality_id, category)
  );

CREATE POLICY "adhoc zones update" ON public.adhoc_impact_zones
  FOR UPDATE TO authenticated
  USING (public.can_manage_adhoc_overlay(municipality_id))
  WITH CHECK (
    public.can_manage_adhoc_overlay(municipality_id)
    AND public.complaint_category_is_adhoc(municipality_id, category)
  );

CREATE POLICY "adhoc zones delete" ON public.adhoc_impact_zones
  FOR DELETE TO authenticated
  USING (public.can_manage_adhoc_overlay(municipality_id));

-- Supabase ตั้ง default privileges ให้ anon ได้สิทธิ์เต็มกับของใหม่ใน schema public — ต้องถอนเองตรงๆ
-- (RLS ไม่มี policy ให้ anon อยู่แล้ว แต่ไม่ปล่อยให้พึ่งชั้นเดียว: RLS ไม่กัน TRUNCATE ดู docs/ai/NOTES.md)
-- ⚠️ ต้อง REVOKE จาก authenticated ด้วย ไม่ใช่แค่ anon: default privileges ของ Supabase ให้ authenticated ได้ ALL (รวม TRUNCATE
-- ที่ RLS ไม่กัน — ผู้ใช้ที่ล็อกอินคนไหนก็ล้างตารางทั้งหมดได้) ตรวจพบตอน apply จริง 2569-10-12 จึง REVOKE ALL ก่อนแล้วค่อย GRANT เฉพาะที่ใช้
REVOKE ALL ON TABLE public.adhoc_impact_zones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.adhoc_impact_zones TO authenticated;

-- ── trigger: ประทับผู้บันทึก/เวลา + จัดรัศมี ────────────────────────────────────
-- created_by/created_at ห้ามให้หน้าจอกำหนดเอง · เปลี่ยน อปท. ของแถวไม่ได้ · รัศมีเรียงจากน้อยไปมากและตัดซ้ำ
-- (ฝั่งหน้าจอทำให้แล้ว แต่ DB ทำซ้ำเพราะ CHECK ตรวจแค่ช่วงค่า ไม่ตรวจลำดับ — ลำดับมีผลกับสีวงและตัวเลขที่โชว์)
CREATE OR REPLACE FUNCTION public.adhoc_impact_zones_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id THEN
      RAISE EXCEPTION 'ย้ายวงรัศมีข้ามหน่วยงานไม่ได้' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  NEW.label := btrim(NEW.label);
  IF NEW.radii_m IS NOT NULL THEN
    NEW.radii_m := ARRAY(SELECT DISTINCT r FROM unnest(NEW.radii_m) AS r ORDER BY r);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adhoc_impact_zones_stamp ON public.adhoc_impact_zones;
CREATE TRIGGER trg_adhoc_impact_zones_stamp
  BEFORE INSERT OR UPDATE ON public.adhoc_impact_zones
  FOR EACH ROW EXECUTE FUNCTION public.adhoc_impact_zones_stamp();

-- ── trigger: audit log ทุกครั้งที่เพิ่ม/แก้/ลบ ─────────────────────────────────────
-- เขียนฝั่งเซิร์ฟเวอร์ หน้าจอข้ามไม่ได้ · metadata มีแค่หมวด/รัศมี/สถานะ ไม่มีพิกัดและไม่มีข้อมูลบุคคล
CREATE OR REPLACE FUNCTION public.adhoc_impact_zones_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row   public.adhoc_impact_zones;
  v_actor record;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT p.full_name, p.role INTO v_actor FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.audit_logs
    (municipality_id, actor_id, actor_name, actor_role, action,
     resource_type, resource_id, resource_label, metadata)
  VALUES
    (v_row.municipality_id, auth.uid(), v_actor.full_name, v_actor.role,
     CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
     'adhoc_impact_zone', v_row.id::text, v_row.label,
     jsonb_build_object('category', v_row.category, 'radii_m', v_row.radii_m, 'is_active', v_row.is_active));
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_adhoc_impact_zones_audit ON public.adhoc_impact_zones;
CREATE TRIGGER trg_adhoc_impact_zones_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.adhoc_impact_zones
  FOR EACH ROW EXECUTE FUNCTION public.adhoc_impact_zones_audit();

-- ── ตัวนับ: คำร้องอยู่ในแต่ละวงกี่เรื่อง ────────────────────────────────────────
-- คืนเฉพาะ "ตัวเลข" ไม่คืนพิกัด/รหัสคำร้อง — เจ้าหน้าที่เห็นว่าวง 1 กม. มี 7 เรื่อง โดยไม่ต้องเปิดหมุดทีละใบ
-- นับ "สะสม" (ภายใน X เมตร รวมวงที่เล็กกว่า) จากพิกัดคำร้องที่ผู้แจ้งปักไว้ ไม่ต้องกรอกเพิ่ม
--
-- ⚠️ นับด้วยกติกาการมองเห็นเดียวกับ data_center_unified_pins เป๊ะ: admin/superadmin ทั้งหมด · ผู้รับผิดชอบเฉพาะเรื่องที่ถูกมอบให้
-- · ผู้บริหารทั้งหมด — ไม่งั้นเจ้าหน้าที่จะรู้จำนวนเรื่องของคนอื่นผ่านตัวเลขที่ไม่ควรเห็น
-- ⚠️ ถ้าในวงมีคำร้องเรื่องเดียว ตัวเลข "1" ก็บอกได้ว่ามีผู้ร้องอยู่ใกล้ฟาร์ม จึงจำกัดให้เฉพาะผู้ที่เห็นคำร้องนั้นอยู่แล้ว
--
-- ระยะทาง: haversine (รัศมีโลก 6,371,000 ม.) ไม่พึ่ง PostGIS · least(1, …) กัน asin รับค่าเกิน 1 จากเศษทศนิยม
CREATE OR REPLACE FUNCTION public.adhoc_zone_counts(p_zone_ids uuid[])
RETURNS TABLE (zone_id uuid, radius_m integer, complaint_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  v_role := public.get_my_role();

  RETURN QUERY
  SELECT z.id, r.radius, COUNT(c.id)::integer
    FROM public.adhoc_impact_zones z
   CROSS JOIN LATERAL unnest(z.radii_m) AS r(radius)
    LEFT JOIN public.complaints c
      ON c.municipality_id = z.municipality_id
     AND c.category = z.category
     AND c.latitude IS NOT NULL
     AND c.longitude IS NOT NULL
     AND (
          v_role IN ('admin', 'superadmin', 'viewer', 'council')
          OR c.assigned_to = v_uid
     )
     AND 2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((c.latitude::double precision) - z.latitude) / 2), 2)
         + cos(radians(z.latitude)) * cos(radians(c.latitude::double precision))
           * power(sin(radians((c.longitude::double precision) - z.longitude) / 2), 2)
         ))) <= r.radius
   WHERE z.id = ANY (p_zone_ids)
     AND public.can_view_adhoc_overlay(z.municipality_id)
   GROUP BY z.id, r.radius
   ORDER BY z.id, r.radius;
END
$$;

REVOKE ALL ON FUNCTION public.adhoc_overlay_is_responsible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_adhoc_overlay(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_adhoc_overlay(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adhoc_zone_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adhoc_overlay_is_responsible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_adhoc_overlay(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_adhoc_overlay(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adhoc_zone_counts(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.adhoc_zone_counts(uuid[]) IS
  'จำนวนคำร้องเฉพาะกิจที่อยู่ภายในแต่ละวงรัศมี (สะสม) นับด้วยกติกามองเห็นเดียวกับหมุดเฉพาะกิจ ไม่คืนพิกัด/รหัสคำร้อง';
