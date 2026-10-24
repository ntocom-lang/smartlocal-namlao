-- Keep trip events inside each membership interval even after a cancellation is reopened.
-- Full latest history definition; no personal data or existing journeys are rewritten.
BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc
  WHERE oid=to_regprocedure('public.patient_booking_history(uuid,uuid)')) IS DISTINCT FROM '77f8409421ba662a4f39b3c140618b89' THEN
  RAISE EXCEPTION 'Function drift: patient_booking_history';
 END IF;
 IF to_regprocedure('public.ptb_booking_trip_windows(uuid,uuid)') IS NULL
  OR to_regprocedure('public.patient_booking_reopen(uuid,uuid,uuid,integer,text)') IS NULL THEN
  RAISE EXCEPTION 'Apply patient_booking_reopen_rpc first';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.patient_booking_history(p_muni uuid,p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $history$
DECLARE b public.patient_bookings; out_events jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN
  RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเท่านั้น';
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni;
 IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคำขอนี้'; END IF;
 WITH named AS (
  SELECT e.* FROM public.patient_booking_events e
  WHERE e.municipality_id=p_muni AND (e.entity_id=b.id
   OR e.detail->>'booking_id'=b.id::text
   OR coalesce(e.detail->'booking_ids','[]'::jsonb)?b.id::text
   OR coalesce(e.detail->'new_booking_ids','[]'::jsonb)?b.id::text)
 ), trip_events AS (
  SELECT e.* FROM public.patient_booking_events e
  WHERE e.municipality_id=p_muni
   AND NOT(e.detail?'booking_id' OR e.detail?'booking_ids' OR e.detail?'new_booking_ids')
   -- A move's source-wide event is not a change to the riders who stayed there.
   AND e.action<>'rescheduled'
   AND EXISTS(SELECT 1 FROM public.ptb_booking_trip_windows(p_muni,b.id) w
    WHERE w.trip_id=e.entity_id AND e.created_at>=w.joined_at
     AND (w.left_at IS NULL OR e.created_at<=w.left_at))
 ), merged AS (
  SELECT * FROM named UNION SELECT * FROM trip_events
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,
  'action',m.action,
  'at',m.created_at,
  'actor_name',coalesce(nullif(btrim(p.full_name),''),'ไม่ทราบชื่อ'),
  'by_booker',m.actor_id=b.created_by AND b.entry_channel='online',
  'entry_channel',m.detail->>'entry_channel',
  'note',nullif(btrim(coalesce(m.detail->>'note',m.detail->>'reason','')),''),
  'for_driver',CASE WHEN m.action IN ('trip_next','trip_finish','issue','passenger_next')
   AND m.detail?'driver_id' AND m.detail->>'driver_id' IS DISTINCT FROM m.actor_id::text THEN m.detail->>'driver_name' END,
  'driver_before',CASE WHEN m.action='driver_reassigned' THEN m.detail#>>'{before,name}' END,
  'driver_after',CASE WHEN m.action='driver_reassigned' THEN m.detail#>>'{after,name}' END
 ) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO out_events
 FROM merged m LEFT JOIN public.profiles p ON p.id=m.actor_id;
 RETURN jsonb_build_object('events',out_events);
END $history$;
-- Existing staff-only contract and projection remain unchanged.
REVOKE ALL ON FUNCTION public.patient_booking_history(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_history(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_reopen(uuid,uuid,uuid,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
