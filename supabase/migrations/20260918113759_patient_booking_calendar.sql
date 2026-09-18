BEGIN;
ALTER TABLE public.patient_bookings ADD COLUMN requested_trip_id uuid REFERENCES public.patient_booking_trips(id);
CREATE INDEX patient_bookings_join_queue ON public.patient_bookings(requested_trip_id) WHERE status='submitted';
CREATE INDEX patient_bookings_trip ON public.patient_bookings(trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX patient_booking_calendar_days ON public.patient_booking_trips(municipality_id,(plan->>'date')) WHERE state<>'cancelled';

-- Only aggregate schedules. Private trips expose blocked time, never destination or headcount.
CREATE FUNCTION public.patient_booking_calendar(p_muni uuid,p_from date,p_to date) RETURNS jsonb
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
   WHEN s.calendar_checked_through IS NULL OR d>s.calendar_checked_through THEN 'unverified'
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

-- Private recomputation includes the existing passengers. Called again under lock on confirmation.
CREATE FUNCTION public.ptb_join_plan(p_muni uuid,p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; t public.patient_booking_trips; ids uuid[]; plan jsonb;
BEGIN
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.requested_trip_id AND municipality_id=p_muni;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL OR t.id IS NULL OR t.state<>'confirmed' OR (t.plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว กรุณาประสานเจ้าหน้าที่'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed';
 IF cardinality(ids) IS NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND (NOT share OR mobility<>'walk' OR passenger_step<>0 OR cancel_requested)) THEN RAISE EXCEPTION 'เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม กรุณาประสานเจ้าหน้าที่'; END IF;
 plan:=public.ptb_plan(p_muni,ids||p_booking,'');
 IF (plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เวลาเริ่มรับของแผนร่วมเที่ยวผ่านแล้ว'; END IF;
 IF t.driver_id IS DISTINCT FROM (SELECT driver_id FROM public.patient_booking_settings WHERE municipality_id=p_muni) THEN RAISE EXCEPTION 'คนขับเปลี่ยนแล้ว ต้องประสานจัดเที่ยวใหม่ก่อนเพิ่มผู้ร่วม'; END IF;
 RETURN plan||jsonb_build_object('join_trip_id',t.id,'join_trip_revision',t.revision,'join_booking_id',p_booking);
END $$;

CREATE FUNCTION public.patient_booking_submit_join(p_muni uuid,p_id uuid,p_trip uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.patient_bookings; plan jsonb;
BEGIN
 IF public.ptb_role(p_muni) IN ('anonymous','outside') THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบด้วยบัญชีของหน่วยงานนี้'; END IF;
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 SELECT * INTO old FROM public.patient_bookings WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by=auth.uid() AND old.municipality_id=p_muni AND old.requested_trip_id=p_trip THEN RETURN old.id; END IF;
  RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง';
 END IF;
 IF p_trip IS NULL OR NOT EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni AND state='confirmed') THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว'; END IF;
 PERFORM public.patient_booking_submit(p_muni,p_id,p_data);
 UPDATE public.patient_bookings SET requested_trip_id=p_trip WHERE id=p_id;
 plan:=public.ptb_join_plan(p_muni,p_id);
 IF jsonb_array_length(plan->'errors')>0 THEN RAISE EXCEPTION 'ยังขอร่วมเที่ยวนี้ไม่ได้: %',plan->'errors'; END IF;
 PERFORM public.ptb_audit(p_muni,p_id,'requested_join',jsonb_build_object('trip_id',p_trip));
 RETURN p_id;
END $$;

CREATE FUNCTION public.patient_booking_preview_join(p_muni uuid,p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์จัดคิว'; END IF;
 RETURN public.ptb_join_plan(p_muni,p_booking);
END $$;

CREATE FUNCTION public.patient_booking_confirm_join(p_muni uuid,p_op uuid,p_booking uuid,p_expected jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_plan jsonb; payload jsonb; old public.patient_booking_operations; t public.patient_booking_trips; ids uuid[];
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ยืนยันคิว'; END IF;
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','confirm_join','booking',p_booking,'plan',p_expected);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN (p_expected->>'join_trip_id')::uuid; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 new_plan:=public.ptb_join_plan(p_muni,p_booking);
 IF new_plan IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'แผนหรือข้อมูลเปลี่ยนแล้ว กรุณาตรวจใหม่'; END IF;
 IF jsonb_array_length(new_plan->'errors')>0 THEN RAISE EXCEPTION '%',new_plan->'errors'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=(new_plan->>'join_trip_id')::uuid;
 SELECT array_agg(x::uuid) INTO ids FROM jsonb_array_elements_text(new_plan->'booking_ids') x;
 UPDATE public.patient_booking_trips SET booking_ids=ARRAY(SELECT DISTINCT unnest(t.booking_ids||p_booking)),
  plan=new_plan-'join_trip_id'-'join_trip_revision'-'join_booking_id',revision=revision+1,updated_at=now() WHERE id=t.id;
 UPDATE public.patient_bookings SET trip_id=t.id,status='confirmed',revision=revision+1,updated_at=now() WHERE id=p_booking;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,t.id,'confirmed_join',jsonb_build_object('booking_id',p_booking,'before',t.plan,'after',new_plan));
 PERFORM public.ptb_notice(p_muni,t.id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(ids))||ARRAY[t.driver_id], 'เพิ่มผู้ร่วมเที่ยวแล้ว แผนเวลารับอาจเปลี่ยน กรุณาตรวจรายละเอียดล่าสุด');
 RETURN t.id;
END $$;
REVOKE ALL ON FUNCTION public.ptb_join_plan(uuid,uuid),public.patient_booking_calendar(uuid,date,date),
 public.patient_booking_submit_join(uuid,uuid,uuid,jsonb),public.patient_booking_preview_join(uuid,uuid),public.patient_booking_confirm_join(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_calendar(uuid,date,date) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_submit_join(uuid,uuid,uuid,jsonb),public.patient_booking_preview_join(uuid,uuid),public.patient_booking_confirm_join(uuid,uuid,uuid,jsonb) TO authenticated;
COMMIT;
