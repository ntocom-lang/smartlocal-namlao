-- 20260921120000_patient_booking_staff_join.sql
--
-- ให้เจ้าหน้าที่ "ให้คำขอที่ชนคิวไปคันเดียวกับเที่ยวที่ยืนยันแล้ว" ได้ในคลิกเดียว
-- (เจ้าของระบบสั่ง 2569-09-21 ให้ทำแบบกล่องงานคำร้อง: ชนคิวแล้วต้องมีปุ่มไปต่อ ไม่ใช่ทางตัน)
--
-- ปัญหาเดิม: ptb_join_plan ผูกกับ requested_trip_id ที่ "ประชาชนกดขอร่วมเอง" จากปฏิทินเท่านั้น
-- เจ้าหน้าที่จึงรวมคำขอเข้าเที่ยวที่ยืนยันแล้วไม่ได้ ผลตรวจแผนขึ้นว่าชนคิวแล้วไม่มีทางไปต่อ
--
-- ไฟล์นี้แตะเฉพาะฟังก์ชัน ไม่เพิ่มคอลัมน์/ตาราง จึงอยู่ไฟล์เดียวได้
-- 1. ptb_join_plan_to(muni, booking, trip) = ตรรกะของ ptb_join_plan เดิมทุกบรรทัด ต่างเพียงระบุเที่ยวเองได้
-- 2. ptb_join_plan เขียนใหม่ทั้งตัวให้ส่ง requested_trip_id เข้า ptb_join_plan_to
--    พฤติกรรมเดิมทุกกรณี รวมทั้ง requested_trip_id เป็น NULL หรือคำขอไม่อยู่ในหน่วยงานนี้
--    (ยังคงปฏิเสธด้วยข้อความเดิม) ⚠️ ห้ามย่อเป็น placeholder — docs/ai/NOTES.md ข้อ 5
-- 3. patient_booking_preview_into_trip (อ่านอย่างเดียว) + patient_booking_confirm_into_trip
--    ยืนยัน = ตั้ง requested_trip_id แล้วเรียก patient_booking_confirm_join ตัวเดิม ซึ่งคำนวณแผนซ้ำ
--    ใต้ล็อกและเทียบกับแผนที่เจ้าหน้าที่เห็น แผนเปลี่ยนหรือมีข้อผิดพลาด = ปฏิเสธและย้อนกลับทั้งก้อน
--
-- เงื่อนไข "ไปด้วยกัน" ไม่ได้ผ่อนลง: ทุกคนต้องเลือกนั่งร่วมกับผู้ป่วยอื่นได้ (ความยินยอมของเจ้าของข้อมูล)
-- และเดินได้เอง ที่นั่งพอ เวลานัด/รับกลับห่างไม่เกิน 30 นาที ปลายทาง วัน และขากลับตรงกัน
-- รถยังไม่ออก คนขับยังเป็นคนเดิม · เฉพาะผู้ดูแลและผู้จัดคิว · บันทึกประวัติ staff_join ทุกครั้ง
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.ptb_plan(uuid,uuid[],text)') IS NULL
  OR to_regprocedure('public.ptb_join_plan(uuid,uuid)') IS NULL
  OR to_regprocedure('public.patient_booking_confirm_join(uuid,uuid,uuid,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Apply 20260918113759_patient_booking_calendar first';
 END IF;
END $$;

-- แผนร่วมเที่ยวของ "เที่ยวที่ระบุ" — ตรรกะเดียวกับ ptb_join_plan เดิมทุกบรรทัด
CREATE FUNCTION public.ptb_join_plan_to(p_muni uuid,p_booking uuid,p_trip uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; t public.patient_booking_trips; ids uuid[]; plan jsonb;
BEGIN
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni;
 SELECT * INTO t FROM public.patient_booking_trips WHERE id=p_trip AND municipality_id=p_muni;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL OR t.id IS NULL OR t.state<>'confirmed' OR (t.plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เที่ยวนี้ไม่เปิดร่วมแล้ว กรุณาประสานเจ้าหน้าที่'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.patient_bookings WHERE trip_id=t.id AND status='confirmed';
 IF cardinality(ids) IS NULL OR EXISTS(SELECT 1 FROM public.patient_bookings WHERE id=ANY(ids) AND (NOT share OR mobility<>'walk' OR passenger_step<>0 OR cancel_requested)) THEN RAISE EXCEPTION 'เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม กรุณาประสานเจ้าหน้าที่'; END IF;
 plan:=public.ptb_plan(p_muni,ids||p_booking,'');
 IF (plan->>'pickup_at')::timestamptz<=now() THEN RAISE EXCEPTION 'เวลาเริ่มรับของแผนร่วมเที่ยวผ่านแล้ว'; END IF;
 IF t.driver_id IS DISTINCT FROM (SELECT driver_id FROM public.patient_booking_settings WHERE municipality_id=p_muni) THEN RAISE EXCEPTION 'คนขับเปลี่ยนแล้ว ต้องประสานจัดเที่ยวใหม่ก่อนเพิ่มผู้ร่วม'; END IF;
 RETURN plan||jsonb_build_object('join_trip_id',t.id,'join_trip_revision',t.revision,'join_booking_id',p_booking);
END $$;

-- ของเดิม (ประชาชนกดขอร่วมเที่ยวจากปฏิทิน) — ส่งเที่ยวที่ประชาชนขอเข้าไปคำนวณด้วยตรรกะชุดเดียวกัน
-- คำขอไม่พบ/ไม่อยู่ในหน่วยงานนี้/ไม่ได้ขอร่วมเที่ยวใด → เที่ยวเป็น NULL → ปฏิเสธด้วยข้อความเดิม
CREATE OR REPLACE FUNCTION public.ptb_join_plan(p_muni uuid,p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN public.ptb_join_plan_to(p_muni,p_booking,
  (SELECT requested_trip_id FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni));
END $$;

CREATE FUNCTION public.patient_booking_preview_into_trip(p_muni uuid,p_booking uuid,p_trip uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์จัดคิว'; END IF;
 RETURN public.ptb_join_plan_to(p_muni,p_booking,p_trip);
END $$;

-- ⚠️ เวลารถออกรับของผู้เดินทางเดิมจะเร็วขึ้น (ขึ้นรถเพิ่ม 1 คน) หน้าจอแสดงเวลาใหม่ก่อนกดเสมอ
-- และ patient_booking_confirm_join แจ้งแผนล่าสุดให้ผู้เดินทางทุกคนกับคนขับในระบบ
CREATE FUNCTION public.patient_booking_confirm_into_trip(p_muni uuid,p_op uuid,p_booking uuid,p_trip uuid,p_expected jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.patient_bookings; joined uuid;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์ยืนยันคิว'; END IF;
 IF p_trip IS NULL OR p_expected IS NULL OR p_expected->>'join_trip_id' IS DISTINCT FROM p_trip::text
  OR p_expected->>'join_booking_id' IS DISTINCT FROM p_booking::text THEN
  RAISE EXCEPTION 'แผนหรือข้อมูลเปลี่ยนแล้ว กรุณาตรวจใหม่';
 END IF;
 PERFORM 1 FROM public.patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE;
 -- เน็ตหลุดแล้วกดซ้ำด้วยรายการเดิม: ให้ตัวเดิมตรวจเจ้าของรายการและตอบผลเดิม ไม่แตะคำขออีก
 -- ตรวจหลังได้ล็อก คำสั่งซ้ำที่มาพร้อมกันจะได้เห็นรายการของอีกฝั่งที่บันทึกเสร็จแล้ว
 IF EXISTS(SELECT 1 FROM public.patient_booking_operations WHERE id=p_op) THEN
  RETURN public.patient_booking_confirm_join(p_muni,p_op,p_booking,p_expected);
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id=p_booking AND municipality_id=p_muni FOR UPDATE;
 IF b.id IS NULL OR b.status<>'submitted' OR b.trip_id IS NOT NULL THEN RAISE EXCEPTION 'คำขอถูกจัดคิวหรือเปลี่ยนสถานะแล้ว'; END IF;
 UPDATE public.patient_bookings SET requested_trip_id=p_trip WHERE id=p_booking;
 joined:=public.patient_booking_confirm_join(p_muni,p_op,p_booking,p_expected);
 PERFORM public.ptb_audit(p_muni,p_booking,'staff_join',jsonb_build_object('trip_id',joined,'previous_requested_trip_id',b.requested_trip_id));
 RETURN joined;
END $$;

REVOKE ALL ON FUNCTION public.ptb_join_plan_to(uuid,uuid,uuid),public.ptb_join_plan(uuid,uuid),
 public.patient_booking_preview_into_trip(uuid,uuid,uuid),public.patient_booking_confirm_into_trip(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_preview_into_trip(uuid,uuid,uuid),public.patient_booking_confirm_into_trip(uuid,uuid,uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
