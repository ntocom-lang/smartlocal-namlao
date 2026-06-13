-- Migration: เพิ่ม project_type ใหม่สำหรับถนนและงานน้ำ
-- ไม่ต้องเปลี่ยน schema เพราะ project_type เป็น text field อยู่แล้ว
-- แค่ migrate ข้อมูลเก่า road → road_concrete (ถ้าต้องการ)

-- optional: migrate existing 'road' records
-- UPDATE civil_projects SET project_type = 'road_concrete' WHERE project_type = 'road';

-- optional: migrate existing 'waterway' records
-- UPDATE civil_projects SET project_type = 'canal' WHERE project_type = 'waterway';

-- ตัวอย่างการ migrate ทีละงาน (ทำ case-by-case ผ่าน admin UI แทนก็ได้)
-- ไม่ run auto เพราะต้องให้เจ้าหน้าที่ตรวจสอบเองก่อน
