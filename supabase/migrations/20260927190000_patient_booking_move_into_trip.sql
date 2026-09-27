BEGIN;

-- Move one confirmed rider into an existing confirmed trip, atomically and with a fresh shared plan.
-- Keep the original trip and its documents as history; the coordinator makes the final choice.
CREATE FUNCTION public.patient_booking_move_into_trip(
 p_muni uuid, p_op uuid, p_booking uuid, p_expected jsonb,
 p_target uuid, p_target_revision integer, p_target_booking uuid, p_target_booking_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.patient_booking_settings; b public.patient_bookings;
 source_trip public.patient_booking_trips; target_trip public.patient_booking_trips;
 target_rider public.patient_bookings; old public.patient_booking_operations;
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
  OR (source_trip.plan->>'pickup_at')::timestamptz<=now() OR (target_trip.plan->>'pickup_at')::timestamptz<=now()
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
REVOKE ALL ON FUNCTION public.patient_booking_move_into_trip(uuid,uuid,uuid,jsonb,uuid,integer,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_move_into_trip(uuid,uuid,uuid,jsonb,uuid,integer,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
