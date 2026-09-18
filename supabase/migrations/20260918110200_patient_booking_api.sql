BEGIN;
DO $$ BEGIN IF to_regprocedure('public.ptb_plan(uuid,uuid[],text)') IS NULL THEN RAISE EXCEPTION 'Apply patient_booking_rules first'; END IF; END $$;

CREATE FUNCTION public.patient_booking_info(p_muni uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('booking_mode',true,'enabled',s.enabled AND p.is_active,'owner_name',p.name,'office_start',s.office_start,
 'office_end',s.office_end,'routes',s.routes,'contact_phone',s.contact_phone,'privacy_notice',s.privacy_notice,
 'consent_version','patient-booking-v1','min_lead_days',p.min_lead_days)
 FROM public.patient_booking_settings s JOIN public.referral_partners p ON p.id=s.partner_id
 WHERE s.municipality_id=p_muni AND s.enabled;
$$;

CREATE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') INTO partners FROM public.referral_partners
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

CREATE FUNCTION public.patient_booking_save_settings(p_muni uuid,p_revision integer,p_data jsonb) RETURNS void
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
 IF driver=ANY(ids) THEN RAISE EXCEPTION 'บัญชีคนขับต้องแยกจากผู้ประสานงาน'; END IF;
 IF partner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=partner AND municipality_id=p_muni AND is_active AND 'patient_transport_request'=ANY(document_types)) THEN RAISE EXCEPTION 'หน่วยงานเจ้าของรถไม่ถูกต้อง'; END IF;
 IF jsonb_typeof(p_data->'routes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'routes')>100 THEN RAISE EXCEPTION 'เส้นทางไม่ถูกต้อง'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'routes') LOOP
  IF coalesce(x->>'id','')!~'^[a-zA-Z0-9_-]{1,60}$' OR char_length(coalesce(btrim(x->>'label'),'')) NOT BETWEEN 1 AND 200 OR coalesce((x->>'minutes')::integer,0) NOT BETWEEN 5 AND 240 THEN RAISE EXCEPTION 'กรุณาระบุชื่อและเวลาเดินทางของทุกเส้นทาง'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_data->'routes'))<>jsonb_array_length(p_data->'routes') THEN RAISE EXCEPTION 'รหัสเส้นทางซ้ำ'; END IF;
 IF char_length(coalesce(p_data->>'privacy_notice',''))>6000 OR char_length(coalesce(p_data->>'delegation_reference',''))>500 THEN RAISE EXCEPTION 'ข้อความตั้งค่ายาวเกินกำหนด'; END IF;
 IF v_enabled AND (partner IS NULL OR driver IS NULL OR cardinality(ids)=0 OR
  nullif(btrim(p_data->>'delegation_reference'),'') IS NULL OR nullif(btrim(p_data->>'privacy_notice'),'') IS NULL OR
  nullif(p_data->>'seats','') IS NULL OR nullif(p_data->>'wheelchairs','') IS NULL OR nullif(p_data->>'stretchers','') IS NULL OR
  coalesce((p_data->>'calendar_checked_through')::date,current_date-1)<(now() AT TIME ZONE 'Asia/Bangkok')::date OR
  coalesce(p_data->>'contact_phone','')!~'^0[0-9]{8,9}$' OR jsonb_array_length(p_data->'routes')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการต้องยืนยันเจ้าของรถ คนขับ ผู้ประสานงาน ความจุรถ ปฏิทิน ขอบเขตมอบหมาย ข้อความใช้ข้อมูล และเบอร์ติดต่อ';
 END IF;
 -- Live journeys use their confirmed snapshots; changed settings require review of pending plans.
 IF driver IS DISTINCT FROM s.driver_id AND EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'มีเที่ยวค้าง ต้องจัดการเที่ยวเดิมก่อนเปลี่ยนคนขับ'; END IF;
 UPDATE public.patient_booking_settings SET enabled=v_enabled, partner_id=partner,driver_id=driver,coordinator_ids=ids,
  office_start=(p_data->>'office_start')::integer,office_end=(p_data->>'office_end')::integer,
  seats=nullif(p_data->>'seats','')::integer,wheelchairs=nullif(p_data->>'wheelchairs','')::integer,stretchers=nullif(p_data->>'stretchers','')::integer,
  buffer_minutes=(p_data->>'buffer_minutes')::integer,boarding_minutes=(p_data->>'boarding_minutes')::integer,
  routes=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(value->>'minutes')::integer)),'[]') FROM jsonb_array_elements(p_data->'routes')),
  holidays=ARRAY(SELECT value::date FROM jsonb_array_elements_text(coalesce(p_data->'holidays','[]'))),
  calendar_checked_through=nullif(p_data->>'calendar_checked_through','')::date,unavailable=coalesce((p_data->>'unavailable')::boolean,false),
  delegation_reference=btrim(coalesce(p_data->>'delegation_reference','')),privacy_notice=btrim(coalesce(p_data->>'privacy_notice','')),
  contact_phone=btrim(coalesce(p_data->>'contact_phone','')),revision=s.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'settings_changed',jsonb_build_object('revision',s.revision+1));
