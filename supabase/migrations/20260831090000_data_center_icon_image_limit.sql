-- 20260831090000_data_center_icon_image_limit.sql
--
-- ต่อยอดจาก 20260828100000_data_center_category_icons.sql — เดิมไอคอนของกลุ่มหลัก/ประเภทย่อยเป็น
-- "อิโมจิ" ได้อย่างเดียว ผู้ใช้ต้องการแนบไฟล์ไอคอนของตัวเองจากเครื่องด้วย (ตราสัญลักษณ์ อปท.,
-- ไอคอนเฉพาะกิจที่ไม่มีในชุดอิโมจิ) — ฝั่งแอปย่อไฟล์เป็น PNG 64x64 ผ่าน <canvas> แล้วเก็บเป็น
-- data URL ลงคอลัมน์ emoji เดิม (ดู fileToIconDataUrl ใน src/lib/dataCenterGroupIcon.js)
--
-- ไม่แยกตาราง/ไม่ใช้ Storage เพราะแผนที่สาธารณะอ่านตารางนี้ด้วย role anon อยู่แล้ว ถ้าย้ายไป Storage
-- ต้องเปิด public bucket + policy ใหม่เพื่อไอคอนไม่กี่สิบรูป และไอคอนจะกลายเป็นลิงก์กำพร้าเวลา
-- renameIconTarget() ย้ายแถวตามการเปลี่ยนชื่อหมวด
--
-- ทำไมต้องมี CHECK: fetchGroupIconOverrides() ดึง "ทุกแถวของเทศบาล" ทุกครั้งที่เปิดหน้ารายการและ
-- แผนที่ ถ้ามีใครยัดรูปดิบหลายร้อย KB ผ่าน PostgREST ตรงๆ (ข้ามหน้าเว็บที่ย่อรูปให้) ทุกคนในเทศบาล
-- นั้นจะโหลดหน้าช้าลงทันทีและ egress ของ Supabase free tier (5GB/เดือน) หมดเร็ว — 16384 ตัวอักษร
-- ~= 12KB ต่อไอคอน มากพอสำหรับ PNG 64x64 ที่แอปสร้าง (จริงประมาณ 3-6KB) แต่กันรูปดิบไม่ให้เข้า
--
-- แถวเดิมทั้งหมดเป็นอิโมจิสั้นๆ จึงไม่มีแถวไหนขัด CHECK ตอน ALTER (ไม่ต้อง NOT VALID)
ALTER TABLE public.data_center_group_icons
  DROP CONSTRAINT IF EXISTS data_center_group_icons_emoji_len_chk;

ALTER TABLE public.data_center_group_icons
  ADD CONSTRAINT data_center_group_icons_emoji_len_chk
  CHECK (length(emoji) <= 16384);
