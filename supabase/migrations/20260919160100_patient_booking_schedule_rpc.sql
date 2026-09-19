BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patient_booking_trips' AND column_name='schedule_revision') THEN
  RAISE EXCEPTION 'Apply patient_booking_schedule_columns first';
 END IF;
END $$;

-- Estimates are communication only: never move the reserved blocks or auto-confirm a queue.
CREATE FUNCTION public.patient_booking_update_schedule(p_muni uuid,p_trip uuid,p_revision integer,p_notice text,p_pickup timestamptz,p_return timestamptz) RETURNS integer
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
 IF p_return IS NOT NULL AND (t.plan->>'return_mode'='one_way' OR p_return<coalesce(p_pickup,(t.plan->>'pickup_at')::timestamptz)) THEN RAISE EXCEPTION 'เวลารับกลับไม่ถูกต้อง'; END IF;
 IF t.public_notice=p_notice AND t.estimated_pickup_at IS NOT DISTINCT FROM p_pickup AND t.estimated_return_at IS NOT DISTINCT FROM p_return THEN RETURN t.schedule_revision; END IF;
 IF p_revision IS DISTINCT FROM t.schedule_revision THEN RAISE EXCEPTION 'ข้อมูลแจ้งเวลาเปลี่ยนแล้ว กรุณาตรวจค่าล่าสุด'; END IF;
 UPDATE public.patient_booking_trips SET public_notice=p_notice,estimated_pickup_at=p_pickup,estimated_return_at=p_return,schedule_revision=schedule_revision+1,updated_at=now() WHERE id=t.id RETURNING schedule_revision INTO next_revision;
 PERFORM public.ptb_audit(p_muni,t.id,'schedule_updated',jsonb_build_object('before',jsonb_build_object('notice',t.public_notice,'pickup',t.estimated_pickup_at,'return',t.estimated_return_at),'after',jsonb_build_object('notice',p_notice,'pickup',p_pickup,'return',p_return)));
 PERFORM public.ptb_notice(p_muni,t.id,ARRAY(SELECT created_by FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed')||ARRAY[t.driver_id], 'มีการแจ้งเวลาเดินทางล่าสุด กรุณาดูตารางรถหรือติดต่อเจ้าหน้าที่');
 RETURN next_revision;
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_update_schedule(uuid,uuid,integer,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_update_schedule(uuid,uuid,integer,text,timestamptz,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.patient_booking_calendar(p_muni uuid,p_from date,p_to date) RETURNS jsonb
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
    'state',CASE WHEN shared THEN t.state ELSE NULL END,
    'public_notice',CASE WHEN shared THEN t.public_notice ELSE NULL END,
    'estimated_pickup_at',CASE WHEN shared THEN t.estimated_pickup_at ELSE NULL END,
    'estimated_return_at',CASE WHEN shared THEN t.estimated_return_at ELSE NULL END,
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

CREATE OR REPLACE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings;
 b jsonb; t jsonb; partners jsonb; people jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'appointment_at'),'[]') INTO b FROM (
  SELECT CASE WHEN role_name='driver' AND r.created_by<>auth.uid() THEN jsonb_build_object('id',r.id,'trip_id',r.trip_id,'patient_name',r.patient_name,
   'phone',r.phone,'pickup',r.pickup,'pickup_lat',r.pickup_lat,'pickup_lng',r.pickup_lng,'mobility',r.mobility,'companions',r.companions,'passenger_step',r.passenger_step,
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
  SELECT CASE WHEN role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) THEN to_jsonb(tr)||jsonb_build_object('driver_name',(SELECT full_name FROM public.profiles WHERE id=tr.driver_id AND municipality_id=p_muni))
   ELSE jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,'estimated_pickup_at',tr.estimated_pickup_at,'estimated_return_at',tr.estimated_return_at,'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required') END x
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
-- Re-plans and closing a trip invalidate old estimates. In-progress status changes do not.
CREATE FUNCTION public.ptb_clear_schedule_on_replan() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF NEW.plan IS DISTINCT FROM OLD.plan OR (NEW.state IN ('completed','cancelled') AND NEW.state IS DISTINCT FROM OLD.state) THEN
  NEW.schedule_revision:=OLD.schedule_revision+1;
  NEW.public_notice:='normal'; NEW.estimated_pickup_at:=NULL; NEW.estimated_return_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ptb_clear_schedule_on_replan() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ptb_schedule_replan BEFORE UPDATE OF plan,state ON public.patient_booking_trips FOR EACH ROW EXECUTE FUNCTION public.ptb_clear_schedule_on_replan();

NOTIFY pgrst, 'reload schema';
COMMIT;
