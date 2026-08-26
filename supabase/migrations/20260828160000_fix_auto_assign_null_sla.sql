-- 20260828160000_fix_auto_assign_null_sla.sql
--
-- แก้บั๊ก due_date เป็น NULL ใน auto_assign_complaint()
--
-- ของเดิม (migration 080):
--   SELECT technician_id, COALESCE(sla_days, 3) INTO tech_id, v_sla
--   FROM category_assignments WHERE municipality_id = ... AND category = ...;
--   ...
--   NEW.due_date := (NOW() AT TIME ZONE 'Asia/Bangkok')::date + v_sla;
--
-- COALESCE ตรงนั้นกันได้แค่กรณี "เจอแถวแต่คอลัมน์ sla_days เป็น NULL" ไม่ได้กันกรณี
-- "ไม่เจอแถวเลย" — SELECT INTO ที่ไม่ match จะทิ้งตัวแปรทุกตัวไว้เป็น NULL แล้ว
-- date + NULL = NULL ⇒ เทศบาลที่ยังไม่ได้ตั้ง category_assignments ของหมวดนั้น คำร้องจะได้
-- due_date เป็น NULL
--
-- ผลที่ตามมา: ทุกจุดที่นับงานเกินกำหนดข้ามแถวที่ due_date ว่างทั้งหมด
--   src/pages/TechnicianDashboard.jsx  slaLevel()  -> if (!c.due_date) return null
--   src/pages/AdminDashboard.jsx       overdue     -> กรอง due_date ที่มีค่าเท่านั้น
-- คำร้องจึงมองไม่เห็นซ้อนสองชั้น: ไม่มี assigned_to (ช่าง/staff กรองไม่เห็น) และไม่ถูกนับ
-- เป็นงานเกินกำหนดในรายงานด้วย
--
-- ต้นเหตุจริงคือหมวดที่เปิดใช้แต่ไม่มีแถวใน category_assignments ซึ่งกันไว้ที่ต้นทางแล้วด้วย
-- แถบเตือนในหน้า "ประเภทคำร้อง" (commit 672731c) — migration นี้เป็นแนวกันตกชั้นที่สอง
-- ให้ due_date มีค่าเสมอถึงแม้แอดมินจะยังไม่ได้ตั้งผู้รับผิดชอบ
--
-- ไม่ backfill แถวเดิมที่ due_date เป็น NULL โดยเจตนา — การเติมย้อนหลังจะทำให้คำร้องเก่า
-- กลายเป็น "เกินกำหนด" ขึ้นมาทันทีทั้งที่ไม่เคยมีใครสัญญากรอบเวลานั้นไว้ ถ้าต้องการเติม
-- ให้ตัดสินใจแยกต่างหาก ตรวจจำนวนก่อนด้วย:
--   select municipality_id, count(*) from public.complaints
--   where due_date is null group by 1;
--
-- เปลี่ยนจาก 080 แค่ 2 อย่าง ไม่แตะ logic การมอบหมายและไม่แตะ status:
--   1) COALESCE(v_sla, 3) ตอนคำนวณ due_date
--   2) SET search_path — ของเดิมเป็น SECURITY DEFINER ที่ไม่ pin search_path ซึ่งเปิดช่องให้
--      ผู้ที่สร้าง schema ชั่วคราวได้สวม table ปลอมแทน category_assignments ตามแนวเดียวกับ
--      ฟังก์ชันอื่นในโปรเจกต์ที่ pin ไว้อยู่แล้ว และเติม public. หน้าชื่อตารางให้ชัด

CREATE OR REPLACE FUNCTION public.auto_assign_complaint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tech_id  uuid;
  v_sla    int;
BEGIN
  SELECT technician_id, COALESCE(sla_days, 3)
  INTO tech_id, v_sla
  FROM public.category_assignments
  WHERE municipality_id = NEW.municipality_id
    AND category        = NEW.category;

  IF tech_id IS NOT NULL THEN
    NEW.assigned_to := tech_id;
    -- ไม่เปลี่ยน status — ให้แอดมินรับเรื่องเอง (คงเจตนาเดิมจาก migration 080)
  END IF;

  IF NEW.due_date IS NULL THEN
    -- COALESCE รอบนี้กันกรณีไม่เจอแถวใน category_assignments ซึ่ง SELECT INTO ทิ้ง v_sla
    -- ไว้เป็น NULL ไม่ใช่ค่า default
    NEW.due_date := (NOW() AT TIME ZONE 'Asia/Bangkok')::date + COALESCE(v_sla, 3);
  END IF;

  RETURN NEW;
END;
$$;
