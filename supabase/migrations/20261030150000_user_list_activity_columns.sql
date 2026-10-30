-- เพิ่มคอลัมน์ "ลงทะเบียน" + "ใช้งานล่าสุด" ในตารางหน้าจัดการผู้ใช้และการแต่งตั้ง
--
-- ทำไมต้องมี last_active_at: last_sign_in_at เปลี่ยนเฉพาะตอนล็อกอิน คนที่จำการเข้าสู่ระบบไว้จึงดูเหมือนหายไปนาน
-- วัดจริง 2026-10-30 (176 บัญชี): ใช้งานใน 30 วัน ดูจากล็อกอินได้ 36 บัญชี ดูจาก session ได้ 102 บัญชี ต่างกันสูงสุด 162 วัน
-- ข้อจำกัด: เปิดหน้าเว็บค้างไว้ก็นับ และคลาดเคลื่อนได้ราว 1 ชั่วโมงตามรอบต่ออายุ token จึงห้ามใช้วัดการทำงาน
--
-- PDPA: 20260901110000_my_active_sessions.sql กำหนดว่าแอดมินดู session ของคนอื่นไม่ได้ถ้ายังไม่ทบทวนฐานทางกฎหมาย
-- เจ้าของระบบตัดสินใจเปิดเฉพาะ "เวลา" ของทุกบัญชีรวมประชาชนเอง 2026-10-30 (ฐานกฎหมายยังไม่ได้ให้ DPO ยืนยัน)
-- ฟังก์ชันนี้จึงคืนแค่ timestamp เดียว ห้ามเพิ่ม ip / user_agent โดยไม่ทบทวนใหม่
--
-- ต้อง DROP เพราะการเพิ่มคอลัมน์ใน RETURNS TABLE ใช้ CREATE OR REPLACE ไม่ได้ ทำใน transaction เดียว
-- ระหว่างนั้นผู้เรียกจึงไม่เห็นฟังก์ชันหาย หน้าเว็บรุ่นเก่าไม่กระทบเพราะแค่ไม่อ่านคอลัมน์ใหม่
-- และสร้างใหม่แล้วต้องคืนสิทธิ์ทุกครั้ง ไม่งั้น default privileges ของ Supabase จะเปิดให้ anon
--
-- เนื้อฟังก์ชันคัดจาก pg_get_functiondef ของฐานจริง 2026-10-30 (ตรงกับ 20260903130000 และ 20261024200000)
-- md5 ตัวเดิม: sorted aa544e675205f29e66f13ec24b034771 · filtered e72f2ee3042ce002e4ec5d4d235b87b4
-- เปลี่ยนเฉพาะจุดที่ทำเครื่องหมาย << ใหม่ >> + รายการคีย์เรียง + RETURNS TABLE + SELECT ท้ายคำสั่ง

BEGIN;

