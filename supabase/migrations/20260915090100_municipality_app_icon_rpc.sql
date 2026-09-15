-- ไอคอนแอปแบบ maskable ของแต่ละ อปท. (เฟส 2/2: RPC)
-- ต้องรัน 20260915090000_municipalities_app_icon_url.sql ก่อน (docs/ai/NOTES.md ข้อ 3)

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'municipalities' AND column_name = 'app_icon_url'
  ) THEN
    RAISE EXCEPTION 'ยังไม่มีคอลัมน์ municipalities.app_icon_url — รัน 20260915090000 ก่อน';
  END IF;
END $$;

-- 1) เปลี่ยนโลโก้แล้วล้างไอคอนเดิมทิ้ง ไม่งั้นแอปจะติดตั้งด้วยตราเก่าต่อไปเงียบๆ
--    หน้าตั้งค่าสร้างไอคอนใหม่ตามมาทันที ถ้าขั้นนั้นพัง manifest ยังมีโลโก้แบบ "any" ใช้ได้
--
--    ยกมาจากนิยามบน production ครบทุกบรรทัด (ตรวจด้วย pg_get_functiondef 2026-09-15
--    ตรงกับ 20260802070000) เพิ่มแค่ app_icon_url = NULL — ดู NOTES.md ข้อ 5
CREATE OR REPLACE FUNCTION public.update_municipality_logo(
  p_municipality_id uuid,
  p_logo_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_role <> 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities
  SET logo_url = p_logo_url,
      app_icon_url = NULL
  WHERE id = p_municipality_id;
END;
$$;

-- 2) บันทึก URL ไอคอนที่หน้าตั้งค่าสร้างเสร็จ — เช็คสิทธิ์ชุดเดียวกับโลโก้
CREATE OR REPLACE FUNCTION public.update_municipality_app_icon(
  p_municipality_id uuid,
  p_app_icon_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_role <> 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;
  -- worker ยังคัดโดเมนซ้ำอีกชั้น ตรงนี้กันค่าขยะไม่ให้ลง DB ตั้งแต่ต้น
  IF p_app_icon_url IS NOT NULL AND p_app_icon_url !~ '^https://' THEN
    RAISE EXCEPTION 'app_icon_url must be https';
  END IF;

  UPDATE public.municipalities
  SET app_icon_url = p_app_icon_url
  WHERE id = p_municipality_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_municipality_logo(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_municipality_app_icon(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_municipality_logo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_municipality_app_icon(uuid, text) TO authenticated;

COMMIT;
