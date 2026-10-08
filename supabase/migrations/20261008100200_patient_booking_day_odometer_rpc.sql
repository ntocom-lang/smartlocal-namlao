-- เลขไมล์เหมาเป็นวัน — เฟส 3/3: RPC
--
-- ใหม่  patient_booking_save_day_odometer  บันทึก/แก้เลขไมล์ของวัน (CAS ด้วย revision · ยิงซ้ำค่าเดิม = สำเร็จ
--        · วันนั้นต้องมีเที่ยวที่จบแล้ว (กันใส่ผิดวัน/วันที่ยังไม่ได้วิ่ง โดยไม่ผูกกับนาฬิกาเครื่อง)
--        · คนขับของวันนั้นที่ยังเป็นเจ้าหน้าที่ หรือผู้จัดคิว/แอดมิน · audit ค่าก่อน/หลัง)
-- ใหม่  patient_booking_odometer_days       อ่านรายวันในช่วง + สรุปเที่ยวของวัน + เลขกลับล่าสุดก่อนช่วง (ไว้เติมเลขออก)
--        ผู้จัดคิว/แอดมินเห็นทุกวัน · คนขับเห็นเฉพาะวันที่ตัวเองขับ · ไม่มีข้อมูลผู้เดินทาง
-- แทน  patient_booking_save_odometer       ปฏิเสธทุกครั้ง — เลขไมล์รายเที่ยวไม่ถูกนับแล้ว หน้าจอรุ่นเก่าที่เปิดค้างจะได้ข้อความให้โหลดใหม่
--        (patient_booking_record_odometer เรียกตัวนี้ จึงปิดตามไปด้วย) · ยกจาก 20260926141301
-- แทน  patient_booking_staff_work_badge     นับ "วันที่รอเลขไมล์ปิดวัน" แทน "เที่ยวที่จบแล้วแต่ยังไม่มีเลขไมล์" · ยกจาก 20260929130000
-- ไม่แตะ ptb_plan / workspace_v2 / RPC รายงาน — หน้าจอรวมระยะทางจากตารางรายวันเอง
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object(
 'public.patient_booking_save_odometer(uuid,uuid,integer,integer,integer,boolean,text)','24648b95384b7fadd5b8b9e2b204c3f8',
 'public.patient_booking_staff_work_badge(uuid)','be0623a843fa93b1a0c1dfa4241309c1'); fn text; actual text;
BEGIN
 IF to_regclass('public.patient_booking_odometer_days') IS NULL THEN RAISE EXCEPTION 'ต้อง apply 20261008100000 และ 20261008100100 ก่อน'; END IF;
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

