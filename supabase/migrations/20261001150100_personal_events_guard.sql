-- รายการส่วนตัวในปฏิทิน — เฟส 2: กติกา 3 ข้อที่เจ้าของระบบสั่ง 2569-10-01 บังคับที่ฐานข้อมูล
-- แยกไฟล์จาก 20261001150000 ตามกติกา "1 ไฟล์ = 1 เฟส" (docs/ai/NOTES.md ข้อ 3)
--
--   1) ลงล่วงหน้าได้ไม่เกิน 1 ปี                         → เกินปฏิเสธด้วย SQLSTATE PE002
--   2) 100 รายการต่อคนต่อ อปท. เต็มแล้วเขียนทับต่อได้เลย  → ลบรายการที่ผ่านไปแล้วและเก่าที่สุดให้เอง
--   3) รายการ "ทุกปี" (เช่น วันเกิด) ไม่ถูกทับ             → หายเมื่อเจ้าของลบเองเท่านั้น
--
-- จุดกันพลาดของข้อ 2: ทับเฉพาะรายการที่ "ผ่านไปแล้ว" — ถ้าทั้ง 100 รายการเป็นรายการล่วงหน้าหรือ "ทุกปี"
-- จะไม่ทับ แต่ปฏิเสธด้วย SQLSTATE PE001 ให้เจ้าของลบเอง ไม่งั้นนัดที่ยังไม่ถึงจะหายไปเงียบๆ
-- โดยไม่มีใครเห็น (แอดมินมองตารางนี้ไม่ได้ จึงไม่มีใครช่วยตามให้)
--
-- ⚠️ ลำดับการเรียงของ "รายการที่จะถูกทับ" ต้องตรงกับ overwriteCandidate() ใน src/lib/personalEvents.js
-- เพราะฟอร์มบอกผู้ใช้ล่วงหน้าว่ารายการไหนจะหาย — แก้ที่หนึ่งต้องแก้อีกที่ (มีเทสต์เทียบทั้งสองฝั่ง)

DO $$
BEGIN
  IF to_regclass('public.personal_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261001150000_personal_events_table.sql ก่อน';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.personal_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- เพดานต่อคนต่อ อปท. — ต้องตรงกับ PERSONAL_LIMIT ใน src/lib/personalEvents.js
  v_limit   constant int := 100;
  -- "วันนี้" ตามเวลาไทย เซิร์ฟเวอร์เป็น UTC ถ้าใช้ current_date ช่วง 00:00–07:00 น. จะได้เมื่อวาน
  v_today   date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_horizon date := (v_today + interval '1 year')::date;
  v_count   int;
  v_need    int;
  v_removed int;
BEGIN
  IF NEW.event_date > v_horizon OR COALESCE(NEW.end_date, NEW.event_date) > v_horizon THEN
    RAISE EXCEPTION 'รายการส่วนตัวลงล่วงหน้าได้ไม่เกิน 1 ปี ถ้าเป็นเรื่องที่เกิดทุกปี ให้เลือก "ทุกปี"'
      USING ERRCODE = 'PE002';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_count
      FROM public.personal_events
     WHERE owner_id = NEW.owner_id
       AND municipality_id = NEW.municipality_id;

    IF v_count >= v_limit THEN
      v_need := v_count - v_limit + 1;

      WITH victims AS (
        SELECT id
          FROM public.personal_events
         WHERE owner_id = NEW.owner_id
           AND municipality_id = NEW.municipality_id
           AND NOT repeat_yearly
           AND COALESCE(end_date, event_date) < v_today
         ORDER BY COALESCE(end_date, event_date), created_at, id
         LIMIT v_need
      )
      DELETE FROM public.personal_events p
       USING victims v
       WHERE p.id = v.id;
      GET DIAGNOSTICS v_removed = ROW_COUNT;

      -- ทับได้ไม่ครบ = ที่เหลือเป็นรายการล่วงหน้าหรือ "ทุกปี" ทั้งหมด — exception ย้อนการลบข้างบนให้ด้วย
      IF v_removed < v_need THEN
        RAISE EXCEPTION 'รายการส่วนตัวครบ % รายการแล้ว และเป็นรายการล่วงหน้าหรือรายการ "ทุกปี" ทั้งหมด กรุณาลบรายการที่ไม่ใช้ก่อน', v_limit
          USING ERRCODE = 'PE001';
      END IF;
    END IF;

    NEW.created_at := now();
  ELSE
    -- เจ้าของและเวลาที่สร้างเปลี่ยนไม่ได้ (ลำดับการทับอิง created_at)
    NEW.owner_id   := OLD.owner_id;
    NEW.created_at := OLD.created_at;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ใช้เป็น trigger เท่านั้น ไม่ต้องเปิดให้หน้าเว็บเรียกตรง
REVOKE ALL ON FUNCTION public.personal_events_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS personal_events_guard ON public.personal_events;
CREATE TRIGGER personal_events_guard
  BEFORE INSERT OR UPDATE ON public.personal_events
  FOR EACH ROW EXECUTE FUNCTION public.personal_events_guard();

NOTIFY pgrst, 'reload schema';
