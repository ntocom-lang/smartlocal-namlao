BEGIN;
CREATE FUNCTION public.patient_booking_change_hospital(
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
REVOKE ALL ON FUNCTION public.patient_booking_change_hospital(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_change_hospital(uuid,uuid,uuid,jsonb,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
