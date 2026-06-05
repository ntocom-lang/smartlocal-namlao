-- เพิ่ม form_type เพื่อแยก 3 ฟอร์ม GPS ของ One Data
ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS form_type TEXT
    CHECK (form_type IN ('infrastructure', 'water_support', 'environment', 'legacy'));

-- complaint เดิมทั้งหมดถือเป็น legacy
UPDATE complaints SET form_type = 'legacy' WHERE form_type IS NULL;

COMMENT ON COLUMN complaints.form_type IS
  'infrastructure=ซ่อมโครงสร้างพื้นฐาน, water_support=ขอน้ำ, environment=สิ่งแวดล้อม/จุดเสี่ยง, legacy=คำร้องเดิม';
