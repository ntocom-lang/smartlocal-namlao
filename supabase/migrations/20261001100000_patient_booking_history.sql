BEGIN;

-- ประวัติการดำเนินการของคำขอรถหนึ่งใบ: ใครกดอะไร เมื่อไร (เจ้าของระบบสั่ง 2569-10-01 แบบ ก)
-- อ่านอย่างเดียวจาก patient_booking_events ที่ ptb_audit เขียนไว้ทุกคำสั่งตั้งแต่เปิดระบบ — ไม่บันทึกอะไรเพิ่ม
-- เห็นเฉพาะแอดมินและผู้ยืนยันคิว (กลุ่มเดียวกับแท็บรายงาน) เพราะเหตุผลที่เจ้าหน้าที่พิมพ์อาจมีข้อมูลสุขภาพ
-- ส่งออกเฉพาะชื่อเหตุการณ์ เวลา ชื่อผู้กด เหตุผล และชื่อคนขับ — ไม่ส่ง before/after ของเวลานัด จุดรับ หรือแผนเที่ยว
--
-- เหตุการณ์ผูกไว้ 2 ระดับ:
--  1) ของคำขอนี้เอง (entity_id = คำขอ) หรือของเที่ยวที่ระบุคำขอนี้ไว้ใน detail (ยืนยันรถ ร่วมเที่ยว ย้ายเที่ยว เปลี่ยนวันเวลา)
--  2) ของเที่ยวที่คำขอนี้อยู่ (ออกรถ จบงาน เหตุขัดข้อง คืนคิว เปลี่ยนคนขับ เอกสาร) เฉพาะช่วงที่อยู่ในเที่ยวจริง
--     ⚠️ ไม่งั้นคนที่ถูกนำออกจากเที่ยวไปแล้วจะเห็น "ออกรถ" ของเที่ยวนั้น และคนที่เข้าร่วมทีหลังจะเห็นเหตุการณ์ก่อนตัวเองเข้า
--     เหตุการณ์ของเที่ยวที่ระบุคำขอรายใบ (booking_id/booking_ids/new_booking_ids) เป็นของคำขอนั้นเท่านั้น ไม่ใช่ของทุกคนในเที่ยว
CREATE FUNCTION public.patient_booking_history(p_muni uuid, p_booking uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE b public.patient_bookings; out_events jsonb;
BEGIN
 IF public.ptb_role(p_muni) NOT IN ('admin', 'coordinator') THEN
  RAISE EXCEPTION 'เฉพาะเจ้าหน้าที่จัดคิวเท่านั้น';
 END IF;
 SELECT * INTO b FROM public.patient_bookings WHERE id = p_booking AND municipality_id = p_muni;
 IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบคำขอนี้'; END IF;
 WITH named AS (
  SELECT e.* FROM public.patient_booking_events e
  WHERE e.municipality_id = p_muni AND (e.entity_id = b.id
   OR e.detail->>'booking_id' = b.id::text
   OR coalesce(e.detail->'booking_ids', '[]'::jsonb) ? b.id::text
   OR coalesce(e.detail->'new_booking_ids', '[]'::jsonb) ? b.id::text)
 ), trips AS (
  -- เที่ยวที่คำขออยู่ตอนนี้ หรืออยู่จนเที่ยวถูกคืนคิว (ย้ายเที่ยว/เปลี่ยนวัน/เปลี่ยนโรงพยาบาล ระบบตัดชื่อออกจาก booking_ids แล้ว)
  -- joined_at = เวลาที่คำขอเข้าเที่ยวนั้น ไม่มีบันทึก (ข้อมูลเก่า) = ไม่ตัดช่วงต้น
  SELECT tr.id, (SELECT min(n.created_at) FROM named n WHERE n.entity_id = tr.id
    OR (n.entity_id = b.id AND n.detail->>'trip_id' = tr.id::text)) AS joined_at
  FROM public.patient_booking_trips tr
  WHERE tr.municipality_id = p_muni AND (tr.id = b.trip_id OR b.id = ANY(tr.booking_ids))
 ), removed AS (
  -- นำออกจากเที่ยวแล้ว คำขอยังผูก trip_id เดิมไว้ — เหตุการณ์ของเที่ยวหลังจากนั้นไม่ใช่ของคำขอนี้
  SELECT max(n.created_at) AS at FROM named n WHERE n.entity_id = b.id AND n.action = 'cancel_passenger'
 ), trip_events AS (
  SELECT e.* FROM public.patient_booking_events e JOIN trips t ON t.id = e.entity_id
  WHERE e.municipality_id = p_muni
   AND NOT (e.detail ? 'booking_id' OR e.detail ? 'booking_ids' OR e.detail ? 'new_booking_ids')
   -- เปลี่ยนวันเวลารายคน: เที่ยวเดิมบันทึก rescheduled คนที่ย้ายได้ rescheduled_from ที่ระบุชื่อแทน คนที่เหลือในเที่ยวไม่ได้ถูกเปลี่ยน
   AND e.action <> 'rescheduled'
   AND (t.joined_at IS NULL OR e.created_at >= t.joined_at)
   AND (b.status <> 'cancelled' OR b.trip_id IS DISTINCT FROM t.id
    OR (SELECT r.at FROM removed r) IS NULL OR e.created_at <= (SELECT r.at FROM removed r))
 ), merged AS (
  SELECT * FROM named UNION SELECT * FROM trip_events
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id', m.id,
   'action', m.action,
   'at', m.created_at,
   'actor_name', coalesce(nullif(btrim(p.full_name), ''), 'ไม่ทราบชื่อ'),
   -- คำขอที่เจ้าหน้าที่รับแทน created_by = เจ้าหน้าที่ที่รับสาย ไม่ใช่ผู้จอง
   'by_booker', m.actor_id = b.created_by AND b.entry_channel = 'online',
   'entry_channel', m.detail->>'entry_channel',
   'note', nullif(btrim(coalesce(m.detail->>'note', m.detail->>'reason', '')), ''),
   -- แอดมินบันทึกงานของคนขับแทนได้ (20260929130000 เก็บ driver_id/driver_name ไว้) — บอกชื่อคนขับจริงเมื่อผู้กดไม่ใช่คนขับ
   'for_driver', CASE WHEN m.action IN ('trip_next', 'trip_finish', 'issue', 'passenger_next')
     AND m.detail ? 'driver_id' AND m.detail->>'driver_id' IS DISTINCT FROM m.actor_id::text THEN m.detail->>'driver_name' END,
   'driver_before', CASE WHEN m.action = 'driver_reassigned' THEN m.detail#>>'{before,name}' END,
   'driver_after', CASE WHEN m.action = 'driver_reassigned' THEN m.detail#>>'{after,name}' END
  ) ORDER BY m.created_at, m.id), '[]'::jsonb) INTO out_events
 FROM merged m LEFT JOIN public.profiles p ON p.id = m.actor_id;
 RETURN jsonb_build_object('events', out_events);
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_history(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patient_booking_history(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
