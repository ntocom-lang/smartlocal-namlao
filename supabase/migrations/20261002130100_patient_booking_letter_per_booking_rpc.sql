-- หนังสือนำส่งกองทุน "แยกรายคน" — เฟสที่ 2: RPC ที่อ้างคอลัมน์จาก 20261002130000 (2569-10-02)
--
-- 1) patient_booking_record_booking_letter — บันทึกเลขที่/วันที่หนังสือของผู้เดินทางหนึ่งคน
--    แบบเดียวกับ patient_booking_record_letter ของเที่ยว (20260919140100): ส่ง letter_revision ที่หน้าจอเห็นมาด้วย
--    ไม่ตรง = มีคนแก้ไปก่อน ปฏิเสธ · ยิงซ้ำด้วยค่าเดิม (เน็ตหลุดแล้วลองใหม่) = สำเร็จโดยไม่เขียนซ้ำ
--    ไม่เพิ่ม revision ของคำขอ (เหตุผลที่หัวไฟล์คอลัมน์) · เขียน patient_booking_events ในธุรกรรมเดียวกัน
--    เหตุการณ์ผูกกับคำขอ (entity_id = คำขอ) ประวัติการดำเนินการของคำขอนั้นจึงเห็นเองโดยไม่ต้องแก้ฟังก์ชันประวัติ
--
-- 2) patient_booking_month_report / patient_booking_period_report — เลขหนังสือของแต่ละเที่ยวในรายงานมาจากคำขอของเที่ยวนั้น
--    (เรียงตามเวลานัด คั่นด้วย ", ") ไม่มีเลขของคำขอใดเลยค่อยใช้เลขของเที่ยว (เที่ยวเก่าก่อนแยกรายคน)
--    ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — ตัวฟังก์ชันคัดลอกจากรุ่นล่าสุดแล้วแก้เฉพาะ 2 บรรทัด letter_no/letter_date
--    ต้นฉบับ: month_report = 20260919150100 · period_report = 20261002090000 (ห้ามแก้อย่างอื่นในไฟล์นี้)
--
-- ไม่แตะ patient_booking_workspace / patient_booking_mine: ทั้งคู่ส่งคำขอด้วย to_jsonb(r) คอลัมน์ใหม่จึงไปถึงเจ้าหน้าที่ทันที
-- (ผู้จองเห็นเลขหนังสือของคำขอตัวเองด้วย — เลขที่ออกให้คำขอของเขาเอง ไม่ใช่ข้อมูลของคนอื่น ผู้จองไม่เห็นรายชื่อคนอื่นอยู่แล้ว)
BEGIN;

DO $$ BEGIN
 IF to_regprocedure('public.patient_booking_period_report(uuid,date,date)') IS NULL THEN
  RAISE EXCEPTION 'ต้องติดตั้ง 20261002090000_patient_booking_period_report ก่อน';
 END IF;
 IF to_regprocedure('public.patient_booking_month_report(uuid,date)') IS NULL THEN
  RAISE EXCEPTION 'ต้องติดตั้งระบบรายงานรายเดือนก่อน';
 END IF;
END $$;

