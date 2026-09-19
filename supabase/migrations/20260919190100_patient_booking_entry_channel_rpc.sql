-- การรับจองแทนต้องเป็นคำสั่งที่ชัดเจนจากหน้าทำงาน ไม่ใช่ผลข้างเคียงของบทบาท
--
-- ⚠️ ของเดิม: patient_booking_submit ให้สิทธิ์ข้ามวันจองล่วงหน้าและข้ามวันหยุด/วันงดบริการ
-- กับทุกคำขอที่ยื่นด้วยบัญชี admin/coordinator แม้เป็นการจองให้ตัวเองหรือญาติจากหน้าประชาชน
-- และไม่บันทึกว่าเป็นการรับแทน ตรวจย้อนหลังไม่ได้ว่าใครใช้สิทธิ์นี้กับคำขอไหน
--
-- ของใหม่: สิทธิ์ผูกกับ p_staff_entry ที่หน้าทำงานส่งมา และยังตรวจบทบาทซ้ำที่ฐานข้อมูล
-- (client ส่ง true มาเองไม่พอ ถ้าไม่ใช่ผู้จัดคิว/ผู้ดูแลจะถูกปฏิเสธ) แล้วเก็บ entry_channel ไว้
--
-- ต้อง DROP ลายเซ็นเดิมก่อน ไม่ใช่เพิ่มพารามิเตอร์ที่มีค่าเริ่มต้นทับของเดิม ไม่งั้นการเรียกด้วย
-- 3 อาร์กิวเมนต์จะตรงทั้งสองฟังก์ชัน แล้วได้ 42725 function is not unique
BEGIN;
DROP FUNCTION IF EXISTS public.patient_booking_submit_join(uuid,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.patient_booking_submit(uuid,uuid,jsonb);

CREATE FUNCTION public.patient_booking_submit(p_muni uuid,p_id uuid,p_data jsonb,p_staff_entry boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); s public.patient_booking_settings; partner public.referral_partners;
 old public.patient_bookings; route jsonb; appt timestamptz; back timestamptz; d date; consent text;
 lat double precision; lng double precision; staff boolean:=coalesce(p_staff_entry,false);
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบด้วยบัญชีของหน่วยงานนี้'; END IF;
 -- รับแทนได้เฉพาะผู้จัดคิว/ผู้ดูแล และต้องเป็นคำสั่งจากหน้าทำงานเท่านั้น
 IF staff AND role_name NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'บัญชีนี้ไม่มีสิทธิ์รับจองแทน'; END IF;
 SELECT * INTO s FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 SELECT * INTO old FROM public.patient_bookings WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by=auth.uid() AND old.municipality_id=p_muni THEN RETURN old.id; END IF;
  RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง';
 END IF;
 IF s.enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'ยังไม่เปิดรับจอง กรุณาติดต่อเจ้าหน้าที่'; END IF;
 SELECT * INTO partner FROM public.referral_partners WHERE id=s.partner_id AND municipality_id=p_muni AND is_active;
 IF partner.id IS NULL THEN RAISE EXCEPTION 'หน่วยงานเจ้าของรถปิดรับเรื่อง'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>8192 THEN RAISE EXCEPTION 'ข้อมูลคำขอไม่ถูกต้อง'; END IF;
 IF (p_data->>'is_emergency')::boolean IS DISTINCT FROM false OR (p_data->>'consent')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'ต้องยืนยันไม่ฉุกเฉินและการใช้ข้อมูลก่อนส่ง กรณีฉุกเฉินโทร 1669'; END IF;
 IF p_data->>'consent_version' IS DISTINCT FROM 'patient-booking-v1' OR p_data->>'privacy_notice' IS DISTINCT FROM s.privacy_notice OR p_data->>'owner_name' IS DISTINCT FROM partner.name THEN RAISE EXCEPTION 'ข้อความใช้ข้อมูลเปลี่ยนแล้ว กรุณาโหลดและตรวจอีกครั้ง'; END IF;
 IF p_data->>'relation'<>'self' AND (p_data->>'representative_authorized')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'ผู้จองแทนต้องได้รับอนุญาตหรือมีอำนาจกระทำแทน'; END IF;
 appt:=(p_data->>'appointment_at')::timestamptz; back:=nullif(p_data->>'return_at','')::timestamptz;
 d:=(appt AT TIME ZONE 'Asia/Bangkok')::date;
 IF d IS NULL OR d<(now() AT TIME ZONE 'Asia/Bangkok')::date+(CASE WHEN staff THEN 0 ELSE partner.min_lead_days END) OR d>(now() AT TIME ZONE 'Asia/Bangkok')::date+180 THEN RAISE EXCEPTION 'วันนัดอยู่นอกช่วงรับจองล่วงหน้า'; END IF;
 IF back IS NOT NULL AND (back<appt OR (back AT TIME ZONE 'Asia/Bangkok')::date<>d) THEN RAISE EXCEPTION 'เวลารับกลับต้องหลังนัดและเป็นวันเดียวกัน'; END IF;
 -- Days the public calendar already reports as unbookable. Staff taking a request by phone keep the
 -- existing coordination path; an open incident stays a soft warning because it can be cleared in time.
 IF NOT staff THEN
  IF s.unavailable THEN RAISE EXCEPTION 'ขณะนี้งดรับจองชั่วคราวเพราะรถหรือคนขับไม่พร้อม กรุณาติดต่อเจ้าหน้าที่'; END IF;
  IF extract(isodow FROM d) IN (6,7) OR d=ANY(s.holidays) THEN RAISE EXCEPTION 'วันที่เลือกตรงวันหยุดให้บริการ กรุณาเลือกวันทำการหรือติดต่อเจ้าหน้าที่'; END IF;
 END IF;
 -- หมุดจุดรับเป็นทางเลือก (ผู้สูงอายุที่ปักหมุดไม่เป็นต้องจองได้) แต่ถ้าส่งมาต้องเป็นพิกัดจริง
 lat:=nullif(p_data->>'pickup_lat','')::double precision; lng:=nullif(p_data->>'pickup_lng','')::double precision;
 IF (lat IS NULL)<>(lng IS NULL) THEN RAISE EXCEPTION 'หมุดจุดรับไม่สมบูรณ์ กรุณาปักหมุดใหม่หรือข้ามการปักหมุด'; END IF;
 IF lat IS NOT NULL AND (lat NOT BETWEEN 5 AND 21 OR lng NOT BETWEEN 96 AND 106) THEN RAISE EXCEPTION 'หมุดจุดรับอยู่นอกพื้นที่ให้บริการ'; END IF;
 SELECT x INTO route FROM jsonb_array_elements(s.routes) x WHERE x->>'id'=p_data->>'route_id';
 IF route IS NULL THEN RAISE EXCEPTION 'กรุณาเลือกโรงพยาบาลและพื้นที่ที่เปิดบริการ'; END IF;
 IF EXISTS(SELECT 1 FROM public.patient_bookings WHERE municipality_id=p_muni AND status IN ('submitted','confirmed')
  AND phone=btrim(p_data->>'phone') AND patient_name=btrim(p_data->>'patient_name') AND appointment_at=appt AND route_id=p_data->>'route_id') THEN RAISE EXCEPTION 'มีคำขอนี้แล้ว กรุณาตรวจการจองเดิมหรือติดต่อเจ้าหน้าที่'; END IF;
 consent:=s.privacy_notice||E'\nเจ้าของรถและผู้รับข้อมูล: '||partner.name;
 INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,in_area,route_id,route_label,
  appointment_at,mobility,companions,share,return_mode,return_at,consent_text,pickup_lat,pickup_lng,entry_channel)
 VALUES(p_id,p_muni,auth.uid(),btrim(p_data->>'requester_name'),btrim(p_data->>'phone'),btrim(p_data->>'patient_name'),p_data->>'relation',btrim(p_data->>'pickup'),
  coalesce((p_data->>'in_area')::boolean,false),p_data->>'route_id',route->>'label',appt,p_data->>'mobility',(p_data->>'companions')::integer,
  coalesce((p_data->>'share')::boolean,false),p_data->>'return_mode',CASE WHEN p_data->>'return_mode'='one_way' THEN NULL ELSE back END,consent,lat,lng,
  CASE WHEN staff THEN 'staff' ELSE 'online' END);
 PERFORM public.ptb_audit(p_muni,p_id,'submitted',jsonb_build_object('entry_channel',CASE WHEN staff THEN 'staff' ELSE 'online' END));
 PERFORM public.ptb_notice(p_muni,p_id,s.coordinator_ids,'มีคำขอจองรถใหม่ กรุณาตรวจแผน');
 RETURN p_id;
