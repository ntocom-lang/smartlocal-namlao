-- สถานการณ์น้ำ-ฝน เฟส 2 PR 2.2 ไฟล์ 2/2 — ผู้มีสิทธิ์ยืนยันมาจากตาราง water_announcement_approvers แทนทะเบียนผู้ลงนาม
-- (ตารางอยู่ 20261020130000)
--
-- เปลี่ยน/เพิ่ม (ทุกตัวเป็นของ PR 2.1/2.2 เอง ไม่ทับฟังก์ชันของโมดูลอื่น):
--   can_approve_water_announcement      → ผู้ยืนยัน = บัญชีที่ admin ของ อปท. ตั้งไว้ในตาราง + ยังเป็น admin/officer/staff ของ อปท. นั้น
--                                         (ถูกลดบทบาท/ย้าย อปท. = หมดสิทธิ์ทันที) · ไม่ดูทะเบียนผู้ลงนามอีกต่อไป · superadmin ไม่ได้สิทธิ์โดยตำแหน่ง
--   water_announcement_approver_roles   → ลบ (ไม่ใช้แล้ว)
--   can_manage_water_announcement_approvers / list_… / set_water_announcement_approver → admin ของ อปท. นั้นหรือ superadmin ตั้ง/ถอนผู้ยืนยัน
--                                         (สูงสุด 5 คน · ทุกครั้งลง audit_logs · บัญชีต้องเป็น admin/officer/staff ของ อปท. นั้น)
--   list_water_announcements            → เพิ่ม approvers_count, can_manage_approvers (หน้าจอใช้เตือนว่า "ยังไม่ได้ตั้งผู้ยืนยัน")
--   get_public_water_announcement       → เพิ่ม server_now (ให้หน้าเว็บนับเวลาหมดอายุตามนาฬิกาเซิร์ฟเวอร์ ไม่ใช่นาฬิกาเครื่องผู้ใช้ที่อาจเพี้ยน)
--   water_announcement_todo(p_muni)     → ตัวบางๆ ให้หน้าแรกเจ้าหน้าที่ถามว่า "มีร่างรอฉันยืนยันไหม" (ชื่อพารามิเตอร์ p_muni ตามฮุก useHomeRpc)
--                                         ไม่ใช่ผู้ยืนยัน = ได้ค่าคงที่ ไม่บอกอะไรเกี่ยวกับ อปท.
--
-- ⚠️ ผู้มีอำนาจประกาศตามกฎหมาย/แผนของ อบต. ต้องยืนยันกับตัวบทฉบับปัจจุบันก่อนเปิดกับ อปท. จริง — ระบบไม่ตัดสินแทน (admin เลือก คนกดยืนยันเอง)
-- ย้อนกลับ: คืนฟังก์ชันจากไฟล์ 20261020100100 แล้ว DROP ฟังก์ชันใหม่ของไฟล์นี้ (ดู scratchpad rollback) — ไม่มีอะไรอื่นอ้างถึง

DO $$
BEGIN
  IF to_regclass('public.water_announcement_approvers') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261020130000_water_announcement_approvers_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('public.can_approve_water_announcement(uuid)') IS NULL
     OR to_regprocedure('public.list_water_announcements(uuid, integer)') IS NULL
     OR to_regprocedure('public.get_public_water_announcement(uuid)') IS NULL
     OR to_regprocedure('public.water_announcement_audit(uuid, text, uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261020100100_water_announcements_functions.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- ผู้ยืนยัน = บัญชีที่ admin ตั้งไว้ในตาราง (ทั้งตั้งไว้และยังเป็นเจ้าหน้าที่ของ อปท. นั้น)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.can_approve_water_announcement(_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.water_announcement_approvers AS a
    JOIN public.profiles AS p ON p.id = a.profile_id
    WHERE _municipality_id IS NOT NULL
      AND auth.uid() IS NOT NULL
      AND a.municipality_id = _municipality_id
      AND a.profile_id = auth.uid()
      AND p.municipality_id = _municipality_id
      AND p.role IN ('admin', 'officer', 'staff')
  );
$$;

