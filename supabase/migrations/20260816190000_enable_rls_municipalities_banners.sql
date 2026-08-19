-- ⚠️ พบว่า public.municipalities และ public.banners มี RLS policy เขียนไว้ครบแล้ว
-- แต่ RLS flag ของตารางเองไม่เคย ENABLE เลย ทำให้ policy ทั้งหมดไม่ทำงานจริง
-- ประกอบกับ anon role มีสิทธิ์ SELECT/INSERT/UPDATE/DELETE เต็มในระดับ GRANT ของ Postgres
-- (ซึ่งปกติ RLS จะเป็นตัวกรองไม่ให้ GRANT เหล่านี้ถูกใช้แบบไม่มีเงื่อนไข) เท่ากับว่าทุกคนบนอินเทอร์เน็ต
-- (ไม่ต้องล็อกอิน) แก้ไข/ลบข้อมูลของทุก อปท. ในระบบได้ รวมถึง bank_account_no, promptpay_id,
-- google_maps_api_key ในตาราง municipalities — เปิด RLS ให้ policy ที่มีอยู่แล้วบังคับใช้จริง
-- (ไม่ลบ/ไม่แก้ policy เดิม เพราะตรวจสอบแล้วว่าเขียนถูกต้อง แค่ยังไม่ถูกเปิดใช้งาน)

ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
