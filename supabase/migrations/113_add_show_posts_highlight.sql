-- 113_add_show_posts_highlight.sql
-- เพิ่ม flag ควบคุมการแสดงข่าวสำคัญ/กิจกรรมในหน้าแรก (per-preset ผ่าน theme_presets JSONB)

ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS show_posts_highlight BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN municipalities.show_posts_highlight IS
  'true = แสดงข่าวสำคัญและกิจกรรมในหน้าแรก (ค่า default), false = ซ่อน';
