-- แก้บั๊กจริงที่พบระหว่างทดสอบ deploy: municipalities ใช้ column-level GRANT (ไม่ใช่ table-level) —
-- ALTER TABLE ADD COLUMN ไม่ได้เพิ่มสิทธิ์ SELECT ให้อัตโนมัติ ทำให้ 2 คอลัมน์ที่เพิ่งเพิ่มวันนี้
-- (header_image_mode, category_icon_style) ทุกคนที่ "ยังไม่ login" (role anon — คือประชาชนทั่วไปที่เข้า
-- เว็บโดยไม่ล็อกอิน ซึ่งเป็นคนส่วนใหญ่) โดน "permission denied for table municipalities" (42501) ทันที
-- ตั้งแต่โหลดหน้าแรก เพราะ TenantContext ดึงคอลัมน์นี้ไปด้วยทุกครั้ง — เว็บล่มทั้งเว็บสำหรับผู้เยี่ยมชมที่
-- ไม่ได้ login (ทดสอบตอนพัฒนาไม่เจอเพราะ login เป็น dev user ตลอด ไม่เคยทดสอบแบบไม่ login จริงๆ)
grant select (header_image_mode)   on public.municipalities to anon, authenticated;
grant select (category_icon_style) on public.municipalities to anon, authenticated;
