-- ตาราง Engineer GPS: บันทึกงานโยธาหน้างาน (กองช่างปลั๊กอิน)
CREATE TABLE IF NOT EXISTS infrastructure_works (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality_id UUID        REFERENCES municipalities(id) ON DELETE CASCADE NOT NULL,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ข้อมูลงาน
  title           TEXT        NOT NULL,
  category        TEXT        NOT NULL
    CHECK (category IN ('road', 'drainage', 'electrical', 'waterway', 'building', 'irrigation', 'other')),
  description     TEXT,
  budget          DECIMAL(12, 2),
  work_year       INT         DEFAULT EXTRACT(YEAR FROM NOW())::INT,
  work_date       DATE        DEFAULT CURRENT_DATE,

  -- GPS (บังคับ)
  latitude        DECIMAL(10, 8) NOT NULL,
  longitude       DECIMAL(11, 8) NOT NULL,
  location_name   TEXT,

  -- รูปภาพหน้างาน
  photos          TEXT[]      DEFAULT '{}',

  -- สถานะ
  status          TEXT        DEFAULT 'completed'
    CHECK (status IN ('planned', 'in_progress', 'completed')),

  -- เชื่อมกับคำร้อง (ถ้ามี)
  complaint_id    UUID        REFERENCES complaints(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE infrastructure_works ENABLE ROW LEVEL SECURITY;

-- ทุกคนอ่านได้ (public map)
CREATE POLICY "public_read_infrastructure_works"
  ON infrastructure_works FOR SELECT
  USING (true);

-- Technician ของ municipality นั้น: สร้าง/แก้ไขงานของตัวเอง
CREATE POLICY "technician_insert_works"
  ON infrastructure_works FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('technician', 'admin', 'superadmin')
        AND profiles.municipality_id = infrastructure_works.municipality_id
    )
  );

CREATE POLICY "technician_update_own_works"
  ON infrastructure_works FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Admin: จัดการทั้งหมด
CREATE POLICY "admin_all_infrastructure_works"
  ON infrastructure_works FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'superadmin')
        AND profiles.municipality_id = infrastructure_works.municipality_id
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_infra_works_municipality ON infrastructure_works(municipality_id);
CREATE INDEX IF NOT EXISTS idx_infra_works_status ON infrastructure_works(status);
CREATE INDEX IF NOT EXISTS idx_infra_works_category ON infrastructure_works(category);
CREATE INDEX IF NOT EXISTS idx_infra_works_date ON infrastructure_works(work_date DESC);
