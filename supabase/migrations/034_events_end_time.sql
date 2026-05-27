-- =====================================================
-- SmartLocal 034: เพิ่ม end_time ให้ events
-- =====================================================
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TIME;
