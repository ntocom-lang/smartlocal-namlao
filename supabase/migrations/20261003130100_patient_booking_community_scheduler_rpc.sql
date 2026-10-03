-- Community transport backend. Full latest definitions; no production writes or flag changes.
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.ptb_plan(uuid,uuid[],text)','0d04dd4149ed38489935019d68237e89',
 'public.patient_booking_calendar(uuid,date,date)','d879ef9952ead77a317fc68621096200',
 'public.patient_booking_save_community_rules(uuid,integer,jsonb)','6c874e89514bd17f861730e7623ede94'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.patient_bookings'::regclass AND conname='patient_bookings_service_shape') THEN RAISE EXCEPTION 'Apply community constraints and retention first'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; travel integer; errors text[]:='{}'; ids uuid[]; date_local date;
 helper boolean:=false;
 back_at timestamptz; first_pickup timestamptz; start_at timestamptz; out_end timestamptz;
 end_at timestamptz; back_start timestamptz; blocks jsonb:='[]'; outbound jsonb:='[]'; returns jsonb:='[]';
 anchor timestamptz; last_time timestamptz; wave_n integer:=0; wave_seats integer:=0;
 max_seats integer:=0; wave_count integer:=0;
 mode text; multiwave boolean:=false; c public.patient_booking_community_rules;
