BEGIN;

-- History is staff-only; page at the database so records older than the workspace's latest 50 remain accessible.
CREATE FUNCTION public.patient_booking_events_page(p_muni uuid, p_page integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE total_count bigint; page_events jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin', 'coordinator') THEN
  RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเท่านั้น';
 END IF;
 IF p_page IS NULL OR p_page < 1 OR p_page > 100000 THEN
  RAISE EXCEPTION 'เลขหน้าไม่ถูกต้อง';
 END IF;
 SELECT count(*) INTO total_count FROM public.patient_booking_events WHERE municipality_id = p_muni;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC, e.id DESC), '[]'::jsonb)
 INTO page_events FROM (
  SELECT id, entity_id, action, detail, created_at
  FROM public.patient_booking_events
  WHERE municipality_id = p_muni
  ORDER BY created_at DESC, id DESC
  LIMIT 20 OFFSET (p_page::bigint - 1) * 20
 ) e;
 RETURN jsonb_build_object('total', total_count, 'page', p_page, 'page_size', 20, 'events', page_events);
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_events_page(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_events_page(uuid, integer) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
