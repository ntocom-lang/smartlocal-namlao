-- Keep applied migration history immutable; correct outdated billing guidance in schema metadata.
COMMENT ON COLUMN municipalities.google_maps_api_key IS
  'Browser API Key สำหรับ Google Maps Platform ของ อปท. รายนี้ ต้องจำกัด HTTP referrer, API scope, quota และ billing budget';
