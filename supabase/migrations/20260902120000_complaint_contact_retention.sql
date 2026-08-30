-- 20260902120000_complaint_contact_retention.sql
--
-- [ทำไมต้องมี] 20260902100000 + หน้าฟอร์ม/PDPA modal ประกาศกับประชาชนไปแล้วว่า
-- "ข้อมูลติดต่อ (ชื่อ-นามสกุล เบอร์โทรศัพท์) เก็บไว้ 5 ปีนับจากวันปิดเรื่อง" — คำประกาศที่ไม่มี
-- กลไกลบจริงรองรับคือความเสี่ยงโดยตรงเวลาถูกตรวจ (ประกาศไว้แต่ทำไม่ได้ = แย่กว่าไม่ประกาศ)
-- migration นี้คือกลไกที่ทำให้คำประกาศนั้นเป็นจริง
--
-- [สมมติฐานที่ต้องรู้ก่อนใช้] "วันปิดเรื่อง" ของแต่ละสายงานไม่เหมือนกัน:
--   - หมวดปกติ: complaints.closed_at (ตั้งค่าโดย ComplaintsManager ตอนแอดมินกดปิดเรื่อง)
--     แถวที่ status ปิดแล้วแต่ closed_at เป็น NULL (ข้อมูลเก่า) จะ "ไม่ถูกลบ" และถูกนับไว้ใน
--     ผลลัพธ์เป็น skipped_no_anchor — จงใจไม่เดาวันแทน ต้องให้คนตัดสินใจว่าจะ backfill ยังไง
--   - หมวดเฉพาะกิจ (is_adhoc เช่น odor): ไม่มีวันปิดเรื่องเลยตามดีไซน์ (ไม่เข้า status pipeline)
--     จึงใช้ acknowledged_at เป็นหมุดเวลาแทน และถ้าไม่เคยมีใครรับทราบเลยใช้ created_at
--     ถ้าไม่เห็นด้วยกับกติกานี้ ให้แก้ที่ CTE anchored ด้านล่างจุดเดียว
--
-- [ขอบเขตการลบ] ลบเฉพาะ reporter_name กับ phone ซึ่งเป็นสิ่งที่ประกาศไว้ ไม่แตะ detail/พิกัด/
-- หมวด/สถานะ เพราะตัวคำร้องเองเป็นเอกสารราชการที่มีระเบียบการเก็บของตัวเอง และสถิติเชิงพื้นที่
-- ต้องใช้ต่อ — ⚠️ ประเด็นค้าง: detail เป็น free-text ที่ประชาชนอาจพิมพ์ชื่อ/ที่อยู่/เบอร์ของตัวเอง
-- ลงไปเอง การลบแค่ 2 คอลัมน์นี้จึงยังไม่ใช่การลบข้อมูลส่วนบุคคลทั้งหมด ต้องยืนยันกับระเบียบ
-- งานสารบรรณฯ/นโยบายเก็บเอกสารของ อปท. ฉบับปัจจุบันก่อนว่าจะจัดการ detail อย่างไร

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS contact_purged_at timestamptz;

COMMENT ON COLUMN public.complaints.contact_purged_at IS
  'เวลาที่ข้อมูลติดต่อผู้แจ้ง (reporter_name, phone) ถูกลบตามระยะเวลาเก็บรักษา — NULL = ยังไม่ถึงกำหนดหรือยังไม่มีข้อมูลติดต่อ';

