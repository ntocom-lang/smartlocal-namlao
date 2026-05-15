-- SmartLocal 020: เพิ่ม website_url ให้ municipalities
ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS website_url text;
