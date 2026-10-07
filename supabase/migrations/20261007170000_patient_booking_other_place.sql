-- สถานที่อื่น (ช่อง "อื่นๆ" ในข้อ "โรงพยาบาลที่จะไป"): ผู้จองพิมพ์ชื่อสถานที่ที่ไม่อยู่ในรายการเองได้
--
-- แอดมินเปิดช่องนี้ครั้งเดียวในหน้าตั้งค่า (เจ้าของระบบเลือก 2569-10-07 "ค่ามาตรฐานที่แอดมินตั้งครั้งเดียว"):
-- เก็บเป็นเส้นทางหนึ่งใน patient_booking_settings.routes ที่ id = '__other__' มีแค่ minutes = เวลาเดินทางมาตรฐาน
-- ไม่มีคอลัมน์ใหม่ ไม่แตะ ptb_plan: ptb_plan หาเส้นทางจาก routes เหมือนเดิมแล้วคิดช่วงที่รถถูกกันจาก minutes นั้น
--
--   patient_booking_submit       '__other__' ต้องมี p_data.other_place (2–200 ตัวอักษร หลังยุบช่องว่าง/ตัวควบคุม)
--                                เก็บเป็น route_label ของคำขอนั้น (ไหลไปเอกสาร/จอคนขับ/รายงานเหมือนชื่อโรงพยาบาล)
--                                และบังคับ share=false: ptb_plan เทียบปลายทางด้วย route_id จึงมองสถานที่อื่นทุกแห่งเป็นแห่งเดียวกัน
--                                ร่วมเที่ยวได้เมื่อทุกใบ share=true เท่านั้น (ptb_plan: ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว)
--   patient_booking_amend        รับ other_place · ไม่ส่ง = คงชื่อเดิม (ไม่เขียนทับด้วยป้าย "อื่นๆ") · เปลี่ยนมาจากแห่งอื่นต้องระบุชื่อ
--   patient_booking_change_hospital  ปฏิเสธปลายทาง '__other__' (ไม่มีที่ให้พิมพ์ชื่อ) ต้นทางเป็น '__other__' แก้เป็นโรงพยาบาลในรายการได้
-- ยกนิยามล่าสุดมาเต็มทุกบรรทัด: submit จาก 20260926114444 · amend/change_hospital จาก 20261003130400
-- ถ้ายังไม่ได้เปิดช่องในตั้งค่า ไม่มีคำขอไหนใช้ '__other__' พฤติกรรมเดิมทุกอย่าง
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object(
 'public.patient_booking_submit(uuid,uuid,jsonb,boolean)','18ddf8cc4cda1cff45e33124dcc6aa91',
 'public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text)','2e99ee9c46cdea0731c836e2498e2589',
 'public.patient_booking_change_hospital(uuid,uuid,uuid,jsonb,text,text)','81902cd0fc9247cd56ec06f0c7607e38'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.patient_booking_submit(p_muni uuid, p_id uuid, p_data jsonb, p_staff_entry boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; partner public.referral_partners;
 old public.patient_bookings; route jsonb; appt timestamptz; back timestamptz; d date; consent text;
 lat double precision; lng double precision; staff boolean:=coalesce(p_staff_entry,false); other_text text;
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
 IF d IS NULL OR d<(now() AT TIME ZONE 'Asia/Bangkok')::date OR d>(now() AT TIME ZONE 'Asia/Bangkok')::date + interval '12 months' THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจองล่วงหน้า'; END IF;
 IF NOT staff AND appt<=now() THEN RAISE EXCEPTION 'วันนัดหรือเวลานัดผ่านมาแล้ว กรุณาเลือกเวลาที่ยังจองได้'; END IF;
 IF back IS NOT NULL AND (back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>d) THEN RAISE EXCEPTION 'เวลารับกลับต้องหลังนัดและเป็นวันเดียวกัน'; END IF;
 -- Days the public calendar already reports as unbookable. Staff taking a request by phone keep the
 -- existing coordination path; an open incident stays a soft warning because it can be cleared in time.
 IF NOT staff THEN
  IF s.unavailable THEN RAISE EXCEPTION 'ขณะนี้งดรับจองชั่วคราวเพราะรถหรือคนขับไม่พร้อม กรุณาติดต่อเจ้าหน้าที่'; END IF;
 END IF;
 -- หมุดจุดรับเป็นทางเลือก (ผู้สูงอายุที่ปักหมุดไม่เป็นต้องจองได้) แต่ถ้าส่งมาต้องเป็นพิกัดจริง
 lat:=nullif(p_data->>'pickup_lat','')::double precision; lng:=nullif(p_data->>'pickup_lng','')::double precision;
 IF (lat IS NULL)<>(lng IS NULL) THEN RAISE EXCEPTION 'หมุดจุดรับไม่สมบูรณ์ กรุณาปักหมุดใหม่หรือข้ามการปักหมุด'; END IF;
 IF lat IS NOT NULL AND (lat NOT BETWEEN 5 AND 21 OR lng NOT BETWEEN 96 AND 106) THEN RAISE EXCEPTION 'หมุดจุดรับอยู่นอกพื้นที่ให้บริการ'; END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_data->>'route_id';
 IF route IS NULL THEN RAISE EXCEPTION 'กรุณาเลือกโรงพยาบาลและพื้นที่ที่เปิดบริการ'; END IF;
 -- สถานที่อื่น: ผู้จองพิมพ์ชื่อเอง เก็บเป็น route_label ของคำขอนี้ · เวลาเดินทางใช้ค่ามาตรฐานของ routes[] ที่ id นี้
 -- ไม่ร่วมเที่ยวกับใคร (share=false) เพราะ ptb_plan เทียบปลายทางด้วย route_id จึงมองสถานที่อื่นทุกแห่งเป็นแห่งเดียวกัน
 IF route->>'id'='__other__' THEN
  other_text:=left(btrim(regexp_replace(coalesce(p_data->>'other_place',''),'[[:space:][:cntrl:]]+',' ','g')),201);
  IF char_length(other_text) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'กรุณาพิมพ์ชื่อสถานที่ที่จะไป (2–200 ตัวอักษร)'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE municipality_id=p_muni AND status IN ('submitted','confirmed')
  AND phone=btrim(p_data->>'phone') AND patient_name=btrim(p_data->>'patient_name') AND appointment_at=appt AND route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอนี้แล้ว กรุณาตรวจการจองเดิมหรือติดต่อเจ้าหน้าที่'; END IF;
 consent:=s.privacy_notice||E'\nเจ้าของรถและผู้รับข้อมูล: '||partner.name;
 INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,in_area,route_id,route_label,
  appointment_at,mobility,companions,share,return_mode,return_at,consent_text,pickup_lat,pickup_lng,entry_channel)
 VALUES(p_id,p_muni,auth.uid(),btrim(p_data->>'requester_name'),btrim(p_data->>'phone'),btrim(p_data->>'patient_name'),p_data->>'relation',btrim(p_data->>'pickup'),
  coalesce((p_data->>'in_area')::boolean,false),p_data->>'route_id',coalesce(other_text,route->>'label'),appt,p_data->>'mobility',(p_data->>'companions')::integer,
  CASE WHEN other_text IS NOT NULL THEN false ELSE coalesce((p_data->>'share')::boolean,false) END,p_data->>'return_mode',CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,consent,lat,lng,
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
 appt timestamptz; back timestamptz; route jsonb; payload jsonb; other_text text;
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
 IF p_data-ARRAY['appointment_at','return_at','return_mode','route_id','pickup','in_area','other_place']<>'{}'::jsonb THEN RAISE EXCEPTION 'มีข้อมูลที่ไม่รองรับในรายการแก้ไข'; END IF;
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
 -- สถานที่อื่น: ใช้ชื่อที่ส่งมา ไม่ส่ง = คงชื่อเดิมของคำขอนี้ (ห้ามเขียนทับด้วยป้าย "อื่นๆ" ของตั้งค่า) · เปลี่ยนมาจากแห่งอื่นต้องระบุชื่อ
 IF route->>'id'='__other__' THEN
  other_text:=left(btrim(regexp_replace(coalesce(nullif(btrim(p_data->>'other_place'),''),CASE WHEN b.route_id='__other__' THEN b.route_label END,''),'[[:space:][:cntrl:]]+',' ','g')),201);
  IF char_length(other_text) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'กรุณาพิมพ์ชื่อสถานที่ที่จะไป (2–200 ตัวอักษร)'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.id<>b.id AND r.municipality_id=p_muni AND r.status IN ('submitted','confirmed') AND r.phone=b.phone AND r.patient_name=b.patient_name AND r.appointment_at=appt AND r.route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอซ้ำในวันเวลานี้'; END IF;
 UPDATE public.patient_bookings SET appointment_at=appt,return_at=CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,
  route_id=route->>'id',route_label=coalesce(other_text,route->>'label'),share=CASE WHEN other_text IS NOT NULL THEN false ELSE share END,
  return_mode=p_data->>'return_mode',pickup=btrim(p_data->>'pickup'),
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
 IF route IS NULL OR p_route='__other__' THEN RAISE EXCEPTION 'กรุณาเลือกโรงพยาบาลที่ตั้งไว้สำหรับหน่วยงานนี้ (สถานที่อื่นต้องพิมพ์ชื่อ ให้ใช้แก้ข้อมูลตามที่ประสาน)'; END IF;
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

NOTIFY pgrst,'reload schema';
COMMIT;
