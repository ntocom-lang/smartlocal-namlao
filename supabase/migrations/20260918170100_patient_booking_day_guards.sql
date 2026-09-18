-- Keep requests that can never be confirmed out of the queue: holidays, unchecked calendar days,
-- lead time and a vehicle marked unavailable are rejected at intake instead of by a phone call.
-- Also exposes the timing values the booking form needs to warn before office hours are exceeded.
BEGIN;
CREATE OR REPLACE FUNCTION public.patient_booking_info(p_muni uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('booking_mode',true,'enabled',s.enabled AND p.is_active,'owner_name',p.name,'office_start',s.office_start,
 'office_end',s.office_end,'routes',s.routes,'contact_phone',s.contact_phone,'privacy_notice',s.privacy_notice,
 'consent_version','patient-booking-v1','min_lead_days',p.min_lead_days,
 'buffer_minutes',s.buffer_minutes,'boarding_minutes',s.boarding_minutes)
 FROM public.patient_booking_settings s JOIN public.referral_partners p ON p.id=s.partner_id
 WHERE s.municipality_id=p_muni AND s.enabled;
$$;

CREATE OR REPLACE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings;
 b jsonb; t jsonb; partners jsonb; people jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'appointment_at'),'[]') INTO b FROM (
  SELECT CASE WHEN role_name='driver' AND r.created_by<>auth.uid() THEN jsonb_build_object('id',r.id,'trip_id',r.trip_id,'patient_name',r.patient_name,
   'phone',r.phone,'pickup',r.pickup,'mobility',r.mobility,'companions',r.companions,'passenger_step',r.passenger_step,
   'revision',r.revision,'return_ready',r.return_ready,'cancel_requested',r.cancel_requested,'appointment_at',r.appointment_at,
   'return_mode',r.return_mode,'status',r.status,'route_label',r.route_label)
  ELSE to_jsonb(r)-'consent_text' END x
  FROM public.patient_bookings r WHERE r.municipality_id=p_muni
  AND (r.status IN ('submitted','confirmed') OR r.updated_at>now()-interval '30 days')
  AND (role_name IN ('admin','coordinator') OR r.created_by=auth.uid() OR (role_name='driver' AND r.status='confirmed' AND EXISTS(
   SELECT 1 FROM public.patient_booking_trips tr WHERE tr.id=r.trip_id AND tr.driver_id=auth.uid() AND tr.state NOT IN ('cancelled','completed'))))
  ORDER BY r.appointment_at LIMIT 1000
 ) rows;
 SELECT coalesce(jsonb_agg(x),'[]') INTO t FROM (
  SELECT CASE WHEN role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) THEN to_jsonb(tr)
   ELSE jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required') END x
  FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND (role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) OR EXISTS(
   SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid()))
  ORDER BY tr.created_at DESC LIMIT 1000
 ) rows;
 IF role_name='admin' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'min_lead_days',min_lead_days)),'[]') INTO partners FROM public.referral_partners
  WHERE municipality_id=p_muni AND is_active AND 'patient_transport_request'=ANY(document_types);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role)),'[]') INTO people FROM public.profiles
  WHERE municipality_id=p_muni AND role IN ('admin','officer','staff');
 END IF;
 RETURN jsonb_build_object('role',role_name,'settings',CASE WHEN role_name IN ('admin','coordinator') THEN to_jsonb(s) ELSE NULL END,
  'bookings',b,'trips',t,'limited',jsonb_array_length(b)=1000 OR jsonb_array_length(t)=1000,'partners',partners,'people',people,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n),
  'events',CASE WHEN role_name IN ('admin','coordinator') THEN (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM
   (SELECT entity_id,action,detail,created_at FROM public.patient_booking_events WHERE municipality_id=p_muni ORDER BY created_at DESC LIMIT 50)e) ELSE '[]'::jsonb END);
END $$;


CREATE OR REPLACE FUNCTION public.patient_booking_submit(p_muni uuid,p_id uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; partner public.referral_partners;
 old public.patient_bookings; route jsonb; appt timestamptz; back timestamptz; d date; consent text;
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
  IF s.calendar_checked_through IS NULL OR d>s.calendar_checked_through THEN RAISE EXCEPTION 'ยังไม่ได้ตรวจปฏิทินวันหยุดถึงวันที่เลือก กรุณาเลือกวันที่ใกล้กว่านี้หรือติดต่อเจ้าหน้าที่'; END IF;
 END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_data->>'route_id';
 IF route IS NULL THEN RAISE EXCEPTION 'กรุณาเลือกโรงพยาบาลและพื้นที่ที่เปิดบริการ'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE municipality_id=p_muni AND status IN ('submitted','confirmed')
  AND phone=btrim(p_data->>'phone') AND patient_name=btrim(p_data->>'patient_name') AND appointment_at=appt AND route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอนี้แล้ว กรุณาตรวจการจองเดิมหรือติดต่อเจ้าหน้าที่'; END IF;
 consent:=s.privacy_notice||E'\nเจ้าของรถและผู้รับข้อมูล: '||partner.name;
 INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,in_area,route_id,route_label,
  appointment_at,mobility,companions,share,return_mode,return_at,consent_text)
 VALUES(p_id,p_muni,auth.uid(),btrim(p_data->>'requester_name'),btrim(p_data->>'phone'),btrim(p_data->>'patient_name'),p_data->>'relation',btrim(p_data->>'pickup'),
  coalesce((p_data->>'in_area')::boolean,false),p_data->>'route_id',route->>'label',appt,p_data->>'mobility',(p_data->>'companions')::integer,
  coalesce((p_data->>'share')::boolean,false),p_data->>'return_mode',CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,consent);
 PERFORM public.ptb_audit(p_muni,p_id,'submitted');
 PERFORM public.ptb_notice(p_muni,p_id,s.coordinator_ids,'มีคำขอจองรถใหม่ กรุณาตรวจแผน');
 RETURN p_id;
END $$;

COMMIT;
