-- ContactPage.jsx เดิม hardcode เบอร์แฟกซ์ + หมายเลขภายในของ namlao ไว้ตรงๆ ทุก tenant เห็นข้อมูล
-- เดียวกันหมด — เพิ่มคอลัมน์ให้แต่ละเทศบาลกรอกของตัวเองแทน
--
-- fax: เบอร์แฟกซ์เดี่ยว รูปแบบเดียวกับ phone
-- internal_extensions: array ของ {name, ext} เช่น [{"name":"กองคลัง","ext":"11, 14"}] — ไม่ fix จำนวน/
--   ชื่อกองแบบเดิม (5 กองของ namlao) เพราะแต่ละ อปท. มีโครงสร้างกองไม่เท่ากัน ให้แอดมินกรอกเองอิสระ
alter table municipalities
  add column if not exists fax text,
  add column if not exists internal_extensions jsonb not null default '[]'::jsonb;
