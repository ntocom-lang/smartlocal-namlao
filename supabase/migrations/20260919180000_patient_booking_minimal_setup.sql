-- Remove setup-only gates; retain staff review, consent snapshots, holidays, capacity and conflict checks.
BEGIN;
CREATE OR REPLACE FUNCTION public.patient_booking_save_settings(p_muni uuid,p_revision integer,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; x jsonb; ids uuid[]; driver uuid; partner uuid; v_enabled boolean;
BEGIN
 IF public.ptb_role(p_muni)<>'admin' THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบตั้งค่าบริการได้'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>32768 THEN RAISE EXCEPTION 'ข้อมูลตั้งค่าไม่ถูกต้อง'; END IF;
 INSERT INTO public.patient_booking_settings(municipality_id) VALUES(p_muni) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF coalesce(p_revision,1)<>s.revision THEN RAISE EXCEPTION 'การตั้งค่าเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 partner:=nullif(p_data->>'partner_id','')::uuid; driver:=nullif(p_data->>'driver_id','')::uuid;
 v_enabled:=coalesce((p_data->>'enabled')::boolean,false);
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(coalesce(p_data->'coordinator_ids','[]'));
 IF cardinality(ids)>30 OR EXISTS(SELECT 1 FROM unnest(ids) u WHERE NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND municipality_id=p_muni AND role IN ('admin','officer','staff'))) THEN RAISE EXCEPTION 'ผู้ประสานงานต้องเป็นเจ้าหน้าที่หน่วยงานนี้'; END IF;
 IF driver IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=driver AND municipality_id=p_muni AND role IN ('admin','officer','staff')) THEN RAISE EXCEPTION 'เลือกบัญชีเจ้าหน้าที่สำหรับคนขับในหน่วยงานนี้'; END IF;
 -- The same eligible staff account may be explicitly assigned both duties.
 IF partner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=partner AND municipality_id=p_muni AND is_active AND 'patient_transport_request'=ANY(document_types)) THEN RAISE EXCEPTION 'หน่วยงานเจ้าของรถไม่ถูกต้อง'; END IF;
 IF jsonb_typeof(p_data->'routes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'routes')>100 THEN RAISE EXCEPTION 'เส้นทางไม่ถูกต้อง'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'routes') LOOP
  IF coalesce(x->>'id','')!~'^[a-zA-Z0-9_-]{1,60}$' OR char_length(coalesce(btrim(x->>'label'),'')) NOT BETWEEN 1 AND 200 OR coalesce((x->>'minutes')::integer,0) NOT BETWEEN 5 AND 240 THEN RAISE EXCEPTION 'กรุณาระบุชื่อและเวลาเดินทางของทุกเส้นทาง'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_data->'routes'))<>jsonb_array_length(p_data->'routes') THEN RAISE EXCEPTION 'รหัสเส้นทางซ้ำ'; END IF;
 IF char_length(coalesce(p_data->>'privacy_notice',''))>6000 OR char_length(coalesce(p_data->>'delegation_reference',''))>500 THEN RAISE EXCEPTION 'ข้อความตั้งค่ายาวเกินกำหนด'; END IF;
 IF v_enabled AND (partner IS NULL OR driver IS NULL OR cardinality(ids)=0 OR
  nullif(p_data->>'seats','') IS NULL OR nullif(p_data->>'wheelchairs','') IS NULL OR nullif(p_data->>'stretchers','') IS NULL OR
  coalesce(p_data->>'contact_phone','')!~'^0[0-9]{8,9}$' OR jsonb_array_length(p_data->'routes')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการต้องยืนยันเจ้าของรถ คนขับ ผู้ประสานงาน ความจุรถ เส้นทาง และเบอร์ติดต่อ';
 END IF;
 -- Live journeys use their confirmed snapshots; changed settings require review of pending plans.
 IF driver IS DISTINCT FROM s.driver_id AND EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'มีเที่ยวค้าง ต้องจัดการเที่ยวเดิมก่อนเปลี่ยนคนขับ'; END IF;
 UPDATE public.patient_booking_settings SET enabled=v_enabled, partner_id=partner,driver_id=driver,coordinator_ids=ids,
  office_start=(p_data->>'office_start')::integer,office_end=(p_data->>'office_end')::integer,
  seats=nullif(p_data->>'seats','')::integer,wheelchairs=nullif(p_data->>'wheelchairs','')::integer,stretchers=nullif(p_data->>'stretchers','')::integer,
  buffer_minutes=(p_data->>'buffer_minutes')::integer,boarding_minutes=(p_data->>'boarding_minutes')::integer,
  routes=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(value->>'minutes')::integer)),'[]') FROM jsonb_array_elements(p_data->'routes')),
  holidays=CASE WHEN p_data ? 'holidays' THEN ARRAY(SELECT value::date FROM jsonb_array_elements_text(coalesce(p_data->'holidays','[]'))) ELSE s.holidays END,
  calendar_checked_through=CASE WHEN p_data ? 'calendar_checked_through' THEN nullif(p_data->>'calendar_checked_through','')::date ELSE s.calendar_checked_through END,unavailable=coalesce((p_data->>'unavailable')::boolean,false),
  delegation_reference=coalesce(nullif(btrim(p_data->>'delegation_reference'),''),s.delegation_reference),
  privacy_notice=coalesce(nullif(btrim(p_data->>'privacy_notice'),''),nullif(btrim(s.privacy_notice),''),
   'บริการรถรับส่งผู้ป่วยใช้ชื่อ เบอร์ติดต่อ วันเวลานัด โรงพยาบาล จุดรับ ผู้ติดตาม และข้อมูลการใช้รถเข็นหรือเปล เพื่อรับคำขอ จัดคิว ติดต่อประสานงาน รับส่ง และจัดทำหลักฐานบริการ พิกัดจุดรับเป็นทางเลือก ระบุที่อยู่และจุดสังเกตแทนได้ เจ้าหน้าที่จัดคิว คนขับ และผู้รับผิดชอบกองทุนเข้าถึงข้อมูลที่จำเป็นต่อหน้าที่ ตารางสาธารณะไม่แสดงชื่อ เบอร์โทร ที่อยู่หรือพิกัดของผู้เดินทาง หากไม่ให้ข้อมูลที่จำเป็นอาจไม่สามารถประสานรับส่งได้ สอบถามการใช้ข้อมูล ระยะเวลาเก็บรักษา หรือขอใช้สิทธิเกี่ยวกับข้อมูลส่วนบุคคลได้ที่เจ้าหน้าที่ผู้ให้บริการตามเบอร์ติดต่อในหน้านี้'),
  contact_phone=btrim(coalesce(p_data->>'contact_phone','')),revision=s.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'settings_changed',jsonb_build_object('revision',s.revision+1));