BEGIN
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 n:=cardinality(ids);
 IF n IS NULL OR n NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางไม่ถูกต้อง'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids))<>n THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้'; END IF;
 SELECT * INTO f FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LIMIT 1;
 date_local:=(f.appointment_at AT TIME ZONE 'Asia/Bangkok')::date;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND service_type<>f.service_type) THEN errors:=array_append(errors,'ห้ามรวมงานผู้ป่วยกับงานชุมชน'); END IF;
 IF f.service_type='community' THEN
  SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
  SELECT x INTO route FROM jsonb_array_elements(coalesce(c.places,'[]'::jsonb)) x WHERE x->>'id'=f.route_id;
  IF n<>1 THEN errors:=array_append(errors,'งานชุมชนไม่เปิดร่วมเที่ยว'); END IF;
  IF coalesce(btrim(p_helper),'')<>'' THEN errors:=array_append(errors,'งานชุมชนไม่ใช้ผู้ช่วยเคลื่อนย้าย'); END IF;
  IF route IS NULL OR f.route_id='__other__' OR (route->>'minutes') IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งสถานที่ชุมชนและเวลาเดินทาง'); END IF;
  IF c.window_start IS NULL OR c.window_end IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งช่วงเวลาบริการชุมชน'); END IF;
 ELSE
  SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=f.route_id;
  IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ'); END IF;
 END IF;
 travel:=coalesce((route->>'minutes')::integer,0);
 IF s.seats IS NULL OR s.wheelchairs IS NULL OR s.stretchers IS NULL THEN errors:=array_append(errors,'ยังไม่ยืนยันความจุรถ'); END IF;
 IF NOT s.enabled OR s.unavailable OR s.driver_id IS NULL THEN errors:=array_append(errors,'รถหรือคนขับยังไม่พร้อมให้บริการ'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active) THEN errors:=array_append(errors,'หน่วยงานเจ้าของรถปิดรับเรื่อง'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.driver_id AND municipality_id=p_muni AND role IN ('admin','officer','staff')) THEN errors:=array_append(errors,'บัญชีคนขับไม่ได้รับสิทธิ์เจ้าหน้าที่แล้ว'); END IF;
 IF date_local<(now() AT TIME ZONE 'Asia/Bangkok')::date THEN errors:=array_append(errors,'วันเดินทางผ่านแล้ว'); END IF;
 SELECT max(return_at) INTO back_at FROM public.patient_bookings WHERE id=ANY(ids);
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) LOOP
  IF r.status NOT IN ('submitted','confirmed') THEN errors:=array_append(errors,'มีคำขอที่ปิดหรือยกเลิกแล้ว'); END IF;
  IF NOT r.in_area THEN errors:=array_append(errors,'ต้องตรวจสอบพื้นที่รับบริการ'); END IF;
  IF r.route_id<>f.route_id OR (r.appointment_at AT TIME ZONE 'Asia/Bangkok')::date<>date_local THEN errors:=array_append(errors,'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน'); END IF;
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
   start_at:=anchor-make_interval(mins=>travel+s.buffer_minutes+s.boarding_minutes*wave_n);
   out_end:=anchor+make_interval(mins=>s.boarding_minutes*CASE WHEN f.service_type='community' THEN f.party_size ELSE 1 END+travel);
   outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',start_at,'end_at',out_end,'passengers',wave_n));
   blocks:=blocks||jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end));
   IF first_pickup IS NULL THEN first_pickup:=start_at; END IF;
   max_seats:=greatest(max_seats,wave_seats);
   anchor:=NULL; wave_n:=0; wave_seats:=0;
  END IF;
  IF anchor IS NULL THEN anchor:=r.appointment_at; wave_count:=wave_count+1; END IF;
  last_time:=r.appointment_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
  wave_seats:=wave_seats+public.ptb_seats(r);
 END LOOP;
 start_at:=anchor-make_interval(mins=>travel+s.buffer_minutes+s.boarding_minutes*wave_n);
 out_end:=anchor+make_interval(mins=>s.boarding_minutes*CASE WHEN f.service_type='community' THEN f.party_size ELSE 1 END+travel);
 outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',start_at,'end_at',out_end,'passengers',wave_n));
 blocks:=blocks||jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end));
 IF first_pickup IS NULL THEN first_pickup:=start_at; END IF;
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
    back_start:=anchor-make_interval(mins=>travel+s.buffer_minutes);
    end_at:=last_time+make_interval(mins=>s.boarding_minutes*wave_n+travel+s.buffer_minutes);
    returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',back_start,'end_at',end_at,'passengers',wave_n));
    blocks:=blocks||jsonb_build_array(jsonb_build_object('start',back_start,'end',end_at));
    max_seats:=greatest(max_seats,wave_seats);
    anchor:=NULL; wave_n:=0; wave_seats:=0;
   END IF;
   IF anchor IS NULL THEN anchor:=r.return_at; END IF;
   last_time:=r.return_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
   wave_seats:=wave_seats+public.ptb_seats(r);
  END LOOP;
  IF anchor IS NOT NULL THEN
   back_start:=anchor-make_interval(mins=>travel+s.buffer_minutes);
   end_at:=last_time+make_interval(mins=>s.boarding_minutes*wave_n+travel+s.buffer_minutes);
   returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',back_start,'end_at',end_at,'passengers',wave_n));
   blocks:=blocks||jsonb_build_array(jsonb_build_object('start',back_start,'end',end_at));
   max_seats:=greatest(max_seats,wave_seats);
  END IF;
 END IF;
 IF helper THEN max_seats:=max_seats+1; END IF;
 IF max_seats>s.seats THEN errors:=array_append(errors,'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'); END IF;
 -- A single wait-at-hospital run still reserves the vehicle continuously.
 IF NOT multiwave AND mode='wait' AND back_at IS NOT NULL THEN
  blocks:=jsonb_build_array(jsonb_build_object('start',first_pickup,'end',end_at));
 ELSIF NOT multiwave AND mode='later' AND back_at IS NOT NULL AND back_start<=out_end THEN
  blocks:=jsonb_build_array(jsonb_build_object('start',first_pickup,'end',end_at));
 END IF;
 -- The same car cannot perform two proposed runs at once, including an outbound and a return.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(blocks) WITH ORDINALITY a(block,ord)
  JOIN jsonb_array_elements(blocks) WITH ORDINALITY b(block,ord) ON a.ord<b.ord
  WHERE (a.block->>'start')::timestamptz<(b.block->>'end')::timestamptz
   AND (b.block->>'start')::timestamptz<(a.block->>'end')::timestamptz) THEN
  errors:=array_append(errors,'รอบรับ–ส่งทับกันภายในแผนเดียว');
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t CROSS JOIN LATERAL jsonb_array_elements(t.plan->'blocks') old
  CROSS JOIN LATERAL jsonb_array_elements(blocks) proposed
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled' AND NOT(t.booking_ids&&ids)
  AND (old->>'start')::timestamptz<(proposed->>'end')::timestamptz AND (proposed->>'start')::timestamptz<(old->>'end')::timestamptz) THEN
  errors:=array_append(errors,'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว');
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t WHERE t.municipality_id=p_muni AND t.state='issue'
  AND (t.plan->>'date')::date=date_local AND NOT(t.booking_ids&&ids)) THEN
  errors:=array_append(errors,'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน');
 END IF;
 RETURN jsonb_build_object('service_type',f.service_type,'community_rules_version',CASE WHEN f.service_type='community' THEN c.rules_version ELSE NULL END,'booking_ids',ids,'date',date_local,'route_label',f.route_label,'route_id',f.route_id,
  'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(ids)),
  'return_mode',mode,'pickup_at',first_pickup,'return_at',back_at,'blocks',blocks,'seats',max_seats,'helper_required',helper,
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
 days jsonb:='[]'; trips jsonb; free jsonb; occupied record; cursor_at timestamptz; close_at timestamptz;
 day_status text; pending_count bigint; people integer; occupied_seats integer; shared boolean; joinable boolean; ready boolean;
 pad_minutes integer; community_free jsonb; c public.patient_booking_community_rules;
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
  FOR t IN SELECT * FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state<>'cancelled' AND (plan->>'date')=d::text ORDER BY (plan->>'pickup_at')::timestamptz LOOP
   SELECT coalesce(sum(CASE WHEN service_type='community' THEN party_size ELSE 1+companions END),0),coalesce(sum(public.ptb_seats(patient_bookings)),0),coalesce(bool_and(service_type='patient' AND share AND mobility='walk'),false)
    INTO people,occupied_seats,shared FROM public.patient_bookings WHERE trip_id=t.id AND status IN ('confirmed','completed');
   joinable:=shared AND coalesce((t.plan->>'multiwave')::boolean,false)=false AND day_status='open' AND t.state='confirmed' AND t.driver_id=s.driver_id AND (t.plan->>'pickup_at')::timestamptz>now() AND occupied_seats<s.seats
    AND NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND (cancel_requested OR passenger_step<>0));
   trips:=trips||jsonb_build_array(jsonb_build_object('id',t.id,'date',d,'pickup_at',t.plan->'pickup_at','return_at',CASE WHEN shared THEN t.plan->'return_at' ELSE NULL END,
    'outbound_waves',CASE WHEN shared THEN t.plan->'outbound_waves' ELSE NULL END,
    'return_waves',CASE WHEN shared THEN t.plan->'return_waves' ELSE NULL END,
    'state',CASE WHEN shared THEN t.state ELSE NULL END,
    'public_notice',CASE WHEN shared THEN t.public_notice ELSE NULL END,
    'estimated_pickup_at',CASE WHEN shared THEN t.estimated_pickup_at ELSE NULL END,
    'estimated_return_at',CASE WHEN shared THEN t.estimated_return_at ELSE NULL END,
    'appointment_at',CASE WHEN shared THEN (SELECT min(appointment_at) FROM public.patient_bookings WHERE trip_id=t.id AND status IN ('confirmed','completed')) ELSE NULL END,'blocks',t.plan->'blocks','route_id',CASE WHEN shared THEN t.plan->>'route_id' ELSE NULL END,
    'route_label',CASE WHEN shared THEN t.plan->>'route_label' ELSE 'รถติดภารกิจ ไม่เปิดร่วมเที่ยว' END,
    'return_mode',CASE WHEN shared THEN t.plan->>'return_mode' ELSE NULL END,'people',CASE WHEN shared THEN people ELSE NULL END,
    'remaining',CASE WHEN shared THEN greatest(s.seats-occupied_seats,0) ELSE NULL END,'joinable',joinable,
    'status',CASE WHEN t.state='completed' THEN 'completed' WHEN t.state='issue' THEN 'issue' WHEN joinable THEN 'joinable' WHEN shared AND occupied_seats>=s.seats THEN 'full' ELSE 'busy' END));
  END LOOP;
  IF day_status='open' THEN
   -- Free intervals describe vehicle occupancy, including travel around the configured appointment hours.
   -- 15 riders is ptb_plan's upper bound; padding never exposes personal booking data.
   pad_minutes:=(SELECT coalesce(max((route_item->>'minutes')::integer),0)
     FROM jsonb_array_elements(coalesce(s.routes,'[]'::jsonb)) route_item)+s.buffer_minutes+s.boarding_minutes*15;
   cursor_at:=(d::timestamp+make_interval(mins=>(s.office_start-pad_minutes))) AT TIME ZONE 'Asia/Bangkok';
   close_at:=(d::timestamp+make_interval(mins=>(s.office_end+pad_minutes))) AT TIME ZONE 'Asia/Bangkok';
   cursor_at:=greatest(cursor_at,now());
   FOR occupied IN SELECT (b->>'start')::timestamptz AS starts,(b->>'end')::timestamptz AS ends
    FROM public.patient_booking_trips q CROSS JOIN LATERAL jsonb_array_elements(q.plan->'blocks') b
    WHERE q.municipality_id=p_muni AND q.state<>'cancelled'
      AND (q.plan->>'date') IN ((d-1)::text,d::text,(d+1)::text)
      AND (b->>'start')::timestamptz<close_at AND (b->>'end')::timestamptz>cursor_at
    ORDER BY starts LOOP
    IF occupied.starts>cursor_at AND cursor_at<close_at THEN free:=free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',least(occupied.starts,close_at))); END IF;
    cursor_at:=greatest(cursor_at,occupied.ends);
   END LOOP;
   IF cursor_at<close_at THEN free:=free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',close_at)); END IF;
  END IF;
  -- Closing new intake does not hide already accepted community trips or change their plans.
  IF day_status='open' AND c.window_start IS NOT NULL AND c.window_end IS NOT NULL THEN
   pad_minutes:=(SELECT coalesce(max((route_item->>'minutes')::integer),0)
    FROM jsonb_array_elements(coalesce(s.routes,'[]'::jsonb)||coalesce(c.places,'[]'::jsonb)) route_item)+s.buffer_minutes+s.boarding_minutes*15;
   cursor_at:=(d::timestamp+make_interval(mins=>(c.window_start-pad_minutes))) AT TIME ZONE 'Asia/Bangkok';
   close_at:=(d::timestamp+make_interval(mins=>(c.window_end+pad_minutes))) AT TIME ZONE 'Asia/Bangkok';
   cursor_at:=greatest(cursor_at,now());
   FOR occupied IN SELECT (b->>'start')::timestamptz AS starts,(b->>'end')::timestamptz AS ends
    FROM public.patient_booking_trips q CROSS JOIN LATERAL jsonb_array_elements(q.plan->'blocks') b
    WHERE q.municipality_id=p_muni AND q.state<>'cancelled'
      AND (q.plan->>'date') IN ((d-1)::text,d::text,(d+1)::text)
      AND (b->>'start')::timestamptz<close_at AND (b->>'end')::timestamptz>cursor_at
    ORDER BY starts LOOP
    IF occupied.starts>cursor_at AND cursor_at<close_at THEN community_free:=community_free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',least(occupied.starts,close_at))); END IF;
    cursor_at:=greatest(cursor_at,occupied.ends);
   END LOOP;
   IF cursor_at<close_at THEN community_free:=community_free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',close_at)); END IF;
  END IF;
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'status',day_status,'pending_count',pending_count,'trips',trips,'free',free,'community_free',community_free));
 END LOOP;
 RETURN jsonb_build_object('enabled',true,'days',days,'as_of',now());
