-- เพิ่มคอลัมน์ attachment_urls (array) ให้กิจกรรมแนบได้หลายไฟล์ (สูงสุด 3 ตามที่ frontend บังคับ)
-- attachment_url เดิม (single) ยังคงอยู่เพื่อ backward-compat ไม่ลบทิ้ง
ALTER TABLE events ADD COLUMN IF NOT EXISTS attachment_urls text[] NOT NULL DEFAULT '{}'::text[];

UPDATE events
SET attachment_urls = ARRAY[attachment_url]
WHERE attachment_url IS NOT NULL
  AND attachment_url <> ''
  AND attachment_urls = '{}'::text[];
