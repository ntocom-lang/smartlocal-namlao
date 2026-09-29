BEGIN;

-- Correct one confirmed rider's pickup without releasing the whole trip.
-- Coordinates are private patient location data: never add them to the public calendar.
CREATE FUNCTION public.patient_booking_update_pickup(
 p_muni uuid, p_op uuid, p_id uuid, p_revision integer,
 p_pickup text, p_lat double precision, p_lng double precision, p_verified boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.patient_booking_settings; b public.patient_bookings;
 t public.patient_booking_trips; old public.patient_booking_operations;
 payload jsonb; clean_pickup text:=btrim(p_pickup);
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะผู้ยืนยันคิวหรือแอดมินแก้จุดรับได้'; END IF;
 IF p_op IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'ข้อมูลคำขอไม่ครบ'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF s.municipality_id IS NULL THEN RAISE EXCEPTION 'ไม่พบหน่วยงาน'; END IF;
 payload:=jsonb_build_object('action','update_pickup','booking',p_id,'revision',p_revision,
  'pickup',clean_pickup,'lat',p_lat,'lng',p_lng,'verified',p_verified);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'รหัสการแก้จุดรับไม่ถูกต้อง';
 END IF;
 IF clean_pickup IS NULL OR char_length(clean_pickup) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'ระบุจุดรับใหม่ไม่เกิน 500 ตัวอักษร'; END IF;
 IF (p_lat IS NULL)<>(p_lng IS NULL) OR (p_lat IS NOT NULL AND
  (p_lat NOT BETWEEN 5 AND 21 OR p_lng NOT BETWEEN 96 AND 106)) THEN
  RAISE EXCEPTION 'หมุดจุดรับต้องมีพิกัดครบและอยู่ในประเทศไทย';
 END IF;
 IF p_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'กรุณาตรวจว่าจุดรับใหม่อยู่ในเขตบริการ'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_id AND municipality_id=p_muni FOR UPDATE;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.trip_id AND municipality_id=p_muni FOR UPDATE;
 IF b.id IS NULL OR b.status<>'confirmed' OR t.id IS NULL OR t.state<>'confirmed' OR b.passenger_step<>0 THEN
  RAISE EXCEPTION 'แก้จุดรับได้เฉพาะคิวที่ยืนยันแล้วและรถยังไม่ออก';
 END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'คำขอเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 IF b.pickup IS NOT DISTINCT FROM clean_pickup AND b.pickup_lat IS NOT DISTINCT FROM p_lat
  AND b.pickup_lng IS NOT DISTINCT FROM p_lng THEN RAISE EXCEPTION 'จุดรับใหม่เหมือนข้อมูลเดิม'; END IF;
 UPDATE public.patient_bookings SET pickup=clean_pickup,pickup_lat=p_lat,pickup_lng=p_lng,
  in_area=true,revision=revision+1,updated_at=now() WHERE id=b.id;
 -- The printed request uses the pickup; invalidate stale document drafts and plan revisions.
 UPDATE public.patient_booking_trips SET
  plan=jsonb_set(plan,ARRAY['booking_revisions',b.id::text],to_jsonb(b.revision+1),true),
  revision=revision+1,docs_revision=docs_revision+1,updated_at=now() WHERE id=t.id;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload)
  VALUES(p_op,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,b.id,'pickup_corrected',jsonb_build_object(
  'before',jsonb_build_object('pickup',b.pickup,'lat',b.pickup_lat,'lng',b.pickup_lng),
  'after',jsonb_build_object('pickup',clean_pickup,'lat',p_lat,'lng',p_lng),'trip_id',t.id));
 PERFORM public.ptb_notice(p_muni,b.id,s.coordinator_ids||ARRAY[b.created_by,t.driver_id],
  'เจ้าหน้าที่แก้จุดรับแล้ว กรุณาตรวจจุดรับและหมุดล่าสุดก่อนเดินทาง');
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_update_pickup(uuid,uuid,uuid,integer,text,double precision,double precision,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_update_pickup(uuid,uuid,uuid,integer,text,double precision,double precision,boolean)
 TO authenticated;

-- When the existing retention process purges a booking, also remove the pickup
-- copies introduced by this RPC. Keep actor/time and the fact of correction.
CREATE FUNCTION public.ptb_purge_pickup_correction_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.patient_booking_events SET detail=(detail-'before'-'after')||jsonb_build_object('contact_purged',true)
  WHERE municipality_id=NEW.municipality_id AND entity_id=NEW.id AND action='pickup_corrected';
 UPDATE public.patient_booking_operations SET payload=(payload-'pickup'-'lat'-'lng')||jsonb_build_object('contact_purged',true)
  WHERE municipality_id=NEW.municipality_id AND payload->>'action'='update_pickup' AND payload->>'booking'=NEW.id::text;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ptb_purge_pickup_correction_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER patient_booking_purge_pickup_correction_history
 AFTER UPDATE OF contact_purged_at ON public.patient_bookings
 FOR EACH ROW WHEN (OLD.contact_purged_at IS NULL AND NEW.contact_purged_at IS NOT NULL)
 EXECUTE FUNCTION public.ptb_purge_pickup_correction_history();
NOTIFY pgrst,'reload schema';
COMMIT;
