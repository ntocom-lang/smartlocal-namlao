-- Community transport backend. Full latest definitions; no production writes or flag changes.
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.patient_booking_month_report(uuid,date)','3c072b55a5e5c812aaad891522c141ee',
 'public.patient_booking_period_report(uuid,date,date)','597f97ee1ddc12319cd732120c49967c'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.patient_booking_month_report(p_muni uuid,p_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE first_day date:=date_trunc('month',coalesce(p_month,current_date))::date; rows jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเรียกดูสรุปได้'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'date',x->>'pickup_at'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('trip_id',t.id,'date',t.plan->>'date','pickup_at',t.plan->>'pickup_at','route_label',t.plan->>'route_label',
   'state',t.state,'helper_name',t.helper_name,
   'passengers',(SELECT count(*) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.service_type='patient' AND b.status IN ('confirmed','completed')),
   'companions',(SELECT coalesce(sum(b.companions),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.service_type='patient' AND b.status IN ('confirmed','completed')),
   'odometer_start',t.odometer_start,'odometer_end',t.odometer_end,
   'odometer_issue',t.odometer_issue,'distance',CASE WHEN NOT t.odometer_issue AND t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),
   'letter_no',coalesce((SELECT string_agg(b.forward_letter_no,', ' ORDER BY b.appointment_at,b.id) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.service_type='patient' AND b.status IN ('confirmed','completed') AND b.forward_letter_no IS NOT NULL),t.forward_letter_no),
   'letter_date',coalesce((SELECT min(b.forward_letter_date) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.service_type='patient' AND b.status IN ('confirmed','completed') AND b.forward_letter_date IS NOT NULL),t.forward_letter_date)) x
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND coalesce(t.plan->>'service_type','patient')='patient'
   AND (t.plan->>'date')::date>=first_day AND (t.plan->>'date')::date<(first_day+interval '1 month')::date
 ) q;
 RETURN jsonb_build_object('month',first_day,'trips',rows);
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_period_report(p_muni uuid,p_from date,p_to date) RETURNS jsonb
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
   'passengers',(SELECT count(*) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.service_type='patient' AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'companions',(SELECT coalesce(sum(b.companions),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.service_type='patient' AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'odometer_start',t.odometer_start,'odometer_end',t.odometer_end,
   'odometer_issue',t.odometer_issue,'distance',CASE WHEN NOT t.odometer_issue AND t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),
   'letter_no',coalesce((SELECT string_agg(b.forward_letter_no,', ' ORDER BY b.appointment_at,b.id) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.service_type='patient' AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed') AND b.forward_letter_no IS NOT NULL),t.forward_letter_no),
   'letter_date',coalesce((SELECT min(b.forward_letter_date) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.service_type='patient' AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed') AND b.forward_letter_date IS NOT NULL),t.forward_letter_date)) x
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND coalesce(t.plan->>'service_type','patient')='patient'
   AND (t.plan->>'date')::date BETWEEN p_from AND p_to
 ) q;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'trips',rows);
END $$;

CREATE FUNCTION public.patient_booking_period_report_v2(p_muni uuid,p_from date,p_to date,p_service text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF coalesce(public.ptb_role(p_muni),'anonymous') NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเรียกดูสรุปได้'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from THEN RAISE EXCEPTION 'กรุณาระบุวันที่เริ่มและสิ้นสุด โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม'; END IF;
 IF p_to-p_from>3660 THEN RAISE EXCEPTION 'เลือกช่วงครั้งละไม่เกิน 10 ปี กรุณาแยกพิมพ์แต่ละช่วง'; END IF;
 IF p_service IS NOT NULL AND p_service NOT IN ('patient','community') THEN RAISE EXCEPTION 'ประเภทบริการไม่ถูกต้อง'; END IF;
 -- One result per trip: distance is never multiplied by member/request count.
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'date',x->>'pickup_at',x->>'trip_id'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('trip_id',t.id,'date',t.plan->>'date','pickup_at',t.plan->>'pickup_at',
   'route_label',t.plan->>'route_label','state',t.state,'service_type',coalesce(t.plan->>'service_type','patient'),
   'people',(SELECT coalesce(sum(CASE WHEN b.service_type='community' THEN b.party_size ELSE 1+b.companions END),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'request_count',(SELECT count(*) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'companions',(SELECT coalesce(sum(b.companions),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'odometer_start',t.odometer_start,'odometer_end',t.odometer_end,'odometer_issue',t.odometer_issue,
   'distance',CASE WHEN NOT t.odometer_issue AND t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id AND municipality_id=p_muni)) x
  FROM public.patient_booking_trips t WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND (t.plan->>'date')::date BETWEEN p_from AND p_to
   AND (p_service IS NULL OR coalesce(t.plan->>'service_type','patient')=p_service)
 ) q;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'service_type',p_service,'trips',rows);
END $$;
-- Both v2 entry points take explicit inclusive dates; the client chooses its month bounds.
CREATE FUNCTION public.patient_booking_month_report_v2(p_muni uuid,p_from date,p_to date,p_service text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(public.ptb_role(p_muni),'anonymous') NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเรียกดูสรุปได้'; END IF;
 RETURN public.patient_booking_period_report_v2(p_muni,p_from,p_to,p_service);
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_period_report_v2(uuid,date,date,text),public.patient_booking_month_report_v2(uuid,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_period_report_v2(uuid,date,date,text),public.patient_booking_month_report_v2(uuid,date,date,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
