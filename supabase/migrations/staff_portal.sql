-- ============================================================
-- Staff Portal — Migration
-- รัน SQL นี้ใน Supabase SQL Editor
-- ============================================================

-- คำขอเอกสารจากประชาชน (และ walk-in)
CREATE TABLE IF NOT EXISTS document_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id   uuid REFERENCES municipalities(id) ON DELETE CASCADE,

  -- ประเภทเอกสาร
  document_type     text NOT NULL,
  -- residence_cert | personal_cert | conduct_cert | tax_notice | other

  -- ข้อมูลผู้ยื่นคำขอ
  requester_name    text NOT NULL,
  requester_id_card text,
  requester_phone   text,
  requester_address text,
  purpose           text,

  -- Workflow
  status            text NOT NULL DEFAULT 'pending',
  -- pending | processing | completed | rejected

  assigned_to       uuid REFERENCES auth.users(id),
  assigned_at       timestamptz,
  staff_notes       text,
  reject_reason     text,

  -- citizen user (optional)
  user_id           uuid REFERENCES auth.users(id),

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Index สำหรับ query บ่อย
CREATE INDEX IF NOT EXISTS idx_doc_requests_municipality
  ON document_requests (municipality_id, status, created_at DESC);

-- RLS
ALTER TABLE document_requests ENABLE ROW LEVEL SECURITY;

-- ทุกคน insert ได้ (ประชาชนยื่นคำขอ)
CREATE POLICY "public can insert document_requests"
  ON document_requests FOR INSERT
  WITH CHECK (true);

-- อ่านได้ทุกคน (เจ้าหน้าที่ + ประชาชนดูของตัวเอง)
CREATE POLICY "public can select document_requests"
  ON document_requests FOR SELECT
  USING (true);

-- update ได้เฉพาะ authenticated
CREATE POLICY "authenticated can update document_requests"
  ON document_requests FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ============================================================
-- เพิ่ม role 'staff' ให้ user ใน profiles
-- (รันแยกต่างหากสำหรับ user ที่ต้องการให้เป็นเจ้าหน้าที่)
-- ============================================================
-- UPDATE profiles SET role = 'staff' WHERE id = '<user-uuid>';
