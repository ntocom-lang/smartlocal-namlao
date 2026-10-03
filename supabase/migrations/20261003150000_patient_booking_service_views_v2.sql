-- Full current projections, versioned so stale clients never receive community data.
-- Depends on 20261003130200. No booking/configuration writes.
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.patient_booking_workspace(uuid)','e5ce1f20886c6df4a60f4273bdf838a8',
 'public.patient_booking_mine(uuid)','d69773d7616d9eaf9a83662e9c8a96a8'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
 IF to_regprocedure('public.patient_booking_workspace_v2(uuid)') IS NOT NULL OR to_regprocedure('public.patient_booking_mine_v2(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Service views v2 already exist; check migration history';
 END IF;
END $guard$;

CREATE FUNCTION public.patient_booking_workspace_v2(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings;
 c public.patient_booking_community_rules; b jsonb; t jsonb; partners jsonb; people jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'appointment_at'),'[]') INTO b FROM (
  SELECT CASE WHEN role_name='driver' AND NOT (r.created_by=auth.uid() AND r.entry_channel='online') THEN jsonb_build_object('id',r.id,'trip_id',r.trip_id,'service_type',r.service_type,'party_size',r.party_size,'group_label',r.group_label,
   'patient_name',CASE WHEN r.service_type='community' THEN 'กลุ่ม '||coalesce(r.group_label,'ชุมชน')||' ('||r.party_size::text||' คน)' ELSE r.patient_name END,
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
  SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 END IF;
 RETURN jsonb_build_object('role',role_name,'settings',CASE WHEN role_name IN ('admin','coordinator') THEN to_jsonb(s) ELSE NULL END,
  'community_rules',CASE WHEN role_name IN ('admin','coordinator') THEN CASE WHEN c.municipality_id IS NOT NULL THEN to_jsonb(c)
   ELSE jsonb_build_object('municipality_id',p_muni,'enabled',false,'window_start',NULL,'window_end',NULL,'places','[]'::jsonb,
    'activities','[]'::jsonb,'rules_reference','','rules_version',1,'revision',1) END ELSE NULL END,
  'bookings',b,'trips',t,'limited',jsonb_array_length(b)=1000 OR jsonb_array_length(t)=1000,'partners',partners,'people',people,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n),
  'events',CASE WHEN role_name IN ('admin','coordinator') THEN (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM
   (SELECT entity_id,action,detail,created_at FROM public.patient_booking_events WHERE municipality_id=p_muni ORDER BY created_at DESC LIMIT 50)e) ELSE '[]'::jsonb END);
END $$;

CREATE FUNCTION public.patient_booking_mine_v2(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); b jsonb; t jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 -- คำขอที่ถูกยกเลิกพ่วง cancel_note = เหตุผลที่เจ้าหน้าที่บันทึกไว้ล่าสุด (ว่างไว้ถ้าไม่มี)
 SELECT coalesce(jsonb_agg(CASE WHEN r.status='cancelled' THEN (to_jsonb(r)-'consent_text')||jsonb_build_object('cancel_note',
   (SELECT nullif(btrim(e.detail->>'note'),'') FROM public.patient_booking_events e
     WHERE e.municipality_id=p_muni AND e.entity_id=r.id AND e.action IN ('cancel','cancel_passenger')
      AND e.actor_id<>auth.uid() AND nullif(btrim(e.detail->>'note'),'') IS NOT NULL
     ORDER BY e.created_at DESC LIMIT 1))
  ELSE to_jsonb(r)-'consent_text' END ORDER BY r.appointment_at),'[]') INTO b
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
 -- service_type/party_size/group_label are included in to_jsonb(r), only for the owner's online requests.
 RETURN jsonb_build_object('role',role_name,'bookings',b,'trips',t,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n));
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_workspace_v2(uuid),public.patient_booking_mine_v2(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_workspace_v2(uuid),public.patient_booking_mine_v2(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
