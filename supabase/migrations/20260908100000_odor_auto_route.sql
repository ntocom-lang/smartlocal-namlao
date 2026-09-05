-- 20260908100000_odor_auto_route.sql
--
-- [เปลี่ยนสายงาน] หมวดเฉพาะกิจ (is_adhoc, ตอนนี้คือ odor) เลิกใช้ปุ่ม "รับทราบ" ของผู้รับผิดชอบ
-- ระบบรับเรื่องให้อัตโนมัติตั้งแต่วินาทีที่ยื่น ผู้รับผิดชอบเปลี่ยนบทบาทเป็น "ดูรายงาน" อย่างเดียว
--
-- ⚠️ ทำไมไม่ใช้ acknowledged_at เดิมแล้วให้ระบบเขียนให้เอง
--   acknowledged_by ถูกออกแบบไว้เป็น "หลักฐานว่าใครรับเรื่องนี้ไปดำเนินการ" (ดู 20260902110000)
--   ถ้าระบบเขียนแทน = ประชาชนเห็น "เจ้าหน้าที่รับทราบแล้ว" ทั้งที่ไม่มีใครเห็นเรื่อง และถ้าเรื่อง
--   บานปลายจนต้องสอบข้อเท็จจริง จะมีหลักฐานชี้ไปที่เจ้าหน้าที่ที่ไม่เคยเปิดดู — เป็นประเด็นวินัย/
--   ป.ป.ช. ได้จริง จึงใช้คีย์ใหม่ routed_at ที่พูดตรงกับสิ่งที่เกิดขึ้นจริง: "ระบบรับเรื่องแล้ว"
--
-- ⚠️ ทำไมไม่เก็บ routed_to (ผู้รับผิดชอบ ณ ตอนรับเรื่อง)
--   complaints.assigned_to มีอยู่แล้วและ reassign_staff_workload() แก้ค่านั้นเมื่อเจ้าหน้าที่ย้าย
--   สำเนาใน jsonb จะไม่ถูกแก้ตาม กลายเป็นข้อมูลสองชุดที่ขัดกันเอง — เก็บแค่ "เมื่อไหร่" อย่างเดียว
--
-- ไม่ลบ acknowledged_at/acknowledged_by ของเรื่องเก่า และไม่ถอน acknowledge_odor_complaint()
-- ออกจากฐานข้อมูล — ค่าเดิมคือหลักฐานว่ามีคนกดจริงในช่วงที่ยังใช้ปุ่มนั้นอยู่ ลบทิ้งคือทำลายร่องรอย
-- ฝั่ง UI แค่เลิกแสดงเป็นสถานะหลักเท่านั้น

-- ── 1) trigger: หมวดเฉพาะกิจได้ routed_at ตั้งแต่ INSERT ──────────────────────
-- ทำไมเป็น trigger แยกตัวใหม่ ไม่ไปแก้ auto_assign_complaint()
--   auto_assign_complaint() เป็น trigger ร่วมของ "ทุกหมวด" การ CREATE OR REPLACE ทับหมายถึง
--   เขียนใหม่ทั้งฟังก์ชัน ถ้าพลาดบรรทัดเดียวคือคำร้องทุกหมวดของทุก อปท. เสียการมอบหมาย
--   (เคสเดียวกับ profiles guard trigger ที่เคยพังทั้งระบบ) — ตัวใหม่แยกอิสระ พังก็พังเฉพาะหมวดนี้
--
-- ชื่อ trigger ต้องเรียงหลัง complaints_auto_assign เพราะ BEFORE trigger ของ Postgres ยิงตาม
-- ลำดับตัวอักษรของชื่อ และตัวนี้ไม่ควรทำงานก่อนที่ assigned_to จะถูกเติม ('t' > 'c' จึงปลอดภัย)
CREATE OR REPLACE FUNCTION public.route_adhoc_complaint()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- หมวดปกติ: ไม่แตะเลย ยังเดิน status pipeline เดิมทุกประการ
  IF NOT public.complaint_category_is_adhoc(NEW.municipality_id, NEW.category) THEN
    RETURN NEW;
  END IF;

  -- เวลามาจาก now() ของเซิร์ฟเวอร์เสมอ ไม่ใช่นาฬิกาเครื่องผู้แจ้ง
  -- submit_citizen_complaint_v4 กัน key นี้ไม่ให้ client ส่งมาเองอยู่แล้ว (ไมเกรชันถัดไป)
  -- ที่นี่ยังเขียนทับซ้ำอีกชั้นเผื่อมีเส้นทาง INSERT อื่นในอนาคตที่ไม่ผ่าน RPC นั้น
  NEW.extra_data := coalesce(NEW.extra_data, '{}'::jsonb)
                    || jsonb_build_object('routed_at', to_jsonb(now()));

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.route_adhoc_complaint() IS
  'คำร้องหมวดเฉพาะกิจ (is_adhoc): ระบบรับเรื่องอัตโนมัติตอน INSERT โดยประทับ extra_data.routed_at จาก now() ของเซิร์ฟเวอร์ ไม่ใช่การรับทราบของบุคคล';

DROP TRIGGER IF EXISTS trg_route_adhoc_complaint ON public.complaints;
CREATE TRIGGER trg_route_adhoc_complaint
BEFORE INSERT ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.route_adhoc_complaint();

