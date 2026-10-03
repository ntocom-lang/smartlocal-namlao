-- Community transport configuration only. No intake, planner or service activation.
-- Depends on all three 20261003110xxx foundation migrations.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.patient_booking_community_rules') IS NULL
  OR to_regprocedure('public.ptb_seats(public.patient_bookings)') IS NULL THEN
  RAISE EXCEPTION 'Apply all community foundation migrations first';
 END IF;
 IF to_regprocedure('public.patient_booking_save_community_rules(uuid,integer,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'Community rules RPC already exists; check migration history';
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc
  WHERE oid=to_regprocedure('public.patient_booking_info(uuid)')) IS DISTINCT FROM 'a67426af6d662c58ccf6367e1f1e7e78' THEN
  RAISE EXCEPTION 'Function drift: patient_booking_info';
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc
  WHERE oid=to_regprocedure('public.patient_booking_workspace(uuid)')) IS DISTINCT FROM '4807ffb73e8becd333306e03de9b7436' THEN
  RAISE EXCEPTION 'Function drift: patient_booking_workspace';
 END IF;
END $guard$;

-- Only administrators of the selected tenant may change its policy. Revision
-- is a compare-and-swap token; rules_version changes only when policy changes.
CREATE FUNCTION public.patient_booking_save_community_rules(p_muni uuid,p_revision integer,p_data jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.patient_booking_community_rules; x jsonb; v_enabled boolean;
 v_start integer; v_end integer; v_places jsonb; v_activities jsonb; v_reference text;
 v_policy_changed boolean;
BEGIN
 IF public.ptb_role(p_muni)<>'admin' THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบตั้งค่าบริการชุมชนได้'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>32768 THEN
  RAISE EXCEPTION 'ข้อมูลตั้งค่าชุมชนไม่ถูกต้อง';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('enabled','window_start','window_end','places','activities','rules_reference')) THEN
  RAISE EXCEPTION 'ข้อมูลตั้งค่าชุมชนไม่ถูกต้อง';
 END IF;
 IF p_data ? 'enabled' AND jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'สถานะเปิดบริการชุมชนไม่ถูกต้อง';
 END IF;
 v_enabled:=coalesce((p_data->>'enabled')::boolean,false);
 FOR x IN SELECT value FROM jsonb_each(p_data) WHERE key IN ('window_start','window_end') LOOP
  IF jsonb_typeof(x)<>'null' AND (jsonb_typeof(x)<>'number' OR x::text !~ '^[0-9]{1,4}$') THEN
   RAISE EXCEPTION 'ช่วงเวลาชุมชนต้องเป็นนาทีเต็มของวัน';
  END IF;
 END LOOP;
 v_start:=(p_data->>'window_start')::integer; v_end:=(p_data->>'window_end')::integer;
 IF (v_start IS NULL)<>(v_end IS NULL)
  OR v_start NOT BETWEEN 0 AND 1439 OR v_end NOT BETWEEN 1 AND 1440 OR v_end<=v_start THEN
  RAISE EXCEPTION 'ช่วงเวลาชุมชนไม่ถูกต้อง';
 END IF;
 IF jsonb_typeof(p_data->'places') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_data->'activities') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'สถานที่และกิจกรรมชุมชนต้องเป็นรายการ';
 END IF;
 IF jsonb_array_length(p_data->'places')>100 OR jsonb_array_length(p_data->'activities')>100 THEN
  RAISE EXCEPTION 'สถานที่และกิจกรรมชุมชนเกินจำนวนที่กำหนด';
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'places') LOOP
  IF jsonb_typeof(x)<>'object' THEN RAISE EXCEPTION 'ข้อมูลสถานที่ชุมชนไม่ถูกต้อง'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','label','minutes'))
   OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR coalesce(x->>'id','') !~ '^[a-zA-Z0-9_-]{1,60}$'
   OR x->>'id'='__other__' OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string'
   OR char_length(btrim(coalesce(x->>'label',''))) NOT BETWEEN 1 AND 200
   OR coalesce(x->>'label','') !~ '[^[:space:]]'
   OR jsonb_typeof(x->'minutes') IS DISTINCT FROM 'number' OR coalesce(x->>'minutes','') !~ '^[0-9]{1,3}$' THEN
   RAISE EXCEPTION 'กรุณาระบุรหัส ชื่อ และเวลาเดินทางของทุกสถานที่ชุมชน';
  END IF;
  IF (x->>'minutes')::integer NOT BETWEEN 5 AND 240 THEN
   RAISE EXCEPTION 'เวลาเดินทางของสถานที่ชุมชนต้องอยู่ระหว่าง 5 ถึง 240 นาที';
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_data->'places'))<>jsonb_array_length(p_data->'places') THEN
  RAISE EXCEPTION 'รหัสสถานที่ชุมชนซ้ำ';
 END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'activities') LOOP
  IF jsonb_typeof(x)<>'object' THEN RAISE EXCEPTION 'ข้อมูลกิจกรรมชุมชนไม่ถูกต้อง'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('code','label'))
   OR jsonb_typeof(x->'code') IS DISTINCT FROM 'string' OR coalesce(x->>'code','') !~ '^[a-zA-Z0-9_-]{1,60}$'
   OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string'
   OR char_length(btrim(coalesce(x->>'label',''))) NOT BETWEEN 1 AND 200
   OR coalesce(x->>'label','') !~ '[^[:space:]]' THEN
   RAISE EXCEPTION 'กรุณาระบุรหัสและชื่อของทุกกิจกรรมชุมชน';
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'code') FROM jsonb_array_elements(p_data->'activities'))<>jsonb_array_length(p_data->'activities') THEN
  RAISE EXCEPTION 'รหัสกิจกรรมชุมชนซ้ำ';
 END IF;
 IF p_data ? 'rules_reference' AND jsonb_typeof(p_data->'rules_reference') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'ข้อความอ้างอิงข้อบังคับชุมชนไม่ถูกต้อง';
 END IF;
 v_reference:=btrim(coalesce(p_data->>'rules_reference',''));
 IF char_length(v_reference)>2000 THEN RAISE EXCEPTION 'ข้อความอ้างอิงข้อบังคับชุมชนยาวเกินกำหนด'; END IF;
 IF v_enabled AND (v_start IS NULL OR v_end IS NULL OR v_reference !~ '[^[:space:]]'
  OR jsonb_array_length(p_data->'places')=0 OR jsonb_array_length(p_data->'activities')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการชุมชนต้องระบุข้อบังคับ กิจกรรม สถานที่ และช่วงเวลา';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(value->>'minutes')::integer) ORDER BY ord),'[]')
  INTO v_places FROM jsonb_array_elements(p_data->'places') WITH ORDINALITY entries(value,ord);
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',value->>'code','label',btrim(value->>'label')) ORDER BY ord),'[]')
  INTO v_activities FROM jsonb_array_elements(p_data->'activities') WITH ORDINALITY entries(value,ord);
 INSERT INTO public.patient_booking_community_rules(municipality_id) VALUES(p_muni) ON CONFLICT DO NOTHING;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni FOR UPDATE;
 IF p_revision IS DISTINCT FROM c.revision THEN RAISE EXCEPTION 'กฎชุมชนเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 v_policy_changed:=ROW(v_start,v_end,v_places,v_activities,v_reference)
  IS DISTINCT FROM ROW(c.window_start,c.window_end,c.places,c.activities,c.rules_reference);
 UPDATE public.patient_booking_community_rules SET enabled=v_enabled,window_start=v_start,window_end=v_end,
  places=v_places,activities=v_activities,rules_reference=v_reference,
  rules_version=c.rules_version+CASE WHEN v_policy_changed THEN 1 ELSE 0 END,
  revision=c.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'community_rules_changed',jsonb_build_object(
  'revision',c.revision+1,'rules_version',c.rules_version+CASE WHEN v_policy_changed THEN 1 ELSE 0 END,
  'enabled',v_enabled,'place_count',jsonb_array_length(v_places),'activity_count',jsonb_array_length(v_activities)));
 RETURN c.revision+1;
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_save_community_rules(uuid,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_save_community_rules(uuid,integer,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.patient_booking_info(p_muni uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('booking_mode',true,'enabled',s.enabled AND p.is_active,'owner_name',p.name,'office_start',s.office_start,
 'office_end',s.office_end,'routes',s.routes,'contact_phone',s.contact_phone,'privacy_notice',s.privacy_notice,
 'consent_version','patient-booking-v1','min_lead_days',0,
 'buffer_minutes',s.buffer_minutes,'boarding_minutes',s.boarding_minutes,
 'community',jsonb_build_object('enabled',coalesce(c.enabled,false) AND s.enabled AND p.is_active,
  'places',coalesce(c.places,'[]'::jsonb),'activities',coalesce(c.activities,'[]'::jsonb),
  'window_start',c.window_start,'window_end',c.window_end,'rules_version',coalesce(c.rules_version,1),
  'consent_version','community-booking-v1',
  'privacy_notice','บริการรถรับ–ส่งชุมชนใช้ชื่อผู้ติดต่อ เบอร์ติดต่อ ชื่อกลุ่ม จำนวนผู้เดินทาง กิจกรรม สถานที่ วันเวลา และจุดรับ เพื่อรับคำขอ จัดคิว และประสานการเดินทาง พิกัดจุดรับเป็นทางเลือก ผู้จัดคิวและคนขับเข้าถึงข้อมูลเท่าที่จำเป็นต่อหน้าที่ ตารางสาธารณะไม่แสดงชื่อ เบอร์โทร จุดรับ หรือพิกัด สอบถามการใช้ข้อมูลและระยะเวลาเก็บรักษาได้ที่เจ้าหน้าที่ตามเบอร์ติดต่อในหน้านี้'))
 FROM public.patient_booking_settings s JOIN public.referral_partners p ON p.id=s.partner_id
 LEFT JOIN public.patient_booking_community_rules c ON c.municipality_id=s.municipality_id
 WHERE s.municipality_id=p_muni AND s.enabled;
$$;

CREATE OR REPLACE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings;
 c public.patient_booking_community_rules; b jsonb; t jsonb; partners jsonb; people jsonb;
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
NOTIFY pgrst, 'reload schema';
COMMIT;
