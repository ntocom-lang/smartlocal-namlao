-- ⚠️ ไฟล์นี้แก้ข้อมูลจริงบน auth.users
--    รันต่อเมื่อ scripts/diagnose-auth-users-null-tokens.sql ยืนยันแล้วว่ามีคอลัมน์เป็น NULL จริง
--    และสำรอง auth.users ก่อน (Dashboard > Database > Backups)
--
-- เปลี่ยนคอลัมน์ token ภายในของ GoTrue จาก NULL เป็นสตริงว่าง ซึ่งเป็นค่าที่ GoTrue คาดหวัง
--
-- ── ทำไมอันนี้แก้ด้วย SQL ได้ ต่างจากการแก้อีเมล ──────────────────────────────
--   • คอลัมน์พวกนี้ไม่มีสำเนาอยู่ที่ auth.identities จึงไม่มีปัญหา "สองที่ไม่ตรงกัน"
--     (ต่างจาก email ที่ถูกเก็บซ้ำทั้งใน auth.users และ auth.identities)
--   • ไม่แตะตัวตนของผู้ใช้เลย (อีเมล / เบอร์ / provider) การล็อกอินไม่ได้รับผลกระทบ
--   • NULL -> '' คือการคืนค่าให้ตรงกับที่ GoTrue เขียนเองอยู่แล้วตอนสร้างผู้ใช้ผ่าน API ปกติ
--   • WHERE ... IS NULL ทำให้ค่าที่ไม่ใช่ NULL ไม่ถูกแตะ token ที่กำลังใช้งานอยู่จึงปลอดภัย
--
-- แยกเป็นคำสั่งละคอลัมน์ ถ้า Supabase เวอร์ชันนี้ไม่มีคอลัมน์ไหน จะ error เฉพาะบรรทัดนั้น
-- ลบบรรทัดนั้นทิ้งแล้วรันต่อได้เลย

update auth.users set confirmation_token         = '' where confirmation_token         is null;
update auth.users set recovery_token             = '' where recovery_token             is null;
update auth.users set email_change               = '' where email_change               is null;
update auth.users set email_change_token_new     = '' where email_change_token_new     is null;
update auth.users set email_change_token_current = '' where email_change_token_current is null;
update auth.users set phone_change               = '' where phone_change               is null;
update auth.users set phone_change_token         = '' where phone_change_token         is null;
update auth.users set reauthentication_token     = '' where reauthentication_token     is null;

-- รันเสร็จแล้วเปิด Dashboard > Authentication > Users ดูว่ารายชื่อขึ้นครบไหม
-- ถ้าขึ้นแล้ว แปลว่า Admin API กลับมาใช้ได้ตามปกติ
