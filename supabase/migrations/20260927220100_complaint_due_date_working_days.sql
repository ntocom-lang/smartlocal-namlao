-- วันกำหนดเสร็จของคำร้องนับเป็น "วันทำการ" — ขั้น 2/2: trigger + แปลงจำนวนวันของแต่ละหมวด
--
-- ปัญหาเดิม: auto_assign_complaint ตั้ง due_date = วันแจ้ง + sla_days แบบวันปฏิทิน (นับเสาร์-อาทิตย์/วันหยุด)
-- แต่ป้ายบนจอ (SlaBadge) และหน้า "วันหยุดราชการ" บอกว่านับวันทำการ · หมวด 3 วันที่แจ้งวันศุกร์
-- ครบกำหนดวันจันทร์ = มีวันทำงานจริง 1 วัน และช่อง "ทันกำหนด" ในเมนูผลการปฏิบัติงานใช้ค่านี้ตรงๆ
--
-- เปลี่ยน 3 อย่าง (เจ้าของระบบเลือกแล้ว 2026-09-27):
--   1) due_date = public.add_working_days(วันแจ้งตามเวลาไทย, sla_days, อปท.) — คำนวณครั้งเดียวตอน INSERT
--      เหมือนเดิม ห้ามคำนวณใหม่ตอนเปลี่ยนสถานะ (เคยเลื่อนกำหนดทุกครั้งที่เริ่มงานจนสถิติเพี้ยน
--      ดูคอมเมนต์ใน src/components/admin/ComplaintsManager.jsx) · ส่วนอื่นของฟังก์ชันเหมือน 20260828160000 ทุกบรรทัด
--   2) แปลง sla_days ที่ตั้งไว้เป็นวันทำการที่ได้เวลาเฉลี่ยใกล้เดิม = ปัดเศษ (วันเดิม × 5/7) ขั้นต่ำ 1
--      ณ 2026-09-27 มีแค่ 2 ค่า: 10 → 7 และ 3 → 2 (ตารางเทียบรายหมวดอยู่ในคำอธิบาย PR)
--   3) ค่าเริ่มต้นของหมวดที่ยังไม่ได้ตั้ง 3 วันปฏิทิน → 2 วันทำการ (ทั้งใน trigger และ DEFAULT ของคอลัมน์)
-- คำร้องที่แจ้งไปแล้วไม่แตะ due_date เดิม · คำขอ E-Service (document_requests) ยังนับวันปฏิทิน (เฟส 2)
--
-- ⚠️ ห้ามรันซ้ำ: ด่านข้างล่างตรวจว่าฟังก์ชันยังเป็นเวอร์ชันวันปฏิทิน ถ้าไม่ใช่จะหยุดทั้งไฟล์
--    ไม่งั้นตัวเลข SLA ถูกแปลงซ้ำ (10 → 7 → 5)
--
-- ตรวจหลังรัน:
--   SELECT pg_get_functiondef('public.auto_assign_complaint()'::regprocedure) LIKE '%add_working_days%';
--   SELECT sla_days, count(*) FROM public.category_assignments GROUP BY 1 ORDER BY 1;   -- ไม่เหลือ 10 และ 3
--
-- ย้อนกลับ: รันนิยามฟังก์ชันใน 20260828160000_fix_auto_assign_null_sla.sql ซ้ำ แล้ว
--   UPDATE public.category_assignments SET sla_days = CASE sla_days WHEN 7 THEN 10 WHEN 2 THEN 3 ELSE sla_days END;
--   ALTER TABLE public.category_assignments ALTER COLUMN sla_days SET DEFAULT 3;
--   (ย้อนตัวเลขได้ตรงเฉพาะค่าที่มีอยู่ ณ วันนี้ คือ 10 และ 3 — ถ้าแอดมินแก้ตัวเลขหลังจากนี้ ต้องย้อนด้วยมือ)

BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.add_working_days(date,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20260927220000_add_working_days_fn.sql ก่อน';
  END IF;
  v_def := pg_get_functiondef('public.auto_assign_complaint()'::regprocedure);
  IF position('::date + COALESCE(v_sla, 3)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'auto_assign_complaint ไม่ใช่เวอร์ชันนับวันปฏิทิน (20260828160000) — ไฟล์นี้อาจรันไปแล้ว หรือมีคนแก้ฟังก์ชันไว้ ตรวจก่อน';
  END IF;
END $$;

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
  SELECT technician_id, COALESCE(sla_days, 2)
  INTO tech_id, v_sla
  FROM public.category_assignments
  WHERE municipality_id = NEW.municipality_id
    AND category        = NEW.category;

  IF tech_id IS NOT NULL THEN
    NEW.assigned_to := tech_id;
    -- ไม่เปลี่ยน status — ให้แอดมินรับเรื่องเอง (คงเจตนาเดิมจาก migration 080)
  END IF;

  IF NEW.due_date IS NULL THEN
    -- นับเป็นวันทำการ (ข้ามเสาร์-อาทิตย์และวันหยุดของ อปท. นี้) คำนวณครั้งเดียวตอนรับคำร้อง
    -- COALESCE รอบนี้กันกรณีไม่เจอแถวใน category_assignments ซึ่ง SELECT INTO ทิ้ง v_sla
    -- ไว้เป็น NULL ไม่ใช่ค่า default
    NEW.due_date := public.add_working_days(
      (NOW() AT TIME ZONE 'Asia/Bangkok')::date, COALESCE(v_sla, 2), NEW.municipality_id);
  END IF;

  RETURN NEW;
END;
$$;

UPDATE public.category_assignments
SET sla_days = GREATEST(1, round(sla_days * 5 / 7.0)::int)
WHERE sla_days IS NOT NULL;

ALTER TABLE public.category_assignments ALTER COLUMN sla_days SET DEFAULT 2;

COMMIT;
