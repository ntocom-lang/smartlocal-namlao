-- 135_emergency_anon_bypass_lockdown.sql — EMERGENCY, apply ASAP
--
-- พบระหว่างตรวจสอบ live DB (ไม่ใช่แค่จากไฟล์ migration):
--
-- (A) โปรเจกต์นี้มี default privilege ระดับ schema ที่ GRANT EXECUTE ON FUNCTIONS
--     ให้ anon โดยอัตโนมัติทุกครั้งที่ CREATE/REPLACE FUNCTION ใหม่ (ยืนยันจาก
--     pg_default_acl) — ทำให้ "REVOKE EXECUTE ... FROM PUBLIC" ที่เขียนไว้ใน
--     migration 107/108/133 (รวมถึงของผมเอง) ไม่เคยได้ผลกับ anon เลย เพราะ
--     PUBLIC-revoke ไม่แตะ grant ที่ให้ anon ตรงๆ จาก default privilege
--
-- (B) ฟังก์ชันหลายตัวเขียน permission check แบบ
--       IF v_role NOT IN ('admin','superadmin',...) THEN RAISE EXCEPTION ...
--     ซึ่ง "fail OPEN" เมื่อ v_role เป็น NULL (กรณี anon เรียกโดยไม่ auth.uid()) —
--     NULL NOT IN (...) = NULL, IF NULL THEN ... ไม่ทำงาน เงื่อนไข IF ถัดไปก็ NULL
--     เช่นกัน (IS DISTINCT FROM ทำให้เป็น bug ซ้อน bug) → ฟังก์ชันรันจนจบโดยไม่มี
--     การตรวจสิทธิ์เลย
--
-- ผลรวม (A)+(B) ที่ยืนยันแล้วว่า exploit ได้จริงบน live DB ตอนนี้ โดยไม่ต้อง login:
--   - get_users_with_email      → ดึงโปรไฟล์ทุกคน (ชื่อ/เบอร์/เลขบัตร ปชช./email/ที่อยู่)
--                                  ของเทศบาลไหนก็ได้ พร้อม search+pagination
--   - delete_user_by_id         → ลบบัญชีผู้ใช้ใดๆ ก็ได้ (ยกเว้น role='superadmin')
--   - update_municipality_qr    → เปลี่ยน QR/PromptPay รับเงินของเทศบาลใดก็ได้ (ทุจริตการเงิน)
--   - update_municipality_logo  → เปลี่ยนโลโก้เทศบาลใดก็ได้ (ต่อยอด XSS ผ่าน og:image ใน ssr.js)
--   - update_municipality_settings → เปลี่ยนชื่อระบบ/PWA ของเทศบาลใดก็ได้
--   - fleet_seed_departments    → สร้างแผนกซ้ำในเทศบาลใดก็ได้ (impact ต่ำกว่าอันอื่นมาก)
--
-- แก้ 2 ชั้น: (1) แก้ logic ให้ fail-closed เมื่อ role เป็น NULL, (2) REVOKE EXECUTE
-- จาก anon ตรงๆ (ไม่ใช่แค่ PUBLIC) กับทุกฟังก์ชันนี้ กัน default-privilege เผลอคืนสิทธิ์
-- ให้อีกครั้งในอนาคตถ้ามีคนมา CREATE OR REPLACE โดยไม่รู้เรื่องนี้

