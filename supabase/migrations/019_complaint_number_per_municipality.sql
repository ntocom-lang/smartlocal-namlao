-- =====================================================
-- SmartLocal 019: เลขที่คำร้องแยกต่อ municipality
-- แก้จาก global sequence → per-municipality MAX+1
-- =====================================================

-- 1. ลบ unique constraint เดิมที่ครอบ global
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_complaint_number_key;

-- 2. เพิ่ม unique constraint ใหม่แบบ per-municipality
ALTER TABLE complaints
  ADD CONSTRAINT complaints_complaint_number_municipality_key
  UNIQUE (municipality_id, complaint_number);

-- 3. ฟังก์ชัน trigger: นับจำนวนคำร้องของ municipality นั้นแล้ว +1
CREATE OR REPLACE FUNCTION assign_complaint_number_per_municipality()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- ถ้ายังไม่มี complaint_number ค่อย assign
  IF NEW.complaint_number IS NULL THEN
    SELECT COALESCE(MAX(complaint_number), 0) + 1
      INTO NEW.complaint_number
      FROM complaints
     WHERE municipality_id = NEW.municipality_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. สร้าง trigger บน INSERT
DROP TRIGGER IF EXISTS trg_assign_complaint_number ON complaints;
CREATE TRIGGER trg_assign_complaint_number
  BEFORE INSERT ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION assign_complaint_number_per_municipality();

-- 5. ลบ default เดิมที่ผูก sequence ก่อน (ต้องทำก่อน drop sequence)
ALTER TABLE complaints ALTER COLUMN complaint_number DROP DEFAULT;

-- 6. ล้าง sequence เก่าที่ไม่ใช้แล้ว
DROP SEQUENCE IF EXISTS complaints_number_seq;
