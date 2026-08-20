-- เพิ่มตัวเลือกรูปแบบไอคอนหมวดหมู่คำร้อง/เรื่องร้องเรียน ระดับ อปท. — แอดมินเลือกได้ที่หน้า
-- "จัดการประเภทคำร้อง" มีผลกับทุกจุดที่ใช้ CategoryIcon (src/lib/categoryIcon.jsx)
-- 'native'  = emoji ตัวอักษรธรรมดา (แล้วแต่ font ของอุปกรณ์แต่ละเครื่อง)
-- 'color'   = OpenMoji ชุดสี (ค่าเริ่มต้น พฤติกรรมเดิมก่อนมีตัวเลือกนี้)
-- 'outline' = OpenMoji ชุดเส้นขาวดำ (dataset เดียวกับชุดสี คนละโฟลเดอร์ ไม่มีต้นทุนเพิ่ม)
alter table municipalities
  add column if not exists category_icon_style text not null default 'color'
    check (category_icon_style in ('native', 'color', 'outline'));
