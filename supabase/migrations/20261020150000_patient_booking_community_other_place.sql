-- ช่อง "อื่นๆ" ในข้อ "สถานที่ชุมชน" ของฟอร์มรถรับ–ส่งชุมชน: ผู้ขอพิมพ์ชื่อสถานที่ที่ไม่อยู่ในรายการเอง (เจ้าของระบบสั่ง 2569-10-19)
--
-- ฟอร์มผู้ป่วยมีช่องนี้แล้ว (20261007170000) แต่ฐานข้อมูลชุมชนปิดทางนี้ไว้ 3 จุด จึงต้องแก้ฟังก์ชัน ไม่ใช่แค่หน้าจอ:
--   1. patient_booking_save_community_rules  เดิมห้าม place id '__other__' → รับได้ (แอดมินเปิดสวิตช์ครั้งเดียว ปิดไว้เป็นค่าเริ่มต้น) ·
--      label บังคับคงที่ "อื่นๆ (พิมพ์ชื่อสถานที่เอง)" · ก่อนเปิดบริการต้องมีสถานที่ในรายการ ≥ 1 แห่งที่ไม่ใช่ '__other__'
--   2. ptb_community_payload                 เดิมห้าม route_id '__other__' → รับ other_place (2–200 ตัวอักษร หลังยุบช่องว่าง/ตัวควบคุม
--      แบบเดียวกับ patient_booking_submit) เก็บเป็น route_label ของคำขอนั้น · '__other__' ต้องอยู่ในกฎของหน่วยงาน ·
--      ส่ง other_place มากับสถานที่ปกติ = ปฏิเสธ · submit/amend ชุมชนเรียกตัวนี้อยู่แล้ว จึงไม่ต้องแก้
--   3. ptb_plan                              ขาชุมชนเลิกปฏิเสธ '__other__' (ยังปฏิเสธ "ยังไม่ตั้งสถานที่ชุมชน" เมื่อสถานที่ไม่อยู่ในกฎ)
-- ตั้งแต่ #455 (2569-10-12) จัดรอบรถด้วยคน ไม่มีเวลาเดินทาง/ช่วงกันรถ จึงไม่ต้องมี "เวลาเดินทางมาตรฐาน" ของสถานที่อื่น
-- ไม่ย้ายข้อมูล (ยังไม่มีคำขอชุมชนไหนใช้ '__other__') · อนุญาตเพิ่มอย่างเดียว เข้ากันได้กับโค้ดเก่า · ยกนิยามล่าสุดมาเต็มทุกบรรทัด (จาก 20261011120000/100/200)
-- ⚠️ ระบบไม่ตรวจว่ากองทุนอนุญาตให้ใช้รถไปสถานที่ประเภทใด ผู้ประสานงานตรวจก่อนยืนยันรถเหมือนเดิม · ต้องยืนยันกับข้อบังคับกองทุนฉบับปัจจุบันก่อนเปิดสวิตช์
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.ptb_plan(uuid,uuid[],text)','9bb00df1ed22c76ff6f7d3c863517c65',
 'public.ptb_community_payload(uuid,jsonb)','393474ee947a47803df94f8fa0c7b289',
 'public.patient_booking_save_community_rules(uuid,integer,jsonb)','4396102663c72d06d72386d767bcfc23'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

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
   OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string'
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
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'places') pl WHERE pl->>'id'<>'__other__') OR jsonb_array_length(p_data->'activities')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการชุมชนต้องระบุข้อบังคับ กิจกรรม สถานที่ และช่วงเวลา';
 END IF;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',CASE WHEN value->>'id'='__other__' THEN 'อื่นๆ (พิมพ์ชื่อสถานที่เอง)' ELSE btrim(value->>'label') END,'minutes',(SELECT old->'minutes' FROM jsonb_array_elements(coalesce(c.places,'[]')) AS previous(old) WHERE old->>'id'=value->>'id')) ORDER BY ord),'[]')
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

