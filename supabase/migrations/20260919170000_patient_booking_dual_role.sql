-- Allow explicit driver/coordinator overlap; retain tenant, staff, revision and assignment checks.
BEGIN;
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
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_data->'routes'))<>jsonb_array_length(p_data->'routes') THEN RAISE EXCEPTION 'รหัสเส้นทางซ้ำ'; END IF;
 IF char_length(coalesce(p_data->>'privacy_notice',''))>6000 OR char_length(coalesce(p_data->>'delegation_reference',''))>500 THEN RAISE EXCEPTION 'ข้อความตั้งค่ายาวเกินกำหนด'; END IF;
 IF v_enabled AND (partner IS NULL OR driver IS NULL OR cardinality(ids)=0 OR
  nullif(btrim(p_data->>'delegation_reference'),'') IS NULL OR nullif(btrim(p_data->>'privacy_notice'),'') IS NULL OR
  nullif(p_data->>'seats','') IS NULL OR nullif(p_data->>'wheelchairs','') IS NULL OR nullif(p_data->>'stretchers','') IS NULL OR
  coalesce((p_data->>'calendar_checked_through')::date,current_date-1)<(now() AT TIME ZONE 'Asia/Bangkok')::date OR
  coalesce(p_data->>'contact_phone','')!~'^0[0-9]{8,9}$' OR jsonb_array_length(p_data->'routes')=0) THEN
  RAISE EXCEPTION 'ก่อนเปิดบริการต้องยืนยันเจ้าของรถ คนขับ ผู้ประสานงาน ความจุรถ ปฏิทิน ขอบเขตมอบหมาย ข้อความใช้ข้อมูล และเบอร์ติดต่อ';
 END IF;
 -- Live journeys use their confirmed snapshots; changed settings require review of pending plans.
 IF driver IS DISTINCT FROM s.driver_id AND EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state NOT IN ('completed','cancelled')) THEN RAISE EXCEPTION 'มีเที่ยวค้าง ต้องจัดการเที่ยวเดิมก่อนเปลี่ยนคนขับ'; END IF;
 UPDATE public.patient_booking_settings SET enabled=v_enabled, partner_id=partner,driver_id=driver,coordinator_ids=ids,
  office_start=(p_data->>'office_start')::integer,office_end=(p_data->>'office_end')::integer,
  seats=nullif(p_data->>'seats','')::integer,wheelchairs=nullif(p_data->>'wheelchairs','')::integer,stretchers=nullif(p_data->>'stretchers','')::integer,
  buffer_minutes=(p_data->>'buffer_minutes')::integer,boarding_minutes=(p_data->>'boarding_minutes')::integer,
  routes=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','label',btrim(value->>'label'),'minutes',(value->>'minutes')::integer)),'[]') FROM jsonb_array_elements(p_data->'routes')),
  holidays=ARRAY(SELECT value::date FROM jsonb_array_elements_text(coalesce(p_data->'holidays','[]'))),
  calendar_checked_through=nullif(p_data->>'calendar_checked_through','')::date,unavailable=coalesce((p_data->>'unavailable')::boolean,false),
  delegation_reference=btrim(coalesce(p_data->>'delegation_reference','')),privacy_notice=btrim(coalesce(p_data->>'privacy_notice','')),
  contact_phone=btrim(coalesce(p_data->>'contact_phone','')),revision=s.revision+1,updated_at=now() WHERE municipality_id=p_muni;
 PERFORM public.ptb_audit(p_muni,p_muni,'settings_changed',jsonb_build_object('revision',s.revision+1));
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
