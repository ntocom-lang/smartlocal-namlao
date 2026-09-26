-- Count only actionable transport work. No patient or route data leaves this RPC.
CREATE FUNCTION public.patient_booking_staff_work_badge(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text;
  v_pending integer := 0;
  v_driver integer := 0;
BEGIN
  IF p_muni IS NULL OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('pending', 0, 'driver', 0, 'total', 0);
  END IF;

  v_role := public.ptb_role(p_muni);
  IF v_role IN ('admin', 'coordinator') THEN
    SELECT count(*) INTO v_pending
    FROM public.patient_bookings
    WHERE municipality_id = p_muni
      AND (status = 'submitted' OR (status = 'confirmed' AND cancel_requested));
  END IF;

  -- A coordinator may also be the assigned driver. ptb_role returns coordinator
  -- first, so check the driver assignment separately instead of using v_role.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND municipality_id = p_muni
      AND role IN ('admin', 'officer', 'staff')
  ) THEN
    SELECT count(*) INTO v_driver
    FROM public.patient_booking_trips
    WHERE municipality_id = p_muni AND driver_id = auth.uid()
      AND state NOT IN ('completed', 'cancelled');
  END IF;

  RETURN jsonb_build_object('pending', v_pending, 'driver', v_driver, 'total', v_pending + v_driver);
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_staff_work_badge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_staff_work_badge(uuid) TO authenticated;
