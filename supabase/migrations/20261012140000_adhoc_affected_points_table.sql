-- ผู้ได้รับผลกระทบรอบจุดต้นทางของเรื่องเฉพาะกิจ (เฟส 2 ของวงรัศมี) — จุดพิกัดที่ผู้รับผิดชอบ/แอดมินปักเอง
-- เช่น บ้าน/โรงเรียน/วัดที่ได้กลิ่นจากฟาร์ม · ผูกกับจุดต้นทาง (adhoc_impact_zones) หนึ่งจุดเสมอ
--
-- แยกไฟล์ตามเฟส: ไฟล์นี้มีแค่ CREATE TABLE — RLS / สิทธิ์ / ฟังก์ชัน ไปอยู่ 20261012140100
-- (CREATE TABLE แล้วอ้างตารางนั้นในไฟล์เดียวกันเคยพังด้วย 42P01 ดู docs/ai/NOTES.md ข้อ 3)
--
-- ⚠️ นี่คือ "พิกัดบุคคล" (พิกัดบ้านย่อมระบุตัวเจ้าของได้) จึงเก็บให้น้อยที่สุด:
--   - เก็บแค่ พิกัด + ชนิด (บ้าน/โรงเรียน/วัด/สถานพยาบาล/อื่นๆ) + หมายเหตุสั้น ≤ 120 ตัวอักษร
--   - ไม่มีช่องชื่อ เบอร์โทร เลขบัตร — และหมายเหตุที่มีตัวเลขติดกัน 9 หลักขึ้นไป (เบอร์/เลขบัตร) ถูก DB ปฏิเสธ
--   - เจ้าของระบบตัดสิน 2569-10-12: เก็บได้เรื่อยๆ ไม่มีกำหนด (ยังไม่ได้ยืนยันกับ DPO ของ อปท.)
--   - ปิดเรื่อง (จุดต้นทาง is_active=false) = ซ่อนให้ทุกคน · ลบจุดต้นทาง = ลบตามทั้งหมด (ON DELETE CASCADE)
CREATE TABLE IF NOT EXISTS public.adhoc_affected_points (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- municipality_id คัดลอกจากจุดต้นทางโดยฟังก์ชัน adhoc_affected_save() ไม่รับจากหน้าจอ
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  zone_id         uuid        NOT NULL REFERENCES public.adhoc_impact_zones(id) ON DELETE CASCADE,
  kind            text        NOT NULL,
  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  note            text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adhoc_affected_points_kind CHECK (kind IN ('residence', 'school', 'temple', 'health', 'other')),
  -- กรอบประเทศไทยแบบหยาบ เหมือน adhoc_impact_zones และ TH_BOUNDS ใน src/lib/odorAnalytics.js
  CONSTRAINT adhoc_affected_points_lat CHECK (latitude BETWEEN 5 AND 21),
  CONSTRAINT adhoc_affected_points_lng CHECK (longitude BETWEEN 96 AND 106),
  CONSTRAINT adhoc_affected_points_note_len CHECK (note IS NULL OR char_length(note) <= 120),
  -- ตัดช่องว่าง/ขีด/จุดออกก่อนตรวจ เพื่อจับเบอร์ที่พิมพ์เป็น 081-234-5678 หรือ 081 234 5678 · นับเลขไทยด้วย
  CONSTRAINT adhoc_affected_points_note_no_ids CHECK (
    note IS NULL OR regexp_replace(note, '[[:space:].-]', '', 'g') !~ '[0-9๐-๙]{9,}'
  )
);

COMMENT ON TABLE public.adhoc_affected_points IS
  'พิกัดผู้ได้รับผลกระทบรอบจุดต้นทางเรื่องเฉพาะกิจ (พิกัดบุคคล) เก็บแค่พิกัด+ชนิด+หมายเหตุสั้น ไม่มีชื่อ/เบอร์ — อ่าน/เขียนผ่านฟังก์ชัน adhoc_affected_* เท่านั้น ผู้ใช้ไม่มีสิทธิ์ที่ตารางโดยตรง';
