-- รถรับ-ส่งผู้ป่วย "รับกลับอย่างเดียว" ไฟล์ 2/2 (ต่อจาก 20261104100000) — ต้อง apply หลังไฟล์ 1 เท่านั้น
--
-- 1) ตัวกระตุ้น ptb_return_only_time: คำขอ return_only ไม่มี "เวลานัดไป" เวลานัดจึงเท่ากับเวลารับกลับเสมอ
--    (ทุกที่ที่ใช้เวลานัดอยู่แล้ว — เรียงคิว/ตรวจวันที่/ตรวจเวลาทำการ/ตรวจคำขอซ้ำ/ใบพิมพ์ — ทำงานต่อได้โดยไม่ต้องแก้)
--    บังคับที่ตารางตัวเดียว จึงครอบคลุมทั้งจองใหม่ แก้ไขหลังประสาน และเลื่อนเวลา โดยไม่ต้องแทนฟังก์ชันเหล่านั้น
-- 2) ptb_plan: คำขอ return_only ไม่นับเป็นรอบไป (ไม่มีรับที่บ้าน) · รับกลับเข้ารอบกลับตามเวลา
--    - มีแต่ return_only → โหมดเที่ยว "later" (รถไปรับที่โรงพยาบาล เจ้าหน้าที่ตั้งเวลาเอง)
--    - เที่ยวไปอย่างเดียวที่มีผู้รับกลับร่วม → "later" (รถไปส่งแล้วกลับมารับ/รอ เจ้าหน้าที่ตั้งเวลาเอง)
--    - return_only ไม่นับเป็น "รูปแบบรับกลับไม่ตรงกัน" ของผู้ร่วมเที่ยว
--    เที่ยวที่ไม่มีคำขอ return_only ได้แผนเหมือนเดิมทุกค่า (เทสต์เทียบ)
-- ไม่แก้ patient_booking_move_into_trip: ย้ายคำขอที่ยืนยันแล้วเข้าเที่ยวอื่นจะยังบอก "รูปแบบรับกลับไม่ตรงกัน" (ให้เลือกร่วมเที่ยวตั้งแต่ยังเป็นคำขอรอยืนยัน)
BEGIN;
DO $guard$
BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.ptb_plan(uuid,uuid[],text)')) IS DISTINCT FROM 'a6dcb48f9f627038613f802096348661' THEN
  RAISE EXCEPTION 'Function drift: ptb_plan';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.patient_bookings'::regclass AND conname='patient_bookings_return_only_has_time') THEN
  RAISE EXCEPTION 'ต้อง apply 20261104100000 ก่อน';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ptb_return_only_time() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.return_mode='return_only' THEN
  IF NEW.return_at IS NULL THEN RAISE EXCEPTION 'รับกลับอย่างเดียวต้องระบุเวลารับกลับ'; END IF;
  NEW.appointment_at:=NEW.return_at;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ptb_return_only_time() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ptb_return_only_time ON public.patient_bookings;
CREATE TRIGGER ptb_return_only_time BEFORE INSERT OR UPDATE OF return_mode,return_at,appointment_at ON public.patient_bookings
 FOR EACH ROW EXECUTE FUNCTION public.ptb_return_only_time();

CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.patient_booking_settings; r public.patient_bookings; f public.patient_bookings;
 n integer; route jsonb; errors text[]:='{}'; ids uuid[]; date_local date;
 helper boolean:=false;
 back_at timestamptz; outbound jsonb:='[]'; returns jsonb:='[]';
 anchor timestamptz; last_time timestamptz; wave_n integer:=0; wave_seats integer:=0;
 max_seats integer:=0; wave_count integer:=0; ret_only boolean:=false;
 mode text; multiwave boolean:=false; c public.patient_booking_community_rules;
 zone text; route_count integer:=1;
BEGIN
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_ids) x;
 n:=cardinality(ids);
 IF n IS NULL OR n NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'จำนวนผู้เดินทางไม่ถูกต้อง'; END IF;
 IF (SELECT count(*) FROM public.patient_bookings WHERE municipality_id=p_muni AND id=ANY(ids))<>n THEN RAISE EXCEPTION 'ไม่พบคำขอในหน่วยงานนี้'; END IF;
 SELECT count(DISTINCT route_id) INTO route_count FROM public.patient_bookings WHERE id=ANY(ids);
 -- return_only (รับกลับอย่างเดียว 2569-11-04) ไม่มีขาไป: ใช้คำขอที่ไปด้วยเป็นตัวแทนเที่ยวก่อน ไม่มีค่อยใช้ตัวแรกของทั้งหมด
 SELECT * INTO f FROM public.patient_bookings WHERE id=ANY(ids) ORDER BY (return_mode='return_only'),appointment_at,id LIMIT 1;
 ret_only:=EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode='return_only');
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
 FOR r IN SELECT * FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode<>'return_only' ORDER BY appointment_at,id LOOP
  IF anchor IS NOT NULL AND r.appointment_at-anchor>interval '30 minutes' THEN

   outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',NULL,'end_at',NULL,'passengers',wave_n));

   max_seats:=greatest(max_seats,wave_seats);
   anchor:=NULL; wave_n:=0; wave_seats:=0;
  END IF;
  IF anchor IS NULL THEN anchor:=r.appointment_at; wave_count:=wave_count+1; END IF;
  last_time:=r.appointment_at; wave_n:=wave_n+CASE WHEN r.service_type='community' THEN r.party_size ELSE 1 END;
  wave_seats:=wave_seats+public.ptb_seats(r);

 END LOOP;

 IF anchor IS NOT NULL THEN
  outbound:=outbound||jsonb_build_array(jsonb_build_object('appointment_start',anchor,'appointment_end',last_time,'pickup_at',NULL,'end_at',NULL,'passengers',wave_n));
 END IF;

 max_seats:=greatest(max_seats,wave_seats);
 multiwave:=wave_count>1;
 mode:=CASE WHEN f.return_mode='return_only' OR (multiwave AND f.return_mode<>'one_way') OR (ret_only AND f.return_mode='one_way') THEN 'later' ELSE f.return_mode END;
 IF multiwave AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode='one_way')
  AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode NOT IN ('one_way','return_only')) THEN
  errors:=array_append(errors,'รูปแบบขากลับของผู้ร่วมเที่ยวไม่ตรงกัน');
 ELSIF NOT multiwave AND EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND return_mode<>f.return_mode AND return_mode<>'return_only') THEN
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
