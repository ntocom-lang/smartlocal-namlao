-- ตาราง Civil Projects: ระบบติดตามโครงการกองช่าง (แทน infrastructure_works)
CREATE TABLE IF NOT EXISTS civil_projects (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality_id UUID REFERENCES municipalities(id) ON DELETE CASCADE NOT NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ข้อมูลพื้นฐาน
  project_no      TEXT,                                -- เลขที่โครงการ (manual)
  fiscal_year     TEXT NOT NULL,                       -- ปีงบประมาณ เช่น '2568'
  title           TEXT NOT NULL,                       -- ชื่อโครงการ
  description     TEXT,                                -- รายละเอียดโครงการ
  project_type    TEXT NOT NULL DEFAULT 'road'
    CHECK (project_type IN ('road','drain','bridge','light','waterway','building','irrigation','water_supply','other')),
  status          TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','approved','in_progress','completed','cancelled','suspended')),
  department      TEXT NOT NULL DEFAULT 'civil',       -- กอง/หน่วยงาน
  progress_pct    INTEGER NOT NULL DEFAULT 0
    CHECK (progress_pct BETWEEN 0 AND 100),            -- ความคืบหน้า (%)

  -- ที่ตั้งโครงการ
  village         TEXT,                                -- หมู่บ้าน/ชุมชน
  subdistrict     TEXT,                                -- ตำบล
  district        TEXT,                                -- อำเภอ
  province        TEXT,                                -- จังหวัด
  location_desc   TEXT,                                -- คำอธิบายที่ตั้ง
  latitude        DECIMAL(10, 8),
  longitude       DECIMAL(11, 8),

  -- งบประมาณและสัญญา
  budget_amount   DECIMAL(15, 2),                      -- วงเงินงบประมาณ
  contract_amount DECIMAL(15, 2),                      -- ราคาสัญญา
  paid_amount     DECIMAL(15, 2),                      -- เบิกจ่ายแล้ว
  contractor_name TEXT,                                -- ชื่อผู้รับจ้าง
  contract_no     TEXT,                                -- เลขที่สัญญา

  -- ระยะเวลาดำเนินการ
  start_date      DATE,
  end_date        DATE,

  -- กรณีปัญหา
  cancel_reason   TEXT,                                -- สาเหตุยกเลิก/ระงับ

  -- ไฟล์แนบ
  photos          TEXT[] DEFAULT '{}',
  note            TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE civil_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civil_projects_select"
  ON civil_projects FOR SELECT USING (true);

CREATE POLICY "civil_projects_insert"
  ON civil_projects FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('technician','admin','superadmin')
        AND profiles.municipality_id = civil_projects.municipality_id
    )
  );

-- Admin แก้ไขได้ทั้งหมด, technician แก้ไขได้เฉพาะที่ตัวเองสร้าง
CREATE POLICY "civil_projects_update"
  ON civil_projects FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin','superadmin')
        AND profiles.municipality_id = civil_projects.municipality_id
    )
    OR auth.uid() = created_by
  );

CREATE POLICY "civil_projects_delete"
  ON civil_projects FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin','superadmin')
        AND profiles.municipality_id = civil_projects.municipality_id
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_civil_projects_municipality ON civil_projects(municipality_id);
CREATE INDEX IF NOT EXISTS idx_civil_projects_status       ON civil_projects(status);
CREATE INDEX IF NOT EXISTS idx_civil_projects_fiscal_year  ON civil_projects(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_civil_projects_created_at   ON civil_projects(created_at DESC);
