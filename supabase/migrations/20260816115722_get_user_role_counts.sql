-- 20260816160000_get_user_role_counts.sql
-- RPC นับจำนวนผู้ใช้ (เจ้าหน้าที่/ประชาชน) สำหรับ badge ในหน้า "จัดการผู้ใช้และการแต่งตั้ง"
--
-- ทำไมต้องแยก RPC แทนนับตรงจาก client (select('id',{count:'exact',head:true})):
-- get_users_with_email (158_harden_user_role_management.sql) นับ/ดึงแถวด้วยเงื่อนไข
--   municipality_id = p_municipality_id OR (municipality_id IS NULL AND profile_linked_to_municipality(...))
-- ครอบคลุมบัญชี superadmin/บัญชีทดสอบที่ municipality_id เป็น NULL แต่ผูกกับเทศบาลนี้ผ่านการยื่นคำร้อง
-- ถ้านับตรงด้วย .eq('municipality_id', ...) เฉยๆ จะตกหล่นเคสนี้ไป (ตรวจพบจริงตอนทดสอบ:
-- นับได้ 37 แต่รายการจริงมี 38 คน) ฟังก์ชันนี้จึง mirror เงื่อนไขเดียวกับ get_users_with_email เป๊ะๆ
-- เพื่อให้ตัวเลข badge ตรงกับรายการที่กดเข้าไปดูจริงเสมอ

CREATE OR REPLACE FUNCTION public.get_user_role_counts(p_municipality_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_muni uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role, p.municipality_id INTO v_role, v_muni
  FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'Municipality is required';
  END IF;
  IF v_role = 'admin' AND p_municipality_id IS DISTINCT FROM v_muni THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN (
    SELECT json_build_object(
      'staff',   count(*) FILTER (
                   WHERE p.role IN ('staff', 'officer', 'technician', 'admin', 'superadmin', 'council', 'viewer')
                 ),
      'citizen', count(*) FILTER (WHERE p.role = 'citizen')
    )
    FROM public.profiles p
    WHERE (
      p.municipality_id = p_municipality_id
      OR (p.municipality_id IS NULL AND public.profile_linked_to_municipality(p.id, p_municipality_id))
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_role_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role_counts(uuid) TO authenticated;
;
