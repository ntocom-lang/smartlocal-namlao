BEGIN;
CREATE INDEX patient_booking_trips_driver_cover ON public.patient_booking_trips(municipality_id,driver_id,updated_at DESC);
CREATE INDEX patient_booking_driver_history ON public.patient_booking_events(municipality_id,entity_id,created_at) WHERE action='driver_reassigned';
-- Preserve complete existing RPC definitions; stop if the reviewed baseline changed.
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.ptb_role(uuid)')) IS DISTINCT FROM 'e025dafa27eac0a6de659e50df78261e' THEN RAISE EXCEPTION 'Function drift: ptb_role'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_workspace(uuid)')) IS DISTINCT FROM 'a565e5086ea9b76e4b67cf6c7fa749ea' THEN RAISE EXCEPTION 'Function drift: patient_booking_workspace'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_action(uuid,uuid,uuid,integer,text,text)')) IS DISTINCT FROM '4fc18741dc7b949b90b36f831fc0c248' THEN RAISE EXCEPTION 'Function drift: patient_booking_action'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_reschedule(uuid,uuid,uuid,text,jsonb,timestamp with time zone,timestamp with time zone,boolean)')) IS DISTINCT FROM 'ab58e99603de546d850c32f488bf0b69' THEN RAISE EXCEPTION 'Function drift: patient_booking_reschedule'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.patient_booking_staff_work_badge(uuid)')) IS DISTINCT FROM '208b2e636df99762a535d5a8eeecd359' THEN RAISE EXCEPTION 'Function drift: patient_booking_staff_work_badge'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ptb_role(p_muni uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.profiles; s public.patient_booking_settings;
BEGIN
 IF auth.uid() IS NULL THEN RETURN 'anonymous'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid();
 IF p.role='superadmin' THEN RETURN 'admin'; END IF;
 IF p.id IS NULL OR p.municipality_id IS DISTINCT FROM p_muni THEN RETURN 'outside'; END IF;
 IF p.role='admin' THEN RETURN 'admin'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 IF p.id=ANY(s.coordinator_ids) AND p.role IN ('officer','staff') THEN RETURN 'coordinator'; END IF;
 IF p.role IN ('officer','staff') AND (s.driver_id=p.id OR EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND driver_id=p.id AND (state NOT IN ('completed','cancelled') OR updated_at>now()-interval '30 days'))) THEN RETURN 'driver'; END IF;
 RETURN 'citizen';
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings;
 b jsonb; t jsonb; partners jsonb; people jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'appointment_at'),'[]') INTO b FROM (
  SELECT CASE WHEN role_name='driver' AND NOT (r.created_by=auth.uid() AND r.entry_channel='online') THEN jsonb_build_object('id',r.id,'trip_id',r.trip_id,'patient_name',r.patient_name,
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
   ELSE jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,'estimated_pickup_at',tr.estimated_pickup_at,'estimated_return_at',tr.estimated_return_at,'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required') END x
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
 END IF;
 RETURN jsonb_build_object('role',role_name,'settings',CASE WHEN role_name IN ('admin','coordinator') THEN to_jsonb(s) ELSE NULL END,
  'bookings',b,'trips',t,'limited',jsonb_array_length(b)=1000 OR jsonb_array_length(t)=1000,'partners',partners,'people',people,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n),
  'events',CASE WHEN role_name IN ('admin','coordinator') THEN (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM
   (SELECT entity_id,action,detail,created_at FROM public.patient_booking_events WHERE municipality_id=p_muni ORDER BY created_at DESC LIMIT 50)e) ELSE '[]'::jsonb END);
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
 PERFORM public.ptb_audit(p_muni,p_entity,p_action,jsonb_build_object('note',coalesce(p_note,''),'from_revision',p_revision,'driver_id',t.driver_id,'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),'recorded_by',auth.uid()));
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_reschedule(p_muni uuid,p_op uuid,p_booking uuid,p_scope text,
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
   VALUES(new_trip,p_muni,t.driver_id,ids,plan,t.helper_name,auth.uid());
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

CREATE FUNCTION public.patient_booking_reassign_driver(
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
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips chosen JOIN public.patient_booking_trips other
  ON other.municipality_id=p_muni AND other.driver_id=p_driver AND other.state NOT IN ('completed','cancelled') AND NOT(other.id=ANY(ids))
  WHERE chosen.id=ANY(ids) AND (EXISTS(SELECT 1 FROM jsonb_array_elements(chosen.plan->'blocks') a,jsonb_array_elements(other.plan->'blocks') b
   WHERE (a->>'start')::timestamptz<(b->>'end')::timestamptz AND (b->>'start')::timestamptz<(a->>'end')::timestamptz)
   OR (chosen.state<>'confirmed' AND other.state<>'confirmed'))) THEN
  RAISE EXCEPTION 'คนขับแทนมีงานรถรับส่งผู้ป่วยชนเวลา กรุณาเลือกคนอื่นหรือประสานจัดเวลาใหม่ · ยังไม่เปลี่ยนคนขับ';
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
REVOKE ALL ON FUNCTION public.patient_booking_reassign_driver(uuid,uuid,uuid,date,uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_reassign_driver(uuid,uuid,uuid,date,uuid,uuid,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.patient_booking_staff_work_badge(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text:=public.ptb_role(p_muni); v_pending integer:=0; v_driver integer:=0;
BEGIN
 IF auth.uid() IS NULL OR v_role IN ('anonymous','outside') THEN RETURN jsonb_build_object('pending',0,'driver',0,'total',0); END IF;
 IF v_role IN ('admin','coordinator') THEN
  SELECT count(*) INTO v_pending FROM public.patient_bookings WHERE municipality_id=p_muni AND (status='submitted' OR (status='confirmed' AND cancel_requested));
 END IF;
 IF v_role IN ('admin','coordinator','driver') THEN
  SELECT count(*) INTO v_driver FROM public.patient_booking_trips WHERE municipality_id=p_muni AND (v_role='admin' OR driver_id=auth.uid())
   AND (state NOT IN ('completed','cancelled') OR (state='completed' AND updated_at>now()-interval '30 days' AND (odometer_end IS NULL OR odometer_issue)));
 END IF;
 RETURN jsonb_build_object('pending',v_pending,'driver',v_driver,'total',v_pending+v_driver);
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_staff_work_badge(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_staff_work_badge(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
