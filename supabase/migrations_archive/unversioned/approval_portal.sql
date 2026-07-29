-- ============================================================
-- Approval Portal — Migration
-- รัน SQL นี้ใน Supabase SQL Editor ต่อจาก staff_portal.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid REFERENCES municipalities(id) ON DELETE CASCADE,

  -- ประเภทคำขอ
  request_type        text NOT NULL,
  -- expense_claim | budget_request | procurement | leave_request | overtime | other_quick | other_sign

  -- true = ต้องผู้บริหารลงนาม (เบิกจ่าย/จัดซื้อ)
  -- false = กดอนุมัติได้เลย (ลา/OT/ทั่วไป)
  requires_signature  boolean NOT NULL DEFAULT false,

  title               text NOT NULL,
  description         text,
  amount              numeric,            -- จำนวนเงิน (ถ้ามี)
  department          text,              -- กอง / หน่วยงาน

  -- ผู้สร้างคำขอ
  created_by          uuid REFERENCES auth.users(id),
  requester_name      text,

  -- Workflow
  status              text NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected

  approved_by         uuid REFERENCES auth.users(id),
  approver_name       text,
  approved_at         timestamptz,
  approver_note       text,
  signature_data      text,              -- base64 PNG ลายมือชื่อ canvas

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_municipality
  ON approval_requests (municipality_id, status, created_at DESC);

-- RLS
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- authenticated users เท่านั้น (ระบบนี้ internal สำหรับเจ้าหน้าที่)
DROP POLICY IF EXISTS "authenticated full access approval_requests" ON approval_requests;
CREATE POLICY "authenticated full access approval_requests"
  ON approval_requests
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
-- Archived: this legacy file had no migration version and was ignored by Supabase CLI.
