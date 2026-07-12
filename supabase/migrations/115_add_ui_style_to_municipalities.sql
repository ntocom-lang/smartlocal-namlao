-- Migration 115: Add ui_style to municipalities

ALTER TABLE municipalities
ADD COLUMN IF NOT EXISTS ui_style text DEFAULT 'default';

-- Add comment for documentation
COMMENT ON COLUMN municipalities.ui_style IS 'UI style for citizen-facing components: default, rounded, glass, minimal';
