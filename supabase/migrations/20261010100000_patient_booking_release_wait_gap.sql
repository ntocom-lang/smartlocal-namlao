-- ปล่อยรถว่างช่วงรอ: "ให้รถรอรับกลับ" กันรถต่อเนื่องเฉพาะเมื่อผู้ป่วยอยู่สั้นกว่ารถวิ่งไปกลับ (เฟส 1, เจ้าของระบบเลือก 2569-10-10)
--
-- เคสจริง (ทุ่งแค้ว 2569-10-10): รถรับหลายรอบต่อวันไม่ได้ เที่ยว "รอรับกลับ" 6 จาก 8 เที่ยวกันรถต่อเนื่อง 8–11 ชั่วโมง
-- (12 ต.ค. 10:30–18:30 · 15 ต.ค. 10:00–21:00 เลยเวลาทำการ) ทั้งที่ผู้ป่วยอยู่โรงพยาบาลหลายชั่วโมงและรถว่างช่วงกลาง
-- นาทีต่อขา (45) กินแค่ราว 90 นาทีของช่วงนั้น จึงไม่ถอด — ตัวการคือการกันรถต่อเนื่อง ไม่ใช่นาทีต่อขา
--
-- 1. ptb_merge_blocks(jsonb): ฟังก์ชันช่วยภายใน รวมช่วงกันรถที่ทับ/ติดกันเป็นช่วงเดียว (เรียกจาก ptb_plan และไฟล์ย้ายข้อมูลถัดไป)
-- 2. ptb_plan: ขา "รอรับกลับ" งานผู้ป่วย — กันรถเป็นช่วงไป + ช่วงกลับ รวมเป็นช่วงเดียวเมื่อทับ/ติดกัน (รถรอที่โรงพยาบาล)
--    ตัวเลขใหม่ไม่มี (ใช้นาทีต่อขา/เวลาเผื่อ/เวลาขึ้นรถที่แอดมินตั้งไว้เดิม) · ช่วงใหม่ ⊆ ช่วงเดิมเสมอ จึงไม่มีเที่ยวเดิมเข้มขึ้น
--    ไม่ throw "รอบรับ–ส่งทับกัน" ใหม่ (ผู้ร่วมเที่ยวที่กลับก่อนซึ่งเคยผ่านใต้ช่วงต่อเนื่องจึงยังผ่าน) · งานชุมชน/later/one_way/หลายรอบรับไม่เปลี่ยน
-- 3. patient_booking_action: ด่าน "ออกรถ" (trip_next) — คนขับกด 2 ปุ่มต่อเที่ยว เที่ยวที่มีขากลับตอนเย็นจึงค้าง outbound ทั้งวัน
--    ถ้าไม่ผ่อน ต่อให้ปฏิทินปล่อยรถว่าง คนขับก็กดออกรถเที่ยวที่ 2 ไม่ได้ · เที่ยวอื่นที่แผนกันรถ ≥ 2 ช่วงไม่นับว่าติดงานแล้ว
--    เที่ยวช่วงเดียว (รถรอต่อเนื่อง) และเหตุขัดข้อง (issue) ยังบล็อกเหมือนเดิม
-- ไฟล์ถัดไปคำนวณช่วงกันรถของเที่ยวที่ยืนยันไว้แล้วใหม่
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.ptb_plan(uuid,uuid[],text)','8511af65aa6f527567c8014d9d95bd30',
 'public.patient_booking_action(uuid,uuid,uuid,integer,text,text)','e74f2faa917ad82ca8327124ecc5849d'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
 IF to_regprocedure('public.ptb_merge_blocks(jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'ptb_merge_blocks already exists'; END IF;
END $guard$;

-- รวมช่วงที่ทับหรือติดกัน (เริ่ม ≤ จบของช่วงก่อนหน้า) เป็นช่วงเดียว เรียงตามเวลาเริ่ม · ไม่ใช่ฟังก์ชันสำหรับผู้ใช้
CREATE FUNCTION public.ptb_merge_blocks(p_blocks jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE merged jsonb:='[]'; blk jsonb; cur_start timestamptz; cur_end timestamptz; blk_start timestamptz; blk_end timestamptz;
BEGIN
 IF p_blocks IS NULL OR jsonb_typeof(p_blocks)<>'array' THEN RETURN '[]'::jsonb; END IF;
 FOR blk IN SELECT value FROM jsonb_array_elements(p_blocks) ORDER BY (value->>'start')::timestamptz,(value->>'end')::timestamptz LOOP
  blk_start:=(blk->>'start')::timestamptz; blk_end:=(blk->>'end')::timestamptz;
  IF cur_end IS NOT NULL AND blk_start<=cur_end THEN
   cur_end:=greatest(cur_end,blk_end);
  ELSE
   IF cur_end IS NOT NULL THEN merged:=merged||jsonb_build_array(jsonb_build_object('start',cur_start,'end',cur_end)); END IF;
   cur_start:=blk_start; cur_end:=blk_end;
  END IF;
 END LOOP;
 IF cur_end IS NOT NULL THEN merged:=merged||jsonb_build_array(jsonb_build_object('start',cur_start,'end',cur_end)); END IF;
 RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.ptb_merge_blocks(jsonb) FROM PUBLIC, anon, authenticated;

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
 -- รอรับกลับ (งานผู้ป่วย): รถรอที่ปลายทางต่อเนื่องเฉพาะเมื่อช่วงไป–กลับทับ/ติดกัน (อยู่สั้นกว่ารถวิ่งไปกลับ)
 -- อยู่นานกว่านั้นกันเฉพาะช่วงไปกับช่วงกลับ ช่วงกลางปล่อยให้รอบอื่น · ช่วงใหม่เป็นส่วนย่อยของช่วงเดิมเสมอ
 -- งานชุมชนคงช่วงต่อเนื่องเดิม (นโยบายของงานชุมชนแยกจากงานผู้ป่วย)
 IF NOT multiwave AND mode='wait' AND back_at IS NOT NULL THEN
  IF f.service_type='community' THEN blocks:=jsonb_build_array(jsonb_build_object('start',first_pickup,'end',end_at));
  ELSE blocks:=public.ptb_merge_blocks(blocks); END IF;
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

CREATE OR REPLACE FUNCTION public.patient_booking_action(p_muni uuid,p_op uuid,p_entity uuid,p_revision integer,p_action text,p_note text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; b public.patient_bookings;
 t public.patient_booking_trips; old public.patient_booking_operations; payload jsonb; coordinator boolean; own boolean; next_step integer; result_state text;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 coordinator:=role_name IN ('admin','coordinator');
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 payload:=jsonb_build_object('entity',p_entity,'revision',p_revision,'action',p_action,'note',p_note);
 SELECT * INTO old FROM public.patient_booking_operations WHERE id=p_op;
 IF old.id IS NOT NULL THEN
  IF old.actor_id=auth.uid() AND old.municipality_id=p_muni AND old.payload=payload THEN RETURN; END IF;
  RAISE EXCEPTION 'รหัสการทำรายการไม่ถูกต้อง';
 END IF;
 IF char_length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'ข้อความยาวเกินกำหนด'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_entity AND municipality_id=p_muni;
 IF b.id IS NOT NULL THEN
  SELECT * INTO t FROM public.patient_booking_trips WHERE id=b.trip_id;
  -- "ผู้จอง" = คนที่จองเองผ่านหน้าประชาชนเท่านั้น · คำขอที่เจ้าหน้าที่รับแทน (entry_channel 'staff') created_by เป็นเจ้าหน้าที่
  -- ถือเป็นงานของสำนักงาน ทำได้ผ่านสิทธิ์ผู้ประสานงานเท่านั้น ถูกถอดสิทธิ์แล้วต้องหมดสิทธิ์ตาม
  own:=coalesce(b.created_by=auth.uid() AND b.entry_channel='online',false);
  IF NOT coordinator AND NOT own AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับคำขอนี้'; END IF;
  IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'คำขอเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
  IF p_action='cancel' THEN
   IF NOT coordinator AND NOT own THEN RAISE EXCEPTION 'เฉพาะผู้จองหรือผู้ประสานงานยกเลิกได้'; END IF;
   IF coordinator AND NOT own AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'กรุณาระบุเหตุผลที่ผู้จองแจ้งยกเลิก'; END IF;
   IF b.status='submitted' THEN UPDATE public.patient_bookings SET status='cancelled' WHERE id=b.id;
   ELSIF b.status='confirmed' THEN UPDATE public.patient_bookings SET cancel_requested=true WHERE id=b.id;
   ELSE RAISE EXCEPTION 'คำขอนี้ปิดแล้ว'; END IF;
  ELSIF p_action='ready_return' THEN
   IF NOT coordinator AND NOT own THEN RAISE EXCEPTION 'เฉพาะผู้จองแจ้งพร้อมกลับได้'; END IF;
   IF b.status<>'confirmed' OR b.return_mode='one_way' OR t.state NOT IN ('outbound','hospital') THEN RAISE EXCEPTION 'ยังไม่ถึงขั้นแจ้งพร้อมรับกลับ'; END IF;
   UPDATE public.patient_bookings SET return_ready=true WHERE id=b.id;
  ELSIF p_action='cancel_passenger' THEN
   IF NOT coordinator OR b.status<>'confirmed' OR b.passenger_step NOT IN (0,2) OR nullif(btrim(p_note),'') IS NULL THEN
    RAISE EXCEPTION 'ผู้ประสานงานต้องบันทึกผลติดต่อและแผนดูแลต่อ ห้ามนำผู้ที่อยู่ระหว่างเดินทางออกจากเที่ยว';
   END IF;
   UPDATE public.patient_bookings SET status='cancelled',cancel_requested=false WHERE id=b.id;
  ELSIF p_action='passenger_next' THEN
   IF NOT coordinator AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'เฉพาะคนขับที่ได้รับมอบหมาย'; END IF;
   IF b.status<>'confirmed' OR t.state IN ('issue','cancelled','completed') OR s.unavailable THEN RAISE EXCEPTION 'เที่ยวไม่พร้อมดำเนินการ'; END IF;
   next_step:=b.passenger_step+1;
   IF (next_step IN (1,2) AND t.state<>'outbound') OR (next_step IN (3,4) AND t.state<>'returning') OR next_step>4 OR (b.return_mode='one_way' AND next_step>2) THEN RAISE EXCEPTION 'ขั้นตอนรับส่งไม่ตรงกับสถานะเที่ยว'; END IF;
   UPDATE public.patient_bookings SET passenger_step=next_step WHERE id=b.id;
  ELSE RAISE EXCEPTION 'คำสั่งไม่ถูกต้อง'; END IF;
  UPDATE public.patient_bookings SET revision=revision+1,updated_at=now() WHERE id=b.id;
  PERFORM public.ptb_notice(p_muni,b.id,s.coordinator_ids||ARRAY[b.created_by,t.driver_id],CASE p_action WHEN 'cancel' THEN 'มีการยกเลิกหรือขอประสานยกเลิกการจอง' WHEN 'ready_return' THEN 'ผู้จองแจ้งพร้อมรับกลับ กรุณาตรวจแผนรับกลับ' ELSE 'สถานะการเดินทางเปลี่ยนแล้ว' END);
 ELSE
  SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_entity AND municipality_id=p_muni;
  IF t.id IS NULL OR (NOT coordinator AND (role_name<>'driver' OR t.driver_id IS DISTINCT FROM auth.uid())) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ดำเนินการกับเที่ยวนี้'; END IF;
  IF t.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'เที่ยวเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด'; END IF;
  result_state:=t.state;
  IF p_action='issue' THEN
   IF t.state IN ('completed','cancelled','issue') OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'ระบุเหตุขัดข้องของเที่ยวที่ยังไม่ปิด'; END IF;
   UPDATE public.patient_booking_trips SET state_before_issue=state,issue_note=btrim(p_note) WHERE id=t.id;
   result_state:='issue';
  ELSIF p_action='resolve' THEN
   IF NOT coordinator OR t.state<>'issue' OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'ผู้ประสานงานต้องระบุผลแก้ไขเหตุขัดข้อง'; END IF;
   IF s.unavailable THEN RAISE EXCEPTION 'รถหรือคนขับยังไม่พร้อม'; END IF;
   result_state:=t.state_before_issue;
  ELSIF p_action='release' THEN
   IF NOT coordinator OR NOT(t.state='confirmed' OR (t.state='issue' AND t.state_before_issue='confirmed')) OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND passenger_step<>0) OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'คืนคิวได้เฉพาะก่อนรถออก พร้อมเหตุผล'; END IF;
   result_state:='cancelled';
   UPDATE public.patient_bookings SET status=CASE WHEN cancel_requested OR status='cancelled' THEN 'cancelled' ELSE 'submitted' END,
    trip_id=NULL,cancel_requested=false,revision=revision+1,updated_at=now() WHERE trip_id=t.id;
  ELSIF p_action='trip_finish' THEN
   IF s.unavailable OR t.state NOT IN ('outbound','hospital','returning') THEN RAISE EXCEPTION 'จบงานได้เฉพาะเที่ยวที่ออกรถแล้วและไม่มีเหตุขัดข้อง'; END IF;
   IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND cancel_requested) THEN RAISE EXCEPTION 'มีผู้ขอยกเลิก กรุณาให้เจ้าหน้าที่ประสานก่อนจบงาน'; END IF;
   -- บันทึกผลส่งครบเมื่อรถกลับเท่านั้น ไม่สร้างเหตุการณ์ระหว่างทางย้อนหลัง
   UPDATE public.patient_bookings SET passenger_step=CASE WHEN return_mode='one_way' THEN 2 ELSE 4 END
    WHERE trip_id=t.id AND status='confirmed';
   result_state:='completed';
  ELSIF p_action='trip_next' THEN
   IF s.unavailable OR t.state IN ('issue','completed','cancelled') THEN RAISE EXCEPTION 'เที่ยวไม่พร้อมดำเนินการ'; END IF;
   -- เที่ยวอื่นที่แผนกันรถแยกเป็น ≥ 2 ช่วง (ไป / กลับ) = รถว่างระหว่างช่วงตามแผน จึงไม่นับว่าติดงาน
   -- เที่ยวช่วงเดียว (รถรอต่อเนื่อง) และเที่ยวที่มีเหตุขัดข้องยังบล็อกเหมือนเดิม
   IF t.state IN ('confirmed','hospital') AND EXISTS(SELECT 1 FROM public.patient_booking_trips other
    WHERE other.municipality_id=p_muni AND other.id<>t.id AND (other.state='issue'
     OR (jsonb_array_length(CASE WHEN jsonb_typeof(other.plan->'blocks')='array' THEN other.plan->'blocks' ELSE '[]'::jsonb END)<2
      AND (other.state IN ('outbound','returning') OR (other.state='hospital' AND other.plan->>'return_mode'='wait'))))) THEN RAISE EXCEPTION 'รถหรือคนขับกำลังปฏิบัติงานเที่ยวอื่น'; END IF;
   CASE t.state
    WHEN 'confirmed' THEN result_state:='outbound';
    WHEN 'outbound' THEN
     IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND passenger_step<2) THEN RAISE EXCEPTION 'ต้องบันทึกส่งถึงโรงพยาบาลครบทุกคนก่อน'; END IF;
     result_state:=CASE WHEN t.plan->>'return_mode'='one_way' OR NOT EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed') THEN 'completed' ELSE 'hospital' END;
    WHEN 'hospital' THEN result_state:='returning';
    WHEN 'returning' THEN
     IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed' AND passenger_step<4) THEN RAISE EXCEPTION 'ต้องบันทึกส่งกลับครบทุกคนก่อนจบเที่ยว'; END IF;
     result_state:='completed';
    ELSE RAISE EXCEPTION 'ขั้นตอนไม่ถูกต้อง';
   END CASE;
  ELSE RAISE EXCEPTION 'คำสั่งไม่ถูกต้อง'; END IF;
  UPDATE public.patient_booking_trips SET state=result_state,revision=revision+1,updated_at=now() WHERE id=t.id;
  IF result_state='completed' THEN UPDATE public.patient_bookings SET status='completed',revision=revision+1,updated_at=now() WHERE trip_id=t.id AND status='confirmed'; END IF;
  PERFORM public.ptb_notice(p_muni,t.id,s.coordinator_ids||ARRAY[t.driver_id]||ARRAY(SELECT created_by FROM public.patient_bookings WHERE id=ANY(t.booking_ids)),'สถานะเที่ยวรถเปลี่ยนแล้ว กรุณาตรวจรายละเอียด');
 END IF;
 INSERT INTO public.patient_booking_operations(id,actor_id,municipality_id,payload) VALUES(p_op,auth.uid(),p_muni,payload);
 PERFORM public.ptb_audit(p_muni,p_entity,p_action,jsonb_build_object('note',coalesce(p_note,''),'from_revision',p_revision,'driver_id',t.driver_id,'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),'recorded_by',auth.uid()));
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
