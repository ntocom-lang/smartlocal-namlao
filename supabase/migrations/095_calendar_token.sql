-- เพิ่ม calendar_token สำหรับ iCal subscribe URL (ไม่ต้อง login)
ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS calendar_token text;

-- สร้าง token ให้ทุก municipality ที่ยังไม่มี
UPDATE municipalities
  SET calendar_token = encode(gen_random_bytes(16), 'hex')
  WHERE calendar_token IS NULL;

-- ทำให้มีค่าเสมอสำหรับ row ใหม่
ALTER TABLE municipalities
  ALTER COLUMN calendar_token SET DEFAULT encode(gen_random_bytes(16), 'hex');
