-- Community transport backend. Full latest definitions; no production writes or flag changes.
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text)','5a4c9eb41b4ee72a138fd54de6052d55',
 'public.patient_booking_change_hospital(uuid,uuid,uuid,jsonb,text,text)','1e3c457fb6008e81d93f207e6f5fbab4'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

DO $$ BEGIN
 IF to_regprocedure('public.patient_booking_period_report_v2(uuid,date,date,text)') IS NULL THEN RAISE EXCEPTION 'Apply community scheduler, projections and reports first'; END IF;
END $$;
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
 IF b.service_type IS DISTINCT FROM 'patient' AND b.id IS NOT NULL THEN RAISE EXCEPTION 'คำขอชุมชนต้องใช้รายการแก้ข้อมูลชุมชน'; END IF;
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

CREATE OR REPLACE FUNCTION public.patient_booking_change_hospital(
 p_muni uuid,p_op uuid,p_booking uuid,p_expected jsonb,p_route text,p_scope text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; b public.patient_bookings; t public.patient_booking_trips;
 old public.patient_booking_operations; expected jsonb; payload jsonb; result jsonb; route jsonb;
 ids uuid[]; remaining uuid[]; destination_plan jsonb; source_plan jsonb; new_trip uuid; recipients uuid[];
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะผู้รับผิดชอบคิวหรือแอดมินเปลี่ยนโรงพยาบาลได้'; END IF;
 IF p_op IS NULL OR p_booking IS NULL OR p_scope IS NULL OR p_scope NOT IN ('single','all') THEN RAISE EXCEPTION 'ข้อมูลเปลี่ยนโรงพยาบาลไม่ครบ'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','change_hospital','booking',p_booking,'expected',p_expected,'route',p_route,'scope',p_scope);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload-'result'=payload THEN RETURN old.payload->'result'; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni FOR UPDATE;
 IF b.service_type IS DISTINCT FROM 'patient' AND b.id IS NOT NULL THEN RAISE EXCEPTION 'คำขอชุมชนเปลี่ยนโรงพยาบาลไม่ได้'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.trip_id AND municipality_id=p_muni FOR UPDATE;
 IF b.id IS NULL OR b.status<>'confirmed' OR t.id IS NULL OR t.state<>'confirmed' OR t.odometer_end IS NOT NULL THEN
  RAISE EXCEPTION 'เปลี่ยนโรงพยาบาลได้เฉพาะคิวที่ยืนยันแล้วและรถยังไม่ออก';
 END IF;
 PERFORM 1 FROM public.patient_bookings WHERE trip_id=t.id ORDER BY id FOR UPDATE;
 SELECT jsonb_build_object('trip',t.id,'revision',t.revision,'docs_revision',t.docs_revision,
  'schedule_revision',t.schedule_revision,'settings_revision',s.revision,
  'bookings',coalesce(jsonb_object_agg(id::text,revision),'{}')) INTO expected
  FROM public.patient_bookings WHERE trip_id=t.id AND status<>'cancelled';
 IF expected IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'คิวเปลี่ยนแล้ว กรุณาปิดฟอร์มและเปิดใหม่จากข้อมูลล่าสุด'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status<>'cancelled'
  AND (status<>'confirmed' OR passenger_step<>0 OR return_ready OR cancel_requested)) THEN
  RAISE EXCEPTION 'มีผู้เริ่มเดินทางหรือขอยกเลิก กรุณาจัดการคิวก่อนเปลี่ยนโรงพยาบาล';
 END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_route;
 IF route IS NULL THEN RAISE EXCEPTION 'กรุณาเลือกโรงพยาบาลที่ตั้งไว้สำหรับหน่วยงานนี้'; END IF;
 IF p_route=b.route_id THEN RAISE EXCEPTION 'โรงพยาบาลใหม่เหมือนเดิม'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.patient_bookings
  WHERE trip_id=t.id AND status='confirmed' AND (p_scope='all' OR id=b.id);
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO remaining FROM public.patient_bookings
  WHERE trip_id=t.id AND status='confirmed' AND NOT(id=ANY(ids));
 SELECT ARRAY(SELECT DISTINCT unnest(s.coordinator_ids||ARRAY[t.driver_id]||ARRAY(
  SELECT created_by FROM public.patient_bookings WHERE trip_id=t.id))) INTO recipients;
 -- Any failed plan raises an exception: every change below rolls back together.
 UPDATE public.patient_bookings SET route_id=p_route,route_label=route->>'label',requested_trip_id=NULL,
  revision=revision+1,updated_at=now() WHERE id=ANY(ids);
 IF EXISTS(SELECT 1 FROM public.patient_bookings x JOIN public.patient_bookings y ON x.municipality_id=y.municipality_id
  AND x.phone=y.phone AND x.patient_name=y.patient_name AND x.route_id=y.route_id AND x.appointment_at=y.appointment_at
  WHERE x.id=ANY(ids) AND NOT(y.id=ANY(ids)) AND y.status IN ('submitted','confirmed')) THEN
  RAISE EXCEPTION 'มีคำขอของผู้เดินทางนี้ไปโรงพยาบาลใหม่ในเวลานี้แล้ว กรุณาตรวจรายการเดิม';
 END IF;
 new_trip:=t.id;
 IF cardinality(remaining)>0 THEN
  new_trip:=gen_random_uuid();
  UPDATE public.patient_bookings SET trip_id=NULL WHERE id=ANY(ids);
  UPDATE public.patient_booking_trips SET booking_ids=remaining WHERE id=t.id;
  source_plan:=public.ptb_plan(p_muni,remaining,t.helper_name);
  IF jsonb_array_length(source_plan->'errors')>0 THEN RAISE EXCEPTION 'จัดเที่ยวเดิมใหม่ไม่ได้: %',source_plan->'errors'; END IF;
  UPDATE public.patient_booking_trips SET plan=source_plan,revision=revision+1,docs_revision=docs_revision+1,
   estimated_pickup_at=NULL,estimated_return_at=NULL,public_notice='normal',schedule_revision=schedule_revision+1,updated_at=now() WHERE id=t.id;
 END IF;
 destination_plan:=public.ptb_plan(p_muni,ids,t.helper_name);
 IF jsonb_array_length(destination_plan->'errors')>0 THEN
  RAISE EXCEPTION 'เปลี่ยนโรงพยาบาลไม่ได้: % · คิวเดิมยังอยู่ กรุณาประสานเวลาแล้วใช้เปลี่ยนวันและเวลาเดินทางก่อนลองใหม่',destination_plan->'errors';
 END IF;
 IF new_trip=t.id THEN
  UPDATE public.patient_booking_trips SET plan=destination_plan,revision=revision+1,docs_revision=docs_revision+1,
   estimated_pickup_at=NULL,estimated_return_at=NULL,public_notice='normal',schedule_revision=schedule_revision+1,updated_at=now() WHERE id=t.id;
 ELSE
  INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,helper_name,confirmed_by)
   VALUES(new_trip,p_muni,t.driver_id,ids,destination_plan,t.helper_name,auth.uid());
  UPDATE public.patient_bookings SET trip_id=new_trip WHERE id=ANY(ids);
 END IF;
 IF cardinality(remaining)=0 THEN
  PERFORM public.ptb_notice(p_muni,t.id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE requested_trip_id=t.id AND status='submitted'),
   'เที่ยวที่ขอร่วมเปลี่ยนโรงพยาบาลแล้ว เจ้าหน้าที่จะตรวจและจัดคิวให้ใหม่');
  UPDATE public.patient_bookings SET requested_trip_id=NULL,revision=revision+1,updated_at=now() WHERE requested_trip_id=t.id AND status='submitted';
 END IF;
 PERFORM public.ptb_audit(p_muni,b.id,'hospital_changed',jsonb_build_object('scope',p_scope,'booking_ids',ids,
  'old_trip',t.id,'new_trip',new_trip,'before_route',b.route_id,'after_route',p_route,'before_plan',t.plan,'after_plan',destination_plan));
 PERFORM public.ptb_notice(p_muni,new_trip,recipients,'เจ้าหน้าที่เปลี่ยนโรงพยาบาลแล้ว กรุณาตรวจโรงพยาบาลและเวลารับล่าสุด และพิมพ์เอกสารใหม่');
 result:=jsonb_build_object('saved',true,'trip_id',new_trip);
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload||jsonb_build_object('result',result));
 RETURN result;
