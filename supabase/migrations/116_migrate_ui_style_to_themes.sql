-- Migration 116: Migrate ui_style to new Multi-Template architecture

-- Update existing data
UPDATE municipalities
SET ui_style = CASE
    WHEN ui_style = 'default' THEN 'eco_friendly'
    WHEN ui_style = 'rounded' THEN 'wave_fluid'
    WHEN ui_style = 'glass' THEN 'civic_friendly'
    WHEN ui_style = 'minimal' THEN 'clean_minimal'
    ELSE 'eco_friendly'
END;

-- Change the default value for the column
ALTER TABLE municipalities
ALTER COLUMN ui_style SET DEFAULT 'eco_friendly';

-- Update comment
COMMENT ON COLUMN municipalities.ui_style IS 'App Template theme: eco_friendly, clean_minimal, wave_fluid, civic_friendly, smart_modern';
