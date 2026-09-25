-- 20260925100000_complaint_category_submit_audience.sql
--
-- [เฟส DDL] ธงรายหมวด "ใครแจ้งคำร้องหมวดนี้ได้" — ทุกคน / เฉพาะผู้มีตำแหน่ง
-- ด่านบังคับจริงอยู่ไฟล์ถัดไป 20260925100100 — แยกไฟล์ตามกติกา ADD COLUMN แล้วอ้างในไฟล์เดียวกันไม่ได้
--
-- ที่มา: เจ้าของระบบต้องการเปิดหมวดให้ผู้มีตำแหน่ง (สมาชิกสภา เจ้าหน้าที่ ผู้บริหาร) ใช้ก่อน
-- แล้วค่อยเปิดให้ประชาชน เช่น คำร้องไฟฟ้าสาธารณะให้ สท. แจ้งแทนประชาชนในเขตไปก่อน (ตัดสินใจ 2569-09-25)
-- เดิมมีแค่ is_active ซึ่งเปิด/ปิดกับทุกคนพร้อมกัน
--
--   'public'    = ทุกคน รวมผู้ไม่ล็อกอิน (ค่าตั้งต้น = พฤติกรรมเดิมของทุกหมวด)
--   'officials' = เฉพาะบัญชีที่ role ไม่ใช่ประชาชนและสังกัด อปท. นี้ — ต้องตรงกับ OFFICIAL_ROLES
--                 ใน src/lib/serviceAudience.js
--
-- จำกัดเฉพาะช่องทางยื่นออนไลน์ด้วยตนเอง ไม่ใช่ตัดสิทธิ์ร้องเรียน — เจ้าหน้าที่ยังรับเรื่องแทนประชาชน
-- ที่เคาน์เตอร์ได้ทุกหมวด เพราะผู้เรียกฟังก์ชันคือเจ้าหน้าที่ซึ่งเป็นผู้มีตำแหน่ง

ALTER TABLE public.complaint_categories
  ADD COLUMN IF NOT EXISTS submit_audience text NOT NULL DEFAULT 'public'
    CHECK (submit_audience IN ('public', 'officials'));

COMMENT ON COLUMN public.complaint_categories.submit_audience IS
  'ใครแจ้งคำร้องหมวดนี้ได้: public = ทุกคน, officials = เฉพาะผู้มีตำแหน่ง (role ไม่ใช่ citizen) ของ อปท. นี้ — บังคับที่ submit_citizen_complaint_v4';

-- complaint_categories ใช้ table-level GRANT (ไม่ใช่ column-level แบบ municipalities)
-- คอลัมน์ใหม่จึงอ่านได้ทุกคนและแก้ได้เฉพาะแอดมินตาม policy เดิมทันที ไม่ต้อง GRANT เพิ่ม
-- (ตรวจแล้วที่ 20260915100000_complaint_auto_receive_columns.sql)

-- ตรวจหลัง apply:
--   select submit_audience, count(*) from public.complaint_categories group by 1;
--   → ได้แถวเดียวคือ public (ยังไม่มีหมวดไหนเปลี่ยน)
