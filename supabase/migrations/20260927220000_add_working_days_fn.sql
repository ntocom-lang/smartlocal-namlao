-- วันกำหนดเสร็จของคำร้องนับเป็น "วันทำการ" — ขั้น 1/2: ตัวนับวันทำการ + ข้อมูลวันหยุด
--
-- 1) public.add_working_days(วันตั้งต้น, n, municipality_id) — บวก n วันทำการ ข้ามเสาร์-อาทิตย์และวันหยุด
--    ความหมายเดียวกับ addWorkingDays() ใน src/lib/workingDays.js: ไม่นับวันตั้งต้น นับวันปลายทาง
--    (ศุกร์ + 3 = พุธ) · n น้อยกว่า 1 คืนวันตั้งต้น · วันหยุดใช้แถวของ อปท. นั้นก่อน (ชนะเสมอ)
--    ถ้าไม่มีจึงดูแถวทั่วประเทศ · is_working_day = true คือ "ยกเลิกวันหยุด" นับเป็นวันทำการ
--    ปีที่ยังไม่มีข้อมูลวันหยุด นับแค่ตัดเสาร์-อาทิตย์ เหมือนหน้าเว็บ (หน้า "วันหยุดราชการ" เตือนอยู่แล้ว)
--
-- 2) คัดวันหยุดชั้น static (พ.ศ. 2568–2569, 47 วัน) จาก src/lib/workingDays.js ลงตารางเป็นแถวทั่วประเทศ
--    ตาราง public_holidays ว่างทั้งตาราง (ตรวจ production 2026-09-27) หน้าเว็บจึงใช้แค่ชั้น static
--    ถ้าไม่คัดลงมา วันกำหนดเสร็จที่ฐานข้อมูลคำนวณจะไม่ข้ามวันหยุดที่หน้าเว็บข้าม (เช่น 13 และ 23 ต.ค. 2569)
--    แล้วป้าย "เหลือ X วันทำการ" จะไม่ตรงกับวันกำหนดเสร็จ · ON CONFLICT DO NOTHING — ถ้ามีคนกรอกวันเดียวกันไว้แล้ว
--    ของเดิมชนะ · ⚠️ ปี พ.ศ. 2570 ไม่ได้คัด (ชั้น static ไม่มี) ต้องกรอกตามประกาศจริงในหน้า "วันหยุดราชการ"
--
-- ฟังก์ชันไม่ให้ client เรียกตรง — ใช้ผ่าน trigger auto_assign_complaint (SECURITY DEFINER) เท่านั้น
--
-- ตรวจหลังรัน:
--   SELECT public.add_working_days('2026-10-02', 3, NULL);   -- ศุกร์ + 3 วันทำการ = 2026-10-07 (พุธ)
--   SELECT public.add_working_days('2026-10-12', 1, NULL);   -- จันทร์ + 1 ข้าม 13 ต.ค. (วันหยุด) = 2026-10-14
--   SELECT count(*) FROM public.public_holidays WHERE municipality_id IS NULL;   -- 47 (ถ้าไม่มีใครกรอกเพิ่ม)
--
-- ย้อนกลับ (ต้องย้อนไฟล์ 20260927220100 ก่อน เพราะ trigger เรียกฟังก์ชันนี้):
--   DROP FUNCTION IF EXISTS public.add_working_days(date, integer, uuid);
--   DELETE FROM public.public_holidays
--    WHERE municipality_id IS NULL AND note = 'คัดจากชั้น static ใน src/lib/workingDays.js';

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.public_holidays') IS NULL THEN
    RAISE EXCEPTION 'ต้องมีตาราง public.public_holidays ก่อน (20260831100000_public_holidays.sql)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.add_working_days(p_start date, p_days integer, p_municipality_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_day   date    := p_start;
  v_added integer := 0;
  v_steps integer := 0;
  v_off   boolean;
BEGIN
  IF p_start IS NULL OR p_days IS NULL THEN
    RETURN NULL;
  END IF;

  -- เพดานรอบเดียวกับฝั่งเว็บ กันลูปไม่รู้จบถ้าตารางวันหยุดถูกกรอกผิดจนแทบไม่เหลือวันทำการ
  WHILE v_added < p_days AND v_steps < p_days * 7 + 400 LOOP
    v_day   := v_day + 1;
    v_steps := v_steps + 1;
    CONTINUE WHEN extract(isodow FROM v_day) >= 6;   -- 6 = เสาร์, 7 = อาทิตย์

    -- แถวของ อปท. มาก่อนแถวทั่วประเทศ (ลำดับทับเดียวกับ rebuild() ใน src/lib/workingDays.js)
    SELECT NOT h.is_working_day INTO v_off
    FROM public.public_holidays h
    WHERE h.holiday_date = v_day
      AND (h.municipality_id = p_municipality_id OR h.municipality_id IS NULL)
    ORDER BY (h.municipality_id IS NULL)
    LIMIT 1;

    IF NOT FOUND OR NOT v_off THEN
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RETURN v_day;
END;
$$;

REVOKE ALL ON FUNCTION public.add_working_days(date, integer, uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.public_holidays (municipality_id, holiday_date, name, is_working_day, note)
VALUES
  (NULL, '2025-01-01', 'วันขึ้นปีใหม่', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-02-12', 'วันมาฆบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-04-06', 'วันจักรี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-04-07', 'ชดเชยวันจักรี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-04-13', 'วันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-04-14', 'วันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-04-15', 'วันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-04-16', 'ชดเชยวันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-05-04', 'วันฉัตรมงคล', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-05-05', 'ชดเชยวันฉัตรมงคล', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-05-09', 'วันพืชมงคล', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-05-11', 'วันวิสาขบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-05-12', 'ชดเชยวันวิสาขบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-06-02', 'วันหยุดราชการกรณีพิเศษ (มติ ครม.)', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-07-10', 'วันอาสาฬหบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-07-11', 'วันเข้าพรรษา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-08-11', 'วันหยุดราชการกรณีพิเศษ (มติ ครม.)', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง / วันแม่แห่งชาติ', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-10-13', 'วันนวมินทรมหาราช', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-10-23', 'วันปิยมหาราช', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-12-10', 'วันรัฐธรรมนูญ', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2025-12-31', 'วันสิ้นปี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-01-01', 'วันขึ้นปีใหม่', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-01-02', 'วันหยุดราชการกรณีพิเศษ (มติ ครม.)', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-03-03', 'วันมาฆบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-04-06', 'วันจักรี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-04-13', 'วันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-04-14', 'วันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-04-15', 'วันสงกรานต์', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-05-04', 'วันฉัตรมงคล', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-05-13', 'วันพืชมงคล', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-05-31', 'วันวิสาขบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-06-01', 'ชดเชยวันวิสาขบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-07-28', 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-07-29', 'วันอาสาฬหบูชา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-07-30', 'วันเข้าพรรษา', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-08-12', 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง / วันแม่แห่งชาติ', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-10-13', 'วันนวมินทรมหาราช', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-10-23', 'วันปิยมหาราช', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-12-05', 'วันคล้ายวันพระบรมราชสมภพ ร.9 / วันพ่อแห่งชาติ', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-12-07', 'ชดเชยวันคล้ายวันพระบรมราชสมภพ ร.9', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-12-10', 'วันรัฐธรรมนูญ', false, 'คัดจากชั้น static ใน src/lib/workingDays.js'),
  (NULL, '2026-12-31', 'วันสิ้นปี', false, 'คัดจากชั้น static ใน src/lib/workingDays.js')
ON CONFLICT (holiday_date) WHERE municipality_id IS NULL DO NOTHING;

COMMIT;
