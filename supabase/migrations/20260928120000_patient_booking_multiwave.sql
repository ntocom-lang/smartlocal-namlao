BEGIN;
-- Stop if either reviewed definition has changed since this migration was written.
DO $guard$
DECLARE expected jsonb:=jsonb_build_object(
 'public.ptb_plan(uuid,uuid[],text)','ce4605b1100e3a8dfba6904b0d63cb18',
 'public.ptb_join_plan_to(uuid,uuid,uuid)','c9856c143b94918bcc2cefa074f6a5f9',
 'public.patient_booking_calendar(uuid,date,date)','9e89de0659714e21e7a4caf4dd95282c');
 fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

-- One vehicle may make several non-overlapping runs on the same day. A wait-at-hospital
-- request must be changed to return-later by the coordinator before the new plan is saved.
CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; travel integer; errors text[]:='{}'; ids uuid[]; date_local date;
 helper boolean:=false;
 back_at timestamptz; first_pickup timestamptz; start_at timestamptz; out_end timestamptz;
 end_at timestamptz; back_start timestamptz; blocks jsonb:='[]'; outbound jsonb:='[]'; returns jsonb:='[]';
 anchor timestamptz; last_time timestamptz; wave_n integer:=0; wave_seats integer:=0;
 max_seats integer:=0; wave_count integer:=0;
 mode text; multiwave boolean:=false;
BEGIN
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 n:=cardinality(ids);
 IF n IS NULL OR n NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางไม่ถูกต้อง'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids))<>n THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้'; END IF;
 SELECT * INTO f FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LIMIT 1;
 date_local:=(f.appointment_at AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=f.route_id;
 IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ'); END IF;
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
  IF r.appointment_at < (date_local::timestamp+make_interval(mins=>s.office_start)) AT TIME ZONE 'Asia/Bangkok'
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
   out_end:=anchor+make_interval(mins=>s.boarding_minutes+travel);
   outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',start_at,'end_at',out_end,'passengers',wave_n));
   blocks:=blocks||jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end));
   IF first_pickup IS NULL THEN first_pickup:=start_at; END IF;
   max_seats:=greatest(max_seats,wave_seats);
   anchor:=NULL; wave_n:=0; wave_seats:=0;
  END IF;
  IF anchor IS NULL THEN anchor:=r.appointment_at; wave_count:=wave_count+1; END IF;
  last_time:=r.appointment_at; wave_n:=wave_n+1;
  wave_seats:=wave_seats+r.companions+CASE WHEN r.mobility='walk' THEN 1 ELSE 0 END;
 END LOOP;
 start_at:=anchor-make_interval(mins=>travel+s.buffer_minutes+s.boarding_minutes*wave_n);
 out_end:=anchor+make_interval(mins=>s.boarding_minutes+travel);
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
   last_time:=r.return_at; wave_n:=wave_n+1;
   wave_seats:=wave_seats+r.companions+CASE WHEN r.mobility='walk' THEN 1 ELSE 0 END;
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
 RETURN jsonb_build_object('booking_ids',ids,'date',date_local,'route_label',f.route_label,'route_id',f.route_id,
  'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(ids)),
  'return_mode',mode,'pickup_at',first_pickup,'return_at',back_at,'blocks',blocks,'seats',max_seats,'helper_required',helper,
  'outbound_waves',outbound,'return_waves',returns,'multiwave',multiwave,
  'settings_revision',s.revision,'errors',(SELECT coalesce(jsonb_agg(DISTINCT x),'[]') FROM unnest(errors) x));
END $$;

