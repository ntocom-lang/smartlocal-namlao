BEGIN;
DO $$ BEGIN
 IF to_regclass('public.patient_booking_settings') IS NULL THEN RAISE EXCEPTION 'Apply patient_booking_tables first'; END IF;
END $$;

-- All definer helpers are private to the RPCs below, not callable by clients.
CREATE FUNCTION public.ptb_role(p_muni uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles; s public.patient_booking_settings;
BEGIN
 IF auth.uid() IS NULL THEN RETURN 'anonymous'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF p.role='superadmin' THEN RETURN 'admin'; END IF;
 IF p.id IS NULL OR p.municipality_id IS DISTINCT FROM p_muni THEN RETURN 'outside'; END IF;
 IF p.role='admin' THEN RETURN 'admin'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 IF p.id=ANY(s.coordinator_ids) AND p.role IN ('officer','staff') THEN RETURN 'coordinator'; END IF;
 IF s.driver_id=p.id AND p.role IN ('officer','staff') THEN RETURN 'driver'; END IF;
 RETURN 'citizen';
END $$;

CREATE FUNCTION public.ptb_audit(p_muni uuid,p_entity uuid,p_action text,p_detail jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
 INSERT INTO public.patient_booking_events(municipality_id,actor_id,entity_id,action,detail)
 VALUES(p_muni,auth.uid(),p_entity,p_action,p_detail);
END $$;

CREATE FUNCTION public.ptb_notice(p_muni uuid,p_entity uuid,p_users uuid[],p_message text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 INSERT INTO public.patient_booking_notices(municipality_id,entity_id,recipient_id,message)
 SELECT p_muni,p_entity,u,p_message FROM (SELECT DISTINCT unnest(p_users) AS u) x WHERE u IS NOT NULL;
$$;

-- Deterministic, authoritative plan for one or more requests. No client timestamps trusted.
CREATE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; travel integer; start_at timestamptz; out_end timestamptz; back_at timestamptz;
 end_at timestamptz; back_start timestamptz; blocks jsonb; errors text[] := '{}'; seats integer:=0;
 helper boolean:=false; date_local date; min_appt timestamptz; max_appt timestamptz; ids uuid[];
BEGIN
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 n:=cardinality(ids);
 IF n IS NULL OR n NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางไม่ถูกต้อง'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids))<>n THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้'; END IF;
 SELECT * INTO f FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LIMIT 1;
 date_local := (f.appointment_at AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=f.route_id;
 IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ'); END IF;
 travel:=coalesce((route->>'minutes')::integer,0);
 IF s.seats IS NULL OR s.wheelchairs IS NULL OR s.stretchers IS NULL THEN errors:=array_append(errors,'ยังไม่ยืนยันความจุรถ'); END IF;
 IF NOT s.enabled OR s.unavailable OR s.driver_id IS NULL THEN errors:=array_append(errors,'รถหรือคนขับยังไม่พร้อมให้บริการ'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active) THEN errors:=array_append(errors,'หน่วยงานเจ้าของรถปิดรับเรื่อง'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.driver_id AND municipality_id=p_muni AND role IN ('admin','officer','staff')) THEN errors:=array_append(errors,'บัญชีคนขับไม่ได้รับสิทธิ์เจ้าหน้าที่แล้ว'); END IF;
 IF s.calendar_checked_through IS NULL OR date_local>s.calendar_checked_through THEN errors:=array_append(errors,'ต้องตรวจปฏิทินวันหยุดให้ครอบคลุมวันเดินทาง'); END IF;
 IF extract(isodow FROM date_local) IN (6,7) OR date_local=ANY(s.holidays) THEN errors:=array_append(errors,'ตรงวันหยุดให้บริการ'); END IF;
 IF date_local<(now() AT TIME ZONE 'Asia/Bangkok')::date THEN errors:=array_append(errors,'วันเดินทางผ่านแล้ว'); END IF;
 SELECT min(appointment_at),max(appointment_at),max(return_at) INTO min_appt,max_appt,back_at FROM public.patient_bookings WHERE id=ANY(ids);
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) LOOP
  IF r.status NOT IN ('submitted','confirmed') THEN errors:=array_append(errors,'มีคำขอที่ปิดหรือยกเลิกแล้ว'); END IF;
  IF NOT r.in_area THEN errors:=array_append(errors,'ต้องตรวจสอบพื้นที่รับบริการ'); END IF;
  IF r.route_id<>f.route_id OR r.return_mode<>f.return_mode OR (r.appointment_at AT TIME ZONE 'Asia/Bangkok')::date<>date_local THEN errors:=array_append(errors,'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน'); END IF;
  IF n>1 AND (NOT r.share OR r.mobility<>'walk') THEN errors:=array_append(errors,'ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว'); END IF;
  IF r.return_mode<>'one_way' AND r.return_at IS NULL THEN errors:=array_append(errors,'ยังไม่มีเวลาขากลับ'); END IF;
  IF r.return_at<r.appointment_at THEN errors:=array_append(errors,'เวลารับกลับอยู่ก่อนเวลานัด'); END IF;
  seats:=seats+r.companions+CASE WHEN r.mobility='walk' THEN 1 ELSE 0 END;
  IF r.mobility<>'walk' THEN helper:=true; END IF;
  IF r.mobility='wheelchair' AND coalesce(s.wheelchairs,0)<1 THEN errors:=array_append(errors,'ยังไม่ยืนยันที่ยึดรถเข็น'); END IF;
  IF r.mobility='stretcher' AND coalesce(s.stretchers,0)<1 THEN errors:=array_append(errors,'ยังไม่ยืนยันที่ยึดเปล'); END IF;
 END LOOP;
 IF helper THEN
  seats:=seats+1;
  IF coalesce(btrim(p_helper),'')='' THEN errors:=array_append(errors,'ต้องยืนยันผู้ช่วยเคลื่อนย้ายประจำเที่ยว'); END IF;
 END IF;
 IF seats>s.seats THEN errors:=array_append(errors,'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'); END IF;
 IF max_appt-min_appt>interval '30 minutes' THEN errors:=array_append(errors,'เวลานัดห่างเกินช่วงร่วมเที่ยว'); END IF;
 IF n>1 AND (SELECT max(return_at)-min(return_at) FROM public.patient_bookings WHERE id=ANY(ids))>interval '30 minutes' THEN errors:=array_append(errors,'เวลารับกลับห่างเกินช่วงร่วมเที่ยว'); END IF;
 start_at:=min_appt-make_interval(mins=>travel+s.buffer_minutes+s.boarding_minutes*n);
 out_end:=min_appt+make_interval(mins=>s.boarding_minutes+travel); -- includes unloading, reposition and buffer
 end_at:=back_at+make_interval(mins=>s.boarding_minutes*n+travel+s.buffer_minutes);
 back_start:=back_at-make_interval(mins=>travel+s.buffer_minutes);
 IF f.return_mode='one_way' THEN
  blocks:=jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end));
 ELSIF f.return_mode='wait' OR back_at IS NULL OR back_start<=out_end THEN
  blocks:=jsonb_build_array(jsonb_build_object('start',start_at,'end',end_at));
 ELSE
  blocks:=jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end),jsonb_build_object('start',back_start,'end',end_at));
 END IF;
 IF start_at < (date_local::timestamp+make_interval(mins=>s.office_start)) AT TIME ZONE 'Asia/Bangkok'
 OR coalesce(CASE WHEN f.return_mode='one_way' THEN out_end ELSE end_at END,out_end) > (date_local::timestamp+make_interval(mins=>s.office_end)) AT TIME ZONE 'Asia/Bangkok' THEN
  errors:=array_append(errors,'เวลารับ–ส่งอยู่นอกเวลาบริการ');
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t CROSS JOIN LATERAL jsonb_array_elements(t.plan->'blocks') old
  CROSS JOIN LATERAL jsonb_array_elements(blocks) proposed
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled' AND NOT(t.booking_ids&&ids)
  AND (old->>'start')::timestamptz<(proposed->>'end')::timestamptz AND (proposed->>'start')::timestamptz<(old->>'end')::timestamptz) THEN
  errors:=array_append(errors,'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว');
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t WHERE t.municipality_id=p_muni AND t.state='issue' AND (t.plan->>'date')::date=date_local AND NOT(t.booking_ids&&ids)) THEN errors:=array_append(errors,'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน'); END IF;
 RETURN jsonb_build_object('booking_ids',ids,'date',date_local,'route_label',f.route_label,'route_id',f.route_id,
  'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(ids)),
  'return_mode',f.return_mode,'pickup_at',start_at,'return_at',back_at,'blocks',blocks,'seats',seats,'helper_required',helper,
  'settings_revision',s.revision,'errors',(SELECT coalesce(jsonb_agg(DISTINCT x),'[]') FROM unnest(errors) x));
END $$;

REVOKE ALL ON FUNCTION public.ptb_role(uuid),public.ptb_audit(uuid,uuid,text,jsonb),
 public.ptb_notice(uuid,uuid,uuid[],text),public.ptb_plan(uuid,uuid[],text) FROM PUBLIC,anon,authenticated;
COMMIT;
