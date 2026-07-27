-- 136_drop_blanket_true_policies_profiles_complaints.sql
-- พบระหว่าง verify migration 132/133 บน live DB: มี 2 policy ที่ USING(true) เปิดโล่ง
-- อยู่คู่ขนานกับ policy อื่นที่ scope ตาม role/municipality ถูกต้อง (RLS permissive
-- policies รวมกันแบบ OR ทำให้ policy เดียวที่หลุดมา = ทำลาย policy อื่นทั้งหมด)
-- ไม่มีในไฟล์ migration ใดๆ ก่อนหน้านี้ — schema drift จากการแก้ตรงใน SQL Editor/Dashboard
--
--   - profiles: "allow read profiles for authenticated" (role=authenticated, USING true)
--     → authenticated ทุกคนอ่านโปรไฟล์ทุกคนได้หมด รวมเลขบัตรประชาชน
--   - complaints: "municipality staff can read all complaints" (role=PUBLIC รวม anon,
--     USING true) → ใครก็ได้แม้ไม่ login อ่านคำร้องทุกใบของทุกเทศบาลได้ตรงๆ
--
-- policy อื่นที่ scope ถูกต้องบนทั้งสองตาราง (citizen read own, staff read own
-- municipality, admin read municipality, ฯลฯ) ยังอยู่ครบ ไม่กระทบสิทธิ์ใช้งานจริง

DROP POLICY IF EXISTS "allow read profiles for authenticated" ON public.profiles;
DROP POLICY IF EXISTS "municipality staff can read all complaints" ON public.complaints;
