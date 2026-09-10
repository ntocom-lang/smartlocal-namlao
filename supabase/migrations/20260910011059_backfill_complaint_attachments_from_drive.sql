-- 20260910011059_backfill_complaint_attachments_from_drive.sql
--
-- กู้รูปแนบของคำร้องที่หายไปจากบั๊กใน 20260910010629 — ไฟล์ขึ้น Google Drive ครบ (drive_files มีแถวจริง
-- พร้อม subject = complaint id) แต่ complaints.attachments ว่าง เพราะ attach_complaint_photos ปฏิเสธ
-- URL รูปแบบใหม่ทุกครั้ง เจ้าหน้าที่จึงเห็นคำร้องไม่มีรูปมาตั้งแต่ 17 ส.ค. 2569
--
-- ประกอบ URL ตามกติกาเดียวกับ supabase/functions/drive-upload/index.ts:
--   รูป (content_type image/*) -> proxy /functions/v1/drive-file?id=  (กัน ORB block + หน้าเลือกบัญชี Google)
--   ไฟล์อื่น (PDF ฯลฯ)          -> https://drive.google.com/uc?id=
--
-- ⚠️ project ref ใน URL hardcode ไว้ตรงนี้โดยตั้งใจ — เป็น data migration ครั้งเดียวของฐานข้อมูลนี้
-- ไม่ใช่โค้ดที่ใช้ซ้ำ ถ้าย้ายโปรเจกต์ Supabase ห้ามรันไฟล์นี้ซ้ำโดยไม่แก้ ref
--
-- idempotent: แตะเฉพาะคำร้องที่ attachments ว่างจริง รันซ้ำได้ ไม่เขียนทับของที่แนบสำเร็จแล้ว
-- ไฟล์ที่ subject เป็น null (อัปโหลดก่อน 3 ก.ย. 2569 ซึ่งยังไม่บันทึก subject) กู้ด้วยวิธีนี้ไม่ได้
-- ต้องไล่จากชื่อโฟลเดอร์บน Google Drive ซึ่งตั้งเป็น uuid ของเรื่องไว้ — แยกทำต่างหาก
with f as (
  select df.subject::uuid as complaint_id,
         array_agg(
           case when coalesce(df.content_type,'') like 'image/%'
                then 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/drive-file?id=' || df.id
                else 'https://drive.google.com/uc?id=' || df.id end
           order by df.created_at
         ) as urls
  from public.drive_files df
  where df.bucket = 'complaint-attachments'
    and df.subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by 1
)
update public.complaints c
set attachments = f.urls
from f
where c.id = f.complaint_id
  and coalesce(array_length(c.attachments,1),0) = 0;
