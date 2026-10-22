-- ลงนามออนไลน์รายเรื่อง — ชุด B1.5 (2/2): ถอดประกาศ/หนังสือให้ความเห็นชอบออกจากเงื่อนไขเปิดใช้
-- ต้องรัน 20261022110000_esign_policy_optional.sql ก่อน (ปลด NOT NULL ของคอลัมน์ประกาศ)
--
-- ยกฟังก์ชันเดิมมาเต็มทุกบรรทัด 3 ตัว (ตรวจแล้วว่าตรงกับ pg_get_functiondef บนฐานจริงก่อนแก้ — docs/ai/NOTES.md ข้อ 5):
--   set_esign_policy    · ทุกช่องกรอกหรือไม่ก็ได้ กรอกแล้วต้องถูกรูปแบบ (เดิมบังคับ 3 ช่อง)
--   esign_confirm_trial · สร้างแถวให้เองถ้ายังไม่มี (เดิมต้องบันทึกประกาศก่อน ไม่งั้น gate_policy_missing)
--   set_esign_doc_type  · ตัดเงื่อนไข gate_policy_missing ออก ที่เหลือเหมือนเดิมทุกบรรทัด
-- signature ไม่เปลี่ยน → สิทธิ์ EXECUTE เดิมคงอยู่ (CREATE OR REPLACE ไม่แตะ GRANT)

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'esign_tenant_policy'
       AND column_name = 'approval_ref' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261022110000_esign_policy_optional.sql ก่อน';
  END IF;
END;
$guard$;

