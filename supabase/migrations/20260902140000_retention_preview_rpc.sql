-- 20260902140000_retention_preview_rpc.sql
--
-- purge_expired_complaint_contacts() (20260902120000) ถูก REVOKE จากทุก role ที่เรียกผ่าน API ได้
-- โดยตั้งใจ เพราะมันลบข้อมูลจริง — ผลข้างเคียงคือ "ตรวจก่อนว่าจะลบอะไรบ้าง" ก็ทำไม่ได้เช่นกัน
-- ถ้าไม่มีสิทธิ์เข้า SQL Editor ของฐานข้อมูล ซึ่งขัดกับหลักความรับผิดชอบต่อข้อมูล (PDPA):
-- ผู้ควบคุมข้อมูลต้องตรวจสอบได้เองว่าระบบกำลังจะลบอะไร เมื่อไหร่ และเหลือค้างเท่าไร
--
-- ฟังก์ชันนี้จึงเป็น "หน้าต่างอ่านอย่างเดียว" ของกติกาเดียวกัน:
--   - STABLE + ไม่มีคำสั่งเขียนใดๆ ในตัว เรียกกี่ครั้งก็ไม่ลบอะไร (ต่างจาก p_dry_run ของตัวจริง
--     ที่ยังเป็นฟังก์ชัน VOLATILE ตัวเดียวกับที่ลบได้ — พลาดส่ง false ครั้งเดียวคือลบจริง)
--   - admin/superadmin เท่านั้น และ admin เห็นเฉพาะ อปท. ของตัวเอง (superadmin เห็นทุกแห่ง)
--   - คืนแค่ "จำนวน" ไม่คืนแถวหรือข้อมูลผู้แจ้งรายบุคคลเลย
--   - ใช้ complaint_contact_retention_anchor() ตัวเดียวกับงานลบจริง ตัวเลขจึงตรงกันเสมอ
--     ถ้าแก้กติกาวันหลังก็แก้ที่ anchor จุดเดียว ไม่มีทางที่ preview กับของจริงจะเพี้ยนจากกัน

CREATE OR REPLACE FUNCTION public.complaint_contact_retention_preview(
  p_retention interval DEFAULT '5 years'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor    public.profiles%ROWTYPE;
  v_cutoff   timestamptz := now() - p_retention;
  v_purge    int := 0;
  v_skipped  int := 0;
  v_holding  int := 0;
  v_all      boolean;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();

  IF NOT FOUND OR coalesce(v_actor.role, '') NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'ดูข้อมูลระยะเวลาเก็บรักษาได้เฉพาะผู้ดูแลระบบ' USING ERRCODE = '42501';
  END IF;

  v_all := v_actor.role = 'superadmin';

  SELECT
    count(*) FILTER (
      WHERE public.complaint_contact_retention_anchor(c) < v_cutoff
    ),
    count(*) FILTER (
      WHERE public.complaint_contact_retention_anchor(c) IS NULL
        AND NOT public.complaint_category_is_adhoc(c.municipality_id, c.category)
        AND c.status IN ('closed', 'done', 'completed', 'rejected')
    ),
    count(*)
  INTO v_purge, v_skipped, v_holding
  FROM public.complaints c
  WHERE c.contact_purged_at IS NULL
    AND (c.reporter_name IS NOT NULL OR c.phone IS NOT NULL)
    AND (v_all OR c.municipality_id = v_actor.municipality_id);

  RETURN jsonb_build_object(
    'retention', p_retention::text,
    'cutoff', to_jsonb(v_cutoff),
    'scope', CASE WHEN v_all THEN 'all_municipalities' ELSE 'own_municipality' END,
    'due_for_purge', v_purge,
    'skipped_no_anchor', v_skipped,
    'holding_contacts', v_holding
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_contact_retention_preview(interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complaint_contact_retention_preview(interval) TO authenticated;

COMMENT ON FUNCTION public.complaint_contact_retention_preview(interval) IS
  'ดูจำนวนคำร้องที่ถึงกำหนดลบข้อมูลติดต่อตามระยะเวลาเก็บรักษา (อ่านอย่างเดียว ไม่ลบ) — admin เห็นเฉพาะ อปท. ตัวเอง, superadmin เห็นทุกแห่ง, ใช้กติกาเดียวกับ purge_expired_complaint_contacts()';
