-- แอดมินลบบัญชีผู้ใช้แล้วรูปโปรไฟล์ค้างใน bucket avatars — เฟส 2/2: นโยบายลบไฟล์
-- ต้องรันหลัง 20261103100000_admin_delete_orphan_avatars_fn.sql (อ้างฟังก์ชัน admin_may_delete_avatar)
--
-- เพิ่มนโยบาย DELETE อีกตัวคู่กับ "Users can delete own avatar" (20261101100000) — นโยบายแบบอนุญาต (PERMISSIVE)
-- หลายตัวรวมกันแบบ "หรือ" ผู้ใช้ลบรูปตัวเองได้เหมือนเดิม แอดมินลบได้เพิ่มเฉพาะไฟล์ที่เจ้าของบัญชีไม่อยู่แล้ว

DO $$
BEGIN
  IF to_regprocedure('public.admin_may_delete_avatar(text)') IS NULL THEN
    RAISE EXCEPTION 'ยังไม่มี public.admin_may_delete_avatar(text) — รัน 20261103100000_admin_delete_orphan_avatars_fn.sql ก่อน';
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can delete orphan avatars" ON storage.objects;
CREATE POLICY "Admins can delete orphan avatars" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND public.admin_may_delete_avatar((storage.foldername(name))[1]));