END $$;

CREATE FUNCTION public.patient_booking_submit_join(p_muni uuid,p_id uuid,p_trip uuid,p_data jsonb,p_staff_entry boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.patient_bookings; plan jsonb;
BEGIN
 IF public.ptb_role(p_muni) IN ('anonymous','outside') THEN RAISE EXCEPTION 'กรุณาเข้าสู่ระบบด้วยบัญชีของหน่วยงานนี้'; END IF;
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 SELECT * INTO old FROM public.patient_bookings WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by=auth.uid() AND old.municipality_id=p_muni AND old.requested_trip_id=p_trip THEN RETURN old.id; END IF;
  RAISE EXCEPTION 'รหัสคำขอไม่ถูกต้อง';
 END IF;
 IF p_trip IS NULL OR NOT EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni AND state='confirmed') THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว'; END IF;
 PERFORM public.patient_booking_submit(p_muni,p_id,p_data,coalesce(p_staff_entry,false));
 UPDATE public.patient_bookings SET requested_trip_id=p_trip WHERE id=p_id;
 plan:=public.ptb_join_plan(p_muni,p_id);
 IF jsonb_array_length(plan->'errors')>0 THEN RAISE EXCEPTION 'ยังขอร่วมเที่ยวนี้ไม่ได้: %',plan->'errors'; END IF;
 PERFORM public.ptb_audit(p_muni,p_id,'requested_join',jsonb_build_object('trip_id',p_trip));
 RETURN p_id;
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_submit(uuid,uuid,jsonb,boolean),
 public.patient_booking_submit_join(uuid,uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_submit(uuid,uuid,jsonb,boolean),
 public.patient_booking_submit_join(uuid,uuid,uuid,jsonb,boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