END $$;

CREATE FUNCTION public.patient_booking_submit(p_muni uuid,p_id uuid,p_data jsonb) RETURNS uuid
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

CREATE FUNCTION public.patient_booking_preview(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์จัดคิว'; END IF;
 RETURN public.ptb_plan(p_muni,p_ids,p_helper);
END $$;

CREATE FUNCTION public.patient_booking_confirm(p_muni uuid,p_id uuid,p_ids uuid[],p_expected jsonb,p_helper text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; plan jsonb; old public.patient_booking_trips;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ยืนยันคิว'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 SELECT * INTO old FROM public.patient_booking_trips WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.municipality_id=p_muni AND old.confirmed_by=auth.uid() AND old.booking_ids@>p_ids AND old.booking_ids<@p_ids THEN RETURN old.id; END IF;
  RAISE EXCEPTION 'รหัสเที่ยวไม่ถูกต้อง';
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(p_ids) AND (status<>'submitted' OR trip_id IS NOT NULL)) THEN RAISE EXCEPTION 'คำขอถูกจัดคิวหรือเปลี่ยนสถานะแล้ว'; END IF;
 IF char_length(coalesce(p_helper,''))>200 THEN RAISE EXCEPTION 'ชื่อผู้ช่วยยาวเกินกำหนด'; END IF;
 plan:=public.ptb_plan(p_muni,p_ids,p_helper);
 IF plan IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'แผนหรือข้อมูลเปลี่ยนแล้ว กรุณาตรวจแผนล่าสุดก่อนยืนยัน'; END IF;
 IF jsonb_array_length(plan->'errors')>0 THEN RAISE EXCEPTION '%',plan->'errors'; END IF;
 INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,helper_name,confirmed_by)
 VALUES(p_id,p_muni,s.driver_id,p_ids,plan,nullif(btrim(p_helper),''),auth.uid());
 UPDATE public.patient_bookings SET status='confirmed',trip_id=p_id,revision=revision+1,updated_at=now() WHERE id=ANY(p_ids);
 PERFORM public.ptb_audit(p_muni,p_id,'confirmed',jsonb_build_object('booking_ids',p_ids,'plan',plan));
 PERFORM public.ptb_notice(p_muni,p_id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(p_ids))||ARRAY[s.driver_id],'ยืนยันรถและเวลารับแล้ว ดูรายละเอียดการเดินทาง');
 RETURN p_id;
END $$;

