-- 112_fix_municipality_update_policies_and_rpcs.sql
-- ปรับปรุง RLS policy และฟังก์ชัน RPC ของ municipalities เพื่อรองรับบทบาท superadmin (ที่ไม่มี municipality_id ผูกมัด)

-- 1. อัปเดต RLS Policy สำหรับการ UPDATE ตาราง municipalities ให้ superadmin สามารถอัปเดตข้อมูลของเทศบาลใดๆ ก็ได้
DROP POLICY IF EXISTS "admin can update municipalities" ON public.municipalities;
CREATE POLICY "admin can update municipalities" ON public.municipalities
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.role = 'superadmin')
          OR (p.role IN ('admin', 'officer') AND p.municipality_id = municipalities.id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.role = 'superadmin')
          OR (p.role IN ('admin', 'officer') AND p.municipality_id = municipalities.id)
        )
    )
  );

-- 2. อัปเดตฟังก์ชัน update_municipality_logo ให้เป็น SECURITY DEFINER และมีการตรวจสอบบทบาทที่ถูกต้อง
CREATE OR REPLACE FUNCTION public.update_municipality_logo(
  p_municipality_id uuid,
  p_logo_url        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            text;
  v_municipality_id uuid;
  v_uid             uuid;
BEGIN
  v_uid := auth.uid();

  SELECT role, municipality_id
    INTO v_role, v_municipality_id
    FROM public.profiles
   WHERE id = v_uid;

  IF v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied: uid=%, role=%', v_uid, COALESCE(v_role,'NULL');
  END IF;

  IF v_role != 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch uid=%, muni=%', v_uid, v_municipality_id;
  END IF;

  UPDATE public.municipalities
     SET logo_url = p_logo_url
   WHERE id = p_municipality_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_municipality_logo TO authenticated;

-- 3. อัปเดตฟังก์ชัน update_municipality_qr ให้เป็น SECURITY DEFINER และมีการตรวจสอบบทบาทที่ถูกต้อง
CREATE OR REPLACE FUNCTION public.update_municipality_qr(
  p_municipality_id uuid,
  p_qr_code_url     text,
  p_qr_label        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            text;
  v_municipality_id uuid;
  v_uid             uuid;
BEGIN
  v_uid := auth.uid();

  SELECT role, municipality_id
    INTO v_role, v_municipality_id
    FROM public.profiles
   WHERE id = v_uid;

  IF v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied: uid=%, role=%', v_uid, COALESCE(v_role,'NULL');
  END IF;

  IF v_role != 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch uid=%, muni=%', v_uid, v_municipality_id;
  END IF;

  UPDATE public.municipalities
     SET qr_code_url = p_qr_code_url,
         qr_label    = p_qr_label
   WHERE id = p_municipality_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_municipality_qr TO authenticated;