-- ── get_users_with_email ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_users_with_email(
  p_municipality_id uuid DEFAULT NULL,
  p_roles text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, email text, full_name text, role text, municipality_id uuid,
  municipality_name text, phone text, id_card text, job_title text,
  address text, address_province text, address_district text,
  address_subdistrict text, address_moo text, address_detail text,
  avatar_url text, providers text[], last_sign_in_at timestamptz,
  created_at timestamptz, staff_id uuid, staff_name text, staff_title text,
  department_id uuid, department_name text, is_dept_head boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_muni uuid;
BEGIN
  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_role IN ('admin', 'officer') AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN QUERY
  SELECT
    p.id, COALESCE(NULLIF(p.email, ''), u.email), p.full_name, p.role,
    p.municipality_id, m.name, p.phone, p.id_card, p.job_title, p.address,
    p.address_province, p.address_district, p.address_subdistrict,
    p.address_moo, p.address_detail, p.avatar_url,
    ARRAY(SELECT DISTINCT i.provider FROM auth.identities i WHERE i.user_id = p.id),
    u.last_sign_in_at, p.created_at,
    s.id, s.name, s.title, p.department_id, dep.name, p.is_dept_head
  FROM public.profiles p
  LEFT JOIN auth.users         u   ON u.id = p.id
  LEFT JOIN public.municipalities m ON m.id = p.municipality_id
  LEFT JOIN public.staff       s   ON s.id = p.staff_id
  LEFT JOIN public.departments dep ON dep.id = p.department_id
  WHERE (
      (p_municipality_id IS NULL AND v_role = 'superadmin')
      OR p.municipality_id = p_municipality_id
      OR (
        p_municipality_id IS NOT NULL AND p.municipality_id IS NULL
        AND EXISTS (SELECT 1 FROM public.complaints c WHERE c.user_id = p.id AND c.municipality_id = p_municipality_id)
      )
    )
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (
      p_search IS NULL OR p_search = ''
      OR p.full_name ILIKE '%' || p_search || '%'
      OR p.phone     ILIKE '%' || p_search || '%'
      OR p.id_card   ILIKE '%' || p_search || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT COALESCE(p_limit, 2147483647)
  OFFSET p_offset;
END;
$$;

-- ── delete_user_by_id ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_user_by_id(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_role text;
  v_caller_muni uuid;
  v_target_role text;
  v_target_muni uuid;
BEGIN
  SELECT role, municipality_id INTO v_caller_role, v_caller_muni
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  SELECT role, municipality_id INTO v_target_role, v_target_muni
  FROM public.profiles WHERE id = p_user_id;

  IF v_target_role = 'superadmin' THEN
    RAISE EXCEPTION 'Cannot delete a superadmin account';
  END IF;

  IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Only superadmin can delete admin accounts';
  END IF;

  IF v_caller_role = 'admin'
     AND v_target_muni IS NOT NULL
     AND v_target_muni IS DISTINCT FROM v_caller_muni
  THEN
    RAISE EXCEPTION 'Permission denied: cannot delete user from another municipality';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

-- ── update_municipality_logo / qr / settings ────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_municipality_logo(p_municipality_id uuid, p_logo_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_role != 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities SET logo_url = p_logo_url WHERE id = p_municipality_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_municipality_qr(p_municipality_id uuid, p_qr_code_url text, p_qr_label text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_role != 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities
     SET qr_code_url = p_qr_code_url, qr_label = p_qr_label
   WHERE id = p_municipality_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_municipality_settings(
  p_municipality_id uuid, p_system_name text, p_system_subtitle text, p_pwa_short_name text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_municipality_id uuid;
BEGIN
  SELECT role, municipality_id INTO v_role, v_municipality_id
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_role != 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  UPDATE public.municipalities
     SET system_name = p_system_name, system_subtitle = p_system_subtitle, pwa_short_name = p_pwa_short_name
   WHERE id = p_municipality_id;
END;
$$;

-- ── fleet_seed_departments (impact ต่ำกว่า แต่ปิดเส้นทางเดียวกัน) ───────────
CREATE OR REPLACE FUNCTION public.fleet_seed_departments(p_municipality_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() IS NULL OR get_my_role() NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF get_my_role() = 'admin' AND get_my_municipality_id() IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  INSERT INTO public.departments(municipality_id, code, name, short_name, sort_order)
  VALUES
    (p_municipality_id, 'exec',        'ผู้บริหาร',    'ผบ.', 0),
    (p_municipality_id, 'general',     'สำนักปลัด',    'สป.', 1),
    (p_municipality_id, 'finance',     'กองคลัง',      'กค.', 2),
    (p_municipality_id, 'engineering', 'กองช่าง',      'กช.', 3),
    (p_municipality_id, 'education',   'กองการศึกษา',  'กศ.', 4)
  ON CONFLICT (municipality_id, code) DO NOTHING;
END;
$$;

-- ── ปิด anon ให้ตรงๆ ทุกตัว (กัน default privilege คืนสิทธิ์ให้อีกในอนาคต) ─────
REVOKE EXECUTE ON FUNCTION public.get_users_with_email(uuid, text[], text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_users_with_email(uuid, text[], text, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_user_by_id(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_user_by_id(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_municipality_logo(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_municipality_logo(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_municipality_qr(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_municipality_qr(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_municipality_settings(uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_municipality_settings(uuid, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fleet_seed_departments(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fleet_seed_departments(uuid) TO authenticated;

-- กันไว้อีกชั้น เผื่อ 133 ที่เพิ่ง apply ก็โดน default-privilege คืนสิทธิ์ anon เหมือนกัน
REVOKE EXECUTE ON FUNCTION public.complaints_near(double precision, double precision, double precision, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complaints_near(double precision, double precision, double precision, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complaints_heatmap(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complaints_heatmap(uuid, int) TO authenticated;
