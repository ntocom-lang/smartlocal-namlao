-- กลุ่มปลายทาง: ผู้ป่วยที่ไปคนละปลายทางนั่งรถเที่ยวเดียวกันได้ เมื่อปลายทางอยู่กลุ่มเดียวกัน
--
-- เคสจริง (ทุ่งแค้ว 2569-10-09): เที่ยวฟอกไต "รอรับกลับ" กันรถ 10:30–19:00 ผู้ป่วยอีกรายไปคลินิกในเมืองแพร่
-- จองไม่ได้ทั้งวัน ทั้งที่รถไปเมืองเดียวกันและว่างระหว่างรอฟอกไต เพราะ ptb_plan ยอมรวมเฉพาะปลายทางเดียวกัน
--
-- ผู้ดูแลตั้ง "กลุ่มปลายทาง" ครั้งเดียวในหน้าตั้งค่าเส้นทาง (routes[].zone ว่าง = ไม่รวมกับปลายทางอื่น)
-- ptb_plan:
--   1. ร่วมเที่ยวต่างปลายทางได้เฉพาะงานผู้ป่วยที่ปลายทางอยู่กลุ่มเดียวกัน (งานชุมชนคงเดิม)
--   2. เวลาเดินทางคิดรายรอบ = ปลายทางที่ไกลที่สุดของรอบ + เวลาเผื่อ (buffer_minutes) จุดละ 1 ครั้งที่แวะเพิ่ม
--      ใช้เวลาเผื่อเดิม ไม่เพิ่มช่องตั้งค่า (เจ้าของระบบเลือก 2569-10-07)
--   3. ขากลับหลายรอบต้องไม่ทับกันทุกแบบ รวม "รอรับกลับ" ที่เดิมไม่ตรวจเพราะกันรถทั้งช่วงอยู่แล้ว
--      (ตรวจฐานจริงแล้ว 2569-10-07 ไม่มีเที่ยวไหนมีขากลับเกิน 1 รอบ จึงไม่มีเที่ยวเดิมติด)
--   4. ชื่อเที่ยว (plan.route_label) ของเที่ยวหลายปลายทาง = ชื่อปลายทางเรียงตามเวลานัด คั่นด้วย " + "
-- เที่ยวปลายทางเดียวได้ผลเหมือนเดิมทุกค่า (leg = เวลาเดินทางของปลายทางนั้น) — มีเทสต์ยืนยัน
-- patient_booking_save_settings: เก็บ routes[].zone (ไม่เกิน 60 ตัวอักษร) เดิมตัดทิ้งทุกช่องยกเว้น id/label/minutes
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.ptb_plan(uuid,uuid[],text)','b4cbee1c37578b133166e6234b5090f1',
 'public.patient_booking_save_settings(uuid,integer,jsonb)','41b01b5126d431d422a62968ed54ab92'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; travel integer; errors text[]:='{}'; ids uuid[]; date_local date;
 helper boolean:=false;
 back_at timestamptz; first_pickup timestamptz; start_at timestamptz; out_end timestamptz;
 end_at timestamptz; back_start timestamptz; blocks jsonb:='[]'; outbound jsonb:='[]'; returns jsonb:='[]';
 anchor timestamptz; last_time timestamptz; wave_n integer:=0; wave_seats integer:=0;
 max_seats integer:=0; wave_count integer:=0;
 mode text; multiwave boolean:=false; c public.patient_booking_community_rules;
 -- กลุ่มปลายทาง: zone ของปลายทางแรก · leg = เวลาเดินทางของรอบ (ปลายทางไกลสุดของรอบ + เวลาเผื่อจุดละ 1 ครั้งเมื่อแวะหลายจุด)
 zone text; route_count integer:=1; leg integer; r_minutes integer; wave_max integer:=0; wave_routes text[]:='{}';
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
  IF route IS NULL OR f.route_id='__other__' OR (route->>'minutes') IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งสถานที่ชุมชนและเวลาเดินทาง'); END IF;
  IF c.window_start IS NULL OR c.window_end IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งช่วงเวลาบริการชุมชน'); END IF;
 ELSE
  SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=f.route_id;
  IF route IS NULL THEN errors:=array_append(errors,'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ'); END IF;
  zone:=nullif(btrim(route->>'zone'),'');
 END IF;
 travel:=coalesce((route->>'minutes')::integer,0);
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
   leg:=wave_max+s.buffer_minutes*greatest(cardinality(wave_routes)-1,0);
   start_at:=anchor-make_interval(mins=>leg+s.buffer_minutes+s.boarding_minutes*wave_n);
   out_end:=anchor+make_interval(mins=>s.boarding_minutes*CASE WHEN f.service_type='community' THEN f.party_size ELSE 1 END+leg);
   outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',start_at,'end_at',out_end,'passengers',wave_n));
   blocks:=blocks||jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end));
   IF first_pickup IS NULL THEN first_pickup:=start_at; END IF;
   max_seats:=greatest(max_seats,wave_seats);
   anchor:=NULL; wave_n:=0; wave_seats:=0; wave_max:=0; wave_routes:='{}';
  END IF;
  IF anchor IS NULL THEN anchor:=r.appointment_at; wave_count:=wave_count+1; END IF;
  last_time:=r.appointment_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
  wave_seats:=wave_seats+public.ptb_seats(r);
  r_minutes:=CASE WHEN r.service_type='community' THEN travel
   ELSE coalesce((SELECT (x->>'minutes')::integer FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=r.route_id),travel) END;
  wave_max:=greatest(wave_max,r_minutes);
  IF NOT r.route_id=ANY(wave_routes) THEN wave_routes:=wave_routes||r.route_id; END IF;
 END LOOP;
 leg:=wave_max+s.buffer_minutes*greatest(cardinality(wave_routes)-1,0);
 start_at:=anchor-make_interval(mins=>leg+s.buffer_minutes+s.boarding_minutes*wave_n);
 out_end:=anchor+make_interval(mins=>s.boarding_minutes*CASE WHEN f.service_type='community' THEN f.party_size ELSE 1 END+leg);
 outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',start_at,'end_at',out_end,'passengers',wave_n));
 blocks:=blocks||jsonb_build_array(jsonb_build_object('start',start_at,'end',out_end));
 IF first_pickup IS NULL THEN first_pickup:=start_at; END IF;
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
 anchor:=NULL; wave_n:=0; wave_seats:=0; wave_max:=0; wave_routes:='{}';
 IF mode<>'one_way' THEN
  FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) AND return_at IS NOT NULL ORDER BY return_at,id LOOP
   IF anchor IS NOT NULL AND r.return_at-anchor>interval '30 minutes' THEN
    leg:=wave_max+s.buffer_minutes*greatest(cardinality(wave_routes)-1,0);
    back_start:=anchor-make_interval(mins=>leg+s.buffer_minutes);
    end_at:=last_time+make_interval(mins=>s.boarding_minutes*wave_n+leg+s.buffer_minutes);
    returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',back_start,'end_at',end_at,'passengers',wave_n));
    blocks:=blocks||jsonb_build_array(jsonb_build_object('start',back_start,'end',end_at));
    max_seats:=greatest(max_seats,wave_seats);
    anchor:=NULL; wave_n:=0; wave_seats:=0; wave_max:=0; wave_routes:='{}';
   END IF;
   IF anchor IS NULL THEN anchor:=r.return_at; END IF;
   last_time:=r.return_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
   wave_seats:=wave_seats+public.ptb_seats(r);
   r_minutes:=CASE WHEN r.service_type='community' THEN travel
    ELSE coalesce((SELECT (x->>'minutes')::integer FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=r.route_id),travel) END;
   wave_max:=greatest(wave_max,r_minutes);
   IF NOT r.route_id=ANY(wave_routes) THEN wave_routes:=wave_routes||r.route_id; END IF;
  END LOOP;
  IF anchor IS NOT NULL THEN
   leg:=wave_max+s.buffer_minutes*greatest(cardinality(wave_routes)-1,0);
   back_start:=anchor-make_interval(mins=>leg+s.buffer_minutes);
   end_at:=last_time+make_interval(mins=>s.boarding_minutes*wave_n+leg+s.buffer_minutes);
   returns:=returns||jsonb_build_array(jsonb_build_object('return_start',anchor,'return_end',last_time,'depart_at',back_start,'end_at',end_at,'passengers',wave_n));
   blocks:=blocks||jsonb_build_array(jsonb_build_object('start',back_start,'end',end_at));
   max_seats:=greatest(max_seats,wave_seats);
  END IF;
 END IF;
 IF helper THEN max_seats:=max_seats+1; END IF;
 IF max_seats>s.seats THEN errors:=array_append(errors,'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'); END IF;
 -- Return runs must not overlap each other in any mode, including wait-at-hospital below:
 -- the car has to take one run home and come back in time for the next one.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(returns) WITH ORDINALITY a(w,ord)
  JOIN jsonb_array_elements(returns) WITH ORDINALITY b(w,ord) ON a.ord<b.ord
  WHERE (a.w->>'depart_at')::timestamptz<(b.w->>'end_at')::timestamptz
   AND (b.w->>'depart_at')::timestamptz<(a.w->>'end_at')::timestamptz) THEN
  errors:=array_append(errors,'รอบรับ–ส่งทับกันภายในแผนเดียว');
 END IF;
 -- A single wait-at-hospital run still reserves the vehicle continuously.
 IF NOT multiwave AND mode='wait' AND back_at IS NOT NULL THEN
  blocks:=jsonb_build_array(jsonb_build_object('start',first_pickup,'end',end_at));
 ELSIF NOT multiwave AND mode='later' AND back_at IS NOT NULL AND back_start<=out_end THEN
  blocks:=jsonb_build_array(jsonb_build_object('start',first_pickup,'end',end_at));
 END IF;
 -- The same car cannot perform two proposed runs at once, including an outbound and a return.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(blocks) WITH ORDINALITY a(block,ord)
  JOIN jsonb_array_elements(blocks) WITH ORDINALITY b(block,ord) ON a.ord<b.ord
  WHERE (a.block->>'start')::timestamptz<(b.block->>'end')::timestamptz
   AND (b.block->>'start')::timestamptz<(a.block->>'end')::timestamptz) THEN
  errors:=array_append(errors,'รอบรับ–ส่งทับกันภายในแผนเดียว');
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t CROSS JOIN LATERAL jsonb_array_elements(t.plan->'blocks') old
  CROSS JOIN LATERAL jsonb_array_elements(blocks) proposed
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled' AND NOT(t.booking_ids&&ids)
  AND (old->>'start')::timestamptz<(proposed->>'end')::timestamptz AND (proposed->>'start')::timestamptz<(old->>'end')::timestamptz) THEN
  errors:=array_append(errors,'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว');
 END IF;
 IF EXISTS(SELECT 1 FROM public.patient_booking_trips t WHERE t.municipality_id=p_muni AND t.state='issue'
  AND (t.plan->>'date')::date=date_local AND NOT(t.booking_ids&&ids)) THEN
  errors:=array_append(errors,'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน');
 END IF;
 RETURN jsonb_build_object('service_type',f.service_type,'community_rules_version',CASE WHEN f.service_type='community' THEN c.rules_version ELSE NULL END,'booking_ids',ids,'date',date_local,'route_label',CASE WHEN route_count>1 THEN (SELECT string_agg(l,' + ' ORDER BY a,k) FROM (SELECT route_id k,min(route_label) l,min(appointment_at) a
    FROM public.patient_bookings WHERE id=ANY(ids) GROUP BY route_id) q) ELSE f.route_label END,'route_id',f.route_id,
  'booking_revisions',(SELECT jsonb_object_agg(id::text,revision) FROM public.patient_bookings WHERE id=ANY(ids)),
  'return_mode',mode,'pickup_at',first_pickup,'return_at',back_at,'blocks',blocks,'seats',max_seats,'helper_required',helper,
  'outbound_waves',outbound,'return_waves',returns,'multiwave',multiwave,
  'settings_revision',s.revision,'errors',(SELECT coalesce(jsonb_agg(DISTINCT x),'[]') FROM unnest(errors) x));
