-- SECURITY DEFINER function: insert timeline entry
-- bypass RLS บน org_project_updates — ตรวจสอบสิทธิ์ใน function body แทน
CREATE OR REPLACE FUNCTION public.insert_org_project_update(
  p_project_id      uuid,
  p_municipality_id uuid,
  p_update_type     text,
  p_title           text,
  p_body            text,
  p_update_date     date,
  p_photos          text[],
  p_note            text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_new_id  uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id
      AND municipality_id = p_municipality_id
      AND role IN ('admin','superadmin','officer','staff')
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์: ไม่ใช่เจ้าหน้าที่ขององค์กรนี้' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.org_project_updates (
    project_id, municipality_id, update_type,
    title, body, update_date, photos, note, created_by
  ) VALUES (
    p_project_id, p_municipality_id, p_update_type,
    p_title, p_body, p_update_date, p_photos, p_note, v_user_id
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_org_project_update(uuid, uuid, text, text, text, date, text[], text) TO authenticated;
