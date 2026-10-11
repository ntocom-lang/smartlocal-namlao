-- Manual dispatch: no travel-duration estimates or resource time reservations.
-- No booking, trip, schedule, document, or odometer data is rewritten.
BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.ptb_plan(uuid,uuid[],text)')) IS DISTINCT FROM '96f3b29ac921349ba7aa46d6bdd8f149' THEN RAISE EXCEPTION 'Function drift: ptb_plan'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_calendar(uuid,date,date)')) IS DISTINCT FROM 'beecbfd76a66c412359a9ab7c3d7fd43' THEN RAISE EXCEPTION 'Function drift: patient_booking_calendar'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; errors text[]:='{}'; ids uuid[]; date_local date;
 helper boolean:=false;
 back_at timestamptz; outbound jsonb:='[]'; returns jsonb:='[]';
 anchor timestamptz; last_time timestamptz; wave_n integer:=0; wave_seats integer:=0;
 max_seats integer:=0; wave_count integer:=0;
 mode text; multiwave boolean:=false; c public.patient_booking_community_rules;
 zone text; route_count integer:=1;
BEGIN
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 n:=cardinality(ids);
 IF n IS NULL OR n NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางไม่ถูกต้อง'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids))<>n THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้'; END IF;
 SELECT count(DISTINCT route_id) INTO route_count FROM public.patient_bookings WHERE id=ANY(ids);
 SELECT * INTO f FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LIMIT 1;
 date_local:=(f.appointment_at AT TIME ZONE 'Asia/Bangkok')::date;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND service_type<>f.service_type) THEN errors:=array_append(errors,'ห้ามรวมงานผู้ป่วยกับงานชุมชน'); END IF;
 IF f.service_type='community' THEN
  SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
  SELECT x INTO route FROM jsonb_array_elements(coalesce(c.places,'[]'::jsonb)) x WHERE x->>'id'=f.route_id;
  IF n<>1 THEN errors:=array_append(errors,'งานชุมชนไม่เปิดร่วมเที่ยว'); END IF;
  IF coalesce(btrim(p_helper),'')<>'' THEN errors:=array_append(errors,'งานชุมชนไม่ใช้ผู้ช่วยเคลื่อนย้าย'); END IF;
  IF route IS NULL OR f.route_id='__other__' THEN errors:=array_append(errors,'ยังไม่ตั้งสถานที่ชุมชน'); END IF;
  IF c.window_start IS NULL OR c.window_end IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งช่วงเวลาบริการชุมชน'); END IF;
 ELSE
  SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=f.route_id;
  IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ'); END IF;
  zone:=nullif(btrim(route->>'zone'),'');
 END IF;
 IF s.seats IS NULL OR s.wheelchairs IS NULL OR s.stretchers IS NULL THEN errors:=array_append(errors,'ยังไม่ยืนยันความจุรถ'); END IF;
 IF NOT s.enabled OR s.unavailable OR s.driver_id IS NULL THEN errors:=array_append(errors,'รถหรือคนขับยังไม่พร้อมให้บริการ'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active) THEN errors:=array_append(errors,'หน่วยงานเจ้าของรถปิดรับเรื่อง'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.driver_id AND municipality_id=p_muni AND role IN ('admin','officer','staff')) THEN errors:=array_append(errors,'บัญชีคนขับไม่ได้รับสิทธิ์เจ้าหน้าที่แล้ว'); END IF;
 IF date_local<(now() AT TIME ZONE 'Asia/Bangkok')::date THEN errors:=array_append(errors,'วันเดินทางผ่านแล้ว'); END IF;
 SELECT max(return_at) INTO back_at FROM public.patient_bookings WHERE id=ANY(ids);
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) LOOP
  IF r.status NOT IN ('submitted','confirmed') THEN errors:=array_append(errors,'มีคำขอที่ปิดหรือยกเลิกแล้ว'); END IF;
  IF NOT r.in_area THEN errors:=array_append(errors,'ต้องตรวจสอบพื้นที่รับบริการ'); END IF;
  -- ปลายทางต่างกันได้เฉพาะงานผู้ป่วย และทั้งสองปลายทางต้องอยู่ "กลุ่มปลายทาง" เดียวกันที่ผู้ดูแลตั้งไว้
  IF (r.route_id<>f.route_id AND (f.service_type='community' OR zone IS NULL OR zone IS DISTINCT FROM
    (SELECT nullif(btrim(x->>'zone'),'') FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=r.route_id)))
   OR (r.appointment_at AT TIME ZONE 'Asia/Bangkok')::date<>date_local THEN errors:=array_append(errors,'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน'); END IF;
  IF n>1 AND (NOT r.share OR r.mobility<>'walk') THEN errors:=array_append(errors,'ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว'); END IF;
  IF r.return_mode<>'one_way' AND r.return_at IS NULL THEN errors:=array_append(errors,'ยังไม่มีเวลาขากลับ'); END IF;
  IF r.return_at<r.appointment_at THEN errors:=array_append(errors,'เวลารับกลับอยู่ก่อนเวลานัด'); END IF;
  IF r.service_type='community' THEN
   IF r.appointment_at < (date_local::timestamp+make_interval(mins=>c.window_start)) AT TIME ZONE 'Asia/Bangkok'
    OR r.appointment_at > (date_local::timestamp+make_interval(mins=>c.window_end)) AT TIME ZONE 'Asia/Bangkok' THEN
    errors:=array_append(errors,'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน');
   END IF;
  ELSIF r.appointment_at < (date_local::timestamp+make_interval(mins=>s.office_start)) AT TIME ZONE 'Asia/Bangkok'
   OR r.appointment_at > (date_local::timestamp+make_interval(mins=>s.office_end)) AT TIME ZONE 'Asia/Bangkok' THEN
   errors:=array_append(errors,'เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง');
  END IF;
  IF r.mobility<>'walk' THEN helper:=true; END IF;
  IF r.mobility='wheelchair' AND coalesce(s.wheelchairs,0)<1 THEN errors:=array_append(errors,'ยังไม่ยืนยันที่ยึดรถเข็น'); END IF;
  IF r.mobility='stretcher' AND coalesce(s.stretchers,0)<1 THEN errors:=array_append(errors,'ยังไม่ยืนยันที่ยึดเปล'); END IF;
 END LOOP;
 IF helper THEN
  IF coalesce(btrim(p_helper),'')='' THEN errors:=array_append(errors,'ต้องยืนยันผู้ช่วยเคลื่อนย้ายประจำเที่ยว'); END IF;
 END IF;

 -- Cluster appointment times within 30 minutes of the FIRST appointment in each run.
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LOOP
  IF anchor IS NOT NULL AND r.appointment_at-anchor>interval '30 minutes' THEN

   outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',NULL,'end_at',NULL,'passengers',wave_n));

   max_seats:=greatest(max_seats,wave_seats);
   anchor:=NULL; wave_n:=0; wave_seats:=0;
  END IF;
  IF anchor IS NULL THEN anchor:=r.appointment_at; wave_count:=wave_count+1; END IF;
  last_time:=r.appointment_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
  wave_seats:=wave_seats+public.ptb_seats(r);

 END LOOP;

 outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',NULL,'end_at',NULL,'passengers',wave_n));

 max_seats:=greatest(max_seats,wave_seats);
 multiwave:=wave_count>1;
 mode:=CASE WHEN multiwave AND f.return_mode<>'one_way' THEN 'later' ELSE f.return_mode END;
 IF multiwave AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode='one_way')
  AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode<>'one_way') THEN
  errors:=array_append(errors,'รูปแบบขากลับของผู้ร่วมเที่ยวไม่ตรงกัน');
 ELSIF NOT multiwave AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode<>f.return_mode) THEN
  errors:=array_append(errors,'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน');
 END IF;
 IF multiwave AND NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND status='confirmed') THEN
  errors:=array_append(errors,'ต้องจัดรอบรับหลายรอบผ่านเที่ยวที่ยืนยันแล้ว');
 END IF;

 -- Return runs may be separate, or a single run when hospital return times are close.
 anchor:=NULL; wave_n:=0; wave_seats:=0;
 IF mode<>'one_way' THEN
  FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) AND return_at IS NOT NULL ORDER BY return_at,id LOOP
   IF anchor IS NOT NULL AND r.return_at-anchor>interval '30 minutes' THEN

    returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',NULL,'end_at',NULL,'passengers',wave_n));

    max_seats:=greatest(max_seats,wave_seats);
    anchor:=NULL; wave_n:=0; wave_seats:=0;
   END IF;
   IF anchor IS NULL THEN anchor:=r.return_at; END IF;
   last_time:=r.return_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
   wave_seats:=wave_seats+public.ptb_seats(r);

  END LOOP;
  IF anchor IS NOT NULL THEN

   returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',NULL,'end_at',NULL,'passengers',wave_n));

   max_seats:=greatest(max_seats,wave_seats);
  END IF;
 END IF;
 IF helper THEN max_seats:=max_seats+1; END IF;
 IF max_seats>s.seats THEN errors:=array_append(errors,'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'); END IF;
 -- The coordinator arranges vehicle timing. No calculated overlap blocks confirmations.
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t WHERE t.municipality_id=p_muni AND t.state='issue'
  AND (t.plan->>'date')::date=date_local AND NOT(t.booking_ids&&ids)) THEN
  errors:=array_append(errors,'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน');
 END IF;
 RETURN jsonb_build_object('service_type',f.service_type,'community_rules_version',CASE WHEN f.service_type='community' THEN c.rules_version ELSE NULL END,'booking_ids',ids,'date',date_local,'route_label',CASE WHEN route_count>1 THEN (SELECT string_agg(l,' + ' ORDER BY a,k) FROM (SELECT route_id k,min(route_label) l,min(appointment_at) a
    FROM public.patient_bookings WHERE id=ANY(ids) GROUP BY route_id) q) ELSE f.route_label END,'route_id',f.route_id,
  'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(ids)),
  'scheduling_mode','manual','appointment_at',f.appointment_at,'return_mode',mode,'pickup_at',NULL,'return_at',back_at,'blocks','[]'::jsonb,'seats',max_seats,'helper_required',helper,
  'outbound_waves',outbound,'return_waves',returns,'multiwave',multiwave,
  'settings_revision',s.revision,'errors',(SELECT coalesce(jsonb_agg(DISTINCT x),'[]') FROM unnest(errors) x));
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_calendar(p_muni uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.patient_booking_settings; partner_active boolean; d date; t public.patient_booking_trips;
 days jsonb:='[]'; trips jsonb; free jsonb; cursor_at timestamptz; close_at timestamptz;
 day_status text; pending_count bigint; people integer; occupied_seats integer; shared boolean; joinable boolean; ready boolean;
 community_free jsonb; c public.patient_booking_community_rules;
 today date:=(now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>61 OR p_from<today-31 OR p_to>(today + interval '12 months')::date THEN RAISE EXCEPTION 'เลือกช่วงวันไม่เกิน 62 วัน และล่วงหน้าไม่เกิน 12 เดือน'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 SELECT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active) INTO partner_active;
 IF s.enabled IS DISTINCT FROM true OR NOT partner_active THEN RETURN jsonb_build_object('days','[]'::jsonb,'enabled',false); END IF;
 ready:=NOT s.unavailable AND s.seats IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles WHERE id=s.driver_id AND municipality_id=p_muni AND role IN ('admin','officer','staff'));
 FOR d IN SELECT x::date FROM generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') x LOOP
  day_status:=CASE WHEN d<today THEN 'past' WHEN NOT ready THEN 'unavailable'
   WHEN EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state='issue' AND (plan->>'date')=d::text) THEN 'issue'
   ELSE 'open' END;
  SELECT count(*) INTO pending_count FROM public.patient_bookings b
   WHERE b.municipality_id=p_muni AND b.status='submitted'
    AND b.appointment_at >= (d::timestamp AT TIME ZONE 'Asia/Bangkok')
    AND b.appointment_at < ((d+1)::timestamp AT TIME ZONE 'Asia/Bangkok');
  trips:='[]'; free:='[]'; community_free:='[]';
  FOR t IN SELECT * FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state<>'cancelled' AND (plan->>'date')=d::text ORDER BY coalesce((plan->>'appointment_at')::timestamptz,(SELECT min(appointment_at) FROM public.patient_bookings WHERE trip_id=patient_booking_trips.id)),id LOOP
   SELECT coalesce(sum(CASE WHEN service_type='community' THEN party_size ELSE 1+companions END),0),coalesce(sum(public.ptb_seats(patient_bookings)),0),coalesce(bool_and(service_type='patient' AND share AND mobility='walk'),false)
    INTO people,occupied_seats,shared FROM public.patient_bookings WHERE trip_id=t.id AND status IN ('confirmed','completed');
   joinable:=shared AND coalesce((t.plan->>'multiwave')::boolean,false)=false AND day_status='open' AND t.state='confirmed' AND t.driver_id=s.driver_id AND occupied_seats<s.seats
    AND NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND (cancel_requested OR passenger_step<>0));
   trips:=trips||jsonb_build_array(jsonb_build_object('id',t.id,'date',d,'pickup_at',NULL,'return_at',CASE WHEN shared THEN t.plan->'return_at' ELSE NULL END,
    'outbound_waves',CASE WHEN shared THEN t.plan->'outbound_waves' ELSE NULL END,
    'return_waves',CASE WHEN shared THEN t.plan->'return_waves' ELSE NULL END,
    'state',CASE WHEN shared THEN t.state ELSE NULL END,
    'public_notice',CASE WHEN shared THEN t.public_notice ELSE NULL END,
    'schedule_revision',t.schedule_revision,'estimated_pickup_at',CASE WHEN shared AND t.schedule_revision>1 THEN t.estimated_pickup_at ELSE NULL END,
    'estimated_return_at',CASE WHEN shared THEN t.estimated_return_at ELSE NULL END,
    'appointment_at',CASE WHEN shared THEN (SELECT min(appointment_at) FROM public.patient_bookings WHERE trip_id=t.id AND status IN ('confirmed','completed')) ELSE NULL END,'blocks','[]'::jsonb,'route_id',CASE WHEN shared THEN t.plan->>'route_id' ELSE NULL END,
    'route_label',CASE WHEN shared THEN t.plan->>'route_label' ELSE 'รถติดภารกิจ ไม่เปิดร่วมเที่ยว' END,
    'return_mode',CASE WHEN shared THEN t.plan->>'return_mode' ELSE NULL END,'people',CASE WHEN shared THEN people ELSE NULL END,
    'remaining',CASE WHEN shared THEN greatest(s.seats-occupied_seats,0) ELSE NULL END,'joinable',joinable,
    'status',CASE WHEN t.state='completed' THEN 'completed' WHEN t.state='issue' THEN 'issue' WHEN joinable THEN 'joinable' WHEN shared AND occupied_seats>=s.seats THEN 'full' ELSE 'busy' END));
  END LOOP;
  IF day_status='open' THEN
   cursor_at:=(d::timestamp+make_interval(mins=>s.office_start)) AT TIME ZONE 'Asia/Bangkok';
   close_at:=(d::timestamp+make_interval(mins=>s.office_end)) AT TIME ZONE 'Asia/Bangkok';
   cursor_at:=greatest(cursor_at,now());
   IF cursor_at<close_at THEN free:=free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',close_at)); END IF;
  END IF;
  -- Closing new intake does not hide already accepted community trips or change their plans.
  IF day_status='open' AND c.window_start IS NOT NULL AND c.window_end IS NOT NULL THEN
   cursor_at:=(d::timestamp+make_interval(mins=>c.window_start)) AT TIME ZONE 'Asia/Bangkok';
   close_at:=(d::timestamp+make_interval(mins=>c.window_end)) AT TIME ZONE 'Asia/Bangkok';
   cursor_at:=greatest(cursor_at,now());
   IF cursor_at<close_at THEN community_free:=community_free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',close_at)); END IF;
  END IF;
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'status',day_status,'pending_count',pending_count,'trips',trips,'free',free,'community_free',community_free));
 END LOOP;
 RETURN jsonb_build_object('enabled',true,'scheduling_mode','manual','days',days,'as_of',now());
END $function$;

NOTIFY pgrst,'reload schema';
COMMIT;