END $$;

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
  IF coalesce(x->>'id','')!~'^[a-zA-Z0-9_-]{1,60}$' OR char_length(coalesce(btrim(x->>'label'),'')) NOT BETWEEN 1 AND 200 OR coalesce((x->>'minutes')::integer,0) NOT BETWEEN 5 AND 240 THEN RAISE EXCEPTION 'กรุณาระบุชื่อและเวลาเดินทางของทุกเส้นทาง'; END IF;
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
  buffer_minutes=(p_data->>'buffer_minutes')::integer,boarding_minutes=(p_data->>'boarding_minutes')::integer,
  routes=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(value->>'minutes')::integer)
    ||CASE WHEN nullif(btrim(value->>'zone'),'') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('zone',btrim(value->>'zone')) END),'[]') FROM jsonb_array_elements(p_data->'routes')),
  holidays=CASE WHEN p_data ? 'holidays' THEN ARRAY(SELECT value::date FROM jsonb_array_elements_text(coalesce(p_data->'holidays','[]'))) ELSE s.holidays END,
  calendar_checked_through=CASE WHEN p_data ? 'calendar_checked_through' THEN nullif(p_data->>'calendar_checked_through','')::date ELSE s.calendar_checked_through END,unavailable=coalesce((p_data->>'unavailable')::boolean,false),
  delegation_reference=coalesce(nullif(btrim(p_data->>'delegation_reference'),''),s.delegation_reference),
  privacy_notice=coalesce(nullif(btrim(p_data->>'privacy_notice'),''),nullif(btrim(s.privacy_notice),''),
   'บริการรถรับส่งผู้ป่วยใช้ชื่อ เบอร์ติดต่อ วันเวลานัด โรงพยาบาล จุดรับ ผู้ติดตาม และข้อมูลการใช้รถเข็นหรือเปล เพื่อรับคำขอ จัดคิว ติดต่อประสานงาน รับส่ง และจัดทำหลักฐานบริการ พิกัดจุดรับเป็นทางเลือก ระบุที่อยู่และจุดสังเกตแทนได้ เจ้าหน้าที่จัดคิว คนขับ และผู้รับผิดชอบกองทุนเข้าถึงข้อมูลที่จำเป็นต่อหน้าที่ ตารางสาธารณะไม่แสดงชื่อ เบอร์โทร ที่อยู่หรือพิกัดของผู้เดินทาง หากไม่ให้ข้อมูลที่จำเป็นอาจไม่สามารถประสานรับส่งได้ สอบถามการใช้ข้อมูล ระยะเวลาเก็บรักษา หรือขอใช้สิทธิเกี่ยวกับข้อมูลส่วนบุคคลได้ที่เจ้าหน้าที่ผู้ให้บริการตามเบอร์ติดต่อในหน้านี้'),
  contact_phone=btrim(coalesce(p_data->>'contact_phone','')),revision=s.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'settings_changed',jsonb_build_object('revision',s.revision+1));
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
