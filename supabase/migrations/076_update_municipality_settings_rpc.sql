CREATE OR REPLACE FUNCTION public.update_municipality_settings(
  p_municipality_id uuid,
  p_system_name      text,
  p_system_subtitle  text,
  p_pwa_short_name   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            text;
  v_municipality_id uuid;
  v_uid             uuid;
BEGIN
  v_uid := auth.uid();

  SELECT role, municipality_id
    INTO v_role, v_municipality_id
    FROM public.profiles
   WHERE id = v_uid;

  -- superadmin ที่ไม่ผูก municipality (system-level) อนุญาตให้แก้ได้ทุก municipality
  IF v_role NOT IN ('admin', 'superadmin', 'officer') THEN
    RAISE EXCEPTION 'Permission denied: uid=%, role=%', v_uid, COALESCE(v_role,'NULL');
  END IF;

  IF v_role != 'superadmin' AND v_municipality_id IS DISTINCT FROM p_municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch uid=%, muni=%', v_uid, v_municipality_id;
  END IF;

  UPDATE public.municipalities
     SET system_name     = p_system_name,
         system_subtitle = p_system_subtitle,
         pwa_short_name  = p_pwa_short_name
   WHERE id = p_municipality_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_municipality_settings TO authenticated;
