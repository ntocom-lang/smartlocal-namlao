-- แก้ผลตรวจ #227 ข้อ 1 และ 2 — ต่อจากคอลัมน์ docs_revision ใน 20260919140000
--
-- ข้อ 1: เดิมคนขับที่ "เคย" ขับเที่ยวนี้บันทึกเลขไมล์ได้ตลอด แม้ถูกลดสิทธิ์เป็นประชาชนแล้ว
--        ต้องเป็นเจ้าหน้าที่ของหน่วยงานนี้ "ปัจจุบัน" ด้วย (บทบาทเดียวกับที่ ptb_role ใช้ตัดสินคนขับ)
-- ข้อ 2: ส่ง docs_revision ที่หน้าจอเห็นมาด้วยทุกครั้ง ไม่ตรง = มีคนแก้ไปก่อน ปฏิเสธ
--        ยกเว้นค่าที่ส่งมาตรงกับค่าปัจจุบันอยู่แล้ว = คำสั่งเดิมที่ยิงซ้ำตอนเน็ตหลุด ตอบสำเร็จโดยไม่เขียนซ้ำ
--        (ไม่มีบันทึกประวัติซ้ำ และไม่ทำให้ผู้ใช้เห็น error ทั้งที่ข้อมูลถูกบันทึกแล้ว)
--
-- เปลี่ยนรายการพารามิเตอร์ = ต้อง DROP ตัวเดิม ไม่งั้น CREATE จะได้ overload คู่กัน แล้วตัวเก่า
-- ที่ไม่มีตัวกันยังเรียกได้อยู่ · ฟังก์ชันเขียนใหม่ทั้งตัว ไม่มี placeholder
BEGIN;

DROP FUNCTION public.patient_booking_record_letter(uuid,uuid,text,date);
DROP FUNCTION public.patient_booking_record_odometer(uuid,uuid,integer,integer);

CREATE FUNCTION public.patient_booking_record_letter(p_muni uuid,p_trip uuid,p_docs_revision integer,p_letter_no text,p_letter_date date) RETURNS integer
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
 IF t.forward_letter_no IS NOT DISTINCT FROM v_no AND t.forward_letter_date IS NOT DISTINCT FROM p_letter_date THEN RETURN t.docs_revision; END IF;
 IF p_docs_revision IS DISTINCT FROM t.docs_revision THEN RAISE EXCEPTION 'ข้อมูลเอกสารของเที่ยวนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้'; END IF;
 UPDATE public.patient_booking_trips SET forward_letter_no=v_no, forward_letter_date=p_letter_date,
  forward_recorded_by=auth.uid(), forward_recorded_at=now(), docs_revision=docs_revision+1, updated_at=now() WHERE id=p_trip;
 PERFORM public.ptb_audit(p_muni,p_trip,'letter_recorded',jsonb_build_object('letter_no',v_no,'letter_date',p_letter_date,
  'previous_no',t.forward_letter_no,'previous_date',t.forward_letter_date));
 RETURN t.docs_revision+1;
END $$;

CREATE FUNCTION public.patient_booking_record_odometer(p_muni uuid,p_trip uuid,p_docs_revision integer,p_start integer,p_end integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; role_name text:=public.ptb_role(p_muni);
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni FOR UPDATE;
 IF t.id IS NULL OR t.state='cancelled' THEN RAISE EXCEPTION 'ไม่พบเที่ยวนี้ หรือเที่ยวถูกยกเลิกแล้ว'; END IF;
 -- คนขับของเที่ยวนั้นบันทึกเองได้แม้ภายหลังเปลี่ยนคนขับประจำไปแล้ว แต่ต้องยังเป็นเจ้าหน้าที่ของหน่วยงานนี้อยู่
 IF role_name NOT IN ('admin','coordinator') AND (t.driver_id IS DISTINCT FROM auth.uid() OR NOT EXISTS(
   SELECT 1 FROM public.profiles WHERE id=auth.uid() AND municipality_id=p_muni AND role IN ('admin','officer','staff'))) THEN
  RAISE EXCEPTION 'เฉพาะคนขับของเที่ยวนี้ที่ยังเป็นเจ้าหน้าที่ หรือเจ้าหน้าที่จัดคิว';
 END IF;
 IF p_start IS NULL OR p_start<0 THEN RAISE EXCEPTION 'กรุณาระบุเลขไมล์ตอนออกรถ'; END IF;
 IF p_end IS NOT NULL AND (p_end<p_start OR p_end-p_start>2000) THEN RAISE EXCEPTION 'เลขไมล์ตอนกลับต้องไม่น้อยกว่าตอนออก และระยะทางต่อเที่ยวไม่เกิน 2,000 กม.'; END IF;
 IF t.odometer_start IS NOT DISTINCT FROM p_start AND t.odometer_end IS NOT DISTINCT FROM p_end THEN RETURN t.docs_revision; END IF;
 IF p_docs_revision IS DISTINCT FROM t.docs_revision THEN RAISE EXCEPTION 'ข้อมูลเอกสารของเที่ยวนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้'; END IF;
 UPDATE public.patient_booking_trips SET odometer_start=p_start, odometer_end=p_end, docs_revision=docs_revision+1, updated_at=now() WHERE id=p_trip;
 PERFORM public.ptb_audit(p_muni,p_trip,'odometer_recorded',jsonb_build_object('start',p_start,'end',p_end,
  'previous_start',t.odometer_start,'previous_end',t.odometer_end));
 RETURN t.docs_revision+1;
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_record_letter(uuid,uuid,integer,text,date),
 public.patient_booking_record_odometer(uuid,uuid,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_record_letter(uuid,uuid,integer,text,date),
 public.patient_booking_record_odometer(uuid,uuid,integer,integer,integer) TO authenticated;

COMMIT;
