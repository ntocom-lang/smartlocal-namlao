-- 20260828110000_odor_adhoc_namlao_only.sql
--
-- หมวดเฉพาะกิจ "กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)" ถูก insert ให้ทุกเทศบาลพร้อมกันตอนตั้งหมวด
-- (created_at เดียวกันเป๊ะทั้ง 4 แห่ง) แต่โครงการนี้ใช้จริงเฉพาะ เทศบาลตำบลน้ำเลา เท่านั้น
--
-- ผลของการเปิดค้างไว้: ประชาชนในอีก 3 เทศบาลเห็นตัวเลือกนี้ในฟอร์มและกดแจ้งได้จริง แต่ไม่มีแถวใน
-- category_assignments ทำให้ auto_assign_complaint() ปล่อย assigned_to เป็น NULL พอเจอ RLS ของ
-- หมวดเฉพาะกิจ (เห็นได้เฉพาะ assigned_to = auth.uid() หรือ admin/superadmin — ดู
-- 20260827120000_restrict_odor_adhoc_visibility.sql) จะไม่มีเจ้าหน้าที่คนไหนเห็นคำร้องนั้นเลย
-- และ OdorAcknowledgePanel ก็ไม่ขึ้น = คำร้องตกหล่นเงียบโดยประชาชนไม่รู้ตัว
--
-- ปิดการมองเห็นเฉพาะ 3 เทศบาลที่ไม่ได้ใช้ ไม่ลบแถวทิ้ง เพื่อให้เปิดคืนได้ทันทีถ้าเทศบาลไหนจะใช้
-- (ตอนเปิดคืนต้องตั้งผู้รับผิดชอบใน category_assignments ก่อนเสมอ ไม่งั้นเจอปัญหาเดิม)
-- ปลอดภัยเพราะทั้ง 3 แห่งยังไม่มีคำร้อง odor สักรายการ — ตรวจแล้วก่อนรัน
--
-- อ้างอิงเทศบาลด้วย slug ไม่ใช่ uuid เพราะ uuid เป็นค่า generate ต่อ environment
UPDATE public.complaint_categories cc
SET is_active = false
FROM public.municipalities m
WHERE m.id = cc.municipality_id
  AND cc.value = 'odor'
  AND m.slug <> 'namlao';