-- ประกาศของ อปท. + หนังสือให้ความเห็นชอบ ตาม พ.ร.ฎ.ธุรกรรมอิเล็กทรอนิกส์ภาครัฐ ๒๕๔๙ มาตรา ๗ — บันทึกเมื่อมี ไม่บังคับ
-- ส่งทุกช่องว่าง = ล้างข้อมูลประกาศที่เคยบันทึก (คงคำยืนยันทดลองไว้)
CREATE OR REPLACE FUNCTION public.set_esign_policy(
  p_municipality_id   uuid,
  p_announcement_no   text,
  p_announcement_date date,
  p_approval_ref      text,
  p_announcement_url  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_no   text := NULLIF(btrim(COALESCE(p_announcement_no, '')), '');
  v_ref  text := NULLIF(btrim(COALESCE(p_approval_ref, '')), '');
  v_url  text := NULLIF(btrim(COALESCE(p_announcement_url, '')), '');
  v_today date := (timezone('Asia/Bangkok', now()))::date;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_no IS NOT NULL AND char_length(v_no) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_announcement_no');
  END IF;
  IF p_announcement_date IS NOT NULL AND p_announcement_date > v_today THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_announcement_date');
  END IF;
  IF v_ref IS NOT NULL AND (char_length(v_ref) < 3 OR char_length(v_ref) > 500) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_approval_ref');
  END IF;
  IF v_url IS NOT NULL AND (char_length(v_url) > 1000 OR v_url !~* '^https?://') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_announcement_url');
  END IF;

  INSERT INTO public.esign_tenant_policy AS t
    (municipality_id, announcement_no, announcement_date, approval_ref, announcement_url, adopted_by)
  VALUES (p_municipality_id, v_no, p_announcement_date, v_ref, v_url, auth.uid())
  ON CONFLICT (municipality_id) DO UPDATE
    SET announcement_no = EXCLUDED.announcement_no,
        announcement_date = EXCLUDED.announcement_date,
        approval_ref = EXCLUDED.approval_ref,
        announcement_url = EXCLUDED.announcement_url,
        adopted_by = EXCLUDED.adopted_by,
        updated_at = now();

  PERFORM public.esign_audit(p_municipality_id, 'esign_set_policy', 'esign_policy', p_municipality_id::text, v_no,
    jsonb_build_object('announcement_date', p_announcement_date, 'approval_ref', v_ref));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- G4: แอดมินยืนยันว่าผู้ลงนามได้ลองใช้ชุดทดสอบแล้ว — เก็บเฉพาะคำยืนยัน; ไม่ต้องบันทึกประกาศก่อนแล้ว จึงสร้างแถวให้เอง
CREATE OR REPLACE FUNCTION public.esign_confirm_trial(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  INSERT INTO public.esign_tenant_policy AS t (municipality_id, trial_confirmed_at, adopted_by)
  VALUES (p_municipality_id, now(), auth.uid())
  ON CONFLICT (municipality_id) DO UPDATE
    SET trial_confirmed_at = now(), updated_at = now();
  PERFORM public.esign_audit(p_municipality_id, 'esign_confirm_trial', 'esign_policy', p_municipality_id::text, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_esign_doc_type(
  p_municipality_id uuid,
  p_doc_type        text,
  p_slot_modes      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_slots   text[] := ARRAY['requester', 'dept_head', 'authority', 'sk1'];
  v_key     text;
  v_val     text;
  v_modes   jsonb := '{}'::jsonb;
  v_any     boolean := false;
  v_policy  public.esign_tenant_policy%ROWTYPE;
  v_old     jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_municipality_id IS NULL OR NOT public.esign_is_tenant_admin(p_municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF p_doc_type IS DISTINCT FROM 'fleet_trip_request' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unknown_doc_type');
  END IF;

  SELECT s.slot_modes INTO v_old
  FROM public.esign_doc_type_settings s
  WHERE s.municipality_id = p_municipality_id AND s.doc_type = p_doc_type;

  IF p_slot_modes IS NOT NULL THEN
    IF jsonb_typeof(p_slot_modes) <> 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_slot_modes');
    END IF;
    FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each_text(p_slot_modes) e LOOP
      IF NOT (v_key = ANY (v_slots)) OR v_val NOT IN ('online', 'wet') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_slot_modes');
      END IF;
    END LOOP;
    -- ครบทุกช่องเสมอ ช่องที่ไม่ระบุ = เซ็นสด
    FOREACH v_key IN ARRAY v_slots LOOP
      v_val := COALESCE(p_slot_modes ->> v_key, 'wet');
      v_modes := v_modes || jsonb_build_object(v_key, v_val);
      IF v_val = 'online' THEN v_any := true; END IF;
    END LOOP;
  END IF;

  IF NOT v_any THEN
    DELETE FROM public.esign_doc_type_settings
     WHERE municipality_id = p_municipality_id AND doc_type = p_doc_type;
    PERFORM public.esign_audit(p_municipality_id, 'esign_disable', 'esign_doc_type', p_doc_type, NULL,
      jsonb_build_object('previous', v_old));
    RETURN jsonb_build_object('ok', true, 'enabled', false);
  END IF;

  -- ประตู: G4 ทดลองแล้ว · G2 ผู้ลงนามของช่องที่เลือกออนไลน์ต้องผูกบัญชีจริง
  -- (G1 ประกาศ/หนังสือให้ความเห็นชอบ ไม่เป็นเงื่อนไขแล้ว — เจ้าของระบบสั่ง 2026-10-22 · ไม่มีแถว = ยังไม่ยืนยันทดลอง)
  SELECT * INTO v_policy FROM public.esign_tenant_policy WHERE municipality_id = p_municipality_id;
  IF v_policy.trial_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_trial_missing');
  END IF;
  IF v_modes ->> 'authority' = 'online'
     AND public.esign_registry_linked_count(p_municipality_id, ARRAY['mayor', 'clerk', 'custom']) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_authority_unlinked');
  END IF;
  IF v_modes ->> 'dept_head' = 'online'
     AND public.esign_registry_linked_count(p_municipality_id, ARRAY['department_head']) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gate_dept_head_unlinked');
  END IF;

  INSERT INTO public.esign_doc_type_settings AS s (municipality_id, doc_type, slot_modes, enabled_by)
  VALUES (p_municipality_id, p_doc_type, v_modes, auth.uid())
  ON CONFLICT (municipality_id, doc_type) DO UPDATE
    SET slot_modes = EXCLUDED.slot_modes, enabled_by = EXCLUDED.enabled_by, updated_at = now();

  PERFORM public.esign_audit(p_municipality_id, 'esign_enable', 'esign_doc_type', p_doc_type, NULL,
    jsonb_build_object('previous', v_old, 'slot_modes', v_modes));
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'slot_modes', v_modes);
END;
$$;
