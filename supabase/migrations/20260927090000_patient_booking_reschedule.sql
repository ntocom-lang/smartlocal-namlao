-- Move a confirmed reservation atomically. Historical trip/document snapshots remain intact.
BEGIN;
CREATE FUNCTION public.patient_booking_reschedule(p_muni uuid,p_op uuid,p_booking uuid,p_scope text,
 p_expected jsonb,p_appointment timestamptz,p_return timestamptz,p_not_departed boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; b public.patient_bookings; t public.patient_booking_trips;
 old public.patient_booking_operations; payload jsonb; expected jsonb; ids uuid[]; remaining uuid[];
 plan jsonb; failed jsonb; result jsonb; new_trip uuid:=gen_random_uuid(); snapshots jsonb;
 appt_delta interval; back_delta interval; d date; candidate jsonb; suggestions jsonb:='[]'; shift interval;
 seats integer; helper boolean; recipient_ids uuid[];
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เปลี่ยนวันเวลาเดินทาง'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','reschedule','booking',p_booking,'scope',p_scope,'expected',p_expected,
  'appointment',p_appointment,'return',p_return,'not_departed',p_not_departed);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload-'result'=payload THEN RETURN old.payload->'result'; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 IF p_op IS NULL OR p_scope IS NULL OR p_scope NOT IN ('single','all') THEN RAISE EXCEPTION 'กรุณาเลือกเลื่อนเฉพาะรายนี้หรือทั้งเที่ยว'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.trip_id AND municipality_id=p_muni FOR UPDATE;
 IF b.id IS NULL OR b.status<>'confirmed' OR t.id IS NULL THEN RAISE EXCEPTION 'คำขอนี้ยังไม่ได้ยืนยันรถหรือปิดแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 PERFORM 1 FROM public.patient_bookings WHERE trip_id=t.id ORDER BY id FOR UPDATE;
 SELECT jsonb_build_object('trip',t.id,'revision',t.revision,'docs_revision',t.docs_revision,
  'schedule_revision',t.schedule_revision,'settings_revision',s.revision,
  'bookings',coalesce(jsonb_object_agg(id::text,revision),'{}')) INTO expected
  FROM public.patient_bookings WHERE trip_id=t.id AND status<>'cancelled';
 IF expected IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'คิวหรือข้อมูลเปลี่ยนแล้ว กรุณาเปิดฟอร์มจากข้อมูลล่าสุด'; END IF;
 IF t.state NOT IN ('confirmed','outbound') OR (t.state='outbound' AND p_not_departed IS DISTINCT FROM true)
  OR t.odometer_end IS NOT NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status<>'cancelled'
   AND (passenger_step<>0 OR return_ready OR status<>'confirmed')) THEN
  RAISE EXCEPTION 'เลื่อนได้เฉพาะเที่ยวที่ยังไม่ได้ออกรถจริง หากกดออกรถผิดให้ยืนยันว่า ยังไม่ได้ออกรถ';
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status<>'cancelled' AND cancel_requested) THEN
  RAISE EXCEPTION 'มีผู้ขอยกเลิกในเที่ยวนี้ กรุณาประสานและจัดการคำขอยกเลิกก่อนเลื่อน';
 END IF;
 SELECT array_agg(id ORDER BY id),jsonb_agg(jsonb_build_object('id',id,'appointment_at',appointment_at,'return_at',return_at))
 INTO ids,snapshots FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND (p_scope='all' OR id=b.id);
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]),coalesce(sum(companions+CASE WHEN mobility='walk' THEN 1 ELSE 0 END),0),coalesce(bool_or(mobility<>'walk'),false)
 INTO remaining,seats,helper FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND NOT(id=ANY(ids));
 IF p_appointment IS NULL OR NOT isfinite(p_appointment) OR (b.return_mode<>'one_way' AND (p_return IS NULL OR NOT isfinite(p_return))) THEN
  RAISE EXCEPTION 'กรุณาระบุวันนัด เวลานัด และเวลารับกลับให้ครบ';
 END IF;
 IF b.return_mode='one_way' AND p_return IS NOT NULL THEN RAISE EXCEPTION 'เที่ยวไปอย่างเดียวไม่ต้องระบุเวลารับกลับ'; END IF;
 appt_delta:=p_appointment-b.appointment_at; back_delta:=p_return-b.return_at;
 IF appt_delta=interval '0' AND p_return IS NOT DISTINCT FROM b.return_at THEN RAISE EXCEPTION 'วันเวลาใหม่เหมือนเดิม ยังไม่ต้องเปลี่ยนคิว'; END IF;
 d:=(p_appointment AT TIME ZONE 'Asia/Bangkok')::date;
 SELECT ARRAY(SELECT DISTINCT unnest(ARRAY[t.driver_id,s.driver_id]||s.coordinator_ids||ARRAY(SELECT created_by FROM public.patient_bookings WHERE trip_id=t.id))) INTO recipient_ids;
 BEGIN
  -- Exclude moved riders before planning, so a single-rider move still conflicts with the remaining trip.
  IF cardinality(remaining)=0 THEN
   UPDATE public.patient_booking_trips SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=t.id;
  ELSE
   UPDATE public.patient_booking_trips AS source SET booking_ids=remaining,state='confirmed',state_before_issue=NULL,
    plan=source.plan||jsonb_build_object('booking_ids',remaining,'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(remaining)),
     'seats',seats+CASE WHEN helper THEN 1 ELSE 0 END,'helper_required',helper),
    revision=revision+1,docs_revision=docs_revision+1,updated_at=now() WHERE id=t.id;
  END IF;
  UPDATE public.patient_bookings SET appointment_at=appointment_at+appt_delta,
   return_at=CASE WHEN return_mode='one_way' THEN NULL ELSE return_at+back_delta END,
   trip_id=NULL,requested_trip_id=NULL,status='submitted',revision=revision+1,updated_at=now() WHERE id=ANY(ids);
  IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND
   ((appointment_at AT TIME ZONE 'Asia/Bangkok')::date<>d OR d<(now() AT TIME ZONE 'Asia/Bangkok')::date
    OR d>((now() AT TIME ZONE 'Asia/Bangkok')::date+interval '12 months')::date
    OR (return_mode<>'one_way' AND (return_at<appointment_at OR (return_at AT TIME ZONE 'Asia/Bangkok')::date<>d)))) THEN
   RAISE EXCEPTION 'เลือกวันภายใน 12 เดือน และเวลารับกลับหลังนัดในวันเดียวกัน ผู้ร่วมเที่ยวต้องอยู่วันเดียวกัน';
  END IF;
  IF EXISTS(SELECT 1 FROM public.patient_bookings x JOIN public.patient_bookings y ON x.municipality_id=y.municipality_id
   AND x.phone=y.phone AND x.patient_name=y.patient_name AND x.route_id=y.route_id AND x.appointment_at=y.appointment_at
   WHERE x.id=ANY(ids) AND NOT(y.id=ANY(ids)) AND y.status IN ('submitted','confirmed')) THEN
   RAISE EXCEPTION 'มีคำขอของผู้เดินทางนี้ในวันเวลาใหม่แล้ว กรุณาตรวจรายการเดิม';
  END IF;
  plan:=public.ptb_plan(p_muni,ids,t.helper_name);
  IF jsonb_array_length(plan->'errors')>0 THEN failed:=plan; RAISE EXCEPTION USING ERRCODE='PT001',MESSAGE='reservation conflict'; END IF;
  INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,helper_name,confirmed_by)
   VALUES(new_trip,p_muni,s.driver_id,ids,plan,t.helper_name,auth.uid());
  UPDATE public.patient_bookings SET trip_id=new_trip,status='confirmed',revision=revision+1,updated_at=now() WHERE id=ANY(ids);
  IF cardinality(remaining)=0 THEN
   PERFORM public.ptb_notice(p_muni,t.id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE requested_trip_id=t.id AND status='submitted'),'เที่ยวที่ขอร่วมเปลี่ยนวันแล้ว เจ้าหน้าที่จะจัดคิวคำขอของท่านใหม่');
   UPDATE public.patient_bookings SET requested_trip_id=NULL,revision=revision+1,updated_at=now() WHERE requested_trip_id=t.id AND status='submitted';
  END IF;
  PERFORM public.ptb_audit(p_muni,t.id,'rescheduled',jsonb_build_object('new_trip',new_trip,'scope',p_scope,'before',snapshots,'plan',plan));
  PERFORM public.ptb_audit(p_muni,new_trip,'rescheduled_from',jsonb_build_object('old_trip',t.id,'booking_ids',ids));
  IF t.state='outbound' THEN PERFORM public.ptb_audit(p_muni,t.id,'departure_corrected',jsonb_build_object('not_departed',true)); END IF;
  PERFORM public.ptb_notice(p_muni,new_trip,recipient_ids,'เจ้าหน้าที่เปลี่ยนวันเวลาเดินทางแล้ว กรุณาตรวจวันเวลาและเที่ยวรถล่าสุด');
  result:=jsonb_build_object('saved',true,'trip_id',new_trip);
  INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload||jsonb_build_object('result',result));
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'PT001' THEN
  -- All attempted changes, including source capacity and membership, roll back together.
  NULL;
 END;
 IF failed->'errors' ? 'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(public.patient_booking_calendar(p_muni,d,
   least(d+14,((now() AT TIME ZONE 'Asia/Bangkok')::date+interval '12 months')::date))->'days') LOOP
   shift:=make_interval(days=>(candidate->>'date')::date-d);
   IF candidate->>'status'='open' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(failed->'blocks') blk WHERE
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate->'free') f WHERE
     (f->>'start')::timestamptz<=(blk->>'start')::timestamptz+shift AND (f->>'end')::timestamptz>=(blk->>'end')::timestamptz+shift)) THEN
    suggestions:=suggestions||jsonb_build_array(candidate->>'date');
    EXIT WHEN jsonb_array_length(suggestions)>=3;
   END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('saved',false,'errors',failed->'errors','suggestions',suggestions);
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_reschedule(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_reschedule(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