-- Every mutation serializes on the tenant's single resource row, checks expected revision,
-- and records operation identity so a network retry cannot advance the next step twice.
CREATE FUNCTION public.patient_booking_action(p_muni uuid,p_op uuid,p_entity uuid,p_revision integer,p_action text,p_note text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; b public.patient_bookings;
 t public.patient_booking_trips; old public.patient_booking_operations; payload jsonb; coordinator boolean; next_step integer; result_state text;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 coordinator:=role_name IN ('admin','coordinator');
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('entity',p_entity,'revision',p_revision,'action',p_action,'note',p_note);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 IF char_length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'ข้อความยาวเกินกำหนด'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_entity AND municipality_id=p_muni;
 IF b.id IS NOT NULL THEN
  SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.trip_id;
  IF NOT coordinator AND b.created_by IS DISTINCT FROM auth.uid() AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอนี้'; END IF;
  IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'คำขอเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
  IF p_action='cancel' THEN
   IF NOT coordinator AND b.created_by<>auth.uid() THEN RAISE EXCEPTION 'เฉพาะผู้จองหรือผู้ประสานงานยกเลิกได้'; END IF;
   IF coordinator AND b.created_by<>auth.uid() AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผลที่ผู้จองแจ้งยกเลิก'; END IF;
   IF b.status='submitted' THEN UPDATE public.patient_bookings SET status='cancelled' WHERE id=b.id;
   ELSIF b.status='confirmed' THEN UPDATE public.patient_bookings SET cancel_requested=true WHERE id=b.id;
   ELSE RAISE EXCEPTION 'คำขอนี้ปิดแล้ว'; END IF;
  ELSIF p_action='ready_return' THEN
   IF NOT coordinator AND b.created_by<>auth.uid() THEN RAISE EXCEPTION 'เฉพาะผู้จองแจ้งพร้อมกลับได้'; END IF;
   IF b.status<>'confirmed' OR b.return_mode='one_way' OR b.passenger_step<>2 THEN RAISE EXCEPTION 'ยังไม่ถึงขั้นแจ้งพร้อมรับกลับ'; END IF;
   UPDATE public.patient_bookings SET return_ready=true WHERE id=b.id;
  ELSIF p_action='cancel_passenger' THEN
   IF NOT coordinator OR b.status<>'confirmed' OR b.passenger_step NOT IN (0,2) OR nullif(btrim(p_note),'') IS NULL THEN
    RAISE EXCEPTION 'ผู้ประสานงานต้องบันทึกผลติดต่อและแผนดูแลต่อ ห้ามนำผู้ที่อยู่ระหว่างเดินทางออกจากเที่ยว';
   END IF;
   UPDATE public.patient_bookings SET status='cancelled',cancel_requested=false WHERE id=b.id;
  ELSIF p_action='passenger_next' THEN
   IF NOT coordinator AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'เฉพาะคนขับที่ได้รับมอบหมาย'; END IF;
   IF b.status<>'confirmed' OR t.state IN ('issue','cancelled','completed') OR s.unavailable THEN RAISE EXCEPTION 'เที่ยวไม่พร้อมดำเนินการ'; END IF;
   next_step:=b.passenger_step+1;
   IF (next_step IN (1,2) AND t.state<>'outbound') OR (next_step IN (3,4) AND t.state<>'returning') OR next_step>4 OR (b.return_mode='one_way' AND next_step>2) THEN RAISE EXCEPTION 'ขั้นตอนรับส่งไม่ตรงกับสถานะเที่ยว'; END IF;
   UPDATE public.patient_bookings SET passenger_step=next_step WHERE id=b.id;
  ELSE RAISE EXCEPTION 'คำสั่งไม่ถูกต้อง'; END IF;
  UPDATE public.patient_bookings SET revision=revision+1,updated_at=now() WHERE id=b.id;
  PERFORM public.ptb_notice(p_muni,b.id,s.coordinator_ids||ARRAY[b.created_by,t.driver_id],CASE p_action WHEN 'cancel' THEN 'มีการยกเลิกหรือขอประสานยกเลิกการจอง' WHEN 'ready_return' THEN 'ผู้จองแจ้งพร้อมรับกลับ กรุณาตรวจแผนรับกลับ' ELSE 'สถานะการเดินทางเปลี่ยนแล้ว' END);
 ELSE
  SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_entity AND municipality_id=p_muni;
  IF t.id IS NULL OR (NOT coordinator AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid())) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับเที่ยวนี้'; END IF;
  IF t.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'เที่ยวเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
  result_state:=t.state;
  IF p_action='issue' THEN
   IF t.state IN ('completed','cancelled','issue') OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'ระบุเหตุขัดข้องของเที่ยวที่ยังไม่ปิด'; END IF;
   UPDATE public.patient_booking_trips SET state_before_issue=state,issue_note=btrim(p_note) WHERE id=t.id;
   result_state:='issue';
  ELSIF p_action='resolve' THEN
   IF NOT coordinator OR t.state<>'issue' OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'ผู้ประสานงานต้องระบุผลแก้ไขเหตุขัดข้อง'; END IF;
   IF s.unavailable THEN RAISE EXCEPTION 'รถหรือคนขับยังไม่พร้อม'; END IF;
   result_state:=t.state_before_issue;
  ELSIF p_action='release' THEN
   IF NOT coordinator OR NOT(t.state='confirmed' OR (t.state='issue' AND t.state_before_issue='confirmed')) OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND passenger_step<>0) OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'คืนคิวได้เฉพาะก่อนรถออก พร้อมเหตุผล'; END IF;
   result_state:='cancelled';
   UPDATE public.patient_bookings SET status=CASE WHEN cancel_requested OR status='cancelled' THEN 'cancelled' ELSE 'submitted' END,
    trip_id=NULL,cancel_requested=false,revision=revision+1,updated_at=now() WHERE trip_id=t.id;
  ELSIF p_action='trip_next' THEN
   IF s.unavailable OR t.state IN ('issue','completed','cancelled') THEN RAISE EXCEPTION 'เที่ยวไม่พร้อมดำเนินการ'; END IF;
   IF t.state IN ('confirmed','hospital') AND EXISTS(SELECT 1 FROM public.patient_booking_trips other
    WHERE other.municipality_id=p_muni AND other.id<>t.id AND (other.state IN ('outbound','returning','issue') OR (other.state='hospital' AND other.plan->>'return_mode'='wait'))) THEN RAISE EXCEPTION 'รถหรือคนขับกำลังปฏิบัติงานเที่ยวอื่น'; END IF;
   CASE t.state
    WHEN 'confirmed' THEN result_state:='outbound';
    WHEN 'outbound' THEN
     IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND passenger_step<2) THEN RAISE EXCEPTION 'ต้องบันทึกส่งถึงโรงพยาบาลครบทุกคนก่อน'; END IF;
     result_state:=CASE WHEN t.plan->>'return_mode'='one_way' OR NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed') THEN 'completed' ELSE 'hospital' END;
    WHEN 'hospital' THEN result_state:='returning';
    WHEN 'returning' THEN
     IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND passenger_step<4) THEN RAISE EXCEPTION 'ต้องบันทึกส่งกลับครบทุกคนก่อนจบเที่ยว'; END IF;
     result_state:='completed';
    ELSE RAISE EXCEPTION 'ขั้นตอนไม่ถูกต้อง';
   END CASE;
  ELSE RAISE EXCEPTION 'คำสั่งไม่ถูกต้อง'; END IF;
  UPDATE public.patient_booking_trips SET state=result_state,revision=revision+1,updated_at=now() WHERE id=t.id;
  IF result_state='completed' THEN UPDATE public.patient_bookings SET status='completed',revision=revision+1,updated_at=now() WHERE trip_id=t.id AND status='confirmed'; END IF;
  PERFORM public.ptb_notice(p_muni,t.id,s.coordinator_ids||ARRAY[t.driver_id]||ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(t.booking_ids)),'สถานะเที่ยวรถเปลี่ยนแล้ว กรุณาตรวจรายละเอียด');
 END IF;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,p_entity,p_action,jsonb_build_object('note',coalesce(p_note,''),'from_revision',p_revision));
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_info(uuid),public.patient_booking_workspace(uuid),
 public.patient_booking_save_settings(uuid,integer,jsonb),public.patient_booking_submit(uuid,uuid,jsonb),
 public.patient_booking_preview(uuid,uuid[],text),public.patient_booking_confirm(uuid,uuid,uuid[],jsonb,text),
 public.patient_booking_action(uuid,uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_info(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_workspace(uuid),public.patient_booking_save_settings(uuid,integer,jsonb),
 public.patient_booking_submit(uuid,uuid,jsonb),public.patient_booking_preview(uuid,uuid[],text),
 public.patient_booking_confirm(uuid,uuid,uuid[],jsonb,text),public.patient_booking_action(uuid,uuid,uuid,integer,text,text) TO authenticated;
COMMIT;
