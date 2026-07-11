-- 108_security_fixes_round2.sql
-- แก้ปัญหาที่พบรอบที่ 2 จาก security scan
--   H4: payment-slips DELETE ไม่มี role filter
--   M2: fleet_seed_departments() ไม่มี permission check
--   L1: my_fleet() ไม่มี SET search_path

-- ══════════════════════════════════════════════════════════════
-- [H4] payment-slips storage DELETE — จำกัดเฉพาะ staff+
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff delete payment slips" ON storage.objects;
CREATE POLICY "staff delete payment slips"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND get_my_role() IN ('superadmin', 'admin', 'officer', 'staff')
  );

-- payment-slips INSERT — เพิ่ม path guard (citizen ต้อง upload ใต้ path ที่มี doc request id)
-- NOTE: ไม่สามารถ enforce municipality ผ่าน path เพียงอย่างเดียวใน SQL ได้
-- แต่จำกัดให้ authenticated เท่านั้น (เหมือนเดิม — ไม่ต้องเปลี่ยน INSERT policy)


-- ══════════════════════════════════════════════════════════════
-- [M2] fleet_seed_departments() — เพิ่ม role check + search_path
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fleet_seed_departments(p_municipality_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- เฉพาะ admin ของ municipality นั้น หรือ superadmin
  IF get_my_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF get_my_role() = 'admin' AND get_my_municipality_id() IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  INSERT INTO public.fleet_departments(municipality_id, code, name, short_name, sort_order)
  VALUES
    (p_municipality_id, 'exec',        'ผู้บริหาร',           'ผบ.',   0),
    (p_municipality_id, 'general',     'สำนักปลัด',           'สป.',   1),
    (p_municipality_id, 'finance',     'กองคลัง',             'กค.',   2),
    (p_municipality_id, 'engineering', 'กองช่าง',             'กช.',   3),
    (p_municipality_id, 'education',   'กองการศึกษา',         'กศ.',   4),
    (p_municipality_id, 'welfare',     'กองสวัสดิการสังคม',   'กส.',   5),
    (p_municipality_id, 'health',      'กองสาธารณสุข',        'กสธ.',  6),
    (p_municipality_id, 'tax',         'กองจัดเก็บรายได้',    'กร.',   7),
    (p_municipality_id, 'pool',        'ส่วนกลาง (Pool)',      'Pool',  99)
  ON CONFLICT (municipality_id, code) DO NOTHING;
END;
$$;

-- ถอน PUBLIC grant แล้วให้เฉพาะ authenticated
REVOKE EXECUTE ON FUNCTION public.fleet_seed_departments(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fleet_seed_departments(uuid) TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- [L1] my_fleet() — เพิ่ม SET search_path ป้องกัน search path injection
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.my_fleet()
RETURNS TABLE(mun_id uuid, frole text, fdept_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT municipality_id, fleet_role, fleet_department_id
  FROM public.profiles WHERE id = auth.uid()
$$;
