-- =====================================================
-- SmartLocal 039: บันทึกผู้สร้างกิจกรรม (created_by)
-- =====================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