CREATE FUNCTION public.patient_booking_save_day_odometer(p_muni uuid,p_day date,p_revision integer,p_start integer,p_end integer,p_issue boolean,p_note text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); d public.patient_booking_odometer_days; note text:=btrim(coalesce(p_note,''));
BEGIN
 IF role_name IS NULL OR role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 -- เลขไมล์ใส่ตอนรถกลับถึงกองทุนหลังจบเที่ยว วันนั้นจึงต้องมีเที่ยวที่จบแล้วอย่างน้อย 1 เที่ยว
 -- (วันที่ยังไม่ได้วิ่ง/ไม่มีเที่ยว/ยกเลิกหมด บันทึกไม่ได้) — ไม่ใช้ "ห้ามวันอนาคต" เพราะต้องพึ่งนาฬิกา ส่วนสถานะเที่ยวตรวจย้อนได้
 IF p_day IS NULL OR NOT EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state='completed' AND (plan->>'date')::date=p_day) THEN
  RAISE EXCEPTION 'บันทึกเลขไมล์ได้เฉพาะวันที่มีเที่ยวรถจบแล้ว';
 END IF;
 -- คนขับเที่ยวใดเที่ยวหนึ่งของวันนั้นบันทึกเองได้ แต่ต้องยังเป็นเจ้าหน้าที่ของหน่วยงานนี้อยู่ (กติกาเดียวกับเลขไมล์รายเที่ยวเดิม)
 IF role_name NOT IN ('admin','coordinator') AND (NOT EXISTS(SELECT 1 FROM public.patient_booking_trips WHERE municipality_id=p_muni AND state<>'cancelled'
   AND (plan->>'date')::date=p_day AND driver_id=auth.uid())
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND municipality_id=p_muni AND role IN ('admin','officer','staff'))) THEN
  RAISE EXCEPTION 'เฉพาะคนขับของวันนั้นที่ยังเป็นเจ้าหน้าที่ หรือเจ้าหน้าที่จัดคิว';
 END IF;
 IF p_issue IS NULL OR char_length(note)>300 THEN RAISE EXCEPTION 'ข้อมูลเหตุผลไม่ถูกต้อง'; END IF;
 IF p_start<0 OR p_end<0 THEN RAISE EXCEPTION 'เลขไมล์ต้องไม่ติดลบ'; END IF;
 IF NOT p_issue AND (p_start IS NULL OR p_end IS NULL) THEN RAISE EXCEPTION 'กรุณาระบุเลขไมล์ตอนออกและตอนรถกลับ หรือเลือกว่ามาตรวัดมีปัญหา'; END IF;
 IF NOT p_issue AND (p_end<p_start OR p_end::bigint-p_start::bigint>2000) THEN RAISE EXCEPTION 'เลขไมล์ตอนกลับต้องไม่น้อยกว่าตอนออก และระยะทางทั้งวันไม่เกิน 2,000 กม.'; END IF;
 SELECT * INTO d FROM public.patient_booking_odometer_days WHERE municipality_id=p_muni AND service_date=p_day FOR UPDATE;
 IF d.municipality_id IS NULL THEN
  -- ครั้งแรกของวัน: revision ที่ส่งมาต้องเป็น 0 · บันทึกพร้อมกันสองเครื่อง คนที่สองได้ "เปลี่ยนแล้ว" แล้วโหลดค่าล่าสุด
  IF coalesce(p_revision,0)<>0 THEN RAISE EXCEPTION 'เลขไมล์ของวันนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้'; END IF;
  INSERT INTO public.patient_booking_odometer_days(municipality_id,service_date,odometer_start,odometer_end,odometer_issue,odometer_note,recorded_by,recorded_at)
   VALUES(p_muni,p_day,p_start,p_end,p_issue,note,auth.uid(),now())
   ON CONFLICT (municipality_id,service_date) DO NOTHING RETURNING * INTO d;
  IF d.municipality_id IS NULL THEN RAISE EXCEPTION 'เลขไมล์ของวันนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้'; END IF;
  PERFORM public.ptb_audit(p_muni,d.id,'day_odometer_recorded',jsonb_build_object('date',p_day,'start',p_start,'end',p_end,'issue',p_issue,'note',note,
   'previous_start',NULL,'previous_end',NULL,'previous_issue',NULL,'previous_note',NULL));
  RETURN d.revision;
 END IF;
 -- คำสั่งเดิมยิงซ้ำ (เน็ตหลุดแล้วกดใหม่) = สำเร็จโดยไม่เขียนและไม่ลงประวัติซ้ำ
 IF d.odometer_start IS NOT DISTINCT FROM p_start AND d.odometer_end IS NOT DISTINCT FROM p_end AND d.odometer_issue=p_issue AND d.odometer_note=note THEN RETURN d.revision; END IF;
 IF p_revision IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'เลขไมล์ของวันนี้เปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้'; END IF;
 UPDATE public.patient_booking_odometer_days SET odometer_start=p_start,odometer_end=p_end,odometer_issue=p_issue,odometer_note=note,
  recorded_by=auth.uid(),recorded_at=now(),revision=revision+1,updated_at=now() WHERE municipality_id=p_muni AND service_date=p_day;
 PERFORM public.ptb_audit(p_muni,d.id,'day_odometer_recorded',jsonb_build_object('date',p_day,'start',p_start,'end',p_end,'issue',p_issue,'note',note,
  'previous_start',d.odometer_start,'previous_end',d.odometer_end,'previous_issue',d.odometer_issue,'previous_note',d.odometer_note));
 RETURN d.revision+1;
END $$;