END $function$;

CREATE OR REPLACE FUNCTION public.patient_booking_save_community_rules(p_muni uuid,p_revision integer,p_data jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.patient_booking_community_rules; x jsonb; v_enabled boolean;
 v_start integer; v_end integer; v_places jsonb; v_activities jsonb; v_reference text;
 v_policy_changed boolean;
BEGIN
 IF public.ptb_role(p_muni)<>'admin' THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบตั้งค่าบริการชุมชนได้'; END IF;
 -- Serialize policy changes with intake and confirmation on the same tenant resource lock.
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ตั้งค่ารถก่อนตั้งบริการชุมชน'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>32768 THEN
  RAISE EXCEPTION 'ข้อมูลตั้งค่าชุมชนไม่ถูกต้อง';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('enabled','window_start','window_end','places','activities','rules_reference')) THEN
  RAISE EXCEPTION 'ข้อมูลตั้งค่าชุมชนไม่ถูกต้อง';
 END IF;
 IF p_data ? 'enabled' AND jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'สถานะเปิดบริการชุมชนไม่ถูกต้อง';
 END IF;
 v_enabled:=coalesce((p_data->>'enabled')::boolean,false);
 FOR x IN SELECT value FROM jsonb_each(p_data) WHERE key IN ('window_start','window_end') LOOP
  IF jsonb_typeof(x)<>'null' AND (jsonb_typeof(x)<>'number' OR x::text !~ '^[0-9]{1,4}$') THEN
   RAISE EXCEPTION 'ช่วงเวลาชุมชนต้องเป็นนาทีเต็มของวัน';
  END IF;
 END LOOP;
 v_start:=(p_data->>'window_start')::integer; v_end:=(p_data->>'window_end')::integer;
 IF (v_start IS NULL)<>(v_end IS NULL)
  OR v_start NOT BETWEEN 0 AND 1439 OR v_end NOT BETWEEN 1 AND 1440 OR v_end<=v_start THEN
  RAISE EXCEPTION 'ช่วงเวลาชุมชนไม่ถูกต้อง';
 END IF;
 IF jsonb_typeof(p_data->'places') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_data->'activities') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'สถานที่และกิจกรรมชุมชนต้องเป็นรายการ';
 END IF;
 IF jsonb_array_length(p_data->'places')>100 OR jsonb_array_length(p_data->'activities')>100 THEN
  RAISE EXCEPTION 'สถานที่และกิจกรรมชุมชนเกินจำนวนที่กำหนด';
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'places') LOOP
  IF jsonb_typeof(x)<>'object' THEN RAISE EXCEPTION 'ข้อมูลสถานที่ชุมชนไม่ถูกต้อง'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','label','minutes'))
   OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR coalesce(x->>'id','') !~ '^[a-zA-Z0-9_-]{1,60}$'
   OR x->>'id'='__other__' OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string'
   OR char_length(btrim(coalesce(x->>'label',''))) NOT BETWEEN 1 AND 200
   OR coalesce(x->>'label','') !~ '[^[:space:]]'
   OR jsonb_typeof(x->'minutes') IS DISTINCT FROM 'number' OR coalesce(x->>'minutes','') !~ '^[0-9]{1,3}$' THEN
   RAISE EXCEPTION 'กรุณาระบุรหัส ชื่อ และเวลาเดินทางของทุกสถานที่ชุมชน';
  END IF;
  IF (x->>'minutes')::integer NOT BETWEEN 5 AND 240 THEN
   RAISE EXCEPTION 'เวลาเดินทางของสถานที่ชุมชนต้องอยู่ระหว่าง 5 ถึง 240 นาที';
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_data->'places'))<>jsonb_array_length(p_data->'places') THEN
  RAISE EXCEPTION 'รหัสสถานที่ชุมชนซ้ำ';
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'activities') LOOP
  IF jsonb_typeof(x)<>'object' THEN RAISE EXCEPTION 'ข้อมูลกิจกรรมชุมชนไม่ถูกต้อง'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('code','label'))
   OR jsonb_typeof(x->'code') IS DISTINCT FROM 'string' OR coalesce(x->>'code','') !~ '^[a-zA-Z0-9_-]{1,60}$'
   OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string'
   OR char_length(btrim(coalesce(x->>'label',''))) NOT BETWEEN 1 AND 200
   OR coalesce(x->>'label','') !~ '[^[:space:]]' THEN
   RAISE EXCEPTION 'กรุณาระบุรหัสและชื่อของทุกกิจกรรมชุมชน';
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'code') FROM jsonb_array_elements(p_data->'activities'))<>jsonb_array_length(p_data->'activities') THEN
  RAISE EXCEPTION 'รหัสกิจกรรมชุมชนซ้ำ';
 END IF;
 IF p_data ? 'rules_reference' AND jsonb_typeof(p_data->'rules_reference') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'ข้อความอ้างอิงข้อบังคับชุมชนไม่ถูกต้อง';
 END IF;
 v_reference:=btrim(coalesce(p_data->>'rules_reference',''));
 IF char_length(v_reference)>2000 THEN RAISE EXCEPTION 'ข้อความอ้างอิงข้อบังคับชุมชนยาวเกินกำหนด'; END IF;
 IF v_enabled AND (v_start IS NULL OR v_end IS NULL OR v_reference !~ '[^[:space:]]'
  OR jsonb_array_length(p_data->'places')=0 OR jsonb_array_length(p_data->'activities')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการชุมชนต้องระบุข้อบังคับ กิจกรรม สถานที่ และช่วงเวลา';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(value->>'minutes')::integer) ORDER BY ord),'[]')
  INTO v_places FROM jsonb_array_elements(p_data->'places') WITH ORDINALITY entries(value,ord);
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',value->>'code','label',btrim(value->>'label')) ORDER BY ord),'[]')
  INTO v_activities FROM jsonb_array_elements(p_data->'activities') WITH ORDINALITY entries(value,ord);
 INSERT INTO public.patient_booking_community_rules(municipality_id) VALUES(p_muni) ON CONFLICT DO NOTHING;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni FOR UPDATE;
 IF p_revision IS DISTINCT FROM c.revision THEN RAISE EXCEPTION 'กฎชุมชนเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 v_policy_changed:=ROW(v_start,v_end,v_places,v_activities,v_reference)
  IS DISTINCT FROM ROW(c.window_start,c.window_end,c.places,c.activities,c.rules_reference);
 UPDATE public.patient_booking_community_rules SET enabled=v_enabled,window_start=v_start,window_end=v_end,
  places=v_places,activities=v_activities,rules_reference=v_reference,
  rules_version=c.rules_version+CASE WHEN v_policy_changed THEN 1 ELSE 0 END,
  revision=c.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'community_rules_changed',jsonb_build_object(
  'revision',c.revision+1,'rules_version',c.rules_version+CASE WHEN v_policy_changed THEN 1 ELSE 0 END,
  'enabled',v_enabled,'place_count',jsonb_array_length(v_places),'activity_count',jsonb_array_length(v_activities)));
 RETURN c.revision+1;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
