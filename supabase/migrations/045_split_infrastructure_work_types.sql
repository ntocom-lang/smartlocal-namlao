-- แยกประเภทงานโครงสร้างพื้นฐาน: โครงการใหม่ vs งานซ่อม
ALTER TABLE infrastructure_works
  ADD COLUMN IF NOT EXISTS work_type TEXT DEFAULT 'repair'
    CHECK (work_type IN ('new_project', 'repair')),
  ADD COLUMN IF NOT EXISTS contractor  TEXT,   -- ผู้รับเหมา (เฉพาะโครงการใหม่)
  ADD COLUMN IF NOT EXISTS contract_no TEXT;   -- เลขที่สัญญา/โครงการ

-- งานเดิมทั้งหมดถือเป็นงานซ่อม
UPDATE infrastructure_works SET work_type = 'repair' WHERE work_type IS NULL;

COMMENT ON COLUMN infrastructure_works.work_type IS
  'new_project = โครงการก่อสร้างใหม่ (ตรวจรับงาน), repair = งานซ่อมบำรุง';
COMMENT ON COLUMN infrastructure_works.contractor IS
  'ชื่อผู้รับเหมา (สำหรับ new_project)';
COMMENT ON COLUMN infrastructure_works.contract_no IS
  'เลขที่สัญญา/โครงการ (สำหรับ new_project)';