CREATE OR REPLACE FUNCTION public.ptb_community_payload(p_muni uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.patient_booking_community_rules; info jsonb; place jsonb; activity jsonb;
 appt timestamptz; back timestamptz; lat double precision; lng double precision; key text; value jsonb; other_text text;
BEGIN
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 THEN RAISE EXCEPTION 'ข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
 IF p_data-ARRAY['requester_name','phone','pickup','pickup_lat','pickup_lng','in_area','route_id','appointment_at','return_at','return_mode','group_label','party_size','purpose_code','rules_version','consent','consent_version','privacy_notice','owner_name','other_place']<>'{}'::jsonb THEN RAISE EXCEPTION 'มีข้อมูลที่ไม่รองรับในคำขอชุมชน'; END IF;
 FOR key,value IN SELECT * FROM jsonb_each(p_data) LOOP
  IF key IN ('party_size','rules_version','pickup_lat','pickup_lng') THEN
   IF jsonb_typeof(value)<>'number' AND NOT(key IN ('pickup_lat','pickup_lng') AND value='null'::jsonb) THEN RAISE EXCEPTION 'ชนิดข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
  ELSIF key IN ('consent','in_area') THEN
   IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'ชนิดข้อมูลคำขอชุมชนไม่ถูกต้อง'; END IF;
  ELSIF key='return_at' AND value='null'::jsonb THEN NULL;
  ELSIF jsonb_typeof(value)<>'string' THEN RAISE EXCEPTION 'ชนิดข้อมูลคำขอชุมชนไม่ถูกต้อง';
  END IF;
 END LOOP;
 IF p_data->'consent' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'ต้องยืนยันการใช้ข้อมูลสำหรับบริการชุมชน'; END IF;
 info:=public.patient_booking_info(p_muni);
 IF p_data->>'consent_version' IS DISTINCT FROM 'community-booking-v1'
  OR p_data->>'privacy_notice' IS DISTINCT FROM info->'community'->>'privacy_notice'
  OR p_data->>'owner_name' IS DISTINCT FROM info->>'owner_name' OR info IS NULL THEN RAISE EXCEPTION 'ข้อความใช้ข้อมูลชุมชนเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
 IF c.municipality_id IS NULL OR c.window_start IS NULL OR c.window_end IS NULL THEN RAISE EXCEPTION 'ยังไม่ตั้งช่วงเวลาบริการชุมชน'; END IF;
 IF coalesce(p_data->>'rules_version','') !~ '^[1-9][0-9]{0,8}$' OR (p_data->>'rules_version')::integer IS DISTINCT FROM c.rules_version THEN RAISE EXCEPTION 'กฎบริการชุมชนเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
 IF coalesce(p_data->>'party_size','') !~ '^[1-9][0-9]?$' OR (p_data->>'party_size')::integer NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางชุมชนต้องเป็น 1 ถึง 15 คน'; END IF;
 IF char_length(coalesce(btrim(p_data->>'requester_name'),'')) NOT BETWEEN 1 AND 200
  OR coalesce(btrim(p_data->>'phone'),'') !~ '^0[0-9]{8,9}$'
  OR char_length(coalesce(btrim(p_data->>'pickup'),'')) NOT BETWEEN 1 AND 500
  OR char_length(coalesce(btrim(p_data->>'group_label'),'')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'ระบุชื่อผู้ติดต่อ เบอร์โทร จุดรับ และชื่อกลุ่มให้ครบ'; END IF;
 IF p_data->>'return_mode' IS NULL OR p_data->>'return_mode' NOT IN ('one_way','wait','later') THEN RAISE EXCEPTION 'รูปแบบรับกลับไม่ถูกต้อง'; END IF;
 SELECT x INTO place FROM jsonb_array_elements(c.places) x WHERE x->>'id'=p_data->>'route_id';
 IF place IS NULL THEN RAISE EXCEPTION 'ยังไม่ตั้งสถานที่ชุมชน'; END IF;
 -- สถานที่อื่น: ผู้ขอพิมพ์ชื่อเอง เก็บเป็น route_label ของคำขอนี้ (ยุบช่องว่าง/ตัวควบคุมแบบเดียวกับงานผู้ป่วย) · ส่งชื่อมากับสถานที่ปกติไม่ได้
 IF place->>'id'='__other__' THEN
  other_text:=left(btrim(regexp_replace(coalesce(p_data->>'other_place',''),'[[:space:][:cntrl:]]+',' ','g')),201);
  IF char_length(other_text) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'กรุณาพิมพ์ชื่อสถานที่ที่จะไป (2–200 ตัวอักษร)'; END IF;
 ELSIF p_data ? 'other_place' THEN RAISE EXCEPTION 'มีข้อมูลที่ไม่รองรับในคำขอชุมชน'; END IF;
 SELECT x INTO activity FROM jsonb_array_elements(c.activities) x WHERE x->>'code'=p_data->>'purpose_code';
 IF activity IS NULL THEN RAISE EXCEPTION 'กิจกรรมชุมชนไม่อยู่ในกฎที่ตั้งไว้'; END IF;
 BEGIN
  appt:=(p_data->>'appointment_at')::timestamptz; back:=(p_data->>'return_at')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'วันเวลาคำขอชุมชนไม่ถูกต้อง'; END;
 IF appt IS NULL OR NOT isfinite(appt) OR (appt AT TIME ZONE 'Asia/Bangkok')::date<(now() AT TIME ZONE 'Asia/Bangkok')::date
  OR (appt AT TIME ZONE 'Asia/Bangkok')::date>((now() AT TIME ZONE 'Asia/Bangkok')::date+interval '12 months')::date THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจอง'; END IF;
 IF appt < (((appt AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+make_interval(mins=>c.window_start)) AT TIME ZONE 'Asia/Bangkok'
  OR appt > (((appt AT TIME ZONE 'Asia/Bangkok')::date)::timestamp+make_interval(mins=>c.window_end)) AT TIME ZONE 'Asia/Bangkok' THEN RAISE EXCEPTION 'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน'; END IF;
 IF p_data->>'return_mode'='one_way' AND back IS NOT NULL THEN RAISE EXCEPTION 'เที่ยวขาเดียวต้องไม่มีเวลารับกลับ'; END IF;
 IF back IS NOT NULL AND (NOT isfinite(back) OR back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>(appt AT TIME ZONE 'Asia/Bangkok')::date) THEN RAISE EXCEPTION 'เวลารับกลับไม่ถูกต้อง'; END IF;
 lat:=(p_data->>'pickup_lat')::double precision; lng:=(p_data->>'pickup_lng')::double precision;
 IF (lat IS NULL)<>(lng IS NULL) OR lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'พิกัดจุดรับไม่ถูกต้อง'; END IF;
 RETURN jsonb_build_object('requester_name',btrim(p_data->>'requester_name'),'phone',btrim(p_data->>'phone'),
  'pickup',btrim(p_data->>'pickup'),'pickup_lat',lat,'pickup_lng',lng,'in_area',coalesce((p_data->>'in_area')::boolean,false),
  'route_id',place->>'id','route_label',CASE WHEN place->>'id'='__other__' THEN other_text ELSE place->>'label' END,'appointment_at',appt,'return_at',back,'return_mode',p_data->>'return_mode',
  'group_label',btrim(p_data->>'group_label'),'party_size',(p_data->>'party_size')::integer,'purpose_code',activity->>'code',
  'rules_version',c.rules_version,'consent_text','community-booking-v1'||E'\n'||(info->'community'->>'privacy_notice')||E'\nเจ้าของรถและผู้รับข้อมูล: '||(info->>'owner_name'));
END $$;

CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; errors text[]:='{}'; ids uuid[]; date_local date;
 helper boolean:=false;
 back_at timestamptz; outbound jsonb:='[]'; returns jsonb:='[]';
 anchor timestamptz; last_time timestamptz; wave_n integer:=0; wave_seats integer:=0;
 max_seats integer:=0; wave_count integer:=0;
 mode text; multiwave boolean:=false; c public.patient_booking_community_rules;
 zone text; route_count integer:=1;
BEGIN
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 n:=cardinality(ids);
 IF n IS NULL OR n NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางไม่ถูกต้อง'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids))<>n THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้'; END IF;
 SELECT count(DISTINCT route_id) INTO route_count FROM public.patient_bookings WHERE id=ANY(ids);
 SELECT * INTO f FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LIMIT 1;
 date_local:=(f.appointment_at AT TIME ZONE 'Asia/Bangkok')::date;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND service_type<>f.service_type) THEN errors:=array_append(errors,'ห้ามรวมงานผู้ป่วยกับงานชุมชน'); END IF;
 IF f.service_type='community' THEN
  SELECT * INTO c FROM public.patient_booking_community_rules WHERE municipality_id=p_muni;
  SELECT x INTO route FROM jsonb_array_elements(coalesce(c.places,'[]'::jsonb)) x WHERE x->>'id'=f.route_id;
  IF n<>1 THEN errors:=array_append(errors,'งานชุมชนไม่เปิดร่วมเที่ยว'); END IF;
  IF coalesce(btrim(p_helper),'')<>'' THEN errors:=array_append(errors,'งานชุมชนไม่ใช้ผู้ช่วยเคลื่อนย้าย'); END IF;
  IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งสถานที่ชุมชน'); END IF;
  IF c.window_start IS NULL OR c.window_end IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งช่วงเวลาบริการชุมชน'); END IF;
 ELSE
  SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=f.route_id;
  IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ'); END IF;
  zone:=nullif(btrim(route->>'zone'),'');
 END IF;
 IF s.seats IS NULL OR s.wheelchairs IS NULL OR s.stretchers IS NULL THEN errors:=array_append(errors,'ยังไม่ยืนยันความจุรถ'); END IF;
 IF NOT s.enabled OR s.unavailable OR s.driver_id IS NULL THEN errors:=array_append(errors,'รถหรือคนขับยังไม่พร้อมให้บริการ'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active) THEN errors:=array_append(errors,'หน่วยงานเจ้าของรถปิดรับเรื่อง'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=s.driver_id AND municipality_id=p_muni AND role IN ('admin','officer','staff')) THEN errors:=array_append(errors,'บัญชีคนขับไม่ได้รับสิทธิ์เจ้าหน้าที่แล้ว'); END IF;
 IF date_local<(now() AT TIME ZONE 'Asia/Bangkok')::date THEN errors:=array_append(errors,'วันเดินทางผ่านแล้ว'); END IF;
 SELECT max(return_at) INTO back_at FROM public.patient_bookings WHERE id=ANY(ids);
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) LOOP
  IF r.status NOT IN ('submitted','confirmed') THEN errors:=array_append(errors,'มีคำขอที่ปิดหรือยกเลิกแล้ว'); END IF;
  IF NOT r.in_area THEN errors:=array_append(errors,'ต้องตรวจสอบพื้นที่รับบริการ'); END IF;
  -- ปลายทางต่างกันได้เฉพาะงานผู้ป่วย และทั้งสองปลายทางต้องอยู่ "กลุ่มปลายทาง" เดียวกันที่ผู้ดูแลตั้งไว้
  IF (r.route_id<>f.route_id AND (f.service_type='community' OR zone IS NULL OR zone IS DISTINCT FROM
    (SELECT nullif(btrim(x->>'zone'),'') FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=r.route_id)))
   OR (r.appointment_at AT TIME ZONE 'Asia/Bangkok')::date<>date_local THEN errors:=array_append(errors,'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน'); END IF;
  IF n>1 AND (NOT r.share OR r.mobility<>'walk') THEN errors:=array_append(errors,'ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว'); END IF;
  IF r.return_mode<>'one_way' AND r.return_at IS NULL THEN errors:=array_append(errors,'ยังไม่มีเวลาขากลับ'); END IF;
  IF r.return_at<r.appointment_at THEN errors:=array_append(errors,'เวลารับกลับอยู่ก่อนเวลานัด'); END IF;
  IF r.service_type='community' THEN
   IF r.appointment_at < (date_local::timestamp+make_interval(mins=>c.window_start)) AT TIME ZONE 'Asia/Bangkok'
    OR r.appointment_at > (date_local::timestamp+make_interval(mins=>c.window_end)) AT TIME ZONE 'Asia/Bangkok' THEN
    errors:=array_append(errors,'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน');
   END IF;
  ELSIF r.appointment_at < (date_local::timestamp+make_interval(mins=>s.office_start)) AT TIME ZONE 'Asia/Bangkok'
   OR r.appointment_at > (date_local::timestamp+make_interval(mins=>s.office_end)) AT TIME ZONE 'Asia/Bangkok' THEN
   errors:=array_append(errors,'เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง');
  END IF;
  IF r.mobility<>'walk' THEN helper:=true; END IF;
  IF r.mobility='wheelchair' AND coalesce(s.wheelchairs,0)<1 THEN errors:=array_append(errors,'ยังไม่ยืนยันที่ยึดรถเข็น'); END IF;
  IF r.mobility='stretcher' AND coalesce(s.stretchers,0)<1 THEN errors:=array_append(errors,'ยังไม่ยืนยันที่ยึดเปล'); END IF;
 END LOOP;
 IF helper THEN
  IF coalesce(btrim(p_helper),'')='' THEN errors:=array_append(errors,'ต้องยืนยันผู้ช่วยเคลื่อนย้ายประจำเที่ยว'); END IF;
 END IF;

 -- Cluster appointment times within 30 minutes of the FIRST appointment in each run.
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY appointment_at,id LOOP
  IF anchor IS NOT NULL AND r.appointment_at-anchor>interval '30 minutes' THEN

   outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',NULL,'end_at',NULL,'passengers',wave_n));

   max_seats:=greatest(max_seats,wave_seats);
   anchor:=NULL; wave_n:=0; wave_seats:=0;
  END IF;
  IF anchor IS NULL THEN anchor:=r.appointment_at; wave_count:=wave_count+1; END IF;
  last_time:=r.appointment_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
  wave_seats:=wave_seats+public.ptb_seats(r);

 END LOOP;

 outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',NULL,'end_at',NULL,'passengers',wave_n));

 max_seats:=greatest(max_seats,wave_seats);
 multiwave:=wave_count>1;
 mode:=CASE WHEN multiwave AND f.return_mode<>'one_way' THEN 'later' ELSE f.return_mode END;
 IF multiwave AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode='one_way')
  AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode<>'one_way') THEN
  errors:=array_append(errors,'รูปแบบขากลับของผู้ร่วมเที่ยวไม่ตรงกัน');
 ELSIF NOT multiwave AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode<>f.return_mode) THEN
  errors:=array_append(errors,'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน');
 END IF;
 IF multiwave AND NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND status='confirmed') THEN
  errors:=array_append(errors,'ต้องจัดรอบรับหลายรอบผ่านเที่ยวที่ยืนยันแล้ว');
 END IF;

 -- Return runs may be separate, or a single run when hospital return times are close.
 anchor:=NULL; wave_n:=0; wave_seats:=0;
 IF mode<>'one_way' THEN
  FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) AND return_at IS NOT NULL ORDER BY return_at,id LOOP
   IF anchor IS NOT NULL AND r.return_at-anchor>interval '30 minutes' THEN

    returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',NULL,'end_at',NULL,'passengers',wave_n));

    max_seats:=greatest(max_seats,wave_seats);
    anchor:=NULL; wave_n:=0; wave_seats:=0;
   END IF;
   IF anchor IS NULL THEN anchor:=r.return_at; END IF;
   last_time:=r.return_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
   wave_seats:=wave_seats+public.ptb_seats(r);

  END LOOP;
  IF anchor IS NOT NULL THEN

   returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',NULL,'end_at',NULL,'passengers',wave_n));

   max_seats:=greatest(max_seats,wave_seats);
  END IF;
 END IF;
 IF helper THEN max_seats:=max_seats+1; END IF;
 IF max_seats>s.seats THEN errors:=array_append(errors,'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'); END IF;
 -- The coordinator arranges vehicle timing. No calculated overlap blocks confirmations.
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t WHERE t.municipality_id=p_muni AND t.state='issue'
  AND (t.plan->>'date')::date=date_local AND NOT(t.booking_ids&&ids)) THEN
  errors:=array_append(errors,'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน');
 END IF;
 RETURN jsonb_build_object('service_type',f.service_type,'community_rules_version',CASE WHEN f.service_type='community' THEN c.rules_version ELSE NULL END,'booking_ids',ids,'date',date_local,'route_label',CASE WHEN route_count>1 THEN (SELECT string_agg(l,' + ' ORDER BY a,k) FROM (SELECT route_id k,min(route_label) l,min(appointment_at) a
    FROM public.patient_bookings WHERE id=ANY(ids) GROUP BY route_id) q) ELSE f.route_label END,'route_id',f.route_id,
  'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(ids)),
  'scheduling_mode','manual','appointment_at',f.appointment_at,'return_mode',mode,'pickup_at',NULL,'return_at',back_at,'blocks','[]'::jsonb,'seats',max_seats,'helper_required',helper,
  'outbound_waves',outbound,'return_waves',returns,'multiwave',multiwave,
  'settings_revision',s.revision,'errors',(SELECT coalesce(jsonb_agg(DISTINCT x),'[]') FROM unnest(errors) x));
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
