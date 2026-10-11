-- Manual dispatch: no travel-duration estimates or resource time reservations.
-- No booking, trip, schedule, document, or odometer data is rewritten.
BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.ptb_join_plan_to(uuid,uuid,uuid)')) IS DISTINCT FROM '0d85162f90db4736ff5be06d56d549d8' THEN RAISE EXCEPTION 'Function drift: ptb_join_plan_to'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_preview_multiwave(uuid,uuid[],uuid)')) IS DISTINCT FROM 'f5d11269f849e46330969159ab0fa3bb' THEN RAISE EXCEPTION 'Function drift: patient_booking_preview_multiwave'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_confirm_multiwave(uuid,uuid,uuid[],uuid,jsonb)')) IS DISTINCT FROM '75c4be9ea6b527cf65724848f66a2b77' THEN RAISE EXCEPTION 'Function drift: patient_booking_confirm_multiwave'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_move_into_trip(uuid,uuid,uuid,jsonb,uuid,integer,uuid,integer)')) IS DISTINCT FROM '17c02af028caed4e427ac16d9a0dd56b' THEN RAISE EXCEPTION 'Function drift: patient_booking_move_into_trip'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_reassign_driver(uuid,uuid,uuid,date,uuid,uuid,jsonb,boolean)')) IS DISTINCT FROM '08d9181641cffdaa1c3741ddfa21e0c6' THEN RAISE EXCEPTION 'Function drift: patient_booking_reassign_driver'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_action(uuid,uuid,uuid,integer,text,text)')) IS DISTINCT FROM '3874a0ffabc175ccac91ac00283f83a2' THEN RAISE EXCEPTION 'Function drift: patient_booking_action'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_update_schedule(uuid,uuid,integer,text,timestamptz,timestamptz)')) IS DISTINCT FROM '70688b1672eb8951fb9529367dd83342' THEN RAISE EXCEPTION 'Function drift: patient_booking_update_schedule'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_confirm(uuid,uuid,uuid[],jsonb,text)')) IS DISTINCT FROM '77ac4c543fd81a222acc1d6ccc11a29d' THEN RAISE EXCEPTION 'Function drift: patient_booking_confirm'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_workspace_v2(uuid)')) IS DISTINCT FROM 'e5ce1f20886c6df4a60f4273bdf838a8' THEN RAISE EXCEPTION 'Function drift: patient_booking_workspace_v2'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_mine_v2(uuid)')) IS DISTINCT FROM 'd69773d7616d9eaf9a83662e9c8a96a8' THEN RAISE EXCEPTION 'Function drift: patient_booking_mine_v2'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.ptb_community_payload(uuid,jsonb)')) IS DISTINCT FROM '8192c88726cb992fe51ebc3fa29e5024' THEN RAISE EXCEPTION 'Function drift: ptb_community_payload'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_info(uuid)')) IS DISTINCT FROM '1556e7025d02ecf945b9a68a2e45f205' THEN RAISE EXCEPTION 'Function drift: patient_booking_info'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ptb_join_plan_to(p_muni uuid,p_booking uuid,p_trip uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; t public.patient_booking_trips; ids uuid[]; plan jsonb;
BEGIN
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL OR t.id IS NULL OR t.state<>'confirmed' THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว กรุณาประสานเจ้าหน้าที่'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed';
 IF cardinality(ids) IS NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND (NOT share OR mobility<>'walk' OR passenger_step<>0 OR cancel_requested)) THEN RAISE EXCEPTION 'เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม กรุณาประสานเจ้าหน้าที่'; END IF;
 plan:=public.ptb_plan(p_muni,ids||p_booking,'');
 IF (plan->>'multiwave')::boolean THEN RAISE EXCEPTION 'รอบรับหลายรอบต้องให้เจ้าหน้าที่ประสานและยืนยัน'; END IF;
 IF t.driver_id IS DISTINCT FROM (SELECT driver_id FROM public.patient_booking_settings WHERE municipality_id=p_muni) THEN RAISE EXCEPTION 'คนขับเปลี่ยนแล้ว ต้องประสานจัดเที่ยวใหม่ก่อนเพิ่มผู้ร่วม'; END IF;
 RETURN plan||jsonb_build_object('join_trip_id',t.id,'join_trip_revision',t.revision,'join_booking_id',p_booking);
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_preview_multiwave(p_muni uuid,p_ids uuid[],p_trip uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; ids uuid[]; existing uuid[]; plan jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์จัดคิว'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 IF t.id IS NULL OR t.state<>'confirmed' OR cardinality(ids) NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว กรุณาประสานเจ้าหน้าที่'; END IF;
 IF t.driver_id IS DISTINCT FROM (SELECT driver_id FROM public.patient_booking_settings WHERE municipality_id=p_muni) THEN RAISE EXCEPTION 'คนขับเปลี่ยนแล้ว ต้องประสานจัดเที่ยวใหม่ก่อนเพิ่มผู้ร่วม'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids)
  AND status='submitted' AND trip_id IS NULL AND passenger_step=0 AND NOT cancel_requested)=cardinality(ids) IS NOT TRUE THEN
  RAISE EXCEPTION 'คำขอถูกจัดคิวหรือเปลี่ยนสถานะแล้ว';
 END IF;
 SELECT array_agg(id ORDER BY id) INTO existing FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed';
 IF cardinality(existing) IS NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(existing) AND (NOT share OR mobility<>'walk' OR passenger_step<>0 OR cancel_requested)) THEN RAISE EXCEPTION 'เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม กรุณาประสานเจ้าหน้าที่'; END IF;
 plan:=public.ptb_plan(p_muni,existing||ids,t.helper_name);
 IF (plan->>'multiwave')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'คำขอนี้ไม่ต้องจัดรถหลายรอบ'; END IF;
 RETURN plan||jsonb_build_object('join_trip_id',t.id,'join_trip_revision',t.revision,'join_booking_ids',ids);
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_confirm_multiwave(p_muni uuid,p_op uuid,p_ids uuid[],p_trip uuid,p_expected jsonb) RETURNS uuid
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
  plan=stored,estimated_pickup_at=CASE WHEN t.schedule_revision>1 THEN t.estimated_pickup_at ELSE NULL END,
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

