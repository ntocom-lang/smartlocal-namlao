-- เพิ่ม column developer_name ในตาราง municipalities
ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS developer_name text;

-- ตั้งค่าตัวอย่างแต่ละหน่วยงาน
UPDATE municipalities SET developer_name = 'นายยุทธศักดิ์ กาศเกษม'    WHERE slug = 'namlao';
UPDATE municipalities SET developer_name = 'ห้างหุ้นส่วน ร้องกวาง ไอที' WHERE slug = 'muangphrae';
-- UPDATE municipalities SET developer_name = 'ชื่อผู้พัฒนา' WHERE slug = 'slug-อื่น';