REVOKE ALL ON FUNCTION public.can_approve_water_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_water_announcement(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.water_announcement_approver_roles();

-- ===========================================================================
-- ใครตั้ง/ถอนผู้ยืนยันได้: admin ของ อปท. นั้น หรือ superadmin
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.can_manage_water_announcement_approvers(_municipality_id uuid)
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
      AND _municipality_id IS NOT NULL
      AND (p.role = 'superadmin' OR (p.role = 'admin' AND p.municipality_id = _municipality_id))
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_water_announcement_approvers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_water_announcement_approvers(uuid) TO authenticated;

-- รายชื่อเจ้าหน้าที่ของ อปท. (ผู้ที่ตั้งเป็นผู้ยืนยันได้) + ใครเป็นผู้ยืนยันอยู่ — ส่งแค่ชื่อ/ตำแหน่ง/บทบาท ไม่ส่งอีเมล/เบอร์
CREATE OR REPLACE FUNCTION public.list_water_announcement_approvers(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.can_manage_water_announcement_approvers(_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ตั้งผู้มีสิทธิ์ยืนยันประกาศของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'max_approvers', 5,
    'enabled', COALESCE((SELECT s.enabled FROM public.water_announcement_settings AS s WHERE s.municipality_id = _municipality_id), false),
    'people', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.sort_name)
      FROM (
        SELECT COALESCE(p.full_name, '') AS sort_name,
               jsonb_build_object(
                 'id', p.id,
                 'name', COALESCE(NULLIF(btrim(p.full_name), ''), 'ไม่ระบุชื่อ'),
                 'job_title', NULLIF(btrim(p.job_title), ''),
                 'role', p.role,
                 'is_approver', (a.profile_id IS NOT NULL),
                 'authority_note', a.authority_note
               ) AS j
        FROM public.profiles AS p
        LEFT JOIN public.water_announcement_approvers AS a
               ON a.municipality_id = _municipality_id AND a.profile_id = p.id
        WHERE p.municipality_id = _municipality_id AND p.role IN ('admin', 'officer', 'staff')
      ) AS x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_water_announcement_approvers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_water_announcement_approvers(uuid) TO authenticated;

-- ตั้ง/ถอนผู้ยืนยัน — บัญชีต้องเป็น admin/officer/staff ของ อปท. นั้น · สูงสุด 5 คน · คืนผลแทน raise เมื่อเป็นเรื่องที่คนแก้ได้เอง
CREATE OR REPLACE FUNCTION public.set_water_announcement_approver(
  _municipality_id uuid, _profile_id uuid, _is_approver boolean, _authority_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_max   CONSTANT integer := 5;
  v_note  text := NULLIF(btrim(COALESCE(_authority_note, '')), '');
  v_count integer;
  v_target public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_water_announcement_approvers(_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ตั้งผู้มีสิทธิ์ยืนยันประกาศของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;
  IF _profile_id IS NULL OR _is_approver IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุบัญชีและสถานะ' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'ข้อความอ้างอิงอำนาจยาวเกิน 300 ตัวอักษร' USING ERRCODE = '22023';
  END IF;

  -- ล็อกแถวหน่วยงานกันสองคนตั้งพร้อมกันจนเกิน 5 คน
  PERFORM 1 FROM public.municipalities WHERE id = _municipality_id FOR UPDATE;

  IF _is_approver THEN
    SELECT * INTO v_target FROM public.profiles WHERE id = _profile_id;
    IF NOT FOUND OR v_target.municipality_id IS DISTINCT FROM _municipality_id OR v_target.role NOT IN ('admin', 'officer', 'staff') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_staff');
    END IF;
    SELECT count(*) INTO v_count FROM public.water_announcement_approvers
    WHERE municipality_id = _municipality_id AND profile_id <> _profile_id;
    IF v_count >= c_max THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'max_reached', 'max', c_max);
    END IF;
    INSERT INTO public.water_announcement_approvers (municipality_id, profile_id, authority_note, added_by)
    VALUES (_municipality_id, _profile_id, v_note, auth.uid())
    ON CONFLICT (municipality_id, profile_id) DO UPDATE
      SET authority_note = EXCLUDED.authority_note, added_by = EXCLUDED.added_by;
  ELSE
    DELETE FROM public.water_announcement_approvers WHERE municipality_id = _municipality_id AND profile_id = _profile_id;
  END IF;

  PERFORM public.water_announcement_audit(_municipality_id, 'update', _profile_id,
    jsonb_build_object('kind', 'approver', 'is_approver', _is_approver, 'authority_note', v_note));

  SELECT count(*) INTO v_count FROM public.water_announcement_approvers WHERE municipality_id = _municipality_id;
  RETURN jsonb_build_object('ok', true, 'approvers_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.set_water_announcement_approver(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_water_announcement_approver(uuid, uuid, boolean, text) TO authenticated;

-- ===========================================================================
-- หน้าเจ้าหน้าที่อ่าน — เพิ่ม approvers_count / can_manage_approvers (ที่เหลือเหมือน PR 2.1)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.list_water_announcements(_municipality_id uuid, _limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 20), 1), 100);
BEGIN
  IF NOT public.can_view_water_events(_municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูประกาศน้ำ-ฝนของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'now', now(),
    'enabled', COALESCE((SELECT s.enabled FROM public.water_announcement_settings AS s WHERE s.municipality_id = _municipality_id), false),
    'default_expiry_hours', (SELECT s.default_expiry_hours FROM public.water_announcement_settings AS s WHERE s.municipality_id = _municipality_id),
    'can_approve', public.can_approve_water_announcement(_municipality_id),
    'can_manage_approvers', public.can_manage_water_announcement_approvers(_municipality_id),
    'approvers_count', (SELECT count(*) FROM public.water_announcement_approvers AS a WHERE a.municipality_id = _municipality_id),
    'recorder', (
      SELECT jsonb_build_object('last_ok_at', h.last_ok_at, 'last_error_at', h.last_error_at)
      FROM public.job_heartbeats AS h WHERE h.job_name = 'water-announce-tick'
    ),
    'pending', (
      SELECT jsonb_build_object('id', a.id, 'body', a.body, 'drafted_at', a.drafted_at)
      FROM public.water_announcements AS a
      WHERE a.municipality_id = _municipality_id AND a.status = 'draft'
    ),
    'current', (
      SELECT jsonb_build_object('id', a.id, 'body', a.body, 'published_at', a.published_at, 'expires_at', a.expires_at)
      FROM public.water_announcements AS a
      WHERE a.municipality_id = _municipality_id AND a.status = 'published' AND a.expires_at > now()
    ),
    'history', COALESCE((
      SELECT jsonb_agg(x.j ORDER BY x.drafted_at DESC)
      FROM (
        SELECT a.drafted_at,
               jsonb_build_object('id', a.id, 'status', a.status, 'body', a.body, 'drafted_at', a.drafted_at,
                                  'published_at', a.published_at, 'expires_at', a.expires_at, 'closed_at', a.closed_at) AS j
        FROM public.water_announcements AS a
        WHERE a.municipality_id = _municipality_id
        ORDER BY a.drafted_at DESC
        LIMIT v_limit
      ) AS x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_water_announcements(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_water_announcements(uuid, integer) TO authenticated;

-- ===========================================================================
-- หน้าประชาชนอ่าน — เพิ่ม server_now (ที่เหลือเหมือน PR 2.1: เฉพาะฉบับที่ยืนยันแล้ว ยังไม่หมดอายุ อปท. ยังเปิดใช้)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_public_water_announcement(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object('id', a.id, 'body', a.body, 'published_at', a.published_at,
                            'expires_at', a.expires_at, 'issuer', m.name, 'server_now', now())
  FROM public.water_announcements AS a
  JOIN public.water_announcement_settings AS s ON s.municipality_id = a.municipality_id AND s.enabled
  JOIN public.municipalities AS m ON m.id = a.municipality_id AND m.is_active
  WHERE a.municipality_id = _municipality_id AND a.status = 'published' AND a.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_water_announcement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_water_announcement(uuid) TO anon, authenticated;

-- ===========================================================================
-- หน้าแรกเจ้าหน้าที่: "มีร่างประกาศรอฉันยืนยันไหม" — ตอบจริงเฉพาะผู้ยืนยัน ที่เหลือได้ค่าคงที่ (ไม่บอกว่า อปท. เปิดใช้หรือไม่)
--   ชื่อพารามิเตอร์ p_muni ตามฮุก useHomeRpc · ร่างที่เก่ากว่า 3 ชม. หรือเหตุการณ์ปิดแล้ว = ไม่นับ (กดยืนยันไม่ได้อยู่แล้ว)
--   ⚠️ 3 ชม. ต้องตรงกับ c_draft_life ใน water_announcement_tick/approve_water_announcement
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.water_announcement_todo(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_draft_life CONSTANT interval := interval '3 hours';
  v_enabled boolean;
  v_drafted timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_approve_water_announcement(p_muni) THEN
    RETURN jsonb_build_object('can_approve', false, 'pending', false);
  END IF;
  SELECT COALESCE(s.enabled, false) INTO v_enabled
  FROM (SELECT 1) AS one LEFT JOIN public.water_announcement_settings AS s ON s.municipality_id = p_muni;
  SELECT a.drafted_at INTO v_drafted
  FROM public.water_announcements AS a
  JOIN public.water_events AS e ON e.id = a.event_id AND e.closed_at IS NULL
  WHERE a.municipality_id = p_muni AND a.status = 'draft' AND a.drafted_at > now() - c_draft_life;
  RETURN jsonb_build_object('can_approve', true, 'pending', COALESCE(v_enabled, false) AND v_drafted IS NOT NULL, 'drafted_at', v_drafted);
END;
$$;

REVOKE ALL ON FUNCTION public.water_announcement_todo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.water_announcement_todo(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_approve_water_announcement(uuid) IS
  'ผู้ยืนยันประกาศน้ำ-ฝน = บัญชีที่ admin ของ อปท. ตั้งไว้ใน water_announcement_approvers และยังเป็น admin/officer/staff ของ อปท. นั้น · ไม่ใช่ superadmin/ผู้ลงนามในทะเบียนโดยตำแหน่ง';
COMMENT ON FUNCTION public.set_water_announcement_approver(uuid, uuid, boolean, text) IS
  'admin ของ อปท. (หรือ superadmin) ตั้ง/ถอนผู้มีสิทธิ์ยืนยันประกาศ — สูงสุด 5 คน ลง audit_logs ทุกครั้ง';

NOTIFY pgrst, 'reload schema';

COMMIT;