CREATE OR REPLACE FUNCTION public.patient_booking_move_into_trip(
 p_muni uuid, p_op uuid, p_booking uuid, p_expected jsonb,
 p_target uuid, p_target_revision integer, p_target_booking uuid, p_target_booking_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.patient_booking_settings; b public.patient_bookings;
 source_trip public.patient_booking_trips; target_trip public.patient_booking_trips;
 target_rider public.patient_bookings; existing_rider public.patient_bookings; old public.patient_booking_operations;
 expected jsonb; payload jsonb; result jsonb; joined_plan jsonb; source_plan jsonb;
 remaining uuid[]; target_ids uuid[]; recipients uuid[];
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเท่านั้น'; END IF;
 IF p_op IS NULL OR p_booking IS NULL OR p_target IS NULL THEN RAISE EXCEPTION 'ข้อมูลย้ายคิวไม่ครบ'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','move_into_trip','booking',p_booking,'expected',p_expected,
  'target',p_target,'target_revision',p_target_revision,'target_booking',p_target_booking,
  'target_booking_revision',p_target_booking_revision);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload-'result'=payload THEN RETURN old.payload->'result'; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni FOR UPDATE;
 SELECT * INTO source_trip FROM public.patient_booking_trips WHERE id=b.trip_id AND municipality_id=p_muni FOR UPDATE;
 SELECT * INTO target_trip FROM public.patient_booking_trips WHERE id=p_target AND municipality_id=p_muni FOR UPDATE;
 IF b.id IS NULL OR b.status<>'confirmed' OR source_trip.id IS NULL OR target_trip.id IS NULL
  OR source_trip.id=target_trip.id THEN RAISE EXCEPTION 'ไม่พบคิวต้นทางหรือเที่ยวปลายทางที่ยืนยันแล้ว'; END IF;
 PERFORM 1 FROM public.patient_bookings WHERE trip_id IN (source_trip.id,target_trip.id) ORDER BY id FOR UPDATE;
 SELECT jsonb_build_object('trip',source_trip.id,'revision',source_trip.revision,'docs_revision',source_trip.docs_revision,
  'schedule_revision',source_trip.schedule_revision,'settings_revision',s.revision,
  'bookings',coalesce(jsonb_object_agg(id::text,revision),'{}')) INTO expected
  FROM public.patient_bookings WHERE trip_id=source_trip.id AND status<>'cancelled';
 IF expected IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'คิวต้นทางเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 IF source_trip.state<>'confirmed' OR target_trip.state<>'confirmed' OR target_trip.revision IS DISTINCT FROM p_target_revision
  OR source_trip.odometer_end IS NOT NULL OR target_trip.odometer_end IS NOT NULL THEN
  RAISE EXCEPTION 'เที่ยวเปลี่ยนหรือเริ่มเดินรถแล้ว กรุณาโหลดข้อมูลล่าสุด';
 END IF;
 IF b.passenger_step<>0 OR b.cancel_requested OR b.return_ready OR NOT b.share OR b.mobility<>'walk' THEN
  RAISE EXCEPTION 'ผู้เดินทางรายนี้ยังไม่พร้อมร่วมเที่ยว';
 END IF;
 SELECT * INTO target_rider FROM public.patient_bookings WHERE id=p_target_booking AND trip_id=target_trip.id
  AND municipality_id=p_muni AND status='confirmed' FOR UPDATE;
 IF target_rider.id IS NULL OR target_rider.revision IS DISTINCT FROM p_target_booking_revision THEN
  RAISE EXCEPTION 'เวลาของเที่ยวปลายทางเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด';
 END IF;
 IF b.route_id IS DISTINCT FROM target_rider.route_id OR b.return_mode IS DISTINCT FROM target_rider.return_mode THEN
  RAISE EXCEPTION 'เส้นทางหรือรูปแบบรับกลับไม่ตรงกับเที่ยวปลายทาง';
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id IN (source_trip.id,target_trip.id) AND status='confirmed'
  AND (passenger_step<>0 OR cancel_requested OR return_ready)) THEN
  RAISE EXCEPTION 'มีผู้เดินทางเริ่มรับบริการหรือขอยกเลิกแล้ว';
 END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO remaining FROM public.patient_bookings
  WHERE trip_id=source_trip.id AND status='confirmed' AND id<>b.id;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO target_ids FROM public.patient_bookings
  WHERE trip_id=target_trip.id AND status='confirmed';
 IF cardinality(target_ids)=0 THEN RAISE EXCEPTION 'เที่ยวปลายทางไม่มีผู้เดินทาง'; END IF;
 -- The patient may already have a confirmed seat in the destination trip. In that case
 -- do not add a second seat: close only the redundant source booking and recalculate
 -- its remaining trip atomically. The chosen destination trip stays untouched.
 SELECT * INTO existing_rider FROM public.patient_bookings x WHERE x.trip_id=target_trip.id
  AND x.municipality_id=p_muni AND x.status='confirmed' AND x.id<>b.id
  AND x.phone=b.phone AND x.patient_name=b.patient_name AND x.route_id=b.route_id
  AND x.appointment_at=target_rider.appointment_at LIMIT 1;
 IF existing_rider.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.patient_bookings x WHERE x.municipality_id=p_muni
   AND x.id NOT IN (b.id,existing_rider.id) AND x.phone=b.phone AND x.patient_name=b.patient_name
   AND x.route_id=b.route_id AND x.appointment_at=target_rider.appointment_at
   AND x.status IN ('submitted','confirmed')) THEN
   RAISE EXCEPTION 'พบคำขอซ้ำมากกว่าหนึ่งรายการ กรุณาตรวจรายการเดิมก่อน';
  END IF;
  UPDATE public.patient_bookings SET status='cancelled',cancel_requested=false,
   revision=revision+1,updated_at=now() WHERE id=b.id;
  IF cardinality(remaining)=0 THEN
   UPDATE public.patient_booking_trips SET state='cancelled',revision=revision+1,
    docs_revision=docs_revision+1,updated_at=now() WHERE id=source_trip.id;
  ELSE
   UPDATE public.patient_booking_trips SET booking_ids=remaining,revision=revision+1,
    docs_revision=docs_revision+1,updated_at=now() WHERE id=source_trip.id;
   source_plan:=public.ptb_plan(p_muni,remaining,source_trip.helper_name);
   IF jsonb_array_length(source_plan->'errors')>0 THEN
    RAISE EXCEPTION 'คิวต้นทางจัดใหม่ไม่ได้: %',source_plan->'errors';
   END IF;
   UPDATE public.patient_booking_trips SET plan=source_plan WHERE id=source_trip.id;
  END IF;
  -- The cancelled applicant can read this reason on their own booking page.
  PERFORM public.ptb_audit(p_muni,b.id,'cancel_passenger',
   jsonb_build_object('note','คำขอนี้ซ้ำกับคิวที่ยืนยันแล้วในเที่ยวปลายทาง จึงใช้คิวเดิมที่ยืนยันไว้',
    'existing_booking_id',existing_rider.id,'target_trip',target_trip.id));
  PERFORM public.ptb_audit(p_muni,source_trip.id,'duplicate_booking_closed',
   jsonb_build_object('booking_id',b.id,'existing_booking_id',existing_rider.id,
    'target_trip',target_trip.id,'before_appointment',b.appointment_at,
    'existing_appointment',existing_rider.appointment_at,'from_revision',b.revision));
  SELECT ARRAY(SELECT DISTINCT unnest(ARRAY[b.created_by,existing_rider.created_by,
   source_trip.driver_id,target_trip.driver_id]
   || ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(remaining)))) INTO recipients;
  PERFORM public.ptb_notice(p_muni,source_trip.id,recipients,
   'ปิดคำขอซ้ำแล้ว คิวในเที่ยวปลายทางยังยืนยันอยู่ กรุณาตรวจเวลารับใหม่ของเที่ยวต้นทาง');
  result:=jsonb_build_object('saved',true,'trip_id',target_trip.id,
   'existing_booking_id',existing_rider.id,'duplicate_closed',true);
  INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload)
   VALUES(p_op,auth.uid(),p_muni,payload||jsonb_build_object('result',result));
  RETURN result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings x WHERE x.municipality_id=p_muni AND x.id<>b.id
  AND x.phone=b.phone AND x.patient_name=b.patient_name AND x.route_id=b.route_id
  AND x.appointment_at=target_rider.appointment_at AND x.status IN ('submitted','confirmed')) THEN
  RAISE EXCEPTION 'มีคำขอของผู้เดินทางนี้ในวันเวลาใหม่แล้ว กรุณาตรวจรายการเดิม';
 END IF;

 -- All changes stay in this transaction; a failed capacity/time check restores both trips and the rider.
 UPDATE public.patient_bookings SET trip_id=NULL,requested_trip_id=NULL,status='submitted',
  appointment_at=target_rider.appointment_at,return_at=target_rider.return_at,revision=revision+1,updated_at=now()
  WHERE id=b.id;
 IF cardinality(remaining)=0 THEN
  UPDATE public.patient_booking_trips SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=source_trip.id;
 ELSE
  UPDATE public.patient_booking_trips SET booking_ids=remaining,revision=revision+1,docs_revision=docs_revision+1,updated_at=now()
   WHERE id=source_trip.id;
  source_plan:=public.ptb_plan(p_muni,remaining,source_trip.helper_name);
  IF jsonb_array_length(source_plan->'errors')>0 THEN RAISE EXCEPTION 'คิวต้นทางจัดใหม่ไม่ได้: %',source_plan->'errors'; END IF;
  UPDATE public.patient_booking_trips SET plan=source_plan WHERE id=source_trip.id;
 END IF;
 joined_plan:=public.ptb_join_plan_to(p_muni,b.id,target_trip.id);
 IF jsonb_array_length(joined_plan->'errors')>0 THEN RAISE EXCEPTION 'ร่วมเที่ยวไม่ได้: %',joined_plan->'errors'; END IF;
 UPDATE public.patient_bookings SET trip_id=target_trip.id,status='confirmed',revision=revision+1,updated_at=now() WHERE id=b.id;
 joined_plan:=jsonb_set(joined_plan-'join_trip_id'-'join_trip_revision'-'join_booking_id',
  ARRAY['booking_revisions',b.id::text],to_jsonb(b.revision+2),true);
 UPDATE public.patient_booking_trips SET booking_ids=ARRAY(SELECT DISTINCT unnest(target_ids||b.id) ORDER BY 1),
  plan=joined_plan,revision=revision+1,docs_revision=docs_revision+1,updated_at=now() WHERE id=target_trip.id;
 PERFORM public.ptb_audit(p_muni,source_trip.id,'moved_into_trip',jsonb_build_object('booking_id',b.id,'target_trip',target_trip.id,
  'before_appointment',b.appointment_at,'after_appointment',target_rider.appointment_at));
 PERFORM public.ptb_audit(p_muni,target_trip.id,'joined_from_trip',jsonb_build_object('booking_id',b.id,'source_trip',source_trip.id));
 SELECT ARRAY(SELECT DISTINCT unnest(ARRAY[b.created_by,source_trip.driver_id,target_trip.driver_id]
  || ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(remaining||target_ids)))) INTO recipients;
 PERFORM public.ptb_notice(p_muni,target_trip.id,recipients,'เจ้าหน้าที่ย้ายผู้เดินทางไปร่วมเที่ยวแล้ว กรุณาตรวจวันเวลาและเวลารับล่าสุด');
 result:=jsonb_build_object('saved',true,'trip_id',target_trip.id);
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload)
  VALUES(p_op,auth.uid(),p_muni,payload||jsonb_build_object('result',result));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_reassign_driver(
 p_muni uuid,p_op uuid,p_trip uuid,p_day date,p_from_driver uuid,p_driver uuid,p_expected jsonb,p_midtrip boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; t public.patient_booking_trips; old public.patient_booking_operations;
 ids uuid[]; expected jsonb; payload jsonb; result jsonb; driver_name text; old_name text; phase text;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะแอดมินหรือผู้ยืนยันคิวเปลี่ยนคนขับได้'; END IF;
 IF p_op IS NULL OR p_driver IS NULL OR (p_trip IS NULL AND (p_day IS NULL OR p_from_driver IS NULL)) OR (p_trip IS NOT NULL AND p_day IS NOT NULL) THEN RAISE EXCEPTION 'กรุณาเลือกเที่ยวหรือวันและคนขับเดิม'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF s.municipality_id IS NULL THEN RAISE EXCEPTION 'ไม่พบการตั้งค่าหน่วยงาน'; END IF;
 payload:=jsonb_build_object('action','reassign_driver','trip',p_trip,'day',p_day,'from_driver',p_from_driver,'driver',p_driver,'expected',p_expected,'midtrip',p_midtrip);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload-'result'=payload THEN RETURN old.payload->'result'; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 SELECT full_name INTO driver_name FROM public.profiles WHERE id=p_driver AND municipality_id=p_muni AND role IN ('admin','officer','staff');
 IF NOT FOUND THEN RAISE EXCEPTION 'เลือกคนขับแทนจากบัญชีเจ้าหน้าที่ของหน่วยงานนี้'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.patient_booking_trips WHERE municipality_id=p_muni AND
  ((p_trip IS NOT NULL AND id=p_trip) OR (p_trip IS NULL AND state='confirmed' AND driver_id=p_from_driver AND (plan->>'date')::date=p_day));
 IF coalesce(cardinality(ids),0)=0 THEN RAISE EXCEPTION 'ไม่มีเที่ยวที่ยังไม่ออกรถของคนขับเดิมในวันที่เลือก'; END IF;
 IF cardinality(ids)>100 THEN RAISE EXCEPTION 'มีเที่ยวเกิน 100 รายการ กรุณาจัดคนขับแยกเป็นรายเที่ยว'; END IF;
 PERFORM 1 FROM public.patient_booking_trips WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 SELECT jsonb_object_agg(id::text,jsonb_build_object('revision',revision,'docs_revision',docs_revision,'driver_id',driver_id)) INTO expected FROM public.patient_booking_trips WHERE id=ANY(ids);
 IF expected IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'รายการเที่ยวหรือข้อมูลเปลี่ยนแล้ว กรุณาปิดฟอร์มแล้วตรวจรายการล่าสุด'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE id=ANY(ids) AND (state IN ('completed','cancelled') OR driver_id=p_driver)) THEN RAISE EXCEPTION 'เที่ยวจบหรือยกเลิกแล้ว หรือเป็นคนขับคนเดิม'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE id=ANY(ids) AND state<>'confirmed' AND (state='issue' AND state_before_issue='confirmed') IS NOT TRUE) AND (p_trip IS NULL OR p_midtrip IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'รถออกแล้ว ต้องยืนยันการส่งมอบงานระหว่างเที่ยว';
 END IF;
 FOR t IN SELECT * FROM public.patient_booking_trips WHERE id=ANY(ids) ORDER BY id LOOP
  SELECT full_name INTO old_name FROM public.profiles WHERE id=t.driver_id;
  phase:=CASE WHEN t.state='confirmed' OR (t.state='issue' AND t.state_before_issue='confirmed') THEN 'before_departure' ELSE 'in_journey' END;
  UPDATE public.patient_booking_trips SET driver_id=p_driver,revision=revision+1,docs_revision=docs_revision+1,updated_at=now() WHERE id=t.id;
  PERFORM public.ptb_audit(p_muni,t.id,'driver_reassigned',jsonb_build_object('before',jsonb_build_object('id',t.driver_id,'name',old_name),
   'after',jsonb_build_object('id',p_driver,'name',driver_name),'phase',phase,'state',t.state,'from_revision',t.revision));
  PERFORM public.ptb_notice(p_muni,t.id,s.coordinator_ids||ARRAY[t.driver_id,p_driver]||ARRAY(SELECT created_by FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed'),
   'เปลี่ยนคนขับประจำเที่ยวแล้ว กรุณาตรวจผู้รับผิดชอบล่าสุดในงานคนขับ');
 END LOOP;
 result:=jsonb_build_object('saved',true,'trip_ids',ids);
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload||jsonb_build_object('result',result));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_action(p_muni uuid,p_op uuid,p_entity uuid,p_revision integer,p_action text,p_note text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; b public.patient_bookings;
 t public.patient_booking_trips; old public.patient_booking_operations; payload jsonb; coordinator boolean; own boolean; next_step integer; result_state text;
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
  -- "ผู้จอง" = คนที่จองเองผ่านหน้าประชาชนเท่านั้น · คำขอที่เจ้าหน้าที่รับแทน (entry_channel 'staff') created_by เป็นเจ้าหน้าที่
  -- ถือเป็นงานของสำนักงาน ทำได้ผ่านสิทธิ์ผู้ประสานงานเท่านั้น ถูกถอดสิทธิ์แล้วต้องหมดสิทธิ์ตาม
  own:=coalesce(b.created_by=auth.uid() AND b.entry_channel='online',false);
  IF NOT coordinator AND NOT own AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอนี้'; END IF;
  IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'คำขอเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
  IF p_action='cancel' THEN
   IF NOT coordinator AND NOT own THEN RAISE EXCEPTION 'เฉพาะผู้จองหรือผู้ประสานงานยกเลิกได้'; END IF;
   IF coordinator AND NOT own AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผลที่ผู้จองแจ้งยกเลิก'; END IF;
   IF b.status='submitted' THEN UPDATE public.patient_bookings SET status='cancelled' WHERE id=b.id;
   ELSIF b.status='confirmed' THEN UPDATE public.patient_bookings SET cancel_requested=true WHERE id=b.id;
   ELSE RAISE EXCEPTION 'คำขอนี้ปิดแล้ว'; END IF;
  ELSIF p_action='ready_return' THEN
   IF NOT coordinator AND NOT own THEN RAISE EXCEPTION 'เฉพาะผู้จองแจ้งพร้อมกลับได้'; END IF;
   IF b.status<>'confirmed' OR b.return_mode='one_way' OR t.state NOT IN ('outbound','hospital') THEN RAISE EXCEPTION 'ยังไม่ถึงขั้นแจ้งพร้อมรับกลับ'; END IF;
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
  ELSIF p_action='trip_finish' THEN
   IF s.unavailable OR t.state NOT IN ('outbound','hospital','returning') THEN RAISE EXCEPTION 'จบงานได้เฉพาะเที่ยวที่ออกรถแล้วและไม่มีเหตุขัดข้อง'; END IF;
   IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND cancel_requested) THEN RAISE EXCEPTION 'มีผู้ขอยกเลิก กรุณาให้เจ้าหน้าที่ประสานก่อนจบงาน'; END IF;
   -- บันทึกผลส่งครบเมื่อรถกลับเท่านั้น ไม่สร้างเหตุการณ์ระหว่างทางย้อนหลัง
   UPDATE public.patient_bookings SET passenger_step=CASE WHEN return_mode='one_way' THEN 2 ELSE 4 END
    WHERE trip_id=t.id AND status='confirmed';
   result_state:='completed';
  ELSIF p_action='trip_next' THEN
   IF s.unavailable OR t.state IN ('issue','completed','cancelled') THEN RAISE EXCEPTION 'เที่ยวไม่พร้อมดำเนินการ'; END IF;
   -- Use actual journey state, never calculated reservations. Drop-off releases the vehicle.
   IF t.state IN ('confirmed','hospital') AND EXISTS(SELECT 1 FROM public.patient_booking_trips other
    WHERE other.municipality_id=p_muni AND other.id<>t.id AND other.state IN ('outbound','returning','issue')) THEN RAISE EXCEPTION 'รถหรือคนขับกำลังปฏิบัติงานเที่ยวอื่น'; END IF;
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
 PERFORM public.ptb_audit(p_muni,p_entity,p_action,jsonb_build_object('note',coalesce(p_note,''),'from_revision',p_revision,'driver_id',t.driver_id,'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),'recorded_by',auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_update_schedule(p_muni uuid,p_trip uuid,p_revision integer,p_notice text,p_pickup timestamptz,p_return timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; role_name text:=public.ptb_role(p_muni); next_revision integer;
BEGIN
 IF role_name NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเท่านั้น'; END IF;
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni FOR UPDATE;
 IF t.id IS NULL THEN RAISE EXCEPTION 'ไม่พบเที่ยวรถของหน่วยงานนี้'; END IF;
 IF t.state IN ('completed','cancelled') THEN RAISE EXCEPTION 'เที่ยวนี้จบหรือยกเลิกแล้ว'; END IF;
 IF p_notice IS NULL OR p_notice NOT IN ('normal','delayed','contact') THEN RAISE EXCEPTION 'เลือกข้อความแจ้งที่กำหนดไว้'; END IF;
 IF (p_pickup IS NOT NULL AND (NOT isfinite(p_pickup) OR (p_pickup AT TIME ZONE 'Asia/Bangkok')::date<>(t.plan->>'date')::date))
 OR (p_return IS NOT NULL AND (NOT isfinite(p_return) OR (p_return AT TIME ZONE 'Asia/Bangkok')::date<>(t.plan->>'date')::date)) THEN RAISE EXCEPTION 'เวลาประมาณการต้องอยู่ในวันเดินทาง'; END IF;
 IF p_pickup IS NOT NULL AND t.plan->>'return_mode'<>'one_way' AND coalesce(p_return,(t.plan->>'return_at')::timestamptz)<p_pickup THEN RAISE EXCEPTION 'เวลาเริ่มรับต้องไม่เกินเวลารับกลับ'; END IF;
 IF p_return IS NOT NULL AND (t.plan->>'return_mode'='one_way' OR p_return<p_pickup) THEN RAISE EXCEPTION 'เวลารับกลับไม่ถูกต้อง'; END IF;
 IF t.public_notice=p_notice AND t.estimated_pickup_at IS NOT DISTINCT FROM p_pickup AND t.estimated_return_at IS NOT DISTINCT FROM p_return THEN RETURN t.schedule_revision; END IF;
 IF p_revision IS DISTINCT FROM t.schedule_revision THEN RAISE EXCEPTION 'ข้อมูลแจ้งเวลาเปลี่ยนแล้ว กรุณาตรวจค่าล่าสุด'; END IF;
 UPDATE public.patient_booking_trips SET public_notice=p_notice,estimated_pickup_at=p_pickup,estimated_return_at=p_return,schedule_revision=schedule_revision+1,updated_at=now() WHERE id=t.id RETURNING schedule_revision INTO next_revision;
 PERFORM public.ptb_audit(p_muni,t.id,'schedule_updated',jsonb_build_object('before',jsonb_build_object('notice',t.public_notice,'pickup',t.estimated_pickup_at,'return',t.estimated_return_at),'after',jsonb_build_object('notice',p_notice,'pickup',p_pickup,'return',p_return)));
 PERFORM public.ptb_notice(p_muni,t.id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed')||ARRAY[t.driver_id], 'มีการแจ้งเวลาเดินทางล่าสุด กรุณาดูตารางรถหรือติดต่อเจ้าหน้าที่');
 RETURN next_revision;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_confirm(p_muni uuid,p_id uuid,p_ids uuid[],p_expected jsonb,p_helper text DEFAULT '') RETURNS uuid
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
 PERFORM public.ptb_notice(p_muni,p_id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(p_ids))||ARRAY[s.driver_id],'ยืนยันรถแล้ว กรุณาตรวจรายละเอียดและประสานเวลารับกับเจ้าหน้าที่');
 RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_workspace_v2(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings;
 c public.patient_booking_community_rules; b jsonb; t jsonb; partners jsonb; people jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'appointment_at'),'[]') INTO b FROM (
  SELECT CASE WHEN role_name='driver' AND NOT (r.created_by=auth.uid() AND r.entry_channel='online') THEN jsonb_build_object('id',r.id,'trip_id',r.trip_id,'service_type',r.service_type,'party_size',r.party_size,'group_label',r.group_label,
   'patient_name',CASE WHEN r.service_type='community' THEN 'กลุ่ม '||coalesce(r.group_label,'ชุมชน')||' ('||r.party_size::text||' คน)' ELSE r.patient_name END,
   'phone',r.phone,'pickup',r.pickup,'pickup_lat',r.pickup_lat,'pickup_lng',r.pickup_lng,'mobility',r.mobility,'companions',r.companions,'passenger_step',r.passenger_step,
   'revision',r.revision,'return_ready',r.return_ready,'cancel_requested',r.cancel_requested,'appointment_at',r.appointment_at,
   'return_mode',r.return_mode,'status',r.status,'route_label',r.route_label)
  ELSE to_jsonb(r)-'consent_text' END x
  FROM public.patient_bookings r WHERE r.municipality_id=p_muni
  AND (r.status IN ('submitted','confirmed') OR r.updated_at>now()-interval '30 days')
  AND (role_name IN ('admin','coordinator') OR (r.created_by=auth.uid() AND r.entry_channel='online') OR (role_name='driver' AND r.status='confirmed' AND EXISTS(
   SELECT 1 FROM public.patient_booking_trips tr WHERE tr.id=r.trip_id AND tr.driver_id=auth.uid() AND tr.state NOT IN ('cancelled','completed'))))
  ORDER BY r.appointment_at LIMIT 1000
 ) rows;
 SELECT coalesce(jsonb_agg(x),'[]') INTO t FROM (
  SELECT CASE WHEN role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) THEN to_jsonb(tr)||jsonb_build_object('driver_name',(SELECT full_name FROM public.profiles WHERE id=tr.driver_id AND municipality_id=p_muni),'driver_history',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',e.created_at,'before',e.detail->'before','after',e.detail->'after','phase',e.detail->'phase') ORDER BY e.created_at),'[]') FROM public.patient_booking_events e WHERE e.municipality_id=p_muni AND e.entity_id=tr.id AND e.action='driver_reassigned'))
   ELSE jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,'schedule_revision',tr.schedule_revision,'estimated_pickup_at',CASE WHEN tr.schedule_revision>1 THEN tr.estimated_pickup_at ELSE NULL END,'estimated_return_at',tr.estimated_return_at,'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required') END x
  FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND (role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) OR EXISTS(
   SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid() AND r.entry_channel='online'))
  ORDER BY tr.created_at DESC LIMIT 1000
 ) rows;
 IF role_name='admin' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'min_lead_days',min_lead_days)),'[]') INTO partners FROM public.referral_partners
  WHERE municipality_id=p_muni AND is_active AND 'patient_transport_request'=ANY(document_types);
 END IF;
 IF role_name IN ('admin','coordinator') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'role',role)),'[]') INTO people FROM public.profiles
  WHERE municipality_id=p_muni AND role IN ('admin','officer','staff');
  SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 END IF;
 RETURN jsonb_build_object('role',role_name,'settings',CASE WHEN role_name IN ('admin','coordinator') THEN to_jsonb(s) ELSE NULL END,
  'community_rules',CASE WHEN role_name IN ('admin','coordinator') THEN CASE WHEN c.municipality_id IS NOT NULL THEN to_jsonb(c)
   ELSE jsonb_build_object('municipality_id',p_muni,'enabled',false,'window_start',NULL,'window_end',NULL,'places','[]'::jsonb,
    'activities','[]'::jsonb,'rules_reference','','rules_version',1,'revision',1) END ELSE NULL END,
  'bookings',b,'trips',t,'limited',jsonb_array_length(b)=1000 OR jsonb_array_length(t)=1000,'partners',partners,'people',people,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n),
  'events',CASE WHEN role_name IN ('admin','coordinator') THEN (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM
   (SELECT entity_id,action,detail,created_at FROM public.patient_booking_events WHERE municipality_id=p_muni ORDER BY created_at DESC LIMIT 50)e) ELSE '[]'::jsonb END);
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_mine_v2(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); b jsonb; t jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 -- คำขอที่ถูกยกเลิกพ่วง cancel_note = เหตุผลที่เจ้าหน้าที่บันทึกไว้ล่าสุด (ว่างไว้ถ้าไม่มี)
 SELECT coalesce(jsonb_agg(CASE WHEN r.status='cancelled' THEN (to_jsonb(r)-'consent_text')||jsonb_build_object('cancel_note',
   (SELECT nullif(btrim(e.detail->>'note'),'') FROM public.patient_booking_events e
     WHERE e.municipality_id=p_muni AND e.entity_id=r.id AND e.action IN ('cancel','cancel_passenger')
      AND e.actor_id<>auth.uid() AND nullif(btrim(e.detail->>'note'),'') IS NOT NULL
     ORDER BY e.created_at DESC LIMIT 1))
  ELSE to_jsonb(r)-'consent_text' END ORDER BY r.appointment_at),'[]') INTO b
 FROM (SELECT * FROM public.patient_bookings WHERE municipality_id=p_muni AND created_by=auth.uid() AND entry_channel='online'
   AND (status IN ('submitted','confirmed') OR updated_at>now()-interval '30 days')
   ORDER BY appointment_at LIMIT 200) r;
 -- เที่ยวของตัวเองใช้ projection เดียวกับที่ workspace ให้ผู้จอง: ไม่มีรายชื่อคนอื่นและไม่มีแผนภายใน
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,
   'schedule_revision',tr.schedule_revision,'estimated_pickup_at',CASE WHEN tr.schedule_revision>1 THEN tr.estimated_pickup_at ELSE NULL END,'estimated_return_at',tr.estimated_return_at,
   'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required')),'[]') INTO t
 FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni
  AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid() AND r.entry_channel='online');
 -- service_type/party_size/group_label are included in to_jsonb(r), only for the owner's online requests.
 RETURN jsonb_build_object('role',role_name,'bookings',b,'trips',t,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n));
