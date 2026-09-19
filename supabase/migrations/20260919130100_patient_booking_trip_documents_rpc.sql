-- เอกสารถึงกองทุนเจ้าของรถ — เฟสที่ 2: RPC ที่อ้างคอลัมน์จาก 20260919130000
--
-- ⚠️ ทั้งสามฟังก์ชันไม่เพิ่ม revision ของเที่ยว — เลขหนังสือ/เลขไมล์เป็นข้อมูลประกอบ ไม่ใช่สถานะ
-- ถ้าเพิ่ม revision คำสั่งของคนขับที่กดค้างไว้ (ออกไปรับ/ส่งถึง) จะชน "revision ไม่ตรง" ทั้งที่ไม่มีอะไร
-- เปลี่ยนในแผนเดินทางเลย · ทุกการบันทึกเขียน patient_booking_events ในธุรกรรมเดียวกัน ตรวจย้อนได้
BEGIN;

CREATE FUNCTION public.patient_booking_record_letter(p_muni uuid,p_trip uuid,p_letter_no text,p_letter_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; v_no text:=btrim(coalesce(p_letter_no,''));
 today date:=(now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวบันทึกเลขหนังสือได้'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni FOR UPDATE;
 IF t.id IS NULL OR t.state='cancelled' THEN RAISE EXCEPTION 'ไม่พบเที่ยวนี้ หรือเที่ยวถูกยกเลิกแล้ว'; END IF;
 IF char_length(v_no) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'กรุณาระบุเลขที่หนังสือจากทะเบียนหนังสือส่ง'; END IF;
 -- กันพิมพ์ปีผิด (เช่น ปี พ.ศ. ลงช่อง ค.ศ.) ไม่ใช่กติกาสารบรรณ
 IF p_letter_date IS NULL OR p_letter_date NOT BETWEEN today-365 AND today+30 THEN RAISE EXCEPTION 'วันที่หนังสือไม่ถูกต้อง'; END IF;
 UPDATE public.patient_booking_trips SET forward_letter_no=v_no, forward_letter_date=p_letter_date,
  forward_recorded_by=auth.uid(), forward_recorded_at=now(), updated_at=now() WHERE id=p_trip;
 PERFORM public.ptb_audit(p_muni,p_trip,'letter_recorded',jsonb_build_object('letter_no',v_no,'letter_date',p_letter_date,
  'previous_no',t.forward_letter_no,'previous_date',t.forward_letter_date));
END $$;

CREATE FUNCTION public.patient_booking_record_odometer(p_muni uuid,p_trip uuid,p_start integer,p_end integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; role_name text:=public.ptb_role(p_muni);
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni FOR UPDATE;
 IF t.id IS NULL OR t.state='cancelled' THEN RAISE EXCEPTION 'ไม่พบเที่ยวนี้ หรือเที่ยวถูกยกเลิกแล้ว'; END IF;
 -- คนขับของเที่ยวนั้นบันทึกเองได้ แม้ภายหลังจะเปลี่ยนคนขับประจำไปแล้ว ส่วนเจ้าหน้าที่จัดคิวแก้แทนได้
 IF role_name NOT IN ('admin','coordinator') AND t.driver_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'เฉพาะคนขับของเที่ยวนี้หรือเจ้าหน้าที่จัดคิว'; END IF;
 IF p_start IS NULL OR p_start<0 THEN RAISE EXCEPTION 'กรุณาระบุเลขไมล์ตอนออกรถ'; END IF;
 IF p_end IS NOT NULL AND (p_end<p_start OR p_end-p_start>2000) THEN RAISE EXCEPTION 'เลขไมล์ตอนกลับต้องไม่น้อยกว่าตอนออก และระยะทางต่อเที่ยวไม่เกิน 2,000 กม.'; END IF;
 UPDATE public.patient_booking_trips SET odometer_start=p_start, odometer_end=p_end, updated_at=now() WHERE id=p_trip;
 PERFORM public.ptb_audit(p_muni,p_trip,'odometer_recorded',jsonb_build_object('start',p_start,'end',p_end,
  'previous_start',t.odometer_start,'previous_end',t.odometer_end));
END $$;

-- สรุปรายเดือนไว้เบิกกับกองทุน: จำนวนผู้เดินทางเท่านั้น ไม่มีชื่อ/ที่อยู่/เบอร์ (data minimization)
-- รายชื่อผู้เดินทางไปถึงกองทุนแล้วทางบัญชีแนบหนังสือนำส่งรายเที่ยว
CREATE FUNCTION public.patient_booking_month_report(p_muni uuid,p_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE first_day date:=date_trunc('month',coalesce(p_month,current_date))::date; rows jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเรียกดูสรุปได้'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'date',x->>'pickup_at'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('trip_id',t.id,'date',t.plan->>'date','pickup_at',t.plan->>'pickup_at','route_label',t.plan->>'route_label',
   'state',t.state,'helper_name',t.helper_name,
   'passengers',(SELECT count(*) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.status IN ('confirmed','completed')),
   'companions',(SELECT coalesce(sum(b.companions),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.status IN ('confirmed','completed')),
   'odometer_start',t.odometer_start,'odometer_end',t.odometer_end,
   'distance',CASE WHEN t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),
   'letter_no',t.forward_letter_no,'letter_date',t.forward_letter_date) x
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND (t.plan->>'date')::date>=first_day AND (t.plan->>'date')::date<(first_day+interval '1 month')::date
 ) q;
 RETURN jsonb_build_object('month',first_day,'trips',rows);
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_record_letter(uuid,uuid,text,date),
 public.patient_booking_record_odometer(uuid,uuid,integer,integer),
 public.patient_booking_month_report(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_record_letter(uuid,uuid,text,date),
 public.patient_booking_record_odometer(uuid,uuid,integer,integer),
 public.patient_booking_month_report(uuid,date) TO authenticated;

COMMIT;
