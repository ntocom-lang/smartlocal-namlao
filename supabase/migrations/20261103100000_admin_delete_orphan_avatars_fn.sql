-- แอดมินลบบัญชีผู้ใช้แล้วรูปโปรไฟล์ (ภาพใบหน้า) ค้างใน bucket avatars — เฟส 1/2: ฟังก์ชันตัดสินว่าไฟล์ไหนลบได้
--
-- [ทำไมต้องมี] ลบบัญชีด้วยตนเอง (20261101100000) ให้ผู้ใช้ลบรูปของตัวเองก่อนลบบัญชีได้ แต่แอดมินลบบัญชีคนอื่น
-- (AdminDashboard.deleteUser → delete_user_by_id) ไม่มีใครลบไฟล์ให้ รูปค้างใน bucket สาธารณะตลอดไป
-- ลบด้วย SQL (DELETE FROM storage.objects) ไม่ได้: Supabase ระบุว่าแถวหายแต่ไฟล์จริงค้างเป็นกำพร้า
-- ต้องลบผ่าน Storage API ซึ่งตัดสินสิทธิ์ด้วยนโยบายของ storage.objects (เฟส 2/2 ไฟล์ถัดไป)
--
-- [ทำไมไม่เปิดให้แอดมินลบรูปของทุกคน] ไม่ให้แอดมิน อปท. หนึ่งลบรูปของคนต่าง อปท. ผ่าน Storage API ตรงๆ ได้
-- จึงให้ลบได้เฉพาะไฟล์ "กำพร้า" = โฟลเดอร์ (รหัสผู้ใช้) ที่ไม่มีบัญชีเหลืออยู่แล้ว ซึ่งไม่ใช่ของใครอีก
-- ฝั่งแอปจึงต้องจำรายชื่อไฟล์ไว้ก่อนลบบัญชี (ตอนบัญชียังอยู่ list ได้) แล้วลบหลังบัญชีหายสำเร็จ
--
-- ฟังก์ชันตอบ true เฉพาะ "แอดมิน + ไม่มีเจ้าของ" เท่านั้น คนอื่นได้ false เสมอ จึงใช้ไล่ถามว่ารหัสนี้เป็นผู้ใช้จริงไหมไม่ได้
-- ไม่แตะ delete_user_by_id (ฟังก์ชันนั้นถูกเขียนทับมาแล้ว 7 รุ่น ไม่ต้องเสี่ยง CREATE OR REPLACE ซ้ำ)
-- ไม่ลบ/แก้ข้อมูลแถวใดเลย

CREATE OR REPLACE FUNCTION public.admin_may_delete_avatar(p_folder text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(public.get_my_role() IN ('admin', 'superadmin'), false)
     AND p_folder IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = p_folder)
$$;

REVOKE ALL ON FUNCTION public.admin_may_delete_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_may_delete_avatar(text) TO authenticated;

COMMENT ON FUNCTION public.admin_may_delete_avatar(text) IS
  'แอดมิน/ซูเปอร์แอดมินลบไฟล์ใน bucket avatars ได้เฉพาะโฟลเดอร์ที่เจ้าของบัญชีไม่อยู่แล้ว (ใช้ในนโยบาย Admins can delete orphan avatars) — คนอื่นได้ false เสมอ';