CREATE FUNCTION public.patient_booking_odometer_days(p_muni uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); staff boolean; rows jsonb; prev jsonb;
BEGIN
 IF role_name IS NULL OR role_name NOT IN ('admin','coordinator','driver') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ดูเลขไมล์ของหน่วยงานนี้'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from OR p_to-p_from>3660 THEN
  RAISE EXCEPTION 'กรุณาเลือกช่วงวันที่ไม่เกิน 10 ปี โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
 END IF;
 staff:=role_name IN ('admin','coordinator');
 WITH x AS (
  SELECT (t.plan->>'date')::date AS d,
   count(*) FILTER (WHERE t.state<>'cancelled') AS trips,
   count(*) FILTER (WHERE t.state='completed') AS completed,
   count(*) FILTER (WHERE t.state NOT IN ('completed','cancelled')) AS open,
   coalesce(bool_or(t.driver_id=auth.uid() AND t.state<>'cancelled'),false) AS mine,
   jsonb_agg(DISTINCT coalesce(t.plan->>'service_type','patient')) FILTER (WHERE t.state<>'cancelled') AS services
  FROM public.patient_booking_trips t
  WHERE t.municipality_id=p_muni AND (t.plan->>'date')::date BETWEEN p_from AND p_to
  GROUP BY 1
 ), o AS (
  SELECT * FROM public.patient_booking_odometer_days WHERE municipality_id=p_muni AND service_date BETWEEN p_from AND p_to
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'date',coalesce(x.d,o.service_date),'trips',coalesce(x.trips,0),'completed',coalesce(x.completed,0),'open',coalesce(x.open,0),
   'mine',coalesce(x.mine,false),'services',coalesce(x.services,'[]'::jsonb),
   'odometer_start',o.odometer_start,'odometer_end',o.odometer_end,'odometer_issue',coalesce(o.odometer_issue,false),
   'odometer_note',coalesce(o.odometer_note,''),'revision',coalesce(o.revision,0),
   'recorded_by_name',(SELECT full_name FROM public.profiles WHERE id=o.recorded_by),'recorded_at',o.recorded_at
  ) ORDER BY coalesce(x.d,o.service_date)),'[]') INTO rows
 FROM x FULL JOIN o ON o.service_date=x.d
 WHERE staff OR coalesce(x.mine,false);
 -- เลขไมล์ออกของวันแรกในช่วง = เลขกลับล่าสุดก่อนช่วง (ไม่นับวันที่รอตรวจสอบ) · เป็นเลขของรถ ไม่มีข้อมูลบุคคล คนขับเห็นได้
 SELECT jsonb_build_object('date',service_date,'odometer_end',odometer_end) INTO prev FROM public.patient_booking_odometer_days
  WHERE municipality_id=p_muni AND service_date<p_from AND odometer_end IS NOT NULL AND NOT odometer_issue ORDER BY service_date DESC LIMIT 1;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'days',rows,'previous',prev);
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_save_odometer(p_muni uuid,p_trip uuid,p_docs_revision integer,p_start integer,p_end integer,p_issue boolean,p_note text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- เลขไมล์เหมาเป็นวันแล้ว (20261008100200): เลขไมล์รายเที่ยวไม่ถูกนับในรายงานอีก จึงไม่รับบันทึก
 -- หน้าจอรุ่นเก่าที่ยังเปิดค้างจะได้ข้อความให้โหลดหน้าใหม่ แทนการบันทึกค่าที่ไม่มีใครเห็น
 RAISE EXCEPTION 'เปลี่ยนเป็นบันทึกเลขไมล์รายวันแล้ว (ใส่ครั้งเดียวตอนรถกลับถึงกองทุน) กรุณาโหลดหน้าใหม่';
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_staff_work_badge(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text:=public.ptb_role(p_muni); v_pending integer:=0; v_driver integer:=0; v_days integer:=0;
BEGIN
 IF auth.uid() IS NULL OR v_role IN ('anonymous','outside') THEN RETURN jsonb_build_object('pending',0,'driver',0,'total',0); END IF;
 IF v_role IN ('admin','coordinator') THEN
  SELECT count(*) INTO v_pending FROM public.patient_bookings WHERE municipality_id=p_muni AND (status='submitted' OR (status='confirmed' AND cancel_requested));
 END IF;
 IF v_role IN ('admin','coordinator','driver') THEN
  SELECT count(*) INTO v_driver FROM public.patient_booking_trips WHERE municipality_id=p_muni AND (v_role='admin' OR driver_id=auth.uid())
   AND state NOT IN ('completed','cancelled');
  -- วันที่รอเลขไมล์ปิดวัน: มีเที่ยวจบแล้วใน 30 วัน ไม่มีเที่ยวค้างในวันนั้น และยังไม่มีเลขไมล์ที่ใช้ได้ (นับวันละ 1 ไม่ใช่เที่ยวละ 1)
  SELECT count(*) INTO v_days FROM (
   SELECT DISTINCT (t.plan->>'date')::date AS d FROM public.patient_booking_trips t
   WHERE t.municipality_id=p_muni AND (v_role='admin' OR t.driver_id=auth.uid()) AND t.state='completed' AND t.updated_at>now()-interval '30 days'
  ) x
  WHERE NOT EXISTS(SELECT 1 FROM public.patient_booking_trips o WHERE o.municipality_id=p_muni AND (o.plan->>'date')::date=x.d AND o.state NOT IN ('completed','cancelled'))
   AND NOT EXISTS(SELECT 1 FROM public.patient_booking_odometer_days od WHERE od.municipality_id=p_muni AND od.service_date=x.d
    AND od.odometer_end IS NOT NULL AND NOT od.odometer_issue);
  v_driver:=v_driver+v_days;
 END IF;
 RETURN jsonb_build_object('pending',v_pending,'driver',v_driver,'total',v_pending+v_driver);
END $$;

REVOKE ALL ON FUNCTION public.patient_booking_save_day_odometer(uuid,date,integer,integer,integer,boolean,text),
 public.patient_booking_odometer_days(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_save_day_odometer(uuid,date,integer,integer,integer,boolean,text),
 public.patient_booking_odometer_days(uuid,date,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
