-- ตาราง ฟอร์ม 4: ลงทะเบียนร้านค้า/ท่องเที่ยว (Smart Economy)
CREATE TABLE IF NOT EXISTS business_registrations (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality_id UUID        REFERENCES municipalities(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ข้อมูลธุรกิจ
  business_name   TEXT        NOT NULL,
  business_type   TEXT        NOT NULL
    CHECK (business_type IN ('shop', 'food', 'stay', 'otop', 'tourism', 'service', 'other')),
  description     TEXT,
  operating_hours TEXT,

  -- GPS (บังคับ)
  latitude        DECIMAL(10, 8) NOT NULL,
  longitude       DECIMAL(11, 8) NOT NULL,
  address         TEXT,

  -- ช่องทางติดต่อ
  phone           TEXT,
  line_id         TEXT,
  facebook_url    TEXT,

  -- รูปภาพ
  images          TEXT[]      DEFAULT '{}',

  -- Approval workflow
  status          TEXT        DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note      TEXT,
  approved_by     UUID        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE business_registrations ENABLE ROW LEVEL SECURITY;

-- ประชาชน: อ่านได้เฉพาะที่อนุมัติแล้ว
CREATE POLICY "public_read_approved_businesses"
  ON business_registrations FOR SELECT
  USING (status = 'approved');

-- ผู้ยื่น: อ่านคำร้องของตัวเอง
CREATE POLICY "owner_read_own_registrations"
  ON business_registrations FOR SELECT
  USING (auth.uid() = user_id);

-- ผู้ยื่น: สร้างได้
CREATE POLICY "authenticated_insert_registration"
  ON business_registrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admin/Superadmin: จัดการทั้งหมด
CREATE POLICY "admin_all_business_registrations"
  ON business_registrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'superadmin')
        AND profiles.municipality_id = business_registrations.municipality_id
    )
  );

-- Index
CREATE INDEX IF NOT EXISTS idx_business_reg_municipality ON business_registrations(municipality_id);
CREATE INDEX IF NOT EXISTS idx_business_reg_status ON business_registrations(status);
CREATE INDEX IF NOT EXISTS idx_business_reg_type ON business_registrations(business_type);
