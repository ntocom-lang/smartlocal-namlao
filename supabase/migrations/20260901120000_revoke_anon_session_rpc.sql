-- ถอนสิทธิ์ anon ออกจาก RPC จัดการ session (ต่อจาก 20260901110000_my_active_sessions.sql)
--
-- ทำไมต้องมีไฟล์นี้: migration ก่อนหน้าเขียนแค่ REVOKE ALL ... FROM PUBLIC ซึ่งไม่พอ
-- Supabase ตั้ง ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
-- TO anon, authenticated, service_role ไว้ตั้งแต่สร้างโปรเจกต์ ฟังก์ชันใหม่ทุกตัวใน
-- schema public จึงได้ EXECUTE ให้ anon แบบ "grant ตรงถึง role" ไม่ใช่ผ่าน PUBLIC
-- การ REVOKE FROM PUBLIC จึงไม่แตะ grant ก้อนนั้นเลย
--
-- ยืนยันด้วยการยิงจริงด้วย anon key ก่อนเขียนไฟล์นี้: list_my_sessions() ตอบ 200 []
-- และ revoke_my_session() ตอบ 401 พร้อมข้อความจาก RAISE EXCEPTION ในตัวฟังก์ชันเอง
-- (= ผ่านด่านสิทธิ์เข้ามาถึงตัวฟังก์ชันได้จริง) ทั้งสองกรณีไม่มีข้อมูลหลุดเพราะ auth.uid()
-- เป็น null แต่ด่านสิทธิ์ควรกันตั้งแต่ก่อนเข้าฟังก์ชัน ไม่ใช่พึ่ง guard ข้างในอย่างเดียว

REVOKE ALL ON FUNCTION public.list_my_sessions()       FROM anon;
REVOKE ALL ON FUNCTION public.revoke_my_session(uuid)  FROM anon;
