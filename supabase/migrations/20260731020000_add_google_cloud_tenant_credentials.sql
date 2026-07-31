-- Migration: Add Google Cloud & Google Maps Tenant Isolation Credentials
-- สถาปัตยกรรม 1 หน่วยงาน (อปท.) = 1 Google Cloud Account = 1 อีเมลองค์กร

ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS google_maps_api_key TEXT,
  ADD COLUMN IF NOT EXISTS google_cloud_email TEXT,
  ADD COLUMN IF NOT EXISTS google_project_id TEXT;

COMMENT ON COLUMN municipalities.google_maps_api_key IS 'API Key สำหรับ Google Maps Platform ของ อปท. รายนี้ (ใช้สิทธิ์โควตา $200/เดือน แยกบัญชี)';
COMMENT ON COLUMN municipalities.google_cloud_email IS 'อีเมลบัญชี Google Cloud องค์กรของ อปท. (เช่น gis@namlao.go.th)';
COMMENT ON COLUMN municipalities.google_project_id IS 'Google Cloud Project ID ของ อปท. (เช่น smartlocal-namlao-gis)';

-- Seed default for Mae Kham Mi / Nam Lao demo if needed
UPDATE municipalities
SET 
  google_cloud_email = 'admin@namlao.go.th',
  google_project_id = 'smartlocal-namlao-gis'
WHERE slug = 'namlao' AND google_cloud_email IS NULL;