END $$;

CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.patient_booking_submit(p_muni uuid,p_id uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; partner public.referral_partners;
 old public.patient_bookings; route jsonb; appt timestamptz; back timestamptz; d date; consent text;
 lat double precision; lng double precision;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบด้วยบัญชีของหน่วยงานนี้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 SELECT * INTO old FROM public.patient_bookings WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by=auth.uid() AND old.municipality_id=p_muni THEN RETURN old.id; END IF;
  RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง';
 END IF;
 IF s.enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'ยังไม่เปิดรับจอง กรุณาติดต่อเจ้าหน้าที่'; END IF;
 SELECT * INTO partner FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active;
 IF partner.id IS NULL THEN RAISE EXCEPTION 'หน่วยงานเจ้าของรถปิดรับเรื่อง'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 THEN RAISE EXCEPTION 'ข้อมูลคำขอไม่ถูกต้อง'; END IF;
 IF (p_data->>'is_emergency')::boolean IS DISTINCT FROM false OR (p_data->>'consent')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'ต้องยืนยันไม่ฉุกเฉินและการใช้ข้อมูลก่อนส่ง กรณีฉุกเฉินโทร 1669'; END IF;
 IF p_data->>'consent_version' IS DISTINCT FROM 'patient-booking-v1' OR p_data->>'privacy_notice' IS DISTINCT FROM s.privacy_notice OR p_data->>'owner_name' IS DISTINCT FROM partner.name THEN RAISE EXCEPTION 'ข้อความใช้ข้อมูลเปลี่ยนแล้ว กรุณาโหลดและตรวจอีกครั้ง'; END IF;
 IF p_data->>'relation'<>'self' AND (p_data->>'representative_authorized')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'ผู้จองแทนต้องได้รับอนุญาตหรือมีอำนาจกระทำแทน'; END IF;
 appt:=(p_data->>'appointment_at')::timestamptz; back:=nullif(p_data->>'return_at','')::timestamptz;
 d:=(appt AT TIME ZONE 'Asia/Bangkok')::date;
 IF d IS NULL OR d<(now() AT TIME ZONE 'Asia/Bangkok')::date+(CASE WHEN role_name IN ('admin','coordinator') THEN 0 ELSE partner.min_lead_days END) OR d>(now() AT TIME ZONE 'Asia/Bangkok')::date+180 THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจองล่วงหน้า'; END IF;
 IF back IS NOT NULL AND (back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>d) THEN RAISE EXCEPTION 'เวลารับกลับต้องหลังนัดและเป็นวันเดียวกัน'; END IF;
 -- Days the public calendar already reports as unbookable. Staff taking a request by phone keep the
 -- existing coordination path; an open incident stays a soft warning because it can be cleared in time.
 IF role_name NOT IN ('admin','coordinator') THEN
  IF s.unavailable THEN RAISE EXCEPTION 'ขณะนี้งดรับจองชั่วคราวเพราะรถหรือคนขับไม่พร้อม กรุณาติดต่อเจ้าหน้าที่'; END IF;
  IF extract(isodow FROM d) IN (6,7) OR d=ANY(s.holidays) THEN RAISE EXCEPTION 'วันที่เลือกตรงวันหยุดให้บริการ กรุณาเลือกวันทำการหรือติดต่อเจ้าหน้าที่'; END IF;
 END IF;
 -- หมุดจุดรับเป็นทางเลือก (ผู้สูงอายุที่ปักหมุดไม่เป็นต้องจองได้) แต่ถ้าส่งมาต้องเป็นพิกัดจริง
 lat:=nullif(p_data->>'pickup_lat','')::double precision; lng:=nullif(p_data->>'pickup_lng','')::double precision;
 IF (lat IS NULL)<>(lng IS NULL) THEN RAISE EXCEPTION 'หมุดจุดรับไม่สมบูรณ์ กรุณาปักหมุดใหม่หรือข้ามการปักหมุด'; END IF;
 IF lat IS NOT NULL AND (lat NOT BETWEEN 5 AND 21 OR lng NOT BETWEEN 96 AND 106) THEN RAISE EXCEPTION 'หมุดจุดรับอยู่นอกพื้นที่ให้บริการ'; END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_data->>'route_id';
 IF route IS NULL THEN RAISE EXCEPTION 'กรุณาเลือกโรงพยาบาลและพื้นที่ที่เปิดบริการ'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE municipality_id=p_muni AND status IN ('submitted','confirmed')
  AND phone=btrim(p_data->>'phone') AND patient_name=btrim(p_data->>'patient_name') AND appointment_at=appt AND route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอนี้แล้ว กรุณาตรวจการจองเดิมหรือติดต่อเจ้าหน้าที่'; END IF;
 consent:=s.privacy_notice||E'\nเจ้าของรถและผู้รับข้อมูล: '||partner.name;
 INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,in_area,route_id,route_label,
  appointment_at,mobility,companions,share,return_mode,return_at,consent_text,pickup_lat,pickup_lng)
 VALUES(p_id,p_muni,auth.uid(),btrim(p_data->>'requester_name'),btrim(p_data->>'phone'),btrim(p_data->>'patient_name'),p_data->>'relation',btrim(p_data->>'pickup'),
  coalesce((p_data->>'in_area')::boolean,false),p_data->>'route_id',route->>'label',appt,p_data->>'mobility',(p_data->>'companions')::integer,
  coalesce((p_data->>'share')::boolean,false),p_data->>'return_mode',CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,consent,lat,lng);
 PERFORM public.ptb_audit(p_muni,p_id,'submitted');
 PERFORM public.ptb_notice(p_muni,p_id,s.coordinator_ids,'มีคำขอจองรถใหม่ กรุณาตรวจแผน');
 RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_calendar(p_muni uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; lead_days integer; d date; t public.patient_booking_trips;
 days jsonb:='[]'; trips jsonb; free jsonb; occupied record; cursor_at timestamptz; close_at timestamptz;
 day_status text; people integer; occupied_seats integer; shared boolean; joinable boolean; ready boolean;
 today date:=(now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>61 OR p_from<today-31 OR p_to>today+180 THEN RAISE EXCEPTION 'เลือกช่วงวันไม่เกิน 62 วัน และล่วงหน้าไม่เกิน 180 วัน'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT min_lead_days INTO lead_days FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active;
 IF s.enabled IS DISTINCT FROM true OR lead_days IS NULL THEN RETURN jsonb_build_object('days','[]'::jsonb,'enabled',false); END IF;
 ready:=NOT s.unavailable AND s.seats IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles WHERE id=s.driver_id AND municipality_id=p_muni AND role IN ('admin','officer','staff'));
 FOR d IN SELECT x::date FROM generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') x LOOP
  day_status:=CASE WHEN d<today THEN 'past' WHEN NOT ready THEN 'unavailable'
   WHEN extract(isodow FROM d) IN (6,7) OR d=ANY(s.holidays) THEN 'closed'
   WHEN d<today+lead_days THEN 'lead_time'
   WHEN EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state='issue' AND (plan->>'date')=d::text) THEN 'issue'
   ELSE 'open' END;
  trips:='[]'; free:='[]';
  FOR t IN SELECT * FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state<>'cancelled' AND (plan->>'date')=d::text ORDER BY (plan->>'pickup_at')::timestamptz LOOP
   SELECT coalesce(sum(1+companions),0),coalesce(sum(companions+CASE WHEN mobility='walk' THEN 1 ELSE 0 END),0),coalesce(bool_and(share AND mobility='walk'),false)
    INTO people,occupied_seats,shared FROM public.patient_bookings WHERE trip_id=t.id AND status IN ('confirmed','completed');
   joinable:=shared AND day_status='open' AND t.state='confirmed' AND t.driver_id=s.driver_id AND (t.plan->>'pickup_at')::timestamptz>now() AND occupied_seats<s.seats
    AND NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND (cancel_requested OR passenger_step<>0));
   trips:=trips||jsonb_build_array(jsonb_build_object('id',t.id,'date',d,'pickup_at',t.plan->'pickup_at','return_at',CASE WHEN shared THEN t.plan->'return_at' ELSE NULL END,
    'state',CASE WHEN shared THEN t.state ELSE NULL END,
    'public_notice',CASE WHEN shared THEN t.public_notice ELSE NULL END,
    'estimated_pickup_at',CASE WHEN shared THEN t.estimated_pickup_at ELSE NULL END,
    'estimated_return_at',CASE WHEN shared THEN t.estimated_return_at ELSE NULL END,
    'blocks',t.plan->'blocks','route_id',CASE WHEN shared THEN t.plan->>'route_id' ELSE NULL END,
    'route_label',CASE WHEN shared THEN t.plan->>'route_label' ELSE 'รถติดภารกิจ ไม่เปิดร่วมเที่ยว' END,
    'return_mode',CASE WHEN shared THEN t.plan->>'return_mode' ELSE NULL END,'people',CASE WHEN shared THEN people ELSE NULL END,
    'remaining',CASE WHEN shared THEN greatest(s.seats-occupied_seats,0) ELSE NULL END,'joinable',joinable,
    'status',CASE WHEN t.state='completed' THEN 'completed' WHEN t.state='issue' THEN 'issue' WHEN joinable THEN 'joinable' WHEN shared AND occupied_seats>=s.seats THEN 'full' ELSE 'busy' END));
  END LOOP;
  IF day_status='open' THEN
   cursor_at:=(d::timestamp+make_interval(mins=>s.office_start)) AT TIME ZONE 'Asia/Bangkok';
   close_at:=(d::timestamp+make_interval(mins=>s.office_end)) AT TIME ZONE 'Asia/Bangkok';
   cursor_at:=greatest(cursor_at,now());
   FOR occupied IN SELECT (b->>'start')::timestamptz AS starts,(b->>'end')::timestamptz AS ends
    FROM public.patient_booking_trips q CROSS JOIN LATERAL jsonb_array_elements(q.plan->'blocks') b
    WHERE q.municipality_id=p_muni AND q.state<>'cancelled' AND (q.plan->>'date')=d::text ORDER BY starts LOOP
    IF occupied.starts>cursor_at AND cursor_at<close_at THEN free:=free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',least(occupied.starts,close_at))); END IF;
    cursor_at:=greatest(cursor_at,occupied.ends);
   END LOOP;
   IF cursor_at<close_at THEN free:=free||jsonb_build_array(jsonb_build_object('start',cursor_at,'end',close_at)); END IF;
  END IF;
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'status',day_status,'trips',trips,'free',free));
 END LOOP;
 RETURN jsonb_build_object('enabled',true,'days',days,'as_of',now());
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