-- guard ของ 20260902110000 บล็อกการแก้ reporter_name/phone ของคำร้องเฉพาะกิจโดยผู้ที่ไม่ใช่ admin
-- ซึ่งรวมถึง cron job ที่รันโดยไม่มี auth.uid() ด้วย — เปิดช่องเฉพาะทรานแซกชันที่ตั้งธง
-- app.retention_purge เท่านั้น (แพทเทิร์นเดียวกับ app.odor_ack / app.rating_write)
CREATE OR REPLACE FUNCTION public.guard_adhoc_complaint_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  IF NOT public.complaint_category_is_adhoc(OLD.municipality_id, OLD.category) THEN
    RETURN NEW;
  END IF;

  -- งานลบข้อมูลติดต่อตามระยะเวลาเก็บรักษา (purge_expired_complaint_contacts)
  IF coalesce(current_setting('app.retention_purge', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  v_role := public.get_my_role();

  IF v_role IN ('admin', 'superadmin') THEN
    RETURN NEW;
  END IF;

  IF NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
    OR NEW.category      IS DISTINCT FROM OLD.category
    OR NEW.category_id   IS DISTINCT FROM OLD.category_id
    OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR NEW.user_id       IS DISTINCT FROM OLD.user_id
    OR NEW.reporter_name IS DISTINCT FROM OLD.reporter_name
    OR NEW.phone         IS DISTINCT FROM OLD.phone
    OR NEW.latitude      IS DISTINCT FROM OLD.latitude
    OR NEW.longitude     IS DISTINCT FROM OLD.longitude
    OR NEW.subject       IS DISTINCT FROM OLD.subject
    OR NEW.detail        IS DISTINCT FROM OLD.detail
    OR NEW.status        IS DISTINCT FROM OLD.status
    OR NEW.assigned_to   IS DISTINCT FROM OLD.assigned_to
    OR NEW.ref_no        IS DISTINCT FROM OLD.ref_no
  THEN
    RAISE EXCEPTION 'คำร้องหมวดเฉพาะกิจแก้ไขข้อมูลหลักผ่าน API โดยตรงไม่ได้ (ต้องเป็นผู้ดูแลระบบ)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.extra_data IS DISTINCT FROM OLD.extra_data
    AND coalesce(current_setting('app.odor_ack', true), '') <> '1'
  THEN
    RAISE EXCEPTION 'การรับทราบคำร้องเฉพาะกิจต้องทำผ่าน acknowledge_odor_complaint() เท่านั้น'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- หมุดเวลาที่ใช้ตัดสินว่าเรื่องนี้ครบกำหนดหรือยัง — แยกเป็นฟังก์ชันของตัวเองเพื่อให้กติกา
-- อยู่ที่เดียว (ทั้ง dry-run, การลบจริง และการตรวจสอบภายหลังใช้นิยามเดียวกันเสมอ)
-- คืน NULL = ยังตัดสินไม่ได้ (เรื่องยังไม่ปิด หรือปิดแล้วแต่ไม่มี closed_at) → ไม่ลบ
CREATE OR REPLACE FUNCTION public.complaint_contact_retention_anchor(c public.complaints)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN public.complaint_category_is_adhoc(c.municipality_id, c.category)
      THEN coalesce((c.extra_data ->> 'acknowledged_at')::timestamptz, c.created_at)
    WHEN c.status IN ('closed', 'done', 'completed', 'rejected')
      THEN c.closed_at
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public.complaint_contact_retention_anchor(public.complaints)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_expired_complaint_contacts(
  p_retention interval DEFAULT '5 years',
  p_dry_run   boolean  DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff timestamptz := now() - p_retention;
  v_purged int := 0;
  v_holding int := 0;
  v_skipped int := 0;
BEGIN
  -- แถวที่ปิดเรื่องแล้วแต่ไม่มี closed_at = ตัดสินไม่ได้ ต้องรายงานให้คนเห็น ไม่ใช่เงียบ
  SELECT count(*) INTO v_skipped
  FROM public.complaints c
  WHERE c.contact_purged_at IS NULL
    AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
    AND public.complaint_contact_retention_anchor(c) IS NULL
    AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
    AND c.status IN ('closed', 'done', 'completed', 'rejected');

  SELECT count(*) INTO v_holding
  FROM public.complaints c
  WHERE c.contact_purged_at IS NULL
    AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL);

  IF p_dry_run THEN
    SELECT count(*) INTO v_purged
    FROM public.complaints c
    WHERE c.contact_purged_at IS NULL
      AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
      AND public.complaint_contact_retention_anchor(c) < v_cutoff;

    RETURN jsonb_build_object(
      'dry_run', true, 'cutoff', to_jsonb(v_cutoff),
      'would_purge', v_purged, 'skipped_no_anchor', v_skipped, 'holding_contacts', v_holding
    );
  END IF;

  PERFORM set_config('app.retention_purge', '1', true);

  -- CTE ที่แก้ข้อมูลทั้งสองก้อนทำงานบน snapshot เดียวกันและถูกรันเสมอ (ไม่ขึ้นกับว่า query หลัก
  -- อ่านผลของมันไหม) — audit จึงตรงกับแถวที่ถูกลบจริงเป๊ะ ไม่มีช่องให้คลาดกันระหว่าง 2 คำสั่ง
  WITH targets AS (
    SELECT c.id, c.municipality_id
    FROM public.complaints c
    WHERE c.contact_purged_at IS NULL
      AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
      AND public.complaint_contact_retention_anchor(c) < v_cutoff
  ), logged AS (
    INSERT INTO public.audit_logs (
      municipality_id, actor_id, actor_name, actor_role, action,
      resource_type, resource_id, resource_label, metadata
    )
    SELECT t.municipality_id, NULL, 'ระบบ (งานลบข้อมูลตามระยะเวลาเก็บรักษา)', 'system',
           'purge_contact_pii', 'complaint', NULL,
           'ลบข้อมูลติดต่อผู้แจ้งที่ครบกำหนดเก็บรักษา',
           jsonb_build_object(
             'retention', p_retention::text,
             'cutoff', to_jsonb(v_cutoff),
             'complaints', count(*),
             'fields', jsonb_build_array('reporter_name', 'phone')
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

-- ฟังก์ชันนี้ลบข้อมูลจริง จึงไม่เปิดให้ role ไหนเรียกผ่าน API ได้เลย — เรียกได้จาก cron
-- (รันด้วยสิทธิ์เจ้าของฟังก์ชัน) หรือจาก SQL editor ของผู้ดูแลฐานข้อมูลเท่านั้น
REVOKE ALL ON FUNCTION public.purge_expired_complaint_contacts(interval, boolean)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.purge_expired_complaint_contacts(interval, boolean) IS
  'ลบชื่อ-นามสกุลและเบอร์โทรของผู้แจ้งเมื่อพ้นระยะเวลาเก็บรักษา (ดีฟอลต์ 5 ปีนับจากวันปิดเรื่อง; หมวดเฉพาะกิจนับจากวันรับทราบ หรือวันที่แจ้งถ้าไม่เคยรับทราบ) — p_dry_run=true เพื่อดูจำนวนก่อนลบจริง';

-- pg_cron เปิดใช้อยู่แล้วในโปรเจกต์นี้ (20260819120000_fleet_doc_expiry_cron.sql)
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('complaint-contact-retention-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'complaint-contact-retention-daily');

-- 18:30 UTC = 01:30 น. เวลาไทย (นอกเวลาทำการ ไม่ชนกับ fleet-doc-expiry-daily ที่ 01:00 UTC)
SELECT cron.schedule(
  'complaint-contact-retention-daily',
  '30 18 * * *',
  $$ SELECT public.purge_expired_complaint_contacts(); $$
);

-- ตรวจก่อนปล่อยจริง (ไม่ลบอะไรเลย):
--   SELECT public.purge_expired_complaint_contacts('5 years', true);
--   → ดู would_purge / skipped_no_anchor ว่าตรงกับที่คาดไหมก่อนรอบ cron แรก
-- ปิดงานชั่วคราว: SELECT cron.unschedule('complaint-contact-retention-daily');
