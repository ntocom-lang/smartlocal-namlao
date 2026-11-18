-- ตลาดชาวบ้าน (ขั้น 1A) ไฟล์ 2/2 — RLS · GRANT · trigger · RPC · ผูกเจ้าของร้านย้อนหลัง · เปิดโมดูลให้ demo
--
-- ใครทำอะไรได้
--   ทุกคน (anon ด้วย)  อ่านสินค้าที่ไม่ถูกซ่อน ของร้านที่ is_active และ อปท. เปิดโมดูล local-market
--   เจ้าของร้าน        เพิ่ม/แก้/ลบสินค้าของร้านตัวเอง (ขึ้นทันที · เพดาน 30 รายการ) · เห็นสินค้าที่ถูกซ่อน + เหตุผล
--   เจ้าหน้าที่         superadmin · admin อปท. เดียวกัน · officer/staff ของกองที่ถือร้าน (tourism_places.department_id)
--                      ⇒ ซ่อน/เลิกซ่อน (RPC บังคับเหตุผล) · ลบ · ผูก/ถอดเจ้าของร้านจากคำขอลงทะเบียน · อ่านสมุดบันทึก
--   ประชาชน            บันทึก/ลบร้านโปรดของตัวเอง (เพดาน 200) · ไม่มีใครอื่นเห็นรายการโปรด (เจ้าหน้าที่ก็ไม่เห็น · PDPA)
-- ตัดสินโดยระบบ: ไม่มี — ระบบไม่ซ่อน/อนุมัติสินค้าเอง แค่บังคับเพดานและรูปแบบข้อมูล (การซ่อนเป็นการกระทำของคน มีบันทึก)
--
-- ⚠️ รันซ้ำได้ (CREATE OR REPLACE / DROP POLICY IF EXISTS) · การผูกย้อนหลังข้ามร้านที่เคยมีประวัติผูก/ถอดในสมุดแล้ว
--    (ไม่ผูกเจ้าของที่เจ้าหน้าที่ถอดไปกลับคืนมา)
--
-- ย้อนกลับ (หลัง DROP ตารางของไฟล์ 1):
--   DROP FUNCTION public.market_module_enabled(uuid), public.market_place_public(uuid), public.market_can_manage_place(uuid),
--     public.market_my_managed_place_ids(), public.market_my_place_ids(), public.market_products_guard(),
--     public.market_products_log_delete(), public.tourism_favorites_guard(), public.market_set_product_hidden(uuid, boolean, text),
--     public.market_link_owner_from_registration(uuid, uuid, boolean), public.market_unlink_owner(uuid);
--   UPDATE public.municipalities SET enabled_modules = array_remove(enabled_modules, 'local-market') WHERE slug = 'demo';
BEGIN;
SET LOCAL lock_timeout = '5s'; -- UPDATE แถว demo ใน municipalities + FK key-share lock ตอนผูกย้อนหลัง — มี session ค้างให้ล้มเร็ว

DO $guard$
BEGIN
  IF to_regclass('public.market_products') IS NULL OR to_regclass('public.market_shop_owners') IS NULL
     OR to_regclass('public.tourism_favorites') IS NULL OR to_regclass('public.market_product_moderation_log') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261214100000_local_market_tables.sql ก่อน';
  END IF;
END $guard$;