-- Prevent legacy one-rider join from silently changing a wait-at-hospital request.
CREATE OR REPLACE FUNCTION public.ptb_join_plan_to(p_muni uuid,p_booking uuid,p_trip uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; t public.patient_booking_trips; ids uuid[]; plan jsonb;
BEGIN
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL OR t.id IS NULL OR t.state<>'confirmed' OR (t.plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว กรุณาประสานเจ้าหน้าที่'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed';
 IF cardinality(ids) IS NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND (NOT share OR mobility<>'walk' OR passenger_step<>0 OR cancel_requested)) THEN RAISE EXCEPTION 'เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม กรุณาประสานเจ้าหน้าที่'; END IF;
 plan:=public.ptb_plan(p_muni,ids||p_booking,'');
 IF (plan->>'multiwave')::boolean THEN RAISE EXCEPTION 'รอบรับหลายรอบต้องให้เจ้าหน้าที่ประสานและยืนยัน'; END IF;
 IF (plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เวลาเริ่มรับของแผนร่วมเที่ยวผ่านแล้ว'; END IF;
 IF t.driver_id IS DISTINCT FROM (SELECT driver_id FROM public.patient_booking_settings WHERE municipality_id=p_muni) THEN RAISE EXCEPTION 'คนขับเปลี่ยนแล้ว ต้องประสานจัดเที่ยวใหม่ก่อนเพิ่มผู้ร่วม'; END IF;
 RETURN plan||jsonb_build_object('join_trip_id',t.id,'join_trip_revision',t.revision,'join_booking_id',p_booking);
END $$;

-- Staff preview of one or more pending requests joining a confirmed trip.
CREATE FUNCTION public.patient_booking_preview_multiwave(p_muni uuid,p_ids uuid[],p_trip uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; ids uuid[]; existing uuid[]; plan jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์จัดคิว'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 IF t.id IS NULL OR t.state<>'confirmed' OR cardinality(ids) NOT BETWEEN 1 AND 15
  OR (t.plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว กรุณาประสานเจ้าหน้าที่'; END IF;
 IF t.driver_id IS DISTINCT FROM (SELECT driver_id FROM public.patient_booking_settings WHERE municipality_id=p_muni) THEN RAISE EXCEPTION 'คนขับเปลี่ยนแล้ว ต้องประสานจัดเที่ยวใหม่ก่อนเพิ่มผู้ร่วม'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids)
  AND status='submitted' AND trip_id IS NULL AND passenger_step=0 AND NOT cancel_requested)=cardinality(ids) IS NOT TRUE THEN
  RAISE EXCEPTION 'คำขอถูกจัดคิวหรือเปลี่ยนสถานะแล้ว';
 END IF;
 SELECT array_agg(id ORDER BY id) INTO existing FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed';
 IF cardinality(existing) IS NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(existing) AND (NOT share OR mobility<>'walk' OR passenger_step<>0 OR cancel_requested)) THEN RAISE EXCEPTION 'เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม กรุณาประสานเจ้าหน้าที่'; END IF;
 plan:=public.ptb_plan(p_muni,existing||ids,t.helper_name);
 IF (plan->>'multiwave')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'คำขอนี้ไม่ต้องจัดรถหลายรอบ'; END IF;
 IF (plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เวลาเริ่มรับของแผนร่วมเที่ยวผ่านแล้ว'; END IF;
 RETURN plan||jsonb_build_object('join_trip_id',t.id,'join_trip_revision',t.revision,'join_booking_ids',ids);
END $$;

CREATE FUNCTION public.patient_booking_confirm_multiwave(p_muni uuid,p_op uuid,p_ids uuid[],p_trip uuid,p_expected jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; old public.patient_booking_operations; plan jsonb; stored jsonb;
 ids uuid[]; existing uuid[]; payload jsonb; changed uuid[]; recipients uuid[]; changed_id uuid;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ยืนยันคิว'; END IF;
 IF p_op IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'ข้อมูลยืนยันคิวไม่ครบ'; END IF;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 IF cardinality(ids) NOT BETWEEN 1 AND 15 OR p_expected->>'join_trip_id' IS DISTINCT FROM p_trip::text
  OR p_expected->'join_booking_ids' IS DISTINCT FROM to_jsonb(ids) THEN RAISE EXCEPTION 'แผนหรือข้อมูลเปลี่ยนแล้ว กรุณาตรวจใหม่'; END IF;
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','confirm_multiwave','trip',p_trip,'ids',ids,'expected',p_expected);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN p_trip; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni FOR UPDATE;
 PERFORM 1 FROM public.patient_bookings WHERE municipality_id=p_muni AND (id=ANY(ids) OR trip_id=p_trip) ORDER BY id FOR UPDATE;
 SELECT array_agg(id ORDER BY id) INTO existing FROM public.patient_bookings WHERE trip_id=p_trip AND status='confirmed';
 plan:=public.patient_booking_preview_multiwave(p_muni,ids,p_trip);
 IF plan IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'แผนหรือข้อมูลเปลี่ยนแล้ว กรุณาตรวจใหม่'; END IF;
 IF jsonb_array_length(plan->'errors')>0 THEN RAISE EXCEPTION '%',plan->'errors'; END IF;
 -- Every wait request in this multi-run itinerary becomes return-later, with an individual audit record.
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO changed FROM public.patient_bookings
  WHERE id=ANY(existing||ids) AND return_mode='wait';
 UPDATE public.patient_bookings SET return_mode='later',revision=revision+1,updated_at=now() WHERE id=ANY(changed);
 UPDATE public.patient_bookings SET trip_id=p_trip,status='confirmed',revision=revision+1,updated_at=now() WHERE id=ANY(ids);
 stored:=public.ptb_plan(p_muni,existing||ids,t.helper_name);
 IF jsonb_array_length(stored->'errors')>0 THEN RAISE EXCEPTION '%',stored->'errors'; END IF;
 UPDATE public.patient_booking_trips SET booking_ids=ARRAY(SELECT DISTINCT unnest(existing||ids) ORDER BY 1),
  plan=stored,estimated_pickup_at=(stored->>'pickup_at')::timestamptz,
  estimated_return_at=(stored->>'return_at')::timestamptz,
  revision=revision+1,docs_revision=docs_revision+1,updated_at=now() WHERE id=p_trip;
 FOREACH changed_id IN ARRAY changed LOOP
  PERFORM public.ptb_audit(p_muni,changed_id,'return_later_for_multiwave',jsonb_build_object('trip_id',p_trip,'before','wait','after','later'));
 END LOOP;
 PERFORM public.ptb_audit(p_muni,p_trip,'confirmed_multiwave',jsonb_build_object('new_booking_ids',ids,'before',t.plan,'after',stored));
 SELECT ARRAY(SELECT DISTINCT unnest(ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(existing||ids))||ARRAY[t.driver_id])) INTO recipients;
 PERFORM public.ptb_notice(p_muni,p_trip,recipients,'เจ้าหน้าที่ยืนยันแผนรถหลายรอบแล้ว กรุณาตรวจเวลารับของตนและเวลารับกลับล่าสุด');
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 RETURN p_trip;
END $$;

-- The public calendar shows anonymized run times, but does not offer the legacy
-- self-join button for a multi-run trip that requires coordinator approval.
CREATE OR REPLACE FUNCTION public.patient_booking_calendar(p_muni uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.patient_booking_settings; partner_active boolean; d date; t public.patient_booking_trips;
 days jsonb:='[]'; trips jsonb; free jsonb; occupied record; cursor_at timestamptz; close_at timestamptz;
 day_status text; pending_count bigint; people integer; occupied_seats integer; shared boolean; joinable boolean; ready boolean;
 pad_minutes integer;
 today date:=(now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>61 OR p_from<today-31 OR p_to>(today + interval '12 months')::date THEN RAISE EXCEPTION 'เลือกช่วงวันไม่เกิน 62 วัน และล่วงหน้าไม่เกิน 12 เดือน'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
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
  trips:='[]'; free:='[]';
  FOR t IN SELECT * FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state<>'cancelled' AND (plan->>'date')=d::text ORDER BY (plan->>'pickup_at')::timestamptz LOOP
   SELECT coalesce(sum(1+companions),0),coalesce(sum(companions+CASE WHEN mobility='walk' THEN 1 ELSE 0 END),0),coalesce(bool_and(share AND mobility='walk'),false)
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
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'status',day_status,'pending_count',pending_count,'trips',trips,'free',free));
 END LOOP;
 RETURN jsonb_build_object('enabled',true,'days',days,'as_of',now());
END $function$;

REVOKE ALL ON FUNCTION public.patient_booking_preview_multiwave(uuid,uuid[],uuid),public.patient_booking_confirm_multiwave(uuid,uuid,uuid[],uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_preview_multiwave(uuid,uuid[],uuid),public.patient_booking_confirm_multiwave(uuid,uuid,uuid[],uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
