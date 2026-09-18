-- Correct an unconfirmed booking after speaking with the requester. No silent reschedule.
BEGIN;
CREATE FUNCTION public.patient_booking_amend(p_muni uuid,p_op uuid,p_id uuid,p_revision integer,p_data jsonb,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; b public.patient_bookings; old public.patient_booking_operations;
 appt timestamptz; back timestamptz; route jsonb; payload jsonb;
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
 IF p_data-ARRAY['appointment_at','return_at','return_mode','route_id','pickup','in_area']<>'{}'::jsonb THEN RAISE EXCEPTION 'มีข้อมูลที่ไม่รองรับในรายการแก้ไข'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_id AND municipality_id=p_muni;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL THEN RAISE EXCEPTION 'แก้ได้เฉพาะคำขอที่ยังไม่ยืนยันเที่ยว'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 appt:=(p_data->>'appointment_at')::timestamptz; back:=nullif(p_data->>'return_at','')::timestamptz;
 IF appt IS NULL OR (appt AT TIME ZONE 'Asia/Bangkok')::date<(now() AT TIME ZONE 'Asia/Bangkok')::date OR
 (appt AT TIME ZONE 'Asia/Bangkok')::date>(now() AT TIME ZONE 'Asia/Bangkok')::date+180 THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจอง'; END IF;
 IF back IS NOT NULL AND (back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>(appt AT TIME ZONE 'Asia/Bangkok')::date) THEN RAISE EXCEPTION 'เวลารับกลับไม่ถูกต้อง'; END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_data->>'route_id';
 IF route IS NULL THEN RAISE EXCEPTION 'เส้นทางไม่ถูกต้อง'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.id<>b.id AND r.municipality_id=p_muni AND r.status IN ('submitted','confirmed') AND r.phone=b.phone AND r.patient_name=b.patient_name AND r.appointment_at=appt AND r.route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอซ้ำในวันเวลานี้'; END IF;
 UPDATE public.patient_bookings SET appointment_at=appt,return_at=CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,
  route_id=route->>'id',route_label=route->>'label',return_mode=p_data->>'return_mode',pickup=btrim(p_data->>'pickup'),
  in_area=coalesce((p_data->>'in_area')::boolean,false),revision=revision+1,updated_at=now() WHERE id=b.id;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,b.id,'amended',jsonb_build_object('note',p_note,'before',jsonb_build_object('appointment_at',b.appointment_at,'return_at',b.return_at,'route_id',b.route_id,'pickup',b.pickup,'in_area',b.in_area,'return_mode',b.return_mode),'after',p_data));
 PERFORM public.ptb_notice(p_muni,b.id,ARRAY[b.created_by],'เจ้าหน้าที่ปรับรายละเอียดตามที่ประสานแล้ว กรุณาตรวจการจอง');
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text) TO authenticated;

-- An already-open browser with the old intake must not create a parallel queue.
CREATE FUNCTION public.patient_booking_guard_legacy_intake() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.patient_booking_settings WHERE municipality_id=NEW.municipality_id AND enabled) THEN
  RAISE EXCEPTION 'หน่วยงานนี้ใช้ระบบจองรถใหม่แล้ว กรุณาเปิดหน้ารถรับส่งผู้ป่วยและส่งคำขอใหม่';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_guard_legacy_intake() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER patient_booking_guard_legacy_intake BEFORE INSERT ON public.patient_transport_requests
 FOR EACH ROW EXECUTE FUNCTION public.patient_booking_guard_legacy_intake();
COMMIT;