CREATE FUNCTION public.patient_booking_record_booking_letter(p_muni uuid,p_booking uuid,p_letter_revision integer,p_letter_no text,p_letter_date date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; v_no text:=btrim(coalesce(p_letter_no,''));
 today date:=(now() AT TIME ZONE 'Asia/Bangkok')::date; trip_state text;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวบันทึกเลขหนังสือได้'; END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni FOR UPDATE;
 -- หนังสือออกให้คำขอที่ยืนยันรถแล้วเท่านั้น (ยังไม่มีเที่ยว = ยังไม่มีหนังสือนำส่ง) คำขอที่ยกเลิกแล้วไม่ต้องส่งถึงกองทุน
 IF b.id IS NULL OR b.status NOT IN ('confirmed','completed') THEN RAISE EXCEPTION 'ไม่พบคำขอนี้ หรือยังไม่ได้ยืนยันรถ หรือถูกยกเลิกแล้ว'; END IF;
 SELECT state INTO trip_state FROM public.patient_booking_trips WHERE id=b.trip_id AND municipality_id=p_muni;
 IF trip_state IS NULL OR trip_state='cancelled' THEN RAISE EXCEPTION 'เที่ยวของคำขอนี้ถูกยกเลิกแล้ว'; END IF;
 IF char_length(v_no) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'กรุณาระบุเลขที่หนังสือจากทะเบียนหนังสือส่ง'; END IF;
 -- กันพิมพ์ปีผิด (เช่น ปี พ.ศ. ลงช่อง ค.ศ.) ไม่ใช่กติกาสารบรรณ
 IF p_letter_date IS NULL OR p_letter_date NOT BETWEEN today-365 AND today+30 THEN RAISE EXCEPTION 'วันที่หนังสือไม่ถูกต้อง'; END IF;
 IF b.forward_letter_no IS NOT DISTINCT FROM v_no AND b.forward_letter_date IS NOT DISTINCT FROM p_letter_date THEN RETURN b.letter_revision; END IF;
 IF p_letter_revision IS DISTINCT FROM b.letter_revision THEN RAISE EXCEPTION 'ข้อมูลเลขหนังสือของคำขอนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วตรวจก่อนบันทึก'; END IF;
 UPDATE public.patient_bookings SET forward_letter_no=v_no, forward_letter_date=p_letter_date,
  forward_recorded_by=auth.uid(), forward_recorded_at=now(), letter_revision=letter_revision+1, updated_at=now() WHERE id=p_booking;
 PERFORM public.ptb_audit(p_muni,p_booking,'booking_letter_recorded',jsonb_build_object('letter_no',v_no,'letter_date',p_letter_date,
  'previous_no',b.forward_letter_no,'previous_date',b.forward_letter_date));
 RETURN b.letter_revision+1;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_month_report(p_muni uuid,p_month date) RETURNS jsonb
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
   'odometer_issue',t.odometer_issue,'distance',CASE WHEN NOT t.odometer_issue AND t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),
   'letter_no',coalesce((SELECT string_agg(b.forward_letter_no,', ' ORDER BY b.appointment_at,b.id) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.status IN ('confirmed','completed') AND b.forward_letter_no IS NOT NULL),t.forward_letter_no),
   'letter_date',coalesce((SELECT min(b.forward_letter_date) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.status IN ('confirmed','completed') AND b.forward_letter_date IS NOT NULL),t.forward_letter_date)) x
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND (t.plan->>'date')::date>=first_day AND (t.plan->>'date')::date<(first_day+interval '1 month')::date
 ) q;
 RETURN jsonb_build_object('month',first_day,'trips',rows);
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_period_report(p_muni uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF coalesce(public.ptb_role(p_muni),'anonymous') NOT IN ('admin','coordinator') THEN
  RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเรียกดูสรุปได้';
 END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from THEN
  RAISE EXCEPTION 'กรุณาระบุวันที่เริ่มและสิ้นสุด โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
 END IF;
 IF p_to-p_from>3660 THEN RAISE EXCEPTION 'เลือกช่วงครั้งละไม่เกิน 10 ปี กรุณาแยกพิมพ์แต่ละช่วง'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'date',x->>'pickup_at',x->>'trip_id'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('trip_id',t.id,'date',t.plan->>'date','pickup_at',t.plan->>'pickup_at','route_label',t.plan->>'route_label',
   'state',t.state,'helper_name',t.helper_name,
   'passengers',(SELECT count(*) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'companions',(SELECT coalesce(sum(b.companions),0) FROM public.patient_bookings b WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed')),
   'odometer_start',t.odometer_start,'odometer_end',t.odometer_end,
   'odometer_issue',t.odometer_issue,'distance',CASE WHEN NOT t.odometer_issue AND t.odometer_start IS NOT NULL AND t.odometer_end IS NOT NULL THEN t.odometer_end-t.odometer_start END,
   'driver_name',(SELECT full_name FROM public.profiles WHERE id=t.driver_id),
   'letter_no',coalesce((SELECT string_agg(b.forward_letter_no,', ' ORDER BY b.appointment_at,b.id) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed') AND b.forward_letter_no IS NOT NULL),t.forward_letter_no),
   'letter_date',coalesce((SELECT min(b.forward_letter_date) FROM public.patient_bookings b
     WHERE b.trip_id=t.id AND b.municipality_id=p_muni AND b.status IN ('confirmed','completed') AND b.forward_letter_date IS NOT NULL),t.forward_letter_date)) x
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND t.state<>'cancelled'
   AND (t.plan->>'date')::date BETWEEN p_from AND p_to
 ) q;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'trips',rows);
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_record_booking_letter(uuid,uuid,integer,text,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_record_booking_letter(uuid,uuid,integer,text,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
