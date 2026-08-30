-- 20260902160000_admin_purge_contacts_rpc.sql
--
-- ต่อจาก 20260902150000 ที่ถอด cron ออก: การลบข้อมูลติดต่อที่ครบกำหนดกลายเป็น "การกระทำของคน"
-- แต่คนที่ต้องกดคือแอดมินของ อปท. ซึ่งไม่มีสิทธิ์เข้า SQL editor — ถ้าไม่มีปุ่ม คำประกาศเรื่อง
-- ระยะเวลาเก็บรักษาในฟอร์มก็ไม่มีวันเป็นจริง migration นี้เปิดทางให้กดจากหน้าแอดมินได้อย่างปลอดภัย
--
-- 2 อย่างที่เปลี่ยนกับฟังก์ชันลบตัวจริง (purge_expired_complaint_contacts):
--   1. เพิ่ม p_municipality_id — เดิมลบทุก อปท. รวดเดียวเสมอ ซึ่งใช้เป็นปุ่มของแอดมินไม่ได้เลย
--      (แอดมินน้ำเลากดแล้วข้อมูลของทุ่งแค้วหายไปด้วย) NULL = ทุกแห่งเหมือนเดิมสำหรับงานระดับระบบ
--   2. audit_logs บันทึกตัวคนกดจริงเมื่อมี auth.uid() (เดิมเขียน 'ระบบ' เสมอเพราะออกแบบไว้ให้ cron
--      เรียกอย่างเดียว) — ลบข้อมูลประชาชนต้องรู้ว่าใครสั่ง ไม่ใช่ "ระบบทำ"
-- เปลี่ยน signature จึงต้อง DROP ก่อน ไม่มีใครเรียกค้างอยู่แล้วเพราะ cron ถูกถอดไปตั้งแต่ไฟล์ก่อน
--
-- ฟังก์ชันใหม่ purge_due_complaint_contacts() = ด่านสำหรับปุ่มบนหน้าจอ:
--   - admin/superadmin เท่านั้น, admin ลบได้เฉพาะ อปท. ตัวเอง (superadmin = ทุกแห่ง ตรงกับ preview)
--   - บังคับส่ง p_expected_count = ตัวเลขที่แอดมินเห็นบนหน้าจอตอนกด ถ้าไม่ตรงกับความจริง ณ วินาทีนั้น
--     จะปฏิเสธทั้งหมด (มีเรื่องใหม่ครบกำหนดแทรกเข้ามา หรือเปิดหน้าจอค้างไว้ข้ามวัน = ไม่ได้ลบมั่ว)
--   - ไม่รับ p_dry_run: อยากดูตัวเลขให้ใช้ complaint_contact_retention_preview() ที่อ่านอย่างเดียว
--     ฟังก์ชันนี้จึงมีความหมายเดียวคือ "ลบจริง" ไม่มีทางกดผิดเพราะลืมใส่ธง

DROP FUNCTION IF EXISTS public.purge_expired_complaint_contacts(interval, boolean);

