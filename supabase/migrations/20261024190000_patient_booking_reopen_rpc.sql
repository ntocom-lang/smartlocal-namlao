-- Restore a cancelled patient request to the queue. Never reopen or reassign a trip.
-- Definitions only: applying this migration does not rewrite requests or journeys.
BEGIN;

-- Internal membership windows, shared by the restore guard and staff history.
-- A rider may leave and later rejoin the same trip; keep every separate interval.
CREATE FUNCTION public.ptb_booking_trip_windows(p_muni uuid,p_booking uuid)
RETURNS TABLE(trip_id uuid,joined_at timestamptz,left_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $windows$
 WITH booking AS (
  SELECT b.* FROM public.patient_bookings b WHERE b.id=p_booking AND b.municipality_id=p_muni
 ), named AS (
  SELECT e.* FROM public.patient_booking_events e,booking b
  WHERE e.municipality_id=p_muni AND (e.entity_id=b.id OR e.detail->>'booking_id'=b.id::text
   OR coalesce(e.detail->'booking_ids','[]'::jsonb)?b.id::text
   OR coalesce(e.detail->'new_booking_ids','[]'::jsonb)?b.id::text)
 ), entries AS (
  SELECT t.id AS trip_id,e.created_at AS joined_at FROM named e
  JOIN public.patient_booking_trips t ON t.id=e.entity_id AND t.municipality_id=p_muni
  WHERE e.action IN ('confirmed','confirmed_join','confirmed_multiwave','rescheduled_from','joined_from_trip')
  UNION
  SELECT t.id,e.created_at FROM named e
  JOIN public.patient_booking_trips t ON t.municipality_id=p_muni AND t.id::text=e.detail->>'trip_id'
  WHERE e.entity_id=p_booking AND e.action='staff_join'
 ), legacy AS (
  -- Historical rows without an entry event retain their original trip association.
  SELECT t.id AS trip_id,t.created_at AS joined_at FROM public.patient_booking_trips t,booking b
  WHERE t.municipality_id=p_muni AND (t.id=b.trip_id OR b.id=ANY(t.booking_ids))
   AND NOT EXISTS(SELECT 1 FROM entries x WHERE x.trip_id=t.id)
 ), starts AS (
  SELECT x.*,lead(x.joined_at) OVER(PARTITION BY x.trip_id ORDER BY x.joined_at) AS next_entry
  FROM (SELECT * FROM entries UNION SELECT * FROM legacy) x
 )
 SELECT s.trip_id,s.joined_at,coalesce((
  SELECT min(e.created_at) FROM public.patient_booking_events e,booking b
  WHERE e.municipality_id=p_muni AND e.created_at>=s.joined_at
   AND (s.next_entry IS NULL OR e.created_at<s.next_entry)
   AND ((e.entity_id=b.id AND e.action IN ('cancel_passenger','reopened'))
    OR (e.entity_id=s.trip_id AND e.action='release')
    OR (e.entity_id=s.trip_id AND e.action='moved_into_trip' AND e.detail->>'booking_id'=b.id::text)
    OR (e.action='rescheduled_from' AND e.detail->>'old_trip'=s.trip_id::text
     AND coalesce(e.detail->'booking_ids','[]'::jsonb)?b.id::text))
 ),s.next_entry) AS left_at FROM starts s;
$windows$;
REVOKE ALL ON FUNCTION public.ptb_booking_trip_windows(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.patient_booking_reopen(p_muni uuid,p_op uuid,p_booking uuid,p_revision integer,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $reopen$
DECLARE b public.patient_bookings; s public.patient_booking_settings; old public.patient_booking_operations;
 payload jsonb; reason text:=btrim(coalesce(p_reason,'')); duplicate_id uuid;
BEGIN
 IF coalesce(public.ptb_role(p_muni),'') NOT IN ('admin','coordinator') THEN
  RAISE EXCEPTION 'เฉพาะแอดมินหรือผู้จัดคิวของหน่วยงานนี้คืนคำขอได้';
 END IF;
 IF p_op IS NULL OR p_booking IS NULL OR p_revision IS NULL OR char_length(reason) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'กรุณาระบุคำขอและเหตุผลการคืนรายการ 1–500 ตัวอักษร';
 END IF;
 -- Same tenant mutex as intake, confirmation, amendment and cancellation.
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ยังไม่ได้ตั้งค่าบริการรถของหน่วยงานนี้'; END IF;
 payload:=jsonb_build_object('action','reopen_booking','booking',p_booking,'revision',p_revision,'reason',reason);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF FOUND THEN
  IF old.actor_id IS DISTINCT FROM auth.uid() OR old.municipality_id IS DISTINCT FROM p_muni OR old.payload IS DISTINCT FROM payload THEN
   RAISE EXCEPTION 'รหัสรายการซ้ำไม่ตรงกับคำขอเดิม';
  END IF;
  RETURN p_booking;
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้ หรือรายการถูกลบแล้ว'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'คำขอเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจก่อนคืนรายการ'; END IF;
 IF b.service_type IS DISTINCT FROM 'patient' THEN RAISE EXCEPTION 'คืนรายการได้เฉพาะคำขอรถผู้ป่วย'; END IF;
 IF b.status<>'cancelled' THEN RAISE EXCEPTION 'คืนได้เฉพาะคำขอที่ยกเลิกแล้ว'; END IF;
 IF b.trip_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.patient_booking_trips t WHERE t.id=b.trip_id AND t.municipality_id=p_muni) THEN
  RAISE EXCEPTION 'ข้อมูลเที่ยวเดิมไม่ตรงกับหน่วยงาน กรุณาตรวจคำขอใหม่';
 END IF;
 IF b.contact_purged_at IS NOT NULL THEN RAISE EXCEPTION 'ข้อมูลติดต่อของคำขอนี้ถูกล้างตามอายุจัดเก็บแล้ว กรุณารับคำขอใหม่'; END IF;
 IF b.passenger_step<>0 OR b.return_ready OR EXISTS(
  SELECT 1 FROM public.patient_booking_events e WHERE e.municipality_id=p_muni AND e.entity_id=b.id
   AND e.action IN ('passenger_next','ready_return')
 ) THEN RAISE EXCEPTION 'คำขอนี้มีการรับ–ส่งแล้ว กรุณารับคำขอใหม่เพื่อรักษาประวัติการเดินทางจริง'; END IF;
 -- Do not guess whether someone rode on a running trip when the evidence is incomplete.
 IF EXISTS(SELECT 1 FROM public.ptb_booking_trip_windows(p_muni,b.id) w
  WHERE w.left_at IS NULL) THEN
  RAISE EXCEPTION 'ยังไม่พบหลักฐานว่าคำขอออกจากเที่ยวเดิมแล้ว กรุณาตรวจประวัติหรือรับคำขอใหม่';
 END IF;
 IF EXISTS(SELECT 1 FROM public.ptb_booking_trip_windows(p_muni,b.id) w
  JOIN public.patient_booking_events e ON e.entity_id=w.trip_id AND e.municipality_id=p_muni
  WHERE e.action IN ('trip_next','trip_finish') AND e.created_at>=w.joined_at AND e.created_at<=w.left_at) THEN
  RAISE EXCEPTION 'เที่ยวเดิมเริ่มรับ–ส่งขณะคำขอนี้อยู่ในเที่ยวแล้ว กรุณารับคำขอใหม่';
 END IF;
 SELECT r.id INTO duplicate_id FROM public.patient_bookings r WHERE r.municipality_id=p_muni AND r.id<>b.id
  AND r.service_type='patient' AND r.status IN ('submitted','confirmed') AND r.phone=b.phone
  AND r.patient_name=b.patient_name AND r.appointment_at=b.appointment_at AND r.route_id=b.route_id LIMIT 1;
 IF duplicate_id IS NOT NULL THEN
  RAISE EXCEPTION 'มีคำขอที่ยังใช้งานในวันเวลาและปลายทางนี้แล้ว เลขที่ % กรุณาใช้คิวที่มีอยู่',upper(left(duplicate_id::text,8));
 END IF;
 UPDATE public.patient_bookings SET status='submitted',trip_id=NULL,requested_trip_id=NULL,
  cancel_requested=false,return_ready=false,revision=revision+1,updated_at=now() WHERE id=b.id;
 PERFORM public.ptb_audit(p_muni,b.id,'reopened',jsonb_build_object('note',reason,'from_revision',b.revision,
  'previous_trip_id',b.trip_id,'previous_requested_trip_id',b.requested_trip_id,'previous_cancelled_at',b.updated_at));
 PERFORM public.ptb_notice(p_muni,b.id,s.coordinator_ids||CASE WHEN b.entry_channel='online' THEN ARRAY[b.created_by] ELSE '{}'::uuid[] END,
  'คำขอเลขที่ '||upper(left(b.id::text,8))||' กลับเป็นรอยืนยันรถแล้ว ยังไม่ได้ยืนยันเที่ยวใหม่');
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 RETURN b.id;
END $reopen$;
REVOKE ALL ON FUNCTION public.patient_booking_reopen(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
-- Enable this RPC only in the following history migration. A partial rollout cannot
-- restore a request while the old history projection would leak later trip events.
NOTIFY pgrst,'reload schema';
COMMIT;