END $$;

-- Validation shared by intake and staff amendment. This helper has no client ACL.
CREATE FUNCTION public.ptb_community_payload(p_muni uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.patient_booking_community_rules; info jsonb; place jsonb; activity jsonb;
 appt timestamptz; back timestamptz; lat double precision; lng double precision; key text; value jsonb;
BEGIN
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 THEN RAISE EXCEPTION 'ข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
 IF p_data-ARRAY['requester_name','phone','pickup','pickup_lat','pickup_lng','in_area','route_id','appointment_at','return_at','return_mode','group_label','party_size','purpose_code','rules_version','consent','consent_version','privacy_notice','owner_name']<>'{}'::jsonb THEN RAISE EXCEPTION 'มีข้อมูลที่ไม่รองรับในคำขอชุมชน'; END IF;
 FOR key,value IN SELECT * FROM jsonb_each(p_data) LOOP
  IF key IN ('party_size','rules_version','pickup_lat','pickup_lng') THEN
   IF jsonb_typeof(value)<>'number' AND NOT(key IN ('pickup_lat','pickup_lng') AND value='null'::jsonb) THEN RAISE EXCEPTION 'ชนิดข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
  ELSIF key IN ('consent','in_area') THEN
   IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'ชนิดข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
  ELSIF key='return_at' AND value='null'::jsonb THEN NULL;
  ELSIF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'ชนิดข้อมูลคำขอชุมชนไม่ถูกต้อง';
  END IF;
 END LOOP;
 IF p_data->'consent' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'ต้องยืนยันการใช้ข้อมูลสำหรับบริการชุมชน'; END IF;
 info:=public.patient_booking_info(p_muni);
 IF p_data->>'consent_version' IS DISTINCT FROM 'community-booking-v1'
  OR p_data->>'privacy_notice' IS DISTINCT FROM info->'community'->>'privacy_notice'
  OR p_data->>'owner_name' IS DISTINCT FROM info->>'owner_name' OR info IS NULL THEN RAISE EXCEPTION 'ข้อความใช้ข้อมูลชุมชนเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 IF c.municipality_id IS NULL OR c.window_start IS NULL OR c.window_end IS NULL THEN RAISE EXCEPTION 'ยังไม่ตั้งช่วงเวลาบริการชุมชน'; END IF;
 IF coalesce(p_data->>'rules_version','') !~ '^[1-9][0-9]{0,8}$' OR (p_data->>'rules_version')::integer IS DISTINCT FROM c.rules_version THEN RAISE EXCEPTION 'กฎบริการชุมชนเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 IF coalesce(p_data->>'party_size','') !~ '^[1-9][0-9]?$' OR (p_data->>'party_size')::integer NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางชุมชนต้องเป็น 1 ถึง 15 คน'; END IF;
 IF char_length(coalesce(btrim(p_data->>'requester_name'),'')) NOT BETWEEN 1 AND 200
  OR coalesce(btrim(p_data->>'phone'),'') !~ '^0[0-9]{8,9}$'
  OR char_length(coalesce(btrim(p_data->>'pickup'),'')) NOT BETWEEN 1 AND 500
  OR char_length(coalesce(btrim(p_data->>'group_label'),'')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'ระบุชื่อผู้ติดต่อ เบอร์โทร จุดรับ และชื่อกลุ่มให้ครบ'; END IF;
 IF p_data->>'return_mode' IS NULL OR p_data->>'return_mode' NOT IN ('one_way','wait','later') THEN RAISE EXCEPTION 'รูปแบบรับกลับไม่ถูกต้อง'; END IF;
 SELECT x INTO place FROM jsonb_array_elements(c.places) x WHERE x->>'id'=p_data->>'route_id';
 IF place IS NULL OR p_data->>'route_id'='__other__' OR place->>'minutes' IS NULL THEN RAISE EXCEPTION 'ยังไม่ตั้งสถานที่ชุมชนและเวลาเดินทาง'; END IF;
 SELECT x INTO activity FROM jsonb_array_elements(c.activities) x WHERE x->>'code'=p_data->>'purpose_code';
 IF activity IS NULL THEN RAISE EXCEPTION 'กิจกรรมชุมชนไม่อยู่ในกฎที่ตั้งไว้'; END IF;
 BEGIN
  appt:=(p_data->>'appointment_at')::timestamptz; back:=(p_data->>'return_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'วันเวลาคำขอชุมชนไม่ถูกต้อง'; END;
 IF appt IS NULL OR NOT isfinite(appt) OR (appt AT TIME ZONE 'Asia/Bangkok')::date<(now() AT TIME ZONE 'Asia/Bangkok')::date
  OR (appt AT TIME ZONE 'Asia/Bangkok')::date>((now() AT TIME ZONE 'Asia/Bangkok')::date+interval '12 months')::date THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจอง'; END IF;
 IF appt < (((appt AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+make_interval(mins=>c.window_start)) AT TIME ZONE 'Asia/Bangkok'
  OR appt > (((appt AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+make_interval(mins=>c.window_end)) AT TIME ZONE 'Asia/Bangkok' THEN RAISE EXCEPTION 'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน'; END IF;
 IF p_data->>'return_mode'='one_way' AND back IS NOT NULL THEN RAISE EXCEPTION 'เที่ยวขาเดียวต้องไม่มีเวลารับกลับ'; END IF;
 IF back IS NOT NULL AND (NOT isfinite(back) OR back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>(appt AT TIME ZONE 'Asia/Bangkok')::date) THEN RAISE EXCEPTION 'เวลารับกลับไม่ถูกต้อง'; END IF;
 lat:=(p_data->>'pickup_lat')::double precision; lng:=(p_data->>'pickup_lng')::double precision;
 IF (lat IS NULL)<>(lng IS NULL) OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'พิกัดจุดรับไม่ถูกต้อง'; END IF;
 RETURN jsonb_build_object('requester_name',btrim(p_data->>'requester_name'),'phone',btrim(p_data->>'phone'),
  'pickup',btrim(p_data->>'pickup'),'pickup_lat',lat,'pickup_lng',lng,'in_area',coalesce((p_data->>'in_area')::boolean,false),
  'route_id',place->>'id','route_label',place->>'label','appointment_at',appt,'return_at',back,'return_mode',p_data->>'return_mode',
  'group_label',btrim(p_data->>'group_label'),'party_size',(p_data->>'party_size')::integer,'purpose_code',activity->>'code',
  'rules_version',c.rules_version,'consent_text','community-booking-v1'||E'\n'||(info->'community'->>'privacy_notice')||E'\nเจ้าของรถและผู้รับข้อมูล: '||(info->>'owner_name'));
END $$;
REVOKE ALL ON FUNCTION public.ptb_community_payload(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.patient_booking_submit_community(p_muni uuid,p_id uuid,p_data jsonb,p_staff boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=coalesce(public.ptb_role(p_muni),'anonymous'); s public.patient_booking_settings;
 c public.patient_booking_community_rules; b public.patient_bookings; data jsonb; old public.patient_booking_operations; payload jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบในหน่วยงานนี้'; END IF;
 IF p_staff IS NULL OR (p_staff AND role_name NOT IN ('admin','coordinator')) THEN RAISE EXCEPTION 'บัญชีนี้ไม่มีสิทธิ์รับจองแทน'; END IF;
 IF p_id IS NULL THEN RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 THEN RAISE EXCEPTION 'ข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
 -- The same tenant row is also locked by patient submission, confirmation, moves and hospital changes.
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','submit_community','entity',p_id,'data_hash',encode(sha256(convert_to(p_data::text,'UTF8')),'hex'),'staff',p_staff);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN p_id; END IF;
  RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง';
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=p_id) THEN RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง'; END IF;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 IF s.enabled IS DISTINCT FROM true OR c.enabled IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active) THEN RAISE EXCEPTION 'บริการชุมชนปิดรับคำขอใหม่'; END IF;
 IF s.unavailable AND NOT p_staff THEN RAISE EXCEPTION 'รถหรือคนขับยังไม่พร้อมให้บริการ'; END IF;
 data:=public.ptb_community_payload(p_muni,p_data);
 IF NOT p_staff AND (data->>'appointment_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เวลานัดผ่านแล้ว กรุณาเลือกเวลาที่ยังไม่ผ่าน'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE municipality_id=p_muni AND service_type='community' AND status IN ('submitted','confirmed')
  AND phone=data->>'phone' AND group_label=data->>'group_label' AND appointment_at=(data->>'appointment_at')::timestamptz AND route_id=data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอชุมชนนี้แล้ว กรุณาตรวจการจองเดิม'; END IF;
 INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,pickup_lat,pickup_lng,in_area,route_id,route_label,
  appointment_at,mobility,companions,share,return_mode,return_at,consent_text,consent_version,entry_channel,service_type,party_size,group_label,purpose_code,rules_version)
 VALUES(p_id,p_muni,auth.uid(),data->>'requester_name',data->>'phone',NULL,NULL,data->>'pickup',(data->>'pickup_lat')::double precision,(data->>'pickup_lng')::double precision,
  (data->>'in_area')::boolean,data->>'route_id',data->>'route_label',(data->>'appointment_at')::timestamptz,'walk',0,false,data->>'return_mode',(data->>'return_at')::timestamptz,
  data->>'consent_text','community-booking-v1',CASE WHEN p_staff THEN 'staff' ELSE 'online' END,'community',(data->>'party_size')::integer,data->>'group_label',data->>'purpose_code',(data->>'rules_version')::integer);
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_id,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,p_id,'submitted',jsonb_build_object('entry_channel',CASE WHEN p_staff THEN 'staff' ELSE 'online' END,'service_type','community','party_size',(data->>'party_size')::integer,'rules_version',(data->>'rules_version')::integer));
 PERFORM public.ptb_notice(p_muni,p_id,s.coordinator_ids,'มีคำขอรถรับ–ส่งชุมชนใหม่ กรุณาตรวจแผน');
 RETURN p_id;
END $$;

CREATE FUNCTION public.patient_booking_amend_community(p_muni uuid,p_op uuid,p_id uuid,p_revision integer,p_data jsonb,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; s public.patient_booking_settings; data jsonb; old public.patient_booking_operations; payload jsonb;
BEGIN
 IF coalesce(public.ptb_role(p_muni),'anonymous') NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะผู้ประสานงานแก้ข้อมูลหลังติดต่อผู้จองได้'; END IF;
 IF p_op IS NULL THEN RAISE EXCEPTION 'รหัสการแก้ข้อมูลไม่ถูกต้อง'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 THEN RAISE EXCEPTION 'ข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','amend_community','entity',p_id,'revision',p_revision,'data_hash',encode(sha256(convert_to(p_data::text,'UTF8')),'hex'),'note_hash',encode(sha256(convert_to(p_note,'UTF8')),'hex'));
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'รหัสการแก้ข้อมูลไม่ถูกต้อง';
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_id AND municipality_id=p_muni FOR UPDATE;
 IF b.id IS NULL OR b.service_type<>'community' OR b.status<>'submitted' OR b.trip_id IS NOT NULL THEN RAISE EXCEPTION 'แก้ได้เฉพาะคำขอชุมชนที่ยังไม่ยืนยันเที่ยว'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 IF char_length(coalesce(btrim(p_note),'')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'ระบุเหตุผลที่ประสานกับผู้จองแล้ว'; END IF;
 -- Closing intake does not stop correction of already accepted work. Creator and channel are immutable.
 data:=public.ptb_community_payload(p_muni,p_data);
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id<>p_id AND municipality_id=p_muni AND service_type='community' AND status IN ('submitted','confirmed')
  AND phone=data->>'phone' AND group_label=data->>'group_label' AND appointment_at=(data->>'appointment_at')::timestamptz AND route_id=data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอชุมชนนี้แล้ว กรุณาตรวจการจองเดิม'; END IF;
 UPDATE public.patient_bookings SET requester_name=data->>'requester_name',phone=data->>'phone',pickup=data->>'pickup',
  pickup_lat=(data->>'pickup_lat')::double precision,pickup_lng=(data->>'pickup_lng')::double precision,in_area=(data->>'in_area')::boolean,
  route_id=data->>'route_id',route_label=data->>'route_label',appointment_at=(data->>'appointment_at')::timestamptz,
  return_mode=data->>'return_mode',return_at=(data->>'return_at')::timestamptz,party_size=(data->>'party_size')::integer,group_label=data->>'group_label',
  purpose_code=data->>'purpose_code',rules_version=(data->>'rules_version')::integer,consent_text=data->>'consent_text',consent_at=now(),revision=revision+1,updated_at=now() WHERE id=p_id;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 -- Avoid copying group/contact data into the permanent audit trail.
 PERFORM public.ptb_audit(p_muni,p_id,'amended',jsonb_build_object('note',btrim(p_note),'service_type','community','before_revision',b.revision,'after_revision',b.revision+1,'rules_version',(data->>'rules_version')::integer));
 PERFORM public.ptb_notice(p_muni,p_id,ARRAY[b.created_by],'เจ้าหน้าที่ปรับรายละเอียดตามที่ประสานแล้ว กรุณาตรวจการจอง');
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_submit_community(uuid,uuid,jsonb,boolean),public.patient_booking_amend_community(uuid,uuid,uuid,integer,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_submit_community(uuid,uuid,jsonb,boolean),public.patient_booking_amend_community(uuid,uuid,uuid,integer,jsonb,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