CREATE FUNCTION public.purge_expired_complaint_contacts(
  p_retention       interval DEFAULT '5 years',
  p_dry_run         boolean  DEFAULT false,
  p_municipality_id uuid     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff   timestamptz := now() - p_retention;
  v_purged   int := 0;
  v_holding  int := 0;
  v_skipped  int := 0;
  v_actor    public.profiles%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_skipped
  FROM public.complaints c
  WHERE c.contact_purged_at IS NULL
    AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
    AND (p_municipality_id IS NULL OR c.municipality_id = p_municipality_id)
    AND public.complaint_contact_retention_anchor(c) IS NULL
    AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
    AND c.status IN ('closed', 'done', 'completed', 'rejected');

  SELECT count(*) INTO v_holding
  FROM public.complaints c
  WHERE c.contact_purged_at IS NULL
    AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
    AND (p_municipality_id IS NULL OR c.municipality_id = p_municipality_id);

  IF p_dry_run THEN
    SELECT count(*) INTO v_purged
    FROM public.complaints c
    WHERE c.contact_purged_at IS NULL
      AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
      AND (p_municipality_id IS NULL OR c.municipality_id = p_municipality_id)
      AND public.complaint_contact_retention_anchor(c) < v_cutoff;

    RETURN jsonb_build_object(
      'dry_run', true, 'cutoff', to_jsonb(v_cutoff),
      'would_purge', v_purged, 'skipped_no_anchor', v_skipped, 'holding_contacts', v_holding
    );
  END IF;

  -- ผู้สั่งลบ: คนกดปุ่มถ้ามี session, เป็น NULL เมื่อถูกเรียกจากงานระดับระบบ/SQL editor
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  END IF;

  PERFORM set_config('app.retention_purge', '1', true);

  WITH targets AS (
    SELECT c.id, c.municipality_id
    FROM public.complaints c
    WHERE c.contact_purged_at IS NULL
      AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
      AND (p_municipality_id IS NULL OR c.municipality_id = p_municipality_id)
      AND public.complaint_contact_retention_anchor(c) < v_cutoff
  ), logged AS (
    INSERT INTO public.audit_logs (
      municipality_id, actor_id, actor_name, actor_role, action,
      resource_type, resource_id, resource_label, metadata
    )
    SELECT t.municipality_id,
           v_actor.id,
           coalesce(v_actor.full_name, v_actor.email, 'ระบบ (งานลบข้อมูลตามระยะเวลาเก็บรักษา)'),
           coalesce(v_actor.role, 'system'),
           'purge_contact_pii', 'complaint', NULL,
           'ลบข้อมูลติดต่อผู้แจ้งที่ครบกำหนดเก็บรักษา',
           jsonb_build_object(
             'retention', p_retention::text,
             'cutoff', to_jsonb(v_cutoff),
             'complaints', count(*),
             'fields', jsonb_build_array('reporter_name', 'phone'),
             'triggered_by', CASE WHEN v_actor.id IS NULL THEN 'system' ELSE 'admin_action' END
           )
    FROM targets t
    GROUP BY t.municipality_id
    RETURNING 1
  ), updated AS (
    UPDATE public.complaints c
       SET reporter_name = NULL,
           phone = NULL,
           contact_purged_at = now()
      FROM targets t
     WHERE c.id = t.id
    RETURNING c.id
  )
  SELECT count(*) INTO v_purged FROM updated;

  PERFORM set_config('app.retention_purge', '0', true);

  RETURN jsonb_build_object(
    'dry_run', false, 'cutoff', to_jsonb(v_cutoff),
    'purged', v_purged, 'skipped_no_anchor', v_skipped, 'holding_contacts', v_holding - v_purged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_complaint_contacts(interval, boolean, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.purge_expired_complaint_contacts(interval, boolean, uuid) IS
  'ลบชื่อ-นามสกุลและเบอร์โทรของผู้แจ้งที่พ้นระยะเวลาเก็บรักษา (ดีฟอลต์ 5 ปี) — p_municipality_id NULL = ทุก อปท., p_dry_run=true เพื่อดูจำนวนก่อน; เรียกได้จาก SQL editor หรือผ่าน purge_due_complaint_contacts() เท่านั้น';

CREATE OR REPLACE FUNCTION public.purge_due_complaint_contacts(
  p_expected_count int,
  p_retention      interval DEFAULT '5 years'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  public.profiles%ROWTYPE;
  v_scope  uuid;
  v_cutoff timestamptz := now() - p_retention;
  v_due    int := 0;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();

  IF NOT FOUND OR coalesce(v_actor.role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'ลบข้อมูลติดต่อได้เฉพาะผู้ดูแลระบบ' USING ERRCODE = '42501';
  END IF;

  IF p_expected_count IS NULL OR p_expected_count < 0 THEN
    RAISE EXCEPTION 'ต้องระบุจำนวนเรื่องที่ยืนยันจะลบ' USING ERRCODE = '22023';
  END IF;

  -- admin ลบได้เฉพาะสังกัดตัวเอง; superadmin (municipality_id เป็น NULL ตามดีไซน์) = ทุกแห่ง
  v_scope := CASE WHEN v_actor.role = 'superadmin' THEN NULL ELSE v_actor.municipality_id END;

  IF v_actor.role <> 'superadmin' AND v_scope IS NULL THEN
    RAISE EXCEPTION 'ไม่พบสังกัดเทศบาลของผู้ใช้รายนี้' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_due
  FROM public.complaints c
  WHERE c.contact_purged_at IS NULL
    AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
    AND (v_scope IS NULL OR c.municipality_id = v_scope)
    AND public.complaint_contact_retention_anchor(c) < v_cutoff;

  -- ตัวเลขบนหน้าจอกับความจริงต้องตรงกัน ณ วินาทีที่กด ไม่งั้นไม่ลบอะไรเลยแล้วให้ไปกดใหม่
  IF v_due <> p_expected_count THEN
    RAISE EXCEPTION 'จำนวนที่ถึงกำหนดเปลี่ยนไปแล้ว (บนหน้าจอ % เรื่อง ปัจจุบัน % เรื่อง) กรุณารีเฟรชแล้วตรวจใหม่',
      p_expected_count, v_due USING ERRCODE = 'P0001';
  END IF;

  IF v_due = 0 THEN
    RETURN jsonb_build_object('ok', true, 'purged', 0, 'message', 'ยังไม่มีเรื่องที่ถึงกำหนดลบ');
  END IF;

  RETURN jsonb_build_object('ok', true)
    || public.purge_expired_complaint_contacts(p_retention, false, v_scope);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_due_complaint_contacts(int, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_due_complaint_contacts(int, interval) TO authenticated;

COMMENT ON FUNCTION public.purge_due_complaint_contacts(int, interval) IS
  'ปุ่มลบข้อมูลติดต่อที่ครบกำหนดสำหรับแอดมิน: admin ลบเฉพาะ อปท. ตัวเอง, superadmin ทุกแห่ง, ต้องส่งจำนวนที่เห็นบนหน้าจอมาให้ตรงกับความจริง มิฉะนั้นปฏิเสธทั้งรายการ และบันทึกผู้สั่งลบใน audit_logs';
