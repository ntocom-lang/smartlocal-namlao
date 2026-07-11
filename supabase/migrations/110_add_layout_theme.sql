-- 110_add_layout_theme.sql
-- เพิ่ม layout_theme สำหรับให้แต่ละหน่วยงานเลือกรูปแบบหน้าแรก

ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS layout_theme TEXT NOT NULL DEFAULT 'classic';

COMMENT ON COLUMN municipalities.layout_theme IS
  'รูปแบบหน้าแรก: classic | modern | service_first | news_first';
