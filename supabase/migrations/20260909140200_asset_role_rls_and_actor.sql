-- ผูกทะเบียนของให้ยืมและการดำเนินการกับคำขอ เข้ากับ profiles.asset_role
--
-- ของเดิม (20260909100100) ใช้ role หลักตรงๆ: officer ของกองไหนก็แก้ทะเบียนของกองนั้นได้ทันที
-- โดยไม่มีใครมอบสิทธิ์ ตรวจย้อนหลังไม่ได้ว่าใครควรเป็นคนทำ ไฟล์นี้เปลี่ยนไปใช้สิทธิ์
-- ที่แอดมินมอบให้เป็นรายคน ตามแม่แบบของระบบยานพาหนะ
--
-- ⚠️ หลัง apply จะยังไม่มีใครมี asset_role เลย เหลือ admin/superadmin ของ อปท. ที่จัดการได้
-- จนกว่าแอดมินจะเข้าไปมอบสิทธิ์ให้เจ้าหน้าที่พัสดุแต่ละกอง — เหมือนตอนเปิดระบบยานพาหนะครั้งแรก

BEGIN;

-- ผู้ดูแลระดับ อปท. — เห็นและแก้ได้ทุกกอง รวมของที่ยังไม่ผูกกอง
-- แอดมินของ อปท. ได้สิทธิ์นี้โดยไม่ต้องถูกตั้ง asset_role (ตรรกะเดียวกับ fleet_is_manager)
CREATE OR REPLACE FUNCTION public.asset_is_manager(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'superadmin'
        OR (
          p.municipality_id = p_municipality_id
          AND (p.role = 'admin' OR p.asset_role = 'asset_admin')
        )
      )
  );
$$;

-- เจ้าหน้าที่พัสดุของกอง — แก้ได้เฉพาะของในกองตัวเอง
-- ของที่ยังไม่ผูกกอง (department_id IS NULL) เป็นของผู้ดูแลระดับ อปท. เท่านั้น ไม่ใช่ของทุกคน
-- ไม่งั้นเจ้าหน้าที่กองไหนก็ยึดของกลางไปเป็นของกองตัวเองได้
CREATE OR REPLACE FUNCTION public.asset_can_manage(p_municipality_id uuid, p_department_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.asset_is_manager(p_municipality_id)
    OR (
      p_department_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = auth.uid()
          AND p.municipality_id = p_municipality_id
          AND p.asset_role = 'asset_staff'
          AND p.department_id = p_department_id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.asset_is_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asset_can_manage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asset_can_manage(uuid, uuid) TO authenticated;

-- ทะเบียนของให้ยืม: เขียนได้เฉพาะคนที่ถูกมอบสิทธิ์
DROP POLICY IF EXISTS "manage borrowable_assets" ON public.borrowable_assets;
CREATE POLICY "manage borrowable_assets" ON public.borrowable_assets
  FOR ALL TO authenticated
  USING (public.asset_can_manage(municipality_id, department_id))
  WITH CHECK (public.asset_can_manage(municipality_id, department_id));

-- การอ่านไม่เปลี่ยน: เจ้าหน้าที่ใน อปท. เห็นทะเบียนได้ทั้งหมด (ต้องเห็นเพื่อรับคำขอหน้าเคาน์เตอร์
-- แทนประชาชน) ประชาชนเห็นเฉพาะของที่ติดสวิตช์ "ประชาชนยืมได้" และยังเปิดใช้งานอยู่
DROP POLICY IF EXISTS "read borrowable_assets" ON public.borrowable_assets;
CREATE POLICY "read borrowable_assets" ON public.borrowable_assets
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      municipality_id = public.get_my_municipality_id()
      AND (
        public.get_my_role() <> 'citizen'
        OR (is_public_borrowable AND is_active)
      )
    )
  );

-- ผู้มีสิทธิ์ดำเนินการกับคำขอ (อนุมัติ/จ่ายของ/รับคืน/ปิดเรื่อง)
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน เนื้อคัดมาครบจาก 20260909100200 ส่วนที่เปลี่ยน
-- คือช่วงตัดสินสิทธิ์เท่านั้น
--
-- ตัดสาขา role = 'officer' และ role = 'staff' ที่ถูกมอบหมายงานออก แล้วใช้ asset_role แทน
-- เหตุผล: ถ้าทะเบียนของถูกล็อกด้วย asset_role แต่การอนุมัติยังเปิดให้ officer ทุกคนของกอง
-- สิทธิ์จะแตกเป็นสองระบบ คนที่แอดมินตั้งใจไม่ให้ยุ่งกับพัสดุ จะจ่ายของออกจากคลังได้อยู่ดี
-- ใครที่ต้องดำเนินการ ให้แอดมินมอบ asset_staff ของกองนั้นให้ ซึ่งตรวจย้อนหลังได้ว่าใครให้
CREATE OR REPLACE FUNCTION public.assert_asset_borrow_actor(p_request_id uuid)
RETURNS public.asset_borrow_requests
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_req  public.asset_borrow_requests;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;

  SELECT * INTO v_req
  FROM public.asset_borrow_requests
  WHERE request_id = p_request_id;

  IF v_req.request_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคำขอยืมพัสดุที่อ้างถึง';
  END IF;

  -- asset_can_manage ครอบคลุมทั้ง superadmin, admin ของ อปท., asset_admin และ asset_staff
  -- ของกองนั้น พร้อมกันคนละ อปท. ให้แล้วในตัว จึงไม่ต้องเช็ค municipality ซ้ำ
  IF public.asset_can_manage(v_req.municipality_id, v_req.department_id) THEN
    RETURN v_req;
  END IF;

  RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอยืมนี้ — ต้องได้รับสิทธิ์พัสดุของกองที่ดูแลของชิ้นนี้';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_asset_borrow_actor(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
