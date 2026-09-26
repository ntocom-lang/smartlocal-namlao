BEGIN;
-- Reasons are optional; actor/time and before/after values remain in ptb_audit.
-- No data rewrite, role change, or automatic approval of abnormal mileage.
ALTER TABLE public.patient_booking_trips DROP CONSTRAINT patient_booking_trips_odometer_order;
ALTER TABLE public.patient_booking_trips ADD CONSTRAINT patient_booking_trips_odometer_order CHECK (
 odometer_issue OR
 (NOT odometer_issue AND (odometer_start IS NULL OR odometer_end IS NULL OR
 (odometer_end>=odometer_start AND odometer_end::bigint-odometer_start::bigint<=2000))));

CREATE OR REPLACE FUNCTION public.patient_booking_save_odometer(p_muni uuid,p_trip uuid,p_docs_revision integer,p_start integer,p_end integer,p_issue boolean,p_note text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.patient_booking_trips; role_name text:=public.ptb_role(p_muni); note text:=btrim(coalesce(p_note,''));
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni FOR UPDATE;
 IF t.id IS NULL OR t.state='cancelled' THEN RAISE EXCEPTION 'ไม่พบเที่ยวนี้ หรือเที่ยวถูกยกเลิกแล้ว'; END IF;
 -- คนขับของเที่ยวนั้นบันทึกเองได้แม้ภายหลังเปลี่ยนคนขับประจำไปแล้ว แต่ต้องยังเป็นเจ้าหน้าที่ของหน่วยงานนี้อยู่
 IF role_name NOT IN ('admin','coordinator') AND (t.driver_id IS DISTINCT FROM auth.uid() OR NOT EXISTS(
   SELECT 1 FROM public.profiles WHERE id=auth.uid() AND municipality_id=p_muni AND role IN ('admin','officer','staff'))) THEN
  RAISE EXCEPTION 'เฉพาะคนขับของเที่ยวนี้ที่ยังเป็นเจ้าหน้าที่ หรือเจ้าหน้าที่จัดคิว';
 END IF;
 IF p_issue IS NULL OR char_length(note)>300 THEN RAISE EXCEPTION 'ข้อมูลเหตุผลไม่ถูกต้อง'; END IF;
 IF p_start<0 OR p_end<0 OR (p_start IS NULL AND NOT p_issue) THEN RAISE EXCEPTION 'กรุณาระบุเลขไมล์ตอนออกรถ'; END IF;
 IF NOT p_issue AND p_end IS NOT NULL AND (p_end<p_start OR p_end::bigint-p_start::bigint>2000) THEN RAISE EXCEPTION 'เลขไมล์ตอนกลับต้องไม่น้อยกว่าตอนออก และระยะทางต่อเที่ยวไม่เกิน 2,000 กม.'; END IF;
 IF t.odometer_start IS NOT DISTINCT FROM p_start AND t.odometer_end IS NOT DISTINCT FROM p_end AND t.odometer_issue=p_issue AND t.odometer_note=note THEN RETURN t.docs_revision; END IF;
 IF p_docs_revision IS DISTINCT FROM t.docs_revision THEN RAISE EXCEPTION 'ข้อมูลเอกสารของเที่ยวนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้'; END IF;
 UPDATE public.patient_booking_trips SET odometer_issue=p_issue,odometer_note=note,odometer_start=p_start, odometer_end=p_end, docs_revision=docs_revision+1, updated_at=now() WHERE id=p_trip;
 PERFORM public.ptb_audit(p_muni,p_trip,'odometer_recorded',jsonb_build_object('start',p_start,'end',p_end,
  'previous_start',t.odometer_start,'previous_end',t.odometer_end,'issue',p_issue,'note',note,'previous_issue',t.odometer_issue,'previous_note',t.odometer_note));
 RETURN t.docs_revision+1;
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_save_odometer(uuid,uuid,integer,integer,integer,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_save_odometer(uuid,uuid,integer,integer,integer,boolean,text) TO authenticated;
COMMIT;