DROP FUNCTION public.get_users_with_email_sorted(uuid, text[], text, integer, integer, text, text);
DROP FUNCTION public.get_users_with_email_sorted_filtered(uuid, text[], text, uuid, boolean, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.get_users_with_email_sorted(p_municipality_id uuid, p_roles text[], p_search text, p_limit integer, p_offset integer, p_sort_key text, p_sort_direction text)
 RETURNS TABLE(id uuid, email text, full_name text, role text, municipality_id uuid, municipality_name text, phone text, id_card text, job_title text, address text, address_province text, address_district text, address_subdistrict text, address_moo text, address_detail text, avatar_url text, providers text[], last_sign_in_at timestamp with time zone, created_at timestamp with time zone, staff_id uuid, staff_name text, staff_title text, department_id uuid, department_name text, is_dept_head boolean, position_id uuid, position_name text, last_active_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_muni uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort_key text := COALESCE(NULLIF(lower(btrim(p_sort_key)), ''), 'full_name');
  v_sort_direction text := COALESCE(NULLIF(lower(btrim(p_sort_direction)), ''), 'asc');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;
  IF v_sort_key NOT IN ('created_at', 'last_active_at', 'full_name', 'email', 'providers', 'role', 'assignment') THEN
    RAISE EXCEPTION 'Invalid sort key';
  END IF;
  IF v_sort_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Invalid sort direction';
  END IF;

  RETURN QUERY
  WITH user_rows AS (
    SELECT
      p.id,
      COALESCE(NULLIF(p.email, ''), u.email) AS email,
      p.full_name,
      p.role,
      p.municipality_id,
      m.name AS municipality_name,
      p.phone,
      p.id_card,
      p.job_title,
      p.address,
      p.address_province,
      p.address_district,
      p.address_subdistrict,
      p.address_moo,
      p.address_detail,
      p.avatar_url,
      identity_data.providers,
      u.last_sign_in_at,
      -- << ใหม่ >> วันสมัครจริงอยู่ที่ auth.users (profiles.created_at ของบัญชียุคแรก 5 บัญชีช้ากว่าจริง 1–64 วัน)
      COALESCE(u.created_at, p.created_at) AS created_at,
      -- << ใหม่ >> เวลาที่ใหม่กว่าระหว่างล็อกอินกับการต่ออายุ session
      GREATEST(u.last_sign_in_at, session_data.last_session_at) AS last_active_at,
      s.id AS staff_id,
      s.name AS staff_name,
      s.title AS staff_title,
      p.department_id,
      dep.name AS department_name,
      p.is_dept_head,
      p.position_id,
      pos.name AS position_name,
      CASE p.role
        WHEN 'superadmin' THEN 'Super Admin'
        WHEN 'admin' THEN 'แอดมินระบบ'
        WHEN 'officer' THEN 'หัวหน้ากอง'
        WHEN 'technician' THEN 'ปฏิบัติงาน'
        WHEN 'staff' THEN 'เจ้าหน้าที่'
        WHEN 'viewer' THEN 'ผู้บริหาร'
        WHEN 'council' THEN 'สมาชิกสภา'
        WHEN 'citizen' THEN 'ประชาชน'
        ELSE COALESCE(p.role, '')
      END AS role_sort,
      concat_ws(' ',
        CASE WHEN 'google' = ANY(identity_data.providers) THEN 'Google' END,
        CASE WHEN 'custom:line' = ANY(identity_data.providers) THEN 'LINE' END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers)
          THEN 'เบอร์โทร'
        END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) NOT ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers)
          THEN 'อีเมล/รหัสผ่าน'
        END,
        CASE WHEN cardinality(identity_data.providers) = 0 THEN 'ไม่พบข้อมูล' END
      ) AS provider_sort,
      COALESCE(dep.name, 'ไม่ระบุกอง') || ' ' || COALESCE(pos.name, 'ไม่ระบุตำแหน่งในทำเนียบ') AS assignment_sort
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.municipalities m ON m.id = p.municipality_id
    LEFT JOIN public.staff s ON s.id = p.staff_id
    LEFT JOIN public.departments dep ON dep.id = p.department_id
    LEFT JOIN public.positions pos ON pos.id = p.position_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(array_agg(DISTINCT i.provider ORDER BY i.provider), ARRAY[]::text[]) AS providers
      FROM auth.identities i
      WHERE i.user_id = p.id
    ) identity_data ON true
    -- << ใหม่ >> อ่านเฉพาะเวลา ไม่คืน ip / user_agent (refreshed_at เก็บ UTC ไม่มี timezone)
    LEFT JOIN LATERAL (
      SELECT max(COALESCE(sess.refreshed_at AT TIME ZONE 'UTC', sess.updated_at, sess.created_at)) AS last_session_at
      FROM auth.sessions sess WHERE sess.user_id = p.id
    ) session_data ON true
    WHERE (
        p.municipality_id = p_municipality_id
        OR (
          p.municipality_id IS NULL
          AND public.profile_linked_to_municipality(p.id, p_municipality_id)
        )
      )
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR p.full_name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%' || btrim(p_search) || '%'
        OR p.phone ILIKE '%' || btrim(p_search) || '%'
        OR p.id_card ILIKE '%' || btrim(p_search) || '%'
      )
  )
  SELECT
    r.id, r.email, r.full_name, r.role, r.municipality_id, r.municipality_name,
    r.phone, r.id_card, r.job_title, r.address, r.address_province, r.address_district,
    r.address_subdistrict, r.address_moo, r.address_detail, r.avatar_url, r.providers,
    r.last_sign_in_at, r.created_at, r.staff_id, r.staff_name, r.staff_title,
    r.department_id, r.department_name, r.is_dept_head, r.position_id, r.position_name, r.last_active_at
  FROM user_rows r
  ORDER BY
    -- รายชื่อภาษาไทยอยู่ก่อนรายชื่ออักษรละตินเหมือนรายการเดิม ไม่ว่ากำลังเรียงขึ้นหรือลง
    CASE WHEN v_sort_key = 'full_name' THEN (COALESCE(r.full_name, '') !~ '^[ก-๙]') END ASC,
    CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'asc' THEN r.created_at END ASC NULLS LAST,
    CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'desc' THEN r.created_at END DESC NULLS LAST,
    -- << ใหม่ >> เรียงจากเก่าไปใหม่ ให้บัญชีที่ไม่เคยเข้าใช้ขึ้นก่อน
    CASE WHEN v_sort_key = 'last_active_at' AND v_sort_direction = 'asc' THEN r.last_active_at END ASC NULLS FIRST,
    CASE WHEN v_sort_key = 'last_active_at' AND v_sort_direction = 'desc' THEN r.last_active_at END DESC NULLS LAST,
    CASE WHEN v_sort_key = 'full_name' AND v_sort_direction = 'asc' THEN lower(r.full_name) END ASC NULLS LAST,
    CASE WHEN v_sort_key = 'full_name' AND v_sort_direction = 'desc' THEN lower(r.full_name) END DESC NULLS LAST,
    CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'asc' THEN lower(COALESCE(r.email, 'ยังไม่ระบุ')) END ASC,
    CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'desc' THEN lower(COALESCE(r.email, 'ยังไม่ระบุ')) END DESC,
    CASE WHEN v_sort_key = 'providers' AND v_sort_direction = 'asc' THEN lower(r.provider_sort) END ASC,
    CASE WHEN v_sort_key = 'providers' AND v_sort_direction = 'desc' THEN lower(r.provider_sort) END DESC,
    CASE WHEN v_sort_key = 'role' AND v_sort_direction = 'asc' THEN lower(r.role_sort) END ASC,
    CASE WHEN v_sort_key = 'role' AND v_sort_direction = 'desc' THEN lower(r.role_sort) END DESC,
    CASE WHEN v_sort_key = 'assignment' AND v_sort_direction = 'asc' THEN lower(r.assignment_sort) END ASC,
    CASE WHEN v_sort_key = 'assignment' AND v_sort_direction = 'desc' THEN lower(r.assignment_sort) END DESC,
    (COALESCE(r.full_name, '') !~ '^[ก-๙]') ASC,
    lower(r.full_name) ASC NULLS LAST,
    r.created_at DESC,
    r.id ASC
  LIMIT v_limit
  OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_users_with_email_sorted(uuid, text[], text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_email_sorted(uuid, text[], text, integer, integer, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_users_with_email_sorted_filtered(p_municipality_id uuid, p_roles text[], p_search text, p_department_id uuid, p_without_department boolean, p_limit integer, p_offset integer, p_sort_key text, p_sort_direction text)
 RETURNS TABLE(id uuid, email text, full_name text, role text, municipality_id uuid, municipality_name text, phone text, id_card text, job_title text, address text, address_province text, address_district text, address_subdistrict text, address_moo text, address_detail text, avatar_url text, providers text[], last_sign_in_at timestamp with time zone, created_at timestamp with time zone, staff_id uuid, staff_name text, staff_title text, department_id uuid, department_name text, is_dept_head boolean, position_id uuid, position_name text, last_active_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_municipality_id uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort_key text := COALESCE(NULLIF(lower(btrim(p_sort_key)), ''), 'full_name');
  v_sort_direction text := COALESCE(NULLIF(lower(btrim(p_sort_direction)), ''), 'asc');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_municipality_id
  FROM public.profiles p WHERE p.id = auth.uid();

  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin')
     OR (v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_municipality_id)
  THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_sort_key NOT IN ('created_at', 'last_active_at', 'full_name', 'email', 'providers', 'role', 'assignment')
     OR v_sort_direction NOT IN ('asc', 'desc')
  THEN
    RAISE EXCEPTION 'Invalid sort';
  END IF;
  IF COALESCE(p_without_department, false) AND p_department_id IS NOT NULL THEN
    RAISE EXCEPTION 'Department filters are mutually exclusive';
  END IF;
  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_department_id AND d.municipality_id = p_municipality_id
  ) THEN
    RAISE EXCEPTION 'Department does not belong to the selected municipality';
  END IF;

  RETURN QUERY
  WITH user_rows AS (
    SELECT
      p.id,
      COALESCE(NULLIF(p.email, ''), u.email) AS email,
      p.full_name,
      p.role,
      p.municipality_id,
      m.name AS municipality_name,
      p.phone,
      p.id_card,
      p.job_title,
      p.address,
      p.address_province,
      p.address_district,
      p.address_subdistrict,
      p.address_moo,
      p.address_detail,
      p.avatar_url,
      identity_data.providers,
      u.last_sign_in_at,
      -- << ใหม่ >> วันสมัครจริงอยู่ที่ auth.users (profiles.created_at ของบัญชียุคแรก 5 บัญชีช้ากว่าจริง 1–64 วัน)
      COALESCE(u.created_at, p.created_at) AS created_at,
      -- << ใหม่ >> เวลาที่ใหม่กว่าระหว่างล็อกอินกับการต่ออายุ session
      GREATEST(u.last_sign_in_at, session_data.last_session_at) AS last_active_at,
      s.id AS staff_id,
      s.name AS staff_name,
      s.title AS staff_title,
      p.department_id,
      dep.name AS department_name,
      p.is_dept_head,
      p.position_id,
      pos.name AS position_name,
      CASE p.role
        WHEN 'superadmin' THEN 'Super Admin'
        WHEN 'admin' THEN 'แอดมินระบบ'
        WHEN 'officer' THEN 'หัวหน้ากอง'
        WHEN 'technician' THEN 'ปฏิบัติงาน'
        WHEN 'staff' THEN 'เจ้าหน้าที่'
        WHEN 'viewer' THEN 'ผู้บริหาร'
        WHEN 'council' THEN 'สมาชิกสภา'
        WHEN 'citizen' THEN 'ประชาชน'
        ELSE COALESCE(p.role, '')
      END AS role_sort,
      concat_ws(' ',
        CASE WHEN 'google' = ANY(identity_data.providers) THEN 'Google' END,
        CASE WHEN 'custom:line' = ANY(identity_data.providers) THEN 'LINE' END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers) THEN 'เบอร์โทร'
        END,
        CASE
          WHEN COALESCE(NULLIF(p.email, ''), u.email) NOT ILIKE '%@phone.smartlocal.app'
            AND 'email' = ANY(identity_data.providers) THEN 'อีเมล/รหัสผ่าน'
        END,
        CASE WHEN cardinality(identity_data.providers) = 0 THEN 'ไม่พบข้อมูล' END
      ) AS provider_sort,
      COALESCE(dep.name, 'ไม่ระบุกอง') || ' ' || COALESCE(pos.name, 'ไม่ระบุตำแหน่งในทำเนียบ') AS assignment_sort
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.municipalities m ON m.id = p.municipality_id
    LEFT JOIN public.staff s ON s.id = p.staff_id
    LEFT JOIN public.departments dep ON dep.id = p.department_id
    LEFT JOIN public.positions pos ON pos.id = p.position_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(array_agg(DISTINCT i.provider ORDER BY i.provider), ARRAY[]::text[]) AS providers
      FROM auth.identities i WHERE i.user_id = p.id
    ) identity_data ON true
    -- << ใหม่ >> อ่านเฉพาะเวลา ไม่คืน ip / user_agent (refreshed_at เก็บ UTC ไม่มี timezone)
    LEFT JOIN LATERAL (
      SELECT max(COALESCE(sess.refreshed_at AT TIME ZONE 'UTC', sess.updated_at, sess.created_at)) AS last_session_at
      FROM auth.sessions sess WHERE sess.user_id = p.id
    ) session_data ON true
    WHERE (
        p.municipality_id = p_municipality_id
        OR (p.municipality_id IS NULL AND public.profile_linked_to_municipality(p.id, p_municipality_id))
      )
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (p_department_id IS NULL OR p.department_id = p_department_id)
      AND (NOT COALESCE(p_without_department, false) OR p.department_id IS NULL)
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR p.full_name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(NULLIF(p.email, ''), u.email) ILIKE '%' || btrim(p_search) || '%'
        OR p.phone ILIKE '%' || btrim(p_search) || '%'
        OR p.id_card ILIKE '%' || btrim(p_search) || '%'
        OR pos.name ILIKE '%' || btrim(p_search) || '%'
      )
  )
  SELECT
    r.id, r.email, r.full_name, r.role, r.municipality_id, r.municipality_name,
    r.phone, r.id_card, r.job_title, r.address, r.address_province, r.address_district,
    r.address_subdistrict, r.address_moo, r.address_detail, r.avatar_url, r.providers,
    r.last_sign_in_at, r.created_at, r.staff_id, r.staff_name, r.staff_title,
    r.department_id, r.department_name, r.is_dept_head, r.position_id, r.position_name, r.last_active_at
  FROM user_rows r
  ORDER BY
    CASE WHEN v_sort_key = 'full_name' THEN (COALESCE(r.full_name, '') !~ '^[ก-๙]') END ASC,
    CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'asc' THEN r.created_at END ASC NULLS LAST,
    CASE WHEN v_sort_key = 'created_at' AND v_sort_direction = 'desc' THEN r.created_at END DESC NULLS LAST,
    -- << ใหม่ >> เรียงจากเก่าไปใหม่ ให้บัญชีที่ไม่เคยเข้าใช้ขึ้นก่อน
    CASE WHEN v_sort_key = 'last_active_at' AND v_sort_direction = 'asc' THEN r.last_active_at END ASC NULLS FIRST,
    CASE WHEN v_sort_key = 'last_active_at' AND v_sort_direction = 'desc' THEN r.last_active_at END DESC NULLS LAST,
    CASE WHEN v_sort_key = 'full_name' AND v_sort_direction = 'asc' THEN lower(r.full_name) END ASC NULLS LAST,
    CASE WHEN v_sort_key = 'full_name' AND v_sort_direction = 'desc' THEN lower(r.full_name) END DESC NULLS LAST,
    CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'asc' THEN lower(COALESCE(r.email, 'ยังไม่ระบุ')) END ASC,
    CASE WHEN v_sort_key = 'email' AND v_sort_direction = 'desc' THEN lower(COALESCE(r.email, 'ยังไม่ระบุ')) END DESC,
    CASE WHEN v_sort_key = 'providers' AND v_sort_direction = 'asc' THEN lower(r.provider_sort) END ASC,
    CASE WHEN v_sort_key = 'providers' AND v_sort_direction = 'desc' THEN lower(r.provider_sort) END DESC,
    CASE WHEN v_sort_key = 'role' AND v_sort_direction = 'asc' THEN lower(r.role_sort) END ASC,
    CASE WHEN v_sort_key = 'role' AND v_sort_direction = 'desc' THEN lower(r.role_sort) END DESC,
    CASE WHEN v_sort_key = 'assignment' AND v_sort_direction = 'asc' THEN lower(r.assignment_sort) END ASC,
    CASE WHEN v_sort_key = 'assignment' AND v_sort_direction = 'desc' THEN lower(r.assignment_sort) END DESC,
    (COALESCE(r.full_name, '') !~ '^[ก-๙]') ASC,
    lower(r.full_name) ASC NULLS LAST,
    r.created_at DESC,
    r.id ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_users_with_email_sorted_filtered(uuid, text[], text, uuid, boolean, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_with_email_sorted_filtered(uuid, text[], text, uuid, boolean, integer, integer, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
