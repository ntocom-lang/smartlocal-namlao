-- 143_drop_dangerous_blanket_upload_policy.sql — EMERGENCY
--
-- พบ policy "allow upload zt8oac_0" บน storage.objects: WITH CHECK(true) ให้ role
-- authenticated + anon โดยไม่เช็ค bucket_id เลย แปลว่าใครก็ได้แม้ไม่ login อัปโหลดไฟล์
-- เข้า bucket ไหนก็ได้ในทั้งโปรเจกต์ (รวม private bucket อย่าง payment-slips,
-- official-documents, org-documents) ทำลายการ scope ของทุก bucket policy ที่มี
-- (RLS permissive รวมกันแบบ OR)
--
-- ชื่อ policy มีลักษณะ auto-generated (สุ่มตัวอักษร) จากเครื่องมือภายนอกที่เคย
-- connect เข้าโปรเจกต์นี้ ไม่มีเหตุผลทางธุรกิจใดๆ รองรับ — ลบทิ้งทันที
--
-- ตรวจสอบแล้วว่าไม่มี policy ลักษณะเดียวกัน (ชื่อสุ่ม/blanket true ไม่เช็คขอบเขต)
-- หลงเหลืออยู่ที่ตารางอื่นในโปรเจกต์

DROP POLICY IF EXISTS "allow upload zt8oac_0" ON storage.objects;
-- History version aligned with linked Supabase project.
