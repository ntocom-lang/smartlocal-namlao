-- Admin-only permanent removal. Existing audit history is retained.
BEGIN;
CREATE FUNCTION public.patient_booking_delete(p_muni uuid,p_op uuid,p_booking uuid,p_revision integer,p_trip_revision integer,p_docs_revision integer,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; t public.patient_booking_trips; s public.patient_booking_settings;
 old public.patient_booking_operations; payload jsonb; remaining uuid[]; active_count integer; seat_count integer; helper boolean;
BEGIN
 IF public.ptb_role(p_muni) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'เฉพาะแอดมินของหน่วยงานนี้เท่านั้นที่ลบคำขอได้'; END IF;
 IF p_op IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>500 THEN RAISE EXCEPTION 'ระบุเหตุผลการลบ 1–500 ตัวอักษร'; END IF;
 -- Same lock order as every booking command: settings, booking, trip.
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('action','delete_booking','booking',p_booking,'revision',p_revision,'trip_revision',p_trip_revision,'docs_revision',p_docs_revision,'reason',btrim(p_reason));
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF FOUND THEN
  IF old.actor_id IS DISTINCT FROM auth.uid() OR old.municipality_id IS DISTINCT FROM p_muni OR old.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'รหัสรายการซ้ำไม่ตรงกับคำขอเดิม'; END IF;
  RETURN p_booking;
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้ กรุณาโหลดข้อมูลล่าสุด'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'คำขอเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจใหม่'; END IF;
 IF b.trip_id IS NOT NULL THEN
  SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.trip_id AND municipality_id=p_muni FOR UPDATE;
  IF NOT FOUND OR t.revision IS DISTINCT FROM p_trip_revision OR t.docs_revision IS DISTINCT FROM p_docs_revision THEN RAISE EXCEPTION 'เที่ยวรถหรือเอกสารเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจใหม่'; END IF;
  IF t.state NOT IN ('confirmed','completed','cancelled') THEN RAISE EXCEPTION 'เที่ยวรถอยู่ระหว่างรับ–ส่งหรือมีปัญหา ให้จบเที่ยวหรือประสานคืนคิวก่อนลบ'; END IF;
 ELSIF p_trip_revision IS NOT NULL OR p_docs_revision IS NOT NULL THEN
  RAISE EXCEPTION 'เที่ยวรถเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจใหม่';
 END IF;
 DELETE FROM public.patient_bookings WHERE id=b.id AND municipality_id=p_muni;
 IF t.id IS NOT NULL THEN
  SELECT coalesce(array_agg(id ORDER BY id),'{}'),count(*) FILTER(WHERE status IN ('confirmed','completed')),
   coalesce(sum(companions+CASE WHEN mobility='walk' THEN 1 ELSE 0 END) FILTER(WHERE status IN ('confirmed','completed')),0),coalesce(bool_or(mobility<>'walk') FILTER(WHERE status IN ('confirmed','completed')),false)
   INTO remaining,active_count,seat_count,helper FROM public.patient_bookings WHERE trip_id=t.id AND municipality_id=p_muni;
  -- Keep promised pickup times/blocks for surviving riders. No silent rescheduling.
  UPDATE public.patient_booking_trips SET booking_ids=remaining,
   plan=(plan||jsonb_build_object('booking_ids',to_jsonb(remaining),'booking_revisions',coalesce(plan->'booking_revisions','{}')-b.id::text,'seats',seat_count+CASE WHEN helper THEN 1 ELSE 0 END,'helper_required',helper)),
   state=CASE WHEN active_count=0 THEN 'cancelled' ELSE state END,revision=revision+1,docs_revision=docs_revision+1,updated_at=now() WHERE id=t.id;
  IF active_count=0 THEN
   UPDATE public.patient_bookings SET requested_trip_id=NULL,revision=revision+1,updated_at=now() WHERE municipality_id=p_muni AND requested_trip_id=t.id AND status='submitted';
  END IF;
 END IF;
 PERFORM public.ptb_audit(p_muni,b.id,'delete_booking',jsonb_build_object('reason',btrim(p_reason),'status',b.status,'trip_id',b.trip_id));
 PERFORM public.ptb_notice(p_muni,b.id,s.coordinator_ids||ARRAY[s.driver_id]||CASE WHEN b.entry_channel='online' THEN ARRAY[b.created_by] ELSE '{}'::uuid[] END,'แอดมินลบคำขอเลขที่ '||upper(left(b.id::text,8))||' แล้ว หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่');
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 RETURN b.id;
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_delete(uuid,uuid,uuid,integer,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_delete(uuid,uuid,uuid,integer,integer,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
