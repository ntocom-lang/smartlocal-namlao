-- ผู้จองเห็นเหตุผลที่เจ้าหน้าที่ยกเลิกคำขอ
--
-- ทำไม: หน้าประชาชนขึ้นแค่ป้าย "ยกเลิกแล้ว" คนที่รอรถอยู่จึงไม่รู้ว่าทำไมถึงไม่ได้รถ ต้องโทรถามเอง
-- ทั้งที่เจ้าหน้าที่พิมพ์เหตุผลลงประวัติไว้แล้วทุกครั้ง (patient_booking_action บังคับให้ระบุเหตุผล
-- ทั้งตอนยกเลิกคำขอแทนผู้จองและตอนนำผู้เดินทางออกจากเที่ยว) เจ้าของระบบสั่งให้เปิดให้เห็น 2026-09-22
--
-- ของใหม่: patient_booking_mine พ่วงคีย์ cancel_note มากับคำขอที่สถานะ 'cancelled' เท่านั้น
-- อ่านจาก patient_booking_events ไม่เพิ่มคอลัมน์ ไม่แก้ทางเขียน (ประวัติยังเป็นชุดเดียวที่ตรวจย้อนได้)
-- เลือกเหตุการณ์ล่าสุดของคำขอนี้ที่ actor_id<>auth.uid() = เจ้าหน้าที่เป็นคนทำเสมอ เพราะ mine
-- ส่งเฉพาะคำขอที่ผู้ใช้คนนั้นจองเองผ่านหน้าประชาชน (created_by=auth.uid() AND entry_channel='online')
-- ผู้จองกดยกเลิกเองไม่มีเหตุผลให้แสดง (หน้าประชาชนไม่มีช่องให้พิมพ์) จึงได้ null ตามเดิม
--
-- ⚠️ PDPA: ข้อความนี้เจ้าหน้าที่พิมพ์เองตอนที่ยังเป็นบันทึกภายใน ของเก่าจะถูกแสดงย้อนหลังด้วย
-- ณ วันที่ทำมีข้อมูลเฉพาะสนามซ้อม (demo) อปท. จริงยังไม่มีคำขอสักรายการ จึงไม่มีข้อความเก่าให้เปิดเผยผิดคน
-- ก่อน อปท. จริงเปิดใช้ต้องแจ้งเจ้าหน้าที่ว่าข้อความในช่องนี้ผู้จองอ่าน และหน้าจอเจ้าหน้าที่บอกไว้ที่ช่องกรอกแล้ว
-- ขอบเขตที่ยังไม่ครอบ: "คืนคิวทั้งเที่ยว" (action 'release') บันทึกเหตุผลไว้ที่ "เที่ยว" ไม่ใช่รายคำขอ
-- และตัด trip_id ของคำขอทิ้ง จึงผูกกลับรายคนไม่ได้ — คำขอที่ถูกยกเลิกด้วยทางนี้คือคำขอที่ผู้จอง
-- กดขอยกเลิกไว้เองอยู่แล้ว (cancel_requested) เหตุผลจึงเป็นเรื่องที่ผู้จองรู้อยู่แล้ว ถ้าจะให้เห็นด้วย
-- ต้องเขียนประวัติรายคำขอตอนคืนคิว = แก้ patient_booking_action อีกตัว ยกไปทำแยกเมื่อเจ้าของระบบสั่ง
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (docs/ai/NOTES.md) ด่านแรกจึงตรวจว่านิยามปัจจุบันตรงกับที่ยกมาทุกตัวอักษร
-- (md5 ของ prosrc ตัด CR) ถ้ามีใครแก้ไปก่อน ไฟล์นี้หยุดทั้งก้อนโดยไม่เขียนทับอะไร
-- นิยามที่ยกมา: 20260922120000 — ตรงกับ production 2026-09-22
-- ย้อนกลับ: CREATE OR REPLACE patient_booking_mine ด้วยนิยามใน 20260922120000 (ดัชนีคงไว้ได้ ไม่กระทบใคร)
BEGIN;
DO $guard$
DECLARE expected jsonb := jsonb_build_object(
  'public.patient_booking_mine(uuid)', '5e1f51f48269c8b43467d27693c08381');
 fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc, chr(13), '')) INTO actual FROM pg_catalog.pg_proc WHERE oid = to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN
   RAISE EXCEPTION 'นิยาม % บนฐานข้อมูลนี้ไม่ตรงกับที่ไฟล์นี้คาดไว้ (อาจมีคนแก้ไปแล้ว) — หยุดก่อนเขียนทับทั้งฟังก์ชัน ตรวจ drift แล้วทำไฟล์ใหม่จากนิยามปัจจุบัน', fn;
  END IF;
 END LOOP;
