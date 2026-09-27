BEGIN;
-- Two driver actions; preserve the full existing authorization, lock, retry and legacy API.
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
 PERFORM public.ptb_audit(p_muni,p_entity,p_action,jsonb_build_object('note',coalesce(p_note,''),'from_revision',p_revision));
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_action(uuid,uuid,uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_action(uuid,uuid,uuid,integer,text,text) TO authenticated;
COMMIT;