END $$;

CREATE OR REPLACE FUNCTION public.ptb_community_payload(p_muni uuid,p_data jsonb) RETURNS jsonb
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
 IF place IS NULL OR p_data->>'route_id'='__other__' THEN RAISE EXCEPTION 'ยังไม่ตั้งสถานที่ชุมชน'; END IF;
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

CREATE OR REPLACE FUNCTION public.patient_booking_info(p_muni uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 -- Zero-valued legacy fields keep already-open clients bookable during rollout.
 -- They are not travel estimates; manual dispatch never reads them to reserve a vehicle.
 SELECT jsonb_build_object('booking_mode',true,'scheduling_mode','manual','enabled',s.enabled AND p.is_active,'owner_name',p.name,'office_start',s.office_start,
 'office_end',s.office_end,'buffer_minutes',0,'boarding_minutes',0,
 'routes',(SELECT coalesce(jsonb_agg(r||jsonb_build_object('minutes',0)),'[]') FROM jsonb_array_elements(s.routes) r),'contact_phone',s.contact_phone,'privacy_notice',s.privacy_notice,
 'consent_version','patient-booking-v1','min_lead_days',0,
 'community',jsonb_build_object('enabled',coalesce(c.enabled,false) AND s.enabled AND p.is_active,
  'places',(SELECT coalesce(jsonb_agg(r||jsonb_build_object('minutes',0)),'[]') FROM jsonb_array_elements(coalesce(c.places,'[]')) r),'activities',coalesce(c.activities,'[]'::jsonb),
  'window_start',c.window_start,'window_end',c.window_end,'rules_version',coalesce(c.rules_version,1),
  'consent_version','community-booking-v1',
  'privacy_notice','บริการรถรับ–ส่งชุมชนใช้ชื่อผู้ติดต่อ เบอร์ติดต่อ ชื่อกลุ่ม จำนวนผู้เดินทาง กิจกรรม สถานที่ วันเวลา และจุดรับ เพื่อรับคำขอ จัดคิว และประสานการเดินทาง พิกัดจุดรับเป็นทางเลือก ผู้จัดคิวและคนขับเข้าถึงข้อมูลเท่าที่จำเป็นต่อหน้าที่ ตารางสาธารณะไม่แสดงชื่อ เบอร์โทร จุดรับ หรือพิกัด สอบถามการใช้ข้อมูลและระยะเวลาเก็บรักษาได้ที่เจ้าหน้าที่ตามเบอร์ติดต่อในหน้านี้'))
 FROM public.patient_booking_settings s JOIN public.referral_partners p ON p.id=s.partner_id
 LEFT JOIN public.patient_booking_community_rules c ON c.municipality_id=s.municipality_id
 WHERE s.municipality_id=p_muni AND s.enabled;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
