-- 20261012130000_staff_home_summary_rpc.sql
--
-- สรุปหน้าแรกเจ้าหน้าที่ (/staff แท็บ "แดชบอร์ด") — เรียกครั้งเดียวต่อการเปิดหน้า คืนเฉพาะตัวเลข/รายการของ "ตัวผู้เรียกเอง"
--   1) complaint_due : คำร้องที่มอบหมายให้ฉันและยังไม่เสร็จ (received/in_progress) จัดกลุ่มตามวันกำหนดเสร็จ
--                      ฝั่งหน้าเว็บแปลงเป็น "เลยกำหนด / ครบภายใน 1 วันทำการ" เอง ด้วยตารางวันหยุดชุดเดียวกับทุกหน้า
--                      (src/lib/workingDays.js) — ไม่คำนวณวันทำการใน SQL เพื่อไม่ให้มีสองสูตรที่ต้องแก้คู่กัน
--   2) my_events     : กิจกรรมในปฏิทินที่ "มอบหมายให้ฉัน" (event_assignments.profile_id) ซึ่งตกในวันนี้–พรุ่งนี้
--   3) today         : วันที่ปัจจุบันตามเวลาไทยจากฐานข้อมูล (หน้าเว็บใช้ตัดสินเลยกำหนด ไม่เชื่อนาฬิกาเครื่องผู้ใช้)
--
-- ทำไม SECURITY DEFINER: กิจกรรมที่มอบหมายให้ฉันอาจอยู่นอกกลุ่มเป้าหมายของกิจกรรม (เช่น ผอ.กองที่ถูกส่งไปประชุมแทน
-- นายกในกิจกรรมกลุ่ม "ผู้บริหาร") ซึ่ง RLS ของ events ไม่ให้อ่านตรงๆ — list_events_for_staff ต้อง DEFINER ด้วยเหตุผลเดียวกัน
-- ความปลอดภัยจึงอยู่ที่เงื่อนไขในตัวฟังก์ชันทั้งหมด:
--   - ผู้เรียกต้องเป็นบุคลากร (ไม่ใช่ประชาชน) ของ อปท. เดียวกับ p_muni (superadmin ข้ามได้) ไม่งั้น 42501
--   - ทุกแถวที่คืนต้องผูกกับ auth.uid() ของผู้เรียก (assigned_to / profile_id) — ไม่มีทางอ่านงานของคนอื่น
--   - คืนเฉพาะจำนวน + ชื่อกิจกรรม/เวลา/สถานที่/ภารกิจ ไม่คืนรายละเอียดคำร้องหรือชื่อประชาชน (PDPA)
--
-- ไฟล์เดียวพอ: ไม่มี ADD COLUMN/CREATE TABLE ในไฟล์นี้ (ข้อ 3 ของ docs/ai/NOTES.md) มีด่านตรวจว่าตาราง/คอลัมน์ที่อ้างมีจริง
-- ฟังก์ชันใหม่ ไม่ใช่ CREATE OR REPLACE ทับของเดิม — ย้อนกลับ: DROP FUNCTION public.staff_home_summary(uuid);
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT has_function_privilege('anon', 'public.staff_home_summary(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.staff_home_summary(uuid)', 'EXECUTE');   → false, true

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'municipality_id'), ('complaints', 'assigned_to'), ('complaints', 'status'), ('complaints', 'due_date'),
    ('events', 'municipality_id'), ('events', 'title'), ('events', 'event_date'), ('events', 'event_time'),
    ('events', 'end_date'), ('events', 'location'),
    ('event_assignments', 'event_id'), ('event_assignments', 'profile_id'), ('event_assignments', 'task'),
    ('profiles', 'role'), ('profiles', 'municipality_id')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'staff_home_summary: ไม่พบคอลัมน์ % (ต้อง apply migration event_assignments ก่อน)', v_missing;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_home_summary(p_muni uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_muni   uuid;
  v_today  date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_due    jsonb;
  v_events jsonb;
BEGIN
  SELECT p.role, p.municipality_id
    INTO v_role, v_muni
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  -- บุคลากรเท่านั้น (ชุดเดียวกับ policy "event assignments read internal") และต้องเป็น อปท. ของตัวเอง
  IF v_uid IS NULL OR p_muni IS NULL OR v_role IS NULL
     OR v_role NOT IN ('superadmin', 'admin', 'officer', 'viewer', 'council', 'staff', 'technician')
     OR (v_role <> 'superadmin' AND v_muni IS DISTINCT FROM p_muni) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูสรุปหน้าแรกของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  -- เฉพาะที่ "เริ่มงานได้/กำลังทำ" — pending ยังกดเริ่มดำเนินการไม่ได้ (ดูเหตุผลที่ badge ใน StaffDashboard.jsx)
  -- คำร้องหมวดเฉพาะกิจค้าง pending ตลอด จึงไม่ปนเข้ามาเอง
  SELECT COALESCE(jsonb_agg(jsonb_build_object('due', d.due_date, 'n', d.n) ORDER BY d.due_date NULLS LAST), '[]'::jsonb)
    INTO v_due
  FROM (
    SELECT c.due_date, count(*)::int AS n
    FROM public.complaints AS c
    WHERE c.municipality_id = p_muni
      AND c.assigned_to = v_uid
      AND c.status IN ('received', 'in_progress')
    GROUP BY c.due_date
  ) AS d;

  -- กิจกรรมที่คาบเกี่ยววันนี้–พรุ่งนี้ (กิจกรรมหลายวันที่กำลังจัดอยู่ก็นับ) · event_assignments_event_profile_uniq
  -- รับประกันว่าคนเดียวไม่ซ้ำในกิจกรรมเดียว จึงไม่ต้อง DISTINCT · เพดาน 10 รายการกันหน้าแรกยาวผิดปกติ
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'date', x.event_date, 'time', x.event_time,
           'end_date', x.end_date, 'location', x.location, 'task', x.task
         ) ORDER BY x.event_date, x.event_time NULLS LAST, x.title), '[]'::jsonb)
    INTO v_events
  FROM (
    SELECT e.id, e.title, e.event_date, e.event_time, e.end_date, e.location, ea.task
    FROM public.event_assignments AS ea
    JOIN public.events AS e ON e.id = ea.event_id
    WHERE ea.profile_id = v_uid
      AND e.municipality_id = p_muni
      AND e.event_date <= v_today + 1
      AND COALESCE(e.end_date, e.event_date) >= v_today
    ORDER BY e.event_date, e.event_time NULLS LAST, e.title
    LIMIT 10
  ) AS x;

  RETURN jsonb_build_object('today', v_today, 'complaint_due', v_due, 'my_events', v_events);
END;
$$;

-- Supabase แจก EXECUTE ให้ anon/authenticated อัตโนมัติกับฟังก์ชันใหม่ใน public — ถอน anon เอง
REVOKE ALL ON FUNCTION public.staff_home_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_home_summary(uuid) TO authenticated;

COMMENT ON FUNCTION public.staff_home_summary(uuid) IS
  'สรุปหน้าแรกเจ้าหน้าที่ของผู้เรียกเอง: คำร้องที่ถือค้างจัดกลุ่มตามกำหนดเสร็จ + กิจกรรมที่มอบหมายให้ในวันนี้-พรุ่งนี้ '
  'ไม่คืนข้อมูลของคนอื่น ไม่คืนรายละเอียดคำร้อง';

NOTIFY pgrst, 'reload schema';