-- ── ตัวช่วย ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.market_module_enabled(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  -- ต้องมีคีย์ 'local-market' ชัดเจนเท่านั้น — ต่างจากโมดูลอื่นโดยตั้งใจ: enabled_modules = NULL (แถวเก่าที่ TenantContext
  -- ถือว่าเปิดทุกโมดูล) ไม่นับว่าเปิดตลาด เพราะตลาดเปิดให้ประชาชนลงเนื้อหาบนเว็บราชการ ค่าเริ่มต้นต้องปิดจริง
  SELECT COALESCE((SELECT 'local-market' = ANY (m.enabled_modules)
                   FROM public.municipalities m WHERE m.id = p_municipality_id), false);
$$;
-- คืนแค่ "เปิด/ปิดโมดูล" ซึ่งหน้าเว็บอ่านจาก municipalities อยู่แล้ว ⇒ ให้ anon เรียกได้ (ใช้ใน policy อ่านสาธารณะ)
REVOKE ALL ON FUNCTION public.market_module_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_module_enabled(uuid) TO anon, authenticated;

-- ร้านนี้แสดงสาธารณะได้ไหม (ร้านเปิดอยู่ + อปท. เปิดโมดูล) — definer เพื่อไม่พึ่ง policy ของ tourism_places
CREATE OR REPLACE FUNCTION public.market_place_public(p_place_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tourism_places p
    WHERE p.id = p_place_id AND p.is_active IS TRUE AND public.market_module_enabled(p.municipality_id)
  );
$$;
REVOKE ALL ON FUNCTION public.market_place_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_place_public(uuid) TO anon, authenticated;

-- ชุดร้านที่ผู้เรียกดูแลได้ — ใช้ใน RLS แบบ (SELECT …) ให้ประเมินครั้งเดียวต่อคำสั่ง (InitPlan)
-- อ่าน role/อปท./กองครั้งเดียว · ไม่ใช่เจ้าหน้าที่ = คืนชุดว่างทันที (ประชาชนทุกคำสั่งไม่ต้องสแกนร้านทุก อปท.)
CREATE OR REPLACE FUNCTION public.market_my_managed_place_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text; v_muni uuid; v_dept uuid; v_ids uuid[];
BEGIN
  SELECT pr.role, pr.municipality_id, pr.department_id INTO v_role, v_muni, v_dept
  FROM public.profiles pr WHERE pr.id = auth.uid();
  IF v_role = 'superadmin' THEN
    SELECT array_agg(p.id) INTO v_ids FROM public.tourism_places p;
  ELSIF v_role = 'admin' AND v_muni IS NOT NULL THEN
    SELECT array_agg(p.id) INTO v_ids FROM public.tourism_places p WHERE p.municipality_id = v_muni;
  ELSIF v_role = 'officer' AND v_muni IS NOT NULL AND v_dept IS NOT NULL THEN
    SELECT array_agg(p.id) INTO v_ids FROM public.tourism_places p
    WHERE p.municipality_id = v_muni AND p.department_id = v_dept;
  ELSIF v_role = 'staff' AND v_muni IS NOT NULL AND v_dept IS NOT NULL THEN
    SELECT array_agg(p.id) INTO v_ids FROM public.tourism_places p
    WHERE p.municipality_id = v_muni AND p.department_id = v_dept AND p.created_by = auth.uid();
  END IF;
  RETURN COALESCE(v_ids, '{}'::uuid[]);
END;
$$;
-- ผู้เรียกดูแลร้านนี้ได้ไหม (ฝั่งเจ้าหน้าที่) — ขอบเขตเท่า policy "department manage tourism_places" เดิม
-- (20260802071000): officer = ทั้งกอง · staff = เฉพาะร้านที่ตัวเองสร้าง (ไม่กว้างกว่าสิทธิ์แก้ร้านที่มีอยู่)
CREATE OR REPLACE FUNCTION public.market_can_manage_place(p_place_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_place_id IS NOT NULL AND p_place_id = ANY (public.market_my_managed_place_ids());
$$;

REVOKE ALL ON FUNCTION public.market_my_managed_place_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_my_managed_place_ids() TO authenticated;
REVOKE ALL ON FUNCTION public.market_can_manage_place(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_can_manage_place(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.market_my_place_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(array_agg(o.place_id), '{}'::uuid[])
  FROM public.market_shop_owners o
  WHERE o.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.market_my_place_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_my_place_ids() TO authenticated;

-- ── trigger สินค้า: ค่าที่ระบบตั้งเอง + เพดาน ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.market_products_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_muni uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.municipality_id INTO v_muni FROM public.tourism_places p WHERE p.id = NEW.place_id;
    IF v_muni IS NULL THEN
      RAISE EXCEPTION 'ไม่พบร้านนี้' USING ERRCODE = 'P0001';
    END IF;
    -- เพดานต่อร้าน: ล็อกตามร้านก่อนนับ ⇒ เพิ่มพร้อมกันหลายแท็บไม่หลุดเกิน
    PERFORM pg_advisory_xact_lock(hashtextextended('market_products:' || NEW.place_id::text, 0));
    IF (SELECT count(*) FROM public.market_products WHERE place_id = NEW.place_id) >= 30 THEN
      RAISE EXCEPTION 'ร้านนี้มีสินค้าครบ 30 รายการแล้ว ลบรายการเก่าก่อนเพิ่มใหม่' USING ERRCODE = 'P0001';
    END IF;
    NEW.municipality_id := v_muni;
    NEW.is_hidden := false;
    NEW.hidden_reason := NULL;
    NEW.created_at := now();
  ELSE
    NEW.place_id := OLD.place_id;
    NEW.municipality_id := OLD.municipality_id;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.market_products_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS market_products_guard_trigger ON public.market_products;
CREATE TRIGGER market_products_guard_trigger BEFORE INSERT OR UPDATE ON public.market_products
  FOR EACH ROW EXECUTE FUNCTION public.market_products_guard();

-- ลบโดยคนที่ไม่ใช่เจ้าของร้าน (เจ้าหน้าที่) = 'delete' · เจ้าของลบสินค้าที่ถูกซ่อนอยู่ = 'owner_delete_hidden'
-- (กันลบ-เพิ่มใหม่หลบการซ่อนโดยไม่มีร่องรอย) · เจ้าของลบสินค้าปกติ / ลบตาม อปท. ที่กำลังถูกลบ ไม่ลง
CREATE OR REPLACE FUNCTION public.market_products_log_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.municipalities m WHERE m.id = OLD.municipality_id) THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.market_shop_owners o WHERE o.place_id = OLD.place_id AND o.user_id = auth.uid()) THEN
    INSERT INTO public.market_product_moderation_log (municipality_id, place_id, product_id, product_name, action, reason, actor_id)
    VALUES (OLD.municipality_id, OLD.place_id, OLD.id, OLD.name, 'delete', NULL, auth.uid());
  ELSIF OLD.is_hidden THEN
    INSERT INTO public.market_product_moderation_log (municipality_id, place_id, product_id, product_name, action, reason, actor_id)
    VALUES (OLD.municipality_id, OLD.place_id, OLD.id, OLD.name, 'owner_delete_hidden', OLD.hidden_reason, auth.uid());
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.market_products_log_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS market_products_log_delete_trigger ON public.market_products;
CREATE TRIGGER market_products_log_delete_trigger AFTER DELETE ON public.market_products
  FOR EACH ROW EXECUTE FUNCTION public.market_products_log_delete();

-- ── trigger รายการโปรด: ผู้บันทึก + อปท. ของร้าน + เพดาน ───────────────────────────────
CREATE OR REPLACE FUNCTION public.tourism_favorites_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_muni uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  SELECT p.municipality_id INTO v_muni FROM public.tourism_places p WHERE p.id = NEW.place_id AND p.is_active IS TRUE;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'ไม่พบสถานที่นี้' USING ERRCODE = 'P0001';
  END IF;
  NEW.user_id := auth.uid();
  NEW.municipality_id := v_muni;
  NEW.created_at := now();
  PERFORM pg_advisory_xact_lock(hashtextextended('tourism_favorites:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM public.tourism_favorites WHERE user_id = NEW.user_id) >= 200 THEN
    RAISE EXCEPTION 'บันทึกรายการโปรดได้สูงสุด 200 แห่ง' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tourism_favorites_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tourism_favorites_guard_trigger ON public.tourism_favorites;
CREATE TRIGGER tourism_favorites_guard_trigger BEFORE INSERT ON public.tourism_favorites
  FOR EACH ROW EXECUTE FUNCTION public.tourism_favorites_guard();

-- ── สิทธิ์ตาราง ────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.market_shop_owners, public.market_products, public.market_product_moderation_log, public.tourism_favorites
  FROM PUBLIC, anon, authenticated;
-- anon อ่านเฉพาะคอลัมน์ที่หน้าร้านใช้ (ไม่มี hidden_reason / attest_lawful)
GRANT SELECT (id, municipality_id, place_id, name, description, price, unit, image_url, is_available, display_order, is_hidden, updated_at)
  ON public.market_products TO anon;
GRANT SELECT, DELETE ON public.market_products TO authenticated;
GRANT INSERT (place_id, name, description, price, unit, image_url, is_available, display_order, attest_lawful)
  ON public.market_products TO authenticated;
GRANT UPDATE (name, description, price, unit, image_url, is_available, display_order, attest_lawful)
  ON public.market_products TO authenticated;
GRANT SELECT ON public.market_shop_owners TO authenticated;          -- เขียนผ่าน RPC เท่านั้น
GRANT SELECT ON public.market_product_moderation_log TO authenticated; -- ระบบเขียนเอง
GRANT SELECT, DELETE ON public.tourism_favorites TO authenticated;
GRANT INSERT (place_id) ON public.tourism_favorites TO authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────────────
-- ANY ((SELECT f())::uuid[]) : ต้อง cast ไม่งั้น = ANY (subquery) เทียบ uuid กับ uuid[] (42883) · ยังเป็น InitPlan ประเมินครั้งเดียว
DROP POLICY IF EXISTS "market products public read" ON public.market_products;
CREATE POLICY "market products public read" ON public.market_products
  FOR SELECT TO anon, authenticated
  USING (NOT is_hidden AND public.market_place_public(place_id));

DROP POLICY IF EXISTS "market products owner or staff read" ON public.market_products;
CREATE POLICY "market products owner or staff read" ON public.market_products
  FOR SELECT TO authenticated
  USING (place_id = ANY ((SELECT public.market_my_place_ids())::uuid[])
         OR place_id = ANY ((SELECT public.market_my_managed_place_ids())::uuid[]));

DROP POLICY IF EXISTS "market products owner insert" ON public.market_products;
CREATE POLICY "market products owner insert" ON public.market_products
  FOR INSERT TO authenticated
  WITH CHECK (place_id = ANY ((SELECT public.market_my_place_ids())::uuid[]) AND public.market_place_public(place_id));

DROP POLICY IF EXISTS "market products owner update" ON public.market_products;
CREATE POLICY "market products owner update" ON public.market_products
  FOR UPDATE TO authenticated
  USING (place_id = ANY ((SELECT public.market_my_place_ids())::uuid[]))
  WITH CHECK (place_id = ANY ((SELECT public.market_my_place_ids())::uuid[]) AND public.market_place_public(place_id));

DROP POLICY IF EXISTS "market products owner or staff delete" ON public.market_products;
CREATE POLICY "market products owner or staff delete" ON public.market_products
  FOR DELETE TO authenticated
  USING (place_id = ANY ((SELECT public.market_my_place_ids())::uuid[])
         OR place_id = ANY ((SELECT public.market_my_managed_place_ids())::uuid[]));

DROP POLICY IF EXISTS "market shop owners read" ON public.market_shop_owners;
CREATE POLICY "market shop owners read" ON public.market_shop_owners
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR place_id = ANY ((SELECT public.market_my_managed_place_ids())::uuid[]));

-- สมุดบันทึก: เจ้าหน้าที่ที่ดูแลร้าน + แอดมิน อปท. (ร้านที่ลบไปแล้วไม่อยู่ในชุดดูแล แอดมินยังเห็น)
DROP POLICY IF EXISTS "market moderation log staff read" ON public.market_product_moderation_log;
CREATE POLICY "market moderation log staff read" ON public.market_product_moderation_log
  FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin'
         OR ((SELECT public.get_my_role()) = 'admin' AND municipality_id = (SELECT public.get_my_municipality_id()))
         OR place_id = ANY ((SELECT public.market_my_managed_place_ids())::uuid[]));

DROP POLICY IF EXISTS "tourism favorites own" ON public.tourism_favorites;
CREATE POLICY "tourism favorites own" ON public.tourism_favorites
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── RPC: เจ้าหน้าที่ซ่อน/เลิกซ่อนสินค้า (บังคับเหตุผลตอนซ่อน · ลงสมุดบันทึกทุกครั้ง) ─────────────
CREATE OR REPLACE FUNCTION public.market_set_product_hidden(p_product_id uuid, p_hidden boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.market_products%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_product_id IS NULL OR p_hidden IS NULL THEN
    RAISE EXCEPTION 'ข้อมูลไม่ครบ' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.market_products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT public.market_can_manage_place(r.place_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จัดการสินค้านี้' USING ERRCODE = '42501';
  END IF;
  IF p_hidden AND v_reason IS NULL THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผลที่ซ่อน (เจ้าของร้านจะเห็นเหตุผลนี้)' USING ERRCODE = 'P0001';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 300 THEN
    RAISE EXCEPTION 'เหตุผลยาวเกิน 300 ตัวอักษร' USING ERRCODE = 'P0001';
  END IF;
  IF r.is_hidden = p_hidden THEN
    RETURN; -- กดซ้ำไม่ลงบันทึกซ้ำ
  END IF;

  UPDATE public.market_products
     SET is_hidden = p_hidden,
         hidden_reason = CASE WHEN p_hidden THEN v_reason ELSE NULL END
   WHERE id = r.id;

  INSERT INTO public.market_product_moderation_log (municipality_id, place_id, product_id, product_name, action, reason, actor_id)
  VALUES (r.municipality_id, r.place_id, r.id, r.name, CASE WHEN p_hidden THEN 'hide' ELSE 'unhide' END, v_reason, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.market_set_product_hidden(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_set_product_hidden(uuid, boolean, text) TO authenticated;

-- ── RPC: ผูก/ถอดเจ้าของร้านจากคำขอลงทะเบียนที่อนุมัติแล้ว ─────────────────────────────────
-- ไม่ขึ้นกับการเปิดโมดูล: ขั้นอนุมัติผูกให้ทุกครั้ง วันไหน อปท. เปิดตลาด เจ้าของร้านจัดการได้ทันที
-- "อนุมัติแล้ว" ต้องมีผู้อนุมัติที่ไม่ใช่ผู้ยื่นเอง: policy INSERT เดิมของ business_registrations (043) ไม่บังคับ status
--   ⇒ ประชาชนยิง REST ใส่ status='approved' + approved_by = บัญชีที่สองของตัวเองได้ (ช่องเดิม แยกงานแก้)
--   ⚠️ ด่านนี้ "แคบลง" แต่ยังไม่ปิด: ใส่ approved_by = uuid ของ officer/admin ตัวจริงยังผ่านได้ (FK เช็กแค่ว่ามีบัญชี)
--      ⇒ ต้องแก้ policy INSERT ของ 043 ให้บังคับ status='pending' / approved_by IS NULL ก่อนเปิดตลาดให้ อปท. จริงแห่งแรก
--   ดู role ของผู้อนุมัติ "ณ วันผูก" — ผู้อนุมัติย้าย/เปลี่ยน role แล้วใบเก่าผูกไม่ได้ (ข้อความแยกให้แอดมินตรวจ)
--   จึงเชื่อเฉพาะใบที่ผู้อนุมัติเป็นคนที่ policy UPDATE (20260802060000) ให้อนุมัติได้จริง: superadmin หรือ admin/officer ของ อปท. นั้น
-- เจ้าของเดิมเป็นคนอื่นอยู่แล้ว = ต้องส่ง p_replace = true (กันกดผิดใบทับเงียบ) · ทุกการผูก/เปลี่ยน/ถอดลงสมุด
DROP FUNCTION IF EXISTS public.market_link_owner_from_registration(uuid, uuid); -- กัน overload รุ่นร่างค้าง (PGRST203)
CREATE OR REPLACE FUNCTION public.market_link_owner_from_registration(p_place_id uuid, p_registration_id uuid,
                                                                      p_replace boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_place_muni uuid;
  v_old public.market_shop_owners%ROWTYPE;
  v_had_owner boolean;
  reg record;
BEGIN
  IF p_place_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION 'ข้อมูลไม่ครบ' USING ERRCODE = '22023';
  END IF;
  IF NOT public.market_can_manage_place(p_place_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จัดการร้านนี้' USING ERRCODE = '42501';
  END IF;
  SELECT p.municipality_id INTO v_place_muni FROM public.tourism_places p WHERE p.id = p_place_id FOR UPDATE;
  SELECT b.municipality_id, b.user_id, b.status, b.approved_by INTO reg
  FROM public.business_registrations b WHERE b.id = p_registration_id;
  IF NOT FOUND OR reg.municipality_id IS DISTINCT FROM v_place_muni THEN
    RAISE EXCEPTION 'ไม่พบคำขอลงทะเบียนนี้ใน อปท. เดียวกับร้าน' USING ERRCODE = 'P0001';
  END IF;
  IF reg.status IS DISTINCT FROM 'approved' OR reg.approved_by IS NULL OR reg.approved_by = reg.user_id THEN
    RAISE EXCEPTION 'คำขอลงทะเบียนยังไม่ได้รับอนุมัติจากเจ้าหน้าที่' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles ap
                 WHERE ap.id = reg.approved_by
                   AND (ap.role = 'superadmin' OR (ap.role IN ('admin', 'officer') AND ap.municipality_id = reg.municipality_id))) THEN
    RAISE EXCEPTION 'ผู้อนุมัติคำขอนี้ไม่ใช่ผู้มีสิทธิ์อนุมัติ (หรือย้าย/เปลี่ยนตำแหน่งแล้ว) ให้แอดมินตรวจคำขอก่อนผูกเจ้าของร้าน'
      USING ERRCODE = 'P0001';
  END IF;
  IF reg.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = reg.user_id) THEN
    RAISE EXCEPTION 'คำขอนี้ไม่มีบัญชีผู้ยื่นแล้ว ผูกเจ้าของร้านไม่ได้' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_shop_owners o WHERE o.registration_id = p_registration_id AND o.place_id <> p_place_id) THEN
    RAISE EXCEPTION 'คำขอนี้ผูกกับร้านอื่นอยู่แล้ว' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_old FROM public.market_shop_owners WHERE place_id = p_place_id FOR UPDATE;
  v_had_owner := FOUND;
  IF v_had_owner THEN
    IF v_old.user_id = reg.user_id AND v_old.registration_id IS NOT DISTINCT FROM p_registration_id THEN
      RETURN; -- ผูกคู่เดิมซ้ำ ไม่ลงบันทึกซ้ำ
    END IF;
    IF v_old.user_id <> reg.user_id AND NOT COALESCE(p_replace, false) THEN
      RAISE EXCEPTION 'ร้านนี้มีเจ้าของร้านคนอื่นอยู่แล้ว ต้องยืนยันการเปลี่ยนเจ้าของ' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.market_shop_owners
       SET user_id = reg.user_id, registration_id = p_registration_id, linked_by = auth.uid(), linked_at = now()
     WHERE place_id = p_place_id;
  ELSE
    INSERT INTO public.market_shop_owners (place_id, municipality_id, user_id, registration_id, linked_by, linked_at)
    VALUES (p_place_id, v_place_muni, reg.user_id, p_registration_id, auth.uid(), now());
  END IF;

  INSERT INTO public.market_product_moderation_log (municipality_id, place_id, action, subject_user_id, actor_id)
  VALUES (v_place_muni, p_place_id,
          CASE WHEN v_had_owner AND v_old.user_id <> reg.user_id THEN 'replace_owner' ELSE 'link_owner' END,
          reg.user_id, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.market_link_owner_from_registration(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_link_owner_from_registration(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.market_unlink_owner(p_place_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old public.market_shop_owners%ROWTYPE;
BEGIN
  IF p_place_id IS NULL OR NOT public.market_can_manage_place(p_place_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จัดการร้านนี้' USING ERRCODE = '42501';
  END IF;
  -- สินค้าคงอยู่ เจ้าหน้าที่ซ่อน/ลบเองได้
  DELETE FROM public.market_shop_owners WHERE place_id = p_place_id RETURNING * INTO v_old;
  IF FOUND THEN
    INSERT INTO public.market_product_moderation_log (municipality_id, place_id, action, subject_user_id, actor_id)
    VALUES (v_old.municipality_id, p_place_id, 'unlink_owner', v_old.user_id, auth.uid());
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.market_unlink_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_unlink_owner(uuid) TO authenticated;

-- ── ผูกเจ้าของร้านย้อนหลัง (ร้านที่อนุมัติไปแล้วก่อนมีตารางนี้) ───────────────────────────────
-- จับคู่ (อปท., ชื่อ) แบบเดียวกับ 20260906120000 แต่รับเฉพาะคู่ที่ "ไม่กำกวม": ชื่อนั้นมีร้านเดียว และคำขอที่อนุมัติ
-- ชื่อนั้นมีใบเดียว ⇒ ชื่อซ้ำ/ผู้ยื่นลบบัญชีแล้ว = ไม่ผูก ให้เจ้าหน้าที่กดผูกเองจากหน้าจัดการ (ไม่เดา)
-- + ต้องมีผู้อนุมัติที่ไม่ใช่ผู้ยื่น (ดูเหตุผลที่ RPC ด้านบน) · ร้านที่เคยมีประวัติผูก/ถอดในสมุด = ข้าม (รันซ้ำไม่ย้อนการถอด)
INSERT INTO public.market_shop_owners (place_id, municipality_id, user_id, registration_id, linked_by)
SELECT t.id, t.municipality_id, b.user_id, b.id, NULL
FROM public.tourism_places t
JOIN public.business_registrations b
  ON b.municipality_id = t.municipality_id AND btrim(b.business_name) = btrim(t.name) AND b.status = 'approved'
WHERE b.user_id IS NOT NULL
  AND b.approved_by IS NOT NULL AND b.approved_by <> b.user_id
  AND EXISTS (SELECT 1 FROM public.profiles ap
                  WHERE ap.id = b.approved_by
                    AND (ap.role = 'superadmin' OR (ap.role IN ('admin', 'officer') AND ap.municipality_id = b.municipality_id)))
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = b.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.market_product_moderation_log lg
                  WHERE lg.place_id = t.id AND lg.action IN ('link_owner', 'replace_owner', 'unlink_owner'))
  AND (SELECT count(*) FROM public.tourism_places t2
        WHERE t2.municipality_id = t.municipality_id AND btrim(t2.name) = btrim(t.name)) = 1
  AND (SELECT count(*) FROM public.business_registrations b2
        WHERE b2.municipality_id = t.municipality_id AND btrim(b2.business_name) = btrim(t.name) AND b2.status = 'approved') = 1
ON CONFLICT DO NOTHING; -- ไม่ระบุคอลัมน์: ครอบทั้ง place_id และ unique registration_id (รันซ้ำไม่ล้ม 23505)

-- ── เปิดโมดูลให้สนามซ้อม demo เท่านั้น (อปท. อื่นแอดมินเปิดเองที่หน้าจัดการโมดูล · ค่าเริ่มต้นปิด) ─────────
UPDATE public.municipalities
   SET enabled_modules = array_append(enabled_modules, 'local-market')
 WHERE slug = 'demo' AND enabled_modules IS NOT NULL
   AND array_position(enabled_modules::text[], 'local-market') IS NULL; -- ไม่ใช้ NOT (= ANY): มีสมาชิก NULL ปน = ข้ามเงียบ

DO $demo$
BEGIN
  IF EXISTS (SELECT 1 FROM public.municipalities WHERE slug = 'demo' AND enabled_modules IS NOT NULL
             AND array_position(enabled_modules::text[], 'local-market') IS NULL) THEN
    RAISE EXCEPTION 'เปิดโมดูล local-market ให้ demo ไม่สำเร็จ';
  END IF;
END $demo$;

-- ── ด่านท้ายไฟล์: ผู้รันไม่ใช่เจ้าของตาราง REVOKE จะไม่ error แต่ไม่มีผล (บทเรียน #657) ──
DO $verify$
DECLARE
  o regclass := 'public.market_shop_owners'; p regclass := 'public.market_products';
  l regclass := 'public.market_product_moderation_log'; f regclass := 'public.tourism_favorites';
BEGIN
  IF (SELECT bool_or(NOT relrowsecurity) FROM pg_class WHERE oid IN (o, p, l, f))
     OR has_any_column_privilege('anon', o, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('anon', l, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('anon', f, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('anon', p, 'INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('anon', o, 'DELETE,TRUNCATE,TRIGGER') OR has_table_privilege('anon', l, 'DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('anon', f, 'DELETE,TRUNCATE,TRIGGER')
     OR has_function_privilege('anon', 'public.market_my_place_ids()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.market_can_manage_place(uuid)', 'EXECUTE')
     OR has_column_privilege('anon', p, 'hidden_reason', 'SELECT')
     OR has_table_privilege('anon', p, 'DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('authenticated', o, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', l, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege('authenticated', o, 'INSERT,UPDATE')
     OR has_any_column_privilege('authenticated', l, 'INSERT,UPDATE')
     OR has_table_privilege('authenticated', p, 'TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', f, 'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_column_privilege('authenticated', p, 'is_hidden', 'UPDATE')
     OR has_column_privilege('authenticated', p, 'is_hidden', 'INSERT')
     OR has_column_privilege('authenticated', p, 'municipality_id', 'INSERT')
     OR has_column_privilege('authenticated', p, 'place_id', 'UPDATE')
     OR has_column_privilege('authenticated', f, 'user_id', 'INSERT')
     OR NOT has_column_privilege('authenticated', p, 'price', 'UPDATE')
     OR has_function_privilege('anon', 'public.market_set_product_hidden(uuid, boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.market_link_owner_from_registration(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.market_unlink_owner(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.market_my_managed_place_ids()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.market_products_guard()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.market_place_public(uuid)', 'EXECUTE')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid IN (o, p, l, f)) <> 8 THEN
    RAISE EXCEPTION 'market_* / tourism_favorites: RLS/สิทธิ์ไม่ตรงตามที่ออกแบบ (ผู้รันต้องเป็นเจ้าของตาราง เช่น postgres)';
  END IF;
END $verify$;

COMMIT;
