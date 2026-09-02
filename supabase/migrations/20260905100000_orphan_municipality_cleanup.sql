-- 20260905100000_orphan_municipality_cleanup.sql
--
-- ล้าง orphan rows ที่ค้างจาก อปท. 2 รายที่ถูกลบไปแล้ว
--   4a3b6295-ceda-4ca9-999c-35b3309485e9
--   7bd54a2c-dd4e-4b29-825f-6c6914558e19
--
-- ต้นเหตุ: ไม่มีตารางไหนใน 8 ตารางนี้มี FK บน municipality_id เลย การลบ อปท. จึงทิ้ง
-- ข้อมูลลูกไว้เงียบๆ ไฟล์ถัดไป (20260905110000) ใส่ FK เพื่อไม่ให้เกิดซ้ำ
--
-- ขอบเขตของไฟล์นี้: ลบเฉพาะ "ข้อมูลตั้งค่า" ที่ไม่มีคุณค่าเชิงหลักฐาน
-- **ไม่ลบ** complaints 5 แถว และ profiles 1 แถว — คำร้องเป็นหลักฐานที่ สตง. อาจขอดู
-- และ profile คือบัญชีผู้ใช้จริง (การลบทิ้งเงียบๆ เป็นคนละเรื่องกับการปิดใช้งาน)
--
-- จุดที่เกือบพลาด: complaint_categories 2 ใน 20 แถวยังถูก complaints 5 เรื่องที่เก็บไว้
-- อ้างถึงอยู่ และ FK เป็น ON DELETE SET NULL — ลบทิ้งหมด = คำร้องที่ตั้งใจรักษาไว้
-- เสียหมวดหมู่ทันที จึงเว้น 2 แถวนั้นไว้เป็น tombstone (ลบจริง 18 จาก 20)

begin;

-- 1. category_assignments (10) — ตารางใบ ไม่มีอะไรอ้างถึง
delete from public.category_assignments ca
where ca.municipality_id is not null
  and not exists (select 1 from public.municipalities m where m.id = ca.municipality_id);

-- 2. locations (20) — ตรวจแล้วไม่มี FK ขาเข้าจากตารางไหน
delete from public.locations l
where l.municipality_id is not null
  and not exists (select 1 from public.municipalities m where m.id = l.municipality_id);

-- 3. emergency_contacts (7) — anon อ่านเจอผ่าน PostgREST ได้จริง
--    เพราะ policy อ่านสาธารณะเป็น USING (is_active = true) ล้วน ไม่กรอง municipality_id
--    (ไฟล์ 20260905120000 รัดนโยบายนั้นเป็นชั้นที่สอง)
delete from public.emergency_contacts ec
where ec.municipality_id is not null
  and not exists (select 1 from public.municipalities m where m.id = ec.municipality_id);

-- 4. complaint_categories (18 จาก 20) — เว้นแถวที่ complaints ยังอ้างถึง
delete from public.complaint_categories cc
where cc.municipality_id is not null
  and not exists (select 1 from public.municipalities m where m.id = cc.municipality_id)
  and not exists (select 1 from public.complaints c where c.category_id = cc.id);

commit;