-- ── 2) backfill เรื่องเก่า ─────────────────────────────────────────────────────
-- ใช้ created_at ไม่ใช่ now() เพราะเรื่องเก่าถูกส่งถึงผู้รับผิดชอบไปแล้วจริงตั้งแต่วันที่แจ้ง
-- (auto_assign_complaint เติม assigned_to ให้ตั้งแต่ INSERT มาตลอด) ถ้าประทับเป็น now() รายงาน
-- จะเห็นเรื่องปี 2568 ทั้งกองรับเรื่องพร้อมกันวันนี้ ซึ่งผิดข้อเท็จจริง
--
-- ⚠️ ต้องปิด trg_guard_adhoc_complaint_write ชั่วคราว: guard ตัวนั้นบล็อกการแก้ extra_data ของ
-- หมวดเฉพาะกิจทุกทางยกเว้นผ่าน acknowledge_odor_complaint() ที่ตั้งธง app.odor_ack ไว้ ซึ่งไมเกรชัน
-- นี้ไม่ได้รันในบริบทนั้น (get_my_role() เป็น NULL ตอนรันไมเกรชัน = ไม่ใช่ admin) จะโดน 42501
-- ทั้ง DISABLE/ENABLE และ UPDATE อยู่ในทรานแซกชันเดียวกัน ถ้าไมเกรชันล้ม trigger กลับมาเองอัตโนมัติ
-- เลือกวิธีนี้แทนการเปิดธงใหม่ถาวรในตัว guard เพราะเป็นงานครั้งเดียว ไม่ควรทิ้งช่องไว้ให้ใช้ซ้ำ
ALTER TABLE public.complaints DISABLE TRIGGER trg_guard_adhoc_complaint_write;

UPDATE public.complaints AS c
SET extra_data = coalesce(c.extra_data, '{}'::jsonb)
                 || jsonb_build_object('routed_at', to_jsonb(c.created_at))
WHERE public.complaint_category_is_adhoc(c.municipality_id, c.category)
  AND (c.extra_data -> 'routed_at') IS NULL;

ALTER TABLE public.complaints ENABLE TRIGGER trg_guard_adhoc_complaint_write;

-- ── 3) นิยาม "งานค้าง" ของหมวดเฉพาะกิจ ────────────────────────────────────────
-- complaint_is_open() ใช้ acknowledged_at IS NULL เป็นตัวชี้วัดอยู่ (20260827100000 → แก้ที่
-- 20260827120000) และ delete_user_by_id() ใช้ค่านี้กันไม่ให้ลบบัญชีเจ้าหน้าที่ที่ยังถือของค้าง
-- พอระบบรับเรื่องเองทุกใบ เงื่อนไขเดิมจะกลายเป็น "ไม่มีงานค้างเลยตลอดกาล" = ลบบัญชีคนที่ถือคำร้อง
-- กลิ่นอยู่ 20 เรื่องได้เงียบๆ แล้วเรื่องพวกนั้นหายไปจากสายตาทุกคน (assigned_to ถูก SET NULL)
--
-- ⚠️ ค่า 30 วันเป็นเกณฑ์ชั่วคราวที่ตั้งขึ้นเอง ไม่ได้อ้างอิงระเบียบใด — สายงานนี้ยังไม่มีจุดที่
-- บันทึกว่า "ตรวจสอบเสร็จแล้ว" เลยไม่มีสัญญาณปิดงานจริงให้ใช้ ถ้าเลือกอีกทางคือ "ค้างตลอดไป"
-- จะลบบัญชีเจ้าหน้าที่ที่เคยถือหมวดนี้ไม่ได้อีกเลย ทั้งสองทางแย่กว่านี้
-- ต้องกลับมาแก้ตอนเพิ่มช่องบันทึกผลการตรวจสอบ แล้วเปลี่ยนไปใช้สัญญาณนั้นแทนอายุคำร้อง
CREATE OR REPLACE FUNCTION public.complaint_is_open(c public.complaints)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.complaint_category_is_adhoc(c.municipality_id, c.category)
    THEN c.created_at >= now() - interval '30 days'
    ELSE c.status NOT IN ('done', 'closed', 'rejected', 'completed')
  END
$$;

REVOKE EXECUTE ON FUNCTION public.complaint_is_open(public.complaints) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complaint_is_open(public.complaints) TO authenticated;

COMMENT ON FUNCTION public.complaint_is_open(public.complaints) IS
  'คำร้องแถวนี้ยังต้องมีคนตามหรือไม่: หมวดปกติดูจาก status; หมวดเฉพาะกิจ (is_adhoc) ไม่มีสัญญาณปิดงาน จึงใช้อายุคำร้อง 30 วันเป็นเกณฑ์ชั่วคราวจนกว่าจะมีช่องบันทึกผลการตรวจสอบ';

-- ตรวจหลัง apply:
--   select count(*) filter (where extra_data ? 'routed_at') as routed,
--          count(*) as total
--     from public.complaints c
--    where public.complaint_category_is_adhoc(c.municipality_id, c.category);
--   → routed ต้องเท่ากับ total
--
--   ยื่นคำร้อง odor ใหม่ 1 ใบผ่านฟอร์ม แล้ว:
--   select extra_data -> 'routed_at' from public.complaints order by created_at desc limit 1;
--   → ต้องได้เวลาปัจจุบัน ไม่ใช่ null
