-- 114_fix_show_posts_highlight_for_all.sql
-- แก้ไข: ข่าวสำคัญและกิจกรรมหายไปสำหรับหน่วยงานอื่น
-- สาเหตุ: show_posts_highlight อาจถูกเซ็ตเป็น false โดยไม่ตั้งใจ
-- เมื่อ applyPreset หรือ saveLayout ทำงาน

-- Reset ทุกหน่วยงานที่ show_posts_highlight = false ให้กลับเป็น true
UPDATE municipalities
   SET show_posts_highlight = true
 WHERE show_posts_highlight = false;

-- ยืนยัน default ให้เป็น true เสมอ
ALTER TABLE municipalities
  ALTER COLUMN show_posts_highlight SET DEFAULT true;
