-- Read-only range report. Preserve the existing monthly RPC for older clients.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.patient_booking_month_report(uuid,date)') IS NULL THEN
  RAISE EXCEPTION 'ต้องติดตั้งระบบรายงานรายเดือนก่อน';
 END IF;
END $$;
CREATE FUNCTION public.patient_booking_period_report(p_muni uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF coalesce(public.ptb_role(p_muni),'anonymous') NOT IN ('admin','coordinator') THEN
  RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเรียกดูสรุปได้';
 END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from THEN
  RAISE EXCEPTION 'กรุณาระบุวันที่เริ่มและสิ้นสุด โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
 END IF;
 IF p_to-p_from>3660 THEN RAISE EXCEPTION 'เลือกช่วงครั้งละไม่เกิน 10 ปี กรุณาแยกพิมพ์แต่ละช่วง'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'date',x->>'pickup_at',x->>'trip_id'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('trip_id',t.id,'date',t.plan->>'date','pickup_at',t.plan->>'pickup_at','route_label',t.plan->>'route_label',
   'state',t.state,'helper_name',t.helper_name,
   'passengers',(SELECT count(*) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'companions',(SELECT coalesce(sum(b.companions),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'odometer_start',t.odometer_start,'odometer_end',t.odometer_end,
   'odometer_issue',t.odometer_issue,'distance',CASE WHEN NOT t.odometer_issue AND t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),
   'letter_no',t.forward_letter_no,'letter_date',t.forward_letter_date) x
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND (t.plan->>'date')::date BETWEEN p_from AND p_to
 ) q;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'trips',rows);
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_period_report(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_period_report(uuid,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
