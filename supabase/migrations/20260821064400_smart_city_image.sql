-- รูปพื้นหลังของแบนเนอร์ "[ชื่อ อปท.] SMART CITY" (SmartCityBanner.jsx) — แอดมินอัปโหลดเองได้ที่แท็บ
-- แบรนด์และรูปภาพ ถ้าไม่ตั้งจะ fallback ไปใช้ภาพผังเมือง isometric ที่วาดเองแทน (พฤติกรรมเดิม)
alter table municipalities
  add column if not exists smart_city_image_url text;

-- ตารางนี้ใช้ column-level GRANT (ไม่ใช่ table-level) — ALTER TABLE ADD COLUMN ไม่เพิ่มสิทธิ์ให้อัตโนมัติ
-- (บทเรียนจากบั๊กที่เพิ่งเจอกับ header_image_mode/category_icon_style) ให้สิทธิ์ทันทีตั้งแต่ migration นี้
grant select (smart_city_image_url) on public.municipalities to anon, authenticated;
