-- คำขอที่เจ้าหน้าที่รับจองแทน = งานของสำนักงาน ไม่ใช่ "ของฉัน" ของเจ้าหน้าที่ที่กรอก
--
-- ทำไม: คำขอที่รับแทนทางโทรศัพท์/หน้าเคาน์เตอร์ (entry_channel 'staff') บันทึก created_by เป็นบัญชีเจ้าหน้าที่
-- แต่ 3 ฟังก์ชันนี้ถือว่า created_by = ผู้จอง จึงให้สิทธิ์ของผู้จองติดตัวเจ้าหน้าที่คนนั้นไป
--  1. ⚠️ PDPA: ถูกถอดจากผู้จัดคิวแล้ว (ptb_role = citizen) ยังเห็นคำขอที่เคยรับแทนครบทุกช่อง ผ่าน patient_booking_mine
--     และ patient_booking_workspace — ชื่อ เบอร์ จุดรับ หมุด วันนัด การใช้รถเข็น/เปล
--  2. ยกเลิกคำขอที่รับแทนได้โดยไม่มีเหตุผลลงประวัติ เพราะ patient_booking_action ยกเว้นเหตุผลให้ผู้สร้างคำขอ
--  3. ปุ่ม "พร้อมให้มารับกลับ" ของคำขอทางโทรศัพท์กดได้เฉพาะคนที่รับสายตอนจอง ผ่านหน้าประชาชนของตัวเอง
--     → แก้ที่หน้าจอด้วยปุ่ม "แจ้งพร้อมให้มารับกลับแทนผู้จอง" ในหน้าเจ้าหน้าที่ (ผู้ประสานงานมีสิทธิ์นี้อยู่แล้ว)
-- เจ้าของระบบสั่งแก้ 2026-09-22 ก่อน อปท. จริงเปิดรับจอง (ณ วันนั้นมีการตั้งค่าเฉพาะ demo)
--
-- ของใหม่: "ผู้จอง" = created_by = auth.uid() AND entry_channel = 'online' ทุกจุดที่ให้สิทธิ์แบบผู้จอง
-- ผู้ประสานงาน/ผู้ดูแลยังเห็นและจัดการทุกคำขอตามบทบาทเหมือนเดิม · ยกเลิกคำขอที่รับแทนต้องมีเหตุผลเสมอ
-- ไม่เปลี่ยน: แจ้งเตือน (ptb_notice) ยังส่งถึง created_by — ข้อความเป็นประโยคทั่วไป ไม่มีข้อมูลส่วนบุคคล
--             การส่งซ้ำด้วยรหัสคำขอเดิม (patient_booking_submit/_join) ยังผูกกับผู้กรอก ซึ่งถูกต้องแล้ว
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (docs/ai/NOTES.md) ด่านแรกจึงตรวจว่านิยามปัจจุบันตรงกับที่ยกมาทุกตัวอักษร
-- (md5 ของ prosrc ตัด \r) ถ้ามีใครแก้ไปก่อน ไฟล์นี้หยุดทั้งก้อนโดยไม่เขียนทับอะไร
-- นิยามที่ยกมา: 20260919200000 (mine) · 20260919160100 (workspace) · 20260918110200 (action) — ตรงกับ production 2026-09-22
-- ย้อนกลับ: CREATE OR REPLACE ทั้ง 3 ฟังก์ชันด้วยนิยามจากไฟล์ข้างต้น
BEGIN;
DO $guard$
DECLARE expected jsonb := jsonb_build_object(
  'public.patient_booking_mine(uuid)', 'db39bbbb6c7b25c53e7f92f5ec74b694',
  'public.patient_booking_workspace(uuid)', '3daf04aaea43c7db6ab9683bd134e9d3',
  'public.patient_booking_action(uuid,uuid,uuid,integer,text,text)', 'bfea0bb85d26b90aaf520e6e70d2ee72');
 fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc, E'\r', '')) INTO actual FROM pg_catalog.pg_proc WHERE oid = to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN
   RAISE EXCEPTION 'นิยาม % บนฐานข้อมูลนี้ไม่ตรงกับที่ไฟล์นี้คาดไว้ (อาจมีคนแก้ไปแล้ว) — หยุดก่อนเขียนทับทั้งฟังก์ชัน ตรวจ drift แล้วทำไฟล์ใหม่จากนิยามปัจจุบัน', fn;
  END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.patient_booking_mine(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); b jsonb; t jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r)-'consent_text' ORDER BY r.appointment_at),'[]') INTO b
 FROM (SELECT * FROM public.patient_bookings WHERE municipality_id=p_muni AND created_by=auth.uid() AND entry_channel='online'
   AND (status IN ('submitted','confirmed') OR updated_at>now()-interval '30 days')
   ORDER BY appointment_at LIMIT 200) r;
 -- เที่ยวของตัวเองใช้ projection เดียวกับที่ workspace ให้ผู้จอง: ไม่มีรายชื่อคนอื่นและไม่มีแผนภายใน
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,
   'estimated_pickup_at',tr.estimated_pickup_at,'estimated_return_at',tr.estimated_return_at,
   'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required')),'[]') INTO t
 FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni
  AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid() AND r.entry_channel='online');
 RETURN jsonb_build_object('role',role_name,'bookings',b,'trips',t,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n));
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
  SELECT CASE WHEN role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) THEN to_jsonb(tr)||jsonb_build_object('driver_name',(SELECT full_name FROM public.profiles WHERE id=tr.driver_id AND municipality_id=p_muni))
   ELSE jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,'estimated_pickup_at',tr.estimated_pickup_at,'estimated_return_at',tr.estimated_return_at,'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required') END x
  FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND (role_name IN ('admin','coordinator') OR (role_name='driver' AND tr.driver_id=auth.uid()) OR EXISTS(
   SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid() AND r.entry_channel='online'))
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
   IF b.status<>'confirmed' OR b.return_mode='one_way' OR b.passenger_step<>2 THEN RAISE EXCEPTION 'ยังไม่ถึงขั้นแจ้งพร้อมรับกลับ'; END IF;
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

-- สิทธิ์เรียกใช้คงเดิม (CREATE OR REPLACE ไม่แตะ ACL) ย้ำไว้กันพลาด
REVOKE ALL ON FUNCTION public.patient_booking_mine(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_mine(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.patient_booking_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_workspace(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.patient_booking_action(uuid,uuid,uuid,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_action(uuid,uuid,uuid,integer,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
