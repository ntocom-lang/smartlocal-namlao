-- Manual dispatch: no travel-duration estimates or resource time reservations.
-- No booking, trip, schedule, document, or odometer data is rewritten.
BEGIN;
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_save_settings(uuid,integer,jsonb)')) IS DISTINCT FROM 'ca7b65302081a0985792c479115f712c' THEN RAISE EXCEPTION 'Function drift: patient_booking_save_settings'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.patient_booking_save_community_rules(uuid,integer,jsonb)')) IS DISTINCT FROM '8488257acd0701e32423390349366405' THEN RAISE EXCEPTION 'Function drift: patient_booking_save_community_rules'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.patient_booking_save_settings(p_muni uuid,p_revision integer,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; x jsonb; ids uuid[]; driver uuid; partner uuid; v_enabled boolean;
BEGIN
 IF public.ptb_role(p_muni)<>'admin' THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบตั้งค่าบริการได้'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>32768 THEN RAISE EXCEPTION 'ข้อมูลตั้งค่าไม่ถูกต้อง'; END IF;
 INSERT INTO public.patient_booking_settings(municipality_id) VALUES(p_muni) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF coalesce(p_revision,1)<>s.revision THEN RAISE EXCEPTION 'การตั้งค่าเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 partner:=nullif(p_data->>'partner_id','')::uuid; driver:=nullif(p_data->>'driver_id','')::uuid;
 v_enabled:=coalesce((p_data->>'enabled')::boolean,false);
 SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(coalesce(p_data->'coordinator_ids','[]'));
 IF cardinality(ids)>30 OR EXISTS(SELECT 1 FROM unnest(ids) u WHERE NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND municipality_id=p_muni AND role IN ('admin','officer','staff'))) THEN RAISE EXCEPTION 'ผู้ประสานงานต้องเป็นเจ้าหน้าที่หน่วยงานนี้'; END IF;
 IF driver IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=driver AND municipality_id=p_muni AND role IN ('admin','officer','staff')) THEN RAISE EXCEPTION 'เลือกบัญชีเจ้าหน้าที่สำหรับคนขับในหน่วยงานนี้'; END IF;
 -- The same eligible staff account may be explicitly assigned both duties.
 IF partner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=partner AND municipality_id=p_muni AND is_active AND 'patient_transport_request'=ANY(document_types)) THEN RAISE EXCEPTION 'หน่วยงานเจ้าของรถไม่ถูกต้อง'; END IF;
 IF jsonb_typeof(p_data->'routes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'routes')>100 THEN RAISE EXCEPTION 'เส้นทางไม่ถูกต้อง'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_data->'routes') LOOP
  IF coalesce(x->>'id','')!~'^[a-zA-Z0-9_-]{1,60}$' OR char_length(coalesce(btrim(x->>'label'),'')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'กรุณาระบุรหัสและชื่อของทุกเส้นทาง'; END IF;
  IF char_length(coalesce(btrim(x->>'zone'),''))>60 THEN RAISE EXCEPTION 'ชื่อกลุ่มปลายทางยาวได้ไม่เกิน 60 ตัวอักษร'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_data->'routes'))<>jsonb_array_length(p_data->'routes') THEN RAISE EXCEPTION 'รหัสเส้นทางซ้ำ'; END IF;
 IF char_length(coalesce(p_data->>'privacy_notice',''))>6000 OR char_length(coalesce(p_data->>'delegation_reference',''))>500 THEN RAISE EXCEPTION 'ข้อความตั้งค่ายาวเกินกำหนด'; END IF;
 IF v_enabled AND (partner IS NULL OR driver IS NULL OR cardinality(ids)=0 OR
  nullif(p_data->>'seats','') IS NULL OR nullif(p_data->>'wheelchairs','') IS NULL OR nullif(p_data->>'stretchers','') IS NULL OR
  coalesce(p_data->>'contact_phone','')!~'^0[0-9]{8,9}$' OR jsonb_array_length(p_data->'routes')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการต้องยืนยันเจ้าของรถ คนขับ ผู้ประสานงาน ความจุรถ เส้นทาง และเบอร์ติดต่อ';
 END IF;
 -- Live journeys use their confirmed snapshots; changed settings require review of pending plans.
 IF driver IS DISTINCT FROM s.driver_id AND EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'มีเที่ยวค้าง ต้องจัดการเที่ยวเดิมก่อนเปลี่ยนคนขับ'; END IF;
 UPDATE public.patient_booking_settings SET enabled=v_enabled, partner_id=partner,driver_id=driver,coordinator_ids=ids,
  office_start=(p_data->>'office_start')::integer,office_end=(p_data->>'office_end')::integer,
  seats=nullif(p_data->>'seats','')::integer,wheelchairs=nullif(p_data->>'wheelchairs','')::integer,stretchers=nullif(p_data->>'stretchers','')::integer,
  buffer_minutes=s.buffer_minutes,boarding_minutes=s.boarding_minutes,
  routes=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(SELECT old->'minutes' FROM jsonb_array_elements(s.routes) AS previous(old) WHERE old->>'id'=value->>'id'))
    ||CASE WHEN nullif(btrim(value->>'zone'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('zone',btrim(value->>'zone')) END),'[]') FROM jsonb_array_elements(p_data->'routes')),
  holidays=CASE WHEN p_data ? 'holidays' THEN ARRAY(SELECT value::date FROM jsonb_array_elements_text(coalesce(p_data->'holidays','[]'))) ELSE s.holidays END,
  calendar_checked_through=CASE WHEN p_data ? 'calendar_checked_through' THEN nullif(p_data->>'calendar_checked_through','')::date ELSE s.calendar_checked_through END,unavailable=coalesce((p_data->>'unavailable')::boolean,false),
  delegation_reference=coalesce(nullif(btrim(p_data->>'delegation_reference'),''),s.delegation_reference),
  privacy_notice=coalesce(nullif(btrim(p_data->>'privacy_notice'),''),nullif(btrim(s.privacy_notice),''),
   'บริการรถรับส่งผู้ป่วยใช้ชื่อ เบอร์ติดต่อ วันเวลานัด โรงพยาบาล จุดรับ ผู้ติดตาม และข้อมูลการใช้รถเข็นหรือเปล เพื่อรับคำขอ จัดคิว ติดต่อประสานงาน รับส่ง และจัดทำหลักฐานบริการ พิกัดจุดรับเป็นทางเลือก ระบุที่อยู่และจุดสังเกตแทนได้ เจ้าหน้าที่จัดคิว คนขับ และผู้รับผิดชอบกองทุนเข้าถึงข้อมูลที่จำเป็นต่อหน้าที่ ตารางสาธารณะไม่แสดงชื่อ เบอร์โทร ที่อยู่หรือพิกัดของผู้เดินทาง หากไม่ให้ข้อมูลที่จำเป็นอาจไม่สามารถประสานรับส่งได้ สอบถามการใช้ข้อมูล ระยะเวลาเก็บรักษา หรือขอใช้สิทธิเกี่ยวกับข้อมูลส่วนบุคคลได้ที่เจ้าหน้าที่ผู้ให้บริการตามเบอร์ติดต่อในหน้านี้'),
  contact_phone=btrim(coalesce(p_data->>'contact_phone','')),revision=s.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'settings_changed',jsonb_build_object('revision',s.revision+1));
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_save_community_rules(p_muni uuid,p_revision integer,p_data jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.patient_booking_community_rules; x jsonb; v_enabled boolean;
 v_start integer; v_end integer; v_places jsonb; v_activities jsonb; v_reference text;
 v_policy_changed boolean;
BEGIN
 IF public.ptb_role(p_muni)<>'admin' THEN RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบตั้งค่าบริการชุมชนได้'; END IF;
 -- Serialize policy changes with intake and confirmation on the same tenant resource lock.
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ตั้งค่ารถก่อนตั้งบริการชุมชน'; END IF;
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
   OR coalesce(x->>'label','') !~ '[^[:space:]]' THEN
   RAISE EXCEPTION 'กรุณาระบุรหัสและชื่อของทุกสถานที่ชุมชน';
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
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(SELECT old->'minutes' FROM jsonb_array_elements(coalesce(c.places,'[]')) AS previous(old) WHERE old->>'id'=value->>'id')) ORDER BY ord),'[]')
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

NOTIFY pgrst,'reload schema';
COMMIT;
