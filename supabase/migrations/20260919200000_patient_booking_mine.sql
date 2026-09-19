-- ข้อมูลของ "หน้าประชาชน" แยกจาก patient_booking_workspace ของหน้าทำงาน
--
-- ทำไม: หน้าประชาชนเดิมเรียก patient_booking_workspace ทุกคนที่ล็อกอิน บัญชีผู้จัดคิว/ผู้ดูแล
-- จึงได้คำขอทั้งหน่วยงาน (สูงสุด 1,000 รายการ) ค่าตั้งค่า ทะเบียนเจ้าหน้าที่ และ audit log
-- ลงมาที่หน้าประชาชน ทั้งที่หน้านั้นไม่ได้ใช้ ข้อมูลไม่ได้รั่วข้ามคน แต่โหลดเกินความจำเป็น
-- และทำให้ "ซ่อนด้วย UI" กลายเป็นเส้นแบ่งเดียวระหว่างสองฝั่ง
--
-- ฟังก์ชันนี้คืนเฉพาะสิ่งที่หน้าประชาชนใช้จริง ไม่ว่าผู้เรียกจะมีบทบาทอะไร:
-- คำขอของตัวเอง · เที่ยวที่ผูกกับคำขอของตัวเอง (ตัดแผนภายในออก) · โปรไฟล์ตัวเอง · แจ้งเตือนของตัวเอง
-- role คืนไว้ให้หน้าประชาชนรู้ว่าควรแสดงลิงก์ "ไปหน้าทำงานเจ้าหน้าที่" หรือไม่ เท่านั้น
BEGIN;
CREATE FUNCTION public.patient_booking_mine(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); b jsonb; t jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r)-'consent_text' ORDER BY r.appointment_at),'[]') INTO b
 FROM (SELECT * FROM public.patient_bookings WHERE municipality_id=p_muni AND created_by=auth.uid()
   AND (status IN ('submitted','confirmed') OR updated_at>now()-interval '30 days')
   ORDER BY appointment_at LIMIT 200) r;
 -- เที่ยวของตัวเองใช้ projection เดียวกับที่ workspace ให้ผู้จอง: ไม่มีรายชื่อคนอื่นและไม่มีแผนภายใน
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,
   'estimated_pickup_at',tr.estimated_pickup_at,'estimated_return_at',tr.estimated_return_at,
   'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required')),'[]') INTO t
 FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni
  AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid());
 RETURN jsonb_build_object('role',role_name,'bookings',b,'trips',t,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n));
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_mine(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_mine(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
