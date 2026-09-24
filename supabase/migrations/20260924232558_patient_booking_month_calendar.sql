-- Monthly booking calendar and a calendar-year advance booking horizon.
BEGIN;
DO $guard$ BEGIN
IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_submit(uuid,uuid,jsonb,boolean)')) IS DISTINCT FROM '3895214c2ed29d4fefd228613a232c5d' THEN RAISE EXCEPTION 'Function drift: public.patient_booking_submit(uuid,uuid,jsonb,boolean)'; END IF;
IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text)')) IS DISTINCT FROM 'c7c52b05601f0a403e348987a6945a64' THEN RAISE EXCEPTION 'Function drift: public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text)'; END IF;
IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_calendar(uuid,date,date)')) IS DISTINCT FROM '130e482348aaf1ddbbbf1ef049b302b0' THEN RAISE EXCEPTION 'Function drift: public.patient_booking_calendar(uuid,date,date)'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.patient_booking_submit(p_muni uuid, p_id uuid, p_data jsonb, p_staff_entry boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; partner public.referral_partners;
 old public.patient_bookings; route jsonb; appt timestamptz; back timestamptz; d date; consent text;
 lat double precision; lng double precision; staff boolean:=coalesce(p_staff_entry,false);
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบด้วยบัญชีของหน่วยงานนี้'; END IF;
 -- รับแทนได้เฉพาะผู้จัดคิว/ผู้ดูแล และต้องเป็นคำสั่งจากหน้าทำงานเท่านั้น
 IF staff AND role_name NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'บัญชีนี้ไม่มีสิทธิ์รับจองแทน'; END IF;
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
 IF d IS NULL OR d<(now() AT TIME ZONE 'Asia/Bangkok')::date+(CASE WHEN staff THEN 0 ELSE partner.min_lead_days END) OR d>(now() AT TIME ZONE 'Asia/Bangkok')::date + interval '12 months' THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจองล่วงหน้า'; END IF;
 IF back IS NOT NULL AND (back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>d) THEN RAISE EXCEPTION 'เวลารับกลับต้องหลังนัดและเป็นวันเดียวกัน'; END IF;
 -- Days the public calendar already reports as unbookable. Staff taking a request by phone keep the
 -- existing coordination path; an open incident stays a soft warning because it can be cleared in time.
 IF NOT staff THEN
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
  appointment_at,mobility,companions,share,return_mode,return_at,consent_text,pickup_lat,pickup_lng,entry_channel)
 VALUES(p_id,p_muni,auth.uid(),btrim(p_data->>'requester_name'),btrim(p_data->>'phone'),btrim(p_data->>'patient_name'),p_data->>'relation',btrim(p_data->>'pickup'),
  coalesce((p_data->>'in_area')::boolean,false),p_data->>'route_id',route->>'label',appt,p_data->>'mobility',(p_data->>'companions')::integer,
  coalesce((p_data->>'share')::boolean,false),p_data->>'return_mode',CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,consent,lat,lng,
  CASE WHEN staff THEN 'staff' ELSE 'online' END);
 PERFORM public.ptb_audit(p_muni,p_id,'submitted',jsonb_build_object('entry_channel',CASE WHEN staff THEN 'staff' ELSE 'online' END));
 PERFORM public.ptb_notice(p_muni,p_id,s.coordinator_ids,'มีคำขอจองรถใหม่ กรุณาตรวจแผน');
 RETURN p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.patient_booking_amend(p_muni uuid, p_op uuid, p_id uuid, p_revision integer, p_data jsonb, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.patient_booking_settings; b public.patient_bookings; old public.patient_booking_operations;
 appt timestamptz; back timestamptz; route jsonb; payload jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะผู้ประสานงานแก้ข้อมูลหลังติดต่อผู้จองได้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','amend','entity',p_id,'revision',p_revision,'data',p_data,'note',p_note);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'รหัสการแก้ข้อมูลไม่ถูกต้อง';
 END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 OR char_length(coalesce(btrim(p_note),'')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'ระบุข้อมูลและเหตุผลที่ประสานกับผู้จองแล้ว'; END IF;
 IF p_data-ARRAY['appointment_at','return_at','return_mode','route_id','pickup','in_area']<>'{}'::jsonb THEN RAISE EXCEPTION 'มีข้อมูลที่ไม่รองรับในรายการแก้ไข'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_id AND municipality_id=p_muni;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL THEN RAISE EXCEPTION 'แก้ได้เฉพาะคำขอที่ยังไม่ยืนยันเที่ยว'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 appt:=(p_data->>'appointment_at')::timestamptz; back:=nullif(p_data->>'return_at','')::timestamptz;
 IF appt IS NULL OR (appt AT TIME ZONE 'Asia/Bangkok')::date<(now() AT TIME ZONE 'Asia/Bangkok')::date OR
 (appt AT TIME ZONE 'Asia/Bangkok')::date>(now() AT TIME ZONE 'Asia/Bangkok')::date + interval '12 months' THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจอง'; END IF;
 IF back IS NOT NULL AND (back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>(appt AT TIME ZONE 'Asia/Bangkok')::date) THEN RAISE EXCEPTION 'เวลารับกลับไม่ถูกต้อง'; END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_data->>'route_id';
 IF route IS NULL THEN RAISE EXCEPTION 'เส้นทางไม่ถูกต้อง'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.id<>b.id AND r.municipality_id=p_muni AND r.status IN ('submitted','confirmed') AND r.phone=b.phone AND r.patient_name=b.patient_name AND r.appointment_at=appt AND r.route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอซ้ำในวันเวลานี้'; END IF;
 UPDATE public.patient_bookings SET appointment_at=appt,return_at=CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,
  route_id=route->>'id',route_label=route->>'label',return_mode=p_data->>'return_mode',pickup=btrim(p_data->>'pickup'),
  in_area=coalesce((p_data->>'in_area')::boolean,false),revision=revision+1,updated_at=now() WHERE id=b.id;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,b.id,'amended',jsonb_build_object('note',p_note,'before',jsonb_build_object('appointment_at',b.appointment_at,'return_at',b.return_at,'route_id',b.route_id,'pickup',b.pickup,'in_area',b.in_area,'return_mode',b.return_mode),'after',p_data));
 PERFORM public.ptb_notice(p_muni,b.id,ARRAY[b.created_by],'เจ้าหน้าที่ปรับรายละเอียดตามที่ประสานแล้ว กรุณาตรวจการจอง');
END $function$;

CREATE OR REPLACE FUNCTION public.patient_booking_calendar(p_muni uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.patient_booking_settings; lead_days integer; d date; t public.patient_booking_trips;
 days jsonb:='[]'; trips jsonb; free jsonb; occupied record; cursor_at timestamptz; close_at timestamptz;
 day_status text; people integer; occupied_seats integer; shared boolean; joinable boolean; ready boolean;
 pad_minutes integer;
 today date:=(now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>61 OR p_from<today-31 OR p_to>(today + interval '12 months')::date THEN RAISE EXCEPTION 'เลือกช่วงวันไม่เกิน 62 วัน และล่วงหน้าไม่เกิน 12 เดือน'; END IF;
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
  days:=days||jsonb_build_array(jsonb_build_object('date',d,'status',day_status,'trips',trips,'free',free));
 END LOOP;
 RETURN jsonb_build_object('enabled',true,'days',days,'as_of',now());
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
