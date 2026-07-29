-- 111_add_theme_presets.sql
-- เพิ่ม theme_presets สำหรับบันทึก preset ธีม (สี + layout) หลายชุด

ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS theme_presets JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN municipalities.theme_presets IS
  'array of {name, color, layout} — preset ธีมที่ admin บันทึกไว้';
-- Unique timestamp assigned while repairing duplicate local version 111.
