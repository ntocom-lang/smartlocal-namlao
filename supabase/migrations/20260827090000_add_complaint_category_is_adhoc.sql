-- แยกหมวดคำร้อง "ปกติ" กับ "เฉพาะกิจ" (เช่น กลิ่นเหม็นรบกวน ที่ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน)
-- ให้แอดมินเห็นเป็นแท็ปแยกในหน้าจัดการประเภทคำร้อง และตั้งหมวดใหม่เป็นเฉพาะกิจได้เองในอนาคตโดยไม่ต้องแก้โค้ด
alter table public.complaint_categories
  add column if not exists is_adhoc boolean not null default false;

-- backfill หมวด odor ที่มีอยู่แล้วทุกเทศบาลให้เป็นเฉพาะกิจทันที (ไม่ต้องรอแอดมินมากดตั้งค่าเอง)
update public.complaint_categories
set is_adhoc = true
where value = 'odor';
