-- 20261116100100_list_events_for_staff_between.sql
--
-- กิจกรรมปฏิทินเฉพาะช่วงวัน — ใช้กับ "กำหนดการ 7 วัน" ในห้องผู้บริหาร (code review PR #685 ข้อ 3)
--   เดิม: หน้าเว็บเรียก list_events_for_staff() ซึ่งคืนกิจกรรม "ทุกช่วงเวลา" ของ อปท. พร้อมรายละเอียด ไฟล์แนบ ผู้รับมอบหมาย
--         แล้วกรองเหลือ 7 วันฝั่งเบราว์เซอร์ — ขนาดคำตอบโตตามจำนวนกิจกรรมสะสมทุกปี กิน Egress แผนฟรี (ข้อ 15 NOTES.md)
--   ใหม่: ห่อ list_events_for_staff() ตัวเดิม — ไม่เขียนกติกาการมองเห็นซ้ำ ใครเห็นกิจกรรมไหนเหมือนหน้าปฏิทินทุกประการ
--         (แก้กติกาที่ list_events_for_staff ที่เดียว ตัวนี้ตามไปเอง) กรองเฉพาะกิจกรรมที่คาบเกี่ยวช่วง [p_from, p_to]
--         รวมกิจกรรมหลายวันที่เริ่มก่อนช่วง · คืนแค่ id / title / event_date / end_date / event_time
--         ไม่มีรายละเอียด ไฟล์แนบ ผู้สร้าง หรือผู้รับมอบหมายติดออกมาเลย (หน้าผู้บริหารไม่ได้ใช้)
--
-- SECURITY INVOKER: ไม่มีสิทธิ์พิเศษของตัวเอง — สิทธิ์ทั้งหมดมาจาก list_events_for_staff (DEFINER ตรวจผู้เรียกด้วย auth.uid())
--   ผลลัพธ์จึงเป็นเซตย่อยของสิ่งที่ผู้เรียกได้จาก list_events_for_staff อยู่แล้วเสมอ · anon เรียกไม่ได้ทั้งสองตัว
-- ช่วงยาวไม่เกิน 400 วัน (เหมือน exec_summary_*) · ช่วงผิดรูปแบบ = 22023
-- ⚠️ ข้อจำกัดที่รู้: ฐานยังคำนวณ list_events_for_staff ทั้งชุดก่อนกรอง (ฟังก์ชัน DEFINER ไม่ถูก inline) — ลด Egress/เวลาโหลดหน้า
--    ได้ แต่ CPU ฐานเท่าเดิม · กิจกรรมหลักพันแถวต่อ อปท. ยังเร็ว ถ้าโตถึงหลักหมื่นค่อยย้ายตัวกรองวันเข้าไปใน list_events_for_staff
--
-- ไม่มี ADD COLUMN / CREATE TABLE (ข้อ 3 NOTES.md) · ฟังก์ชันใหม่ ไม่ทับของเดิม
-- ย้อนกลับ: DROP FUNCTION public.list_events_for_staff_between(uuid, date, date);
--   (หน้าเว็บรุ่นนี้เรียกตัวนี้ — ย้อนต้องย้อนโค้ด useExecSchedule ด้วย ไม่งั้นกำหนดการขึ้น "โหลดไม่ได้")
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT has_function_privilege('authenticated', 'public.list_events_for_staff_between(uuid,date,date)', 'EXECUTE') AS auth_exec,
--          has_function_privilege('anon', 'public.list_events_for_staff_between(uuid,date,date)', 'EXECUTE') AS anon_exec,
--          (SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_events_for_staff_between(uuid,date,date)'::regprocedure) AS definer;
--   → true / false / false

DO $$
BEGIN
  IF to_regprocedure('public.list_events_for_staff(uuid)') IS NULL THEN
    RAISE EXCEPTION 'list_events_for_staff_between: ไม่พบ list_events_for_staff(uuid) — ต้อง apply 20261001120100_event_assignments_rpc.sql ก่อน';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.list_events_for_staff_between(p_municipality_id uuid, p_from date, p_to date)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT jsonb_build_object(
             'id',         ev -> 'id',
             'title',      ev -> 'title',
             'event_date', ev -> 'event_date',
             'end_date',   ev -> 'end_date',
             'event_time', ev -> 'event_time'
           )
    FROM public.list_events_for_staff(p_municipality_id) AS ev
    WHERE (ev ->> 'event_date')::date <= p_to
      AND COALESCE(ev ->> 'end_date', ev ->> 'event_date')::date >= p_from
    ORDER BY (ev ->> 'event_date')::date, ev ->> 'event_time' NULLS LAST, ev ->> 'title';
END;
$$;

-- ข้อ 5 NOTES.md: ฟังก์ชันใหม่ได้ EXECUTE ให้ PUBLIC (และ anon ผ่าน default privileges ของ Supabase) ทันที — ถอนทั้งสองก่อนให้ authenticated
REVOKE ALL ON FUNCTION public.list_events_for_staff_between(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_events_for_staff_between(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.list_events_for_staff_between(uuid, date, date) IS
  'กิจกรรมปฏิทินที่คาบเกี่ยวช่วงวัน [p_from, p_to] (ไม่เกิน 400 วัน) — ห่อ list_events_for_staff (สิทธิ์การมองเห็นชุดเดียวกัน) '
  'คืนเฉพาะ id/title/event_date/end_date/event_time · SECURITY INVOKER · ใช้ที่กำหนดการ 7 วันของห้องผู้บริหาร (E2.1)';

NOTIFY pgrst, 'reload schema';