END $guard$;

-- ดัชนีเดิมของ patient_booking_events เรียงตามหน่วยงาน+เวลา ใช้กับหน้ารายงาน
-- การอ่านเหตุผลรายคำขอต้องค้นด้วย entity_id ถ้าไม่มีดัชนีนี้ทุกครั้งที่ผู้จองเปิดหน้าจะสแกนทั้งตาราง
CREATE INDEX IF NOT EXISTS patient_booking_events_entity ON public.patient_booking_events(entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.patient_booking_mine(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); b jsonb; t jsonb;
BEGIN
 IF role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 -- คำขอที่ถูกยกเลิกพ่วง cancel_note = เหตุผลที่เจ้าหน้าที่บันทึกไว้ล่าสุด (ว่างไว้ถ้าไม่มี)
 SELECT coalesce(jsonb_agg(CASE WHEN r.status='cancelled' THEN (to_jsonb(r)-'consent_text')||jsonb_build_object('cancel_note',
   (SELECT nullif(btrim(e.detail->>'note'),'') FROM public.patient_booking_events e
     WHERE e.municipality_id=p_muni AND e.entity_id=r.id AND e.action IN ('cancel','cancel_passenger')
      AND e.actor_id<>auth.uid() AND nullif(btrim(e.detail->>'note'),'') IS NOT NULL
     ORDER BY e.created_at DESC LIMIT 1))
  ELSE to_jsonb(r)-'consent_text' END ORDER BY r.appointment_at),'[]') INTO b
 FROM (SELECT * FROM public.patient_bookings WHERE municipality_id=p_muni AND created_by=auth.uid() AND entry_channel='online'
   AND (status IN ('submitted','confirmed') OR updated_at>now()-interval '30 days')
   ORDER BY appointment_at LIMIT 200) r;
 -- เที่ยวของตัวเองใช้ projection เดียวกับที่ workspace ให้ผู้จอง: ไม่มีรายชื่อคนอื่นและไม่มีแผนภายใน
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',tr.id,'state',tr.state,'revision',tr.revision,'public_notice',tr.public_notice,
   'estimated_pickup_at',tr.estimated_pickup_at,'estimated_return_at',tr.estimated_return_at,
   'plan',tr.plan-'booking_ids'-'booking_revisions'-'settings_revision'-'seats'-'errors'-'helper_required')),'[]') INTO t
 FROM public.patient_booking_trips tr WHERE tr.municipality_id=p_muni
  AND (tr.state NOT IN ('completed','cancelled') OR tr.updated_at>now()-interval '30 days')
  AND EXISTS(SELECT 1 FROM public.patient_bookings r WHERE r.trip_id=tr.id AND r.created_by=auth.uid() AND r.entry_channel='online');
 RETURN jsonb_build_object('role',role_name,'bookings',b,'trips',t,
  'my_profile',(SELECT jsonb_build_object('full_name',full_name,'phone',phone) FROM public.profiles WHERE id=auth.uid()),
  'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT id,entity_id,message,created_at FROM public.patient_booking_notices
    WHERE municipality_id=p_muni AND recipient_id=auth.uid() ORDER BY created_at DESC LIMIT 30)n));
END $$;

-- สิทธิ์เรียกใช้คงเดิม (CREATE OR REPLACE ไม่แตะ ACL) ย้ำไว้กันพลาด
REVOKE ALL ON FUNCTION public.patient_booking_mine(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_mine(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
