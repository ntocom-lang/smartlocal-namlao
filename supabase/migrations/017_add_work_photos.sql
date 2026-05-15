-- =====================================================
-- SmartLocal: เพิ่ม column work_photos สำหรับรูปหลักฐานการทำงาน (โดย admin/ช่าง)
-- แยกออกจาก attachments ที่ประชาชนส่งมา
-- =====================================================

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS work_photos text[] DEFAULT '{}';
