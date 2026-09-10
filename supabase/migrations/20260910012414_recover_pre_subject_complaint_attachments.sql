-- 20260910012414_recover_pre_subject_complaint_attachments.sql
--
-- กู้รูปแนบของคำร้องยุคก่อน 3 ก.ย. 2569 ซึ่ง drive_files ยังไม่บันทึกคอลัมน์ subject
-- (ดู 20260905160000) จึง backfill ด้วย SQL อย่างเดียวไม่ได้
--
-- วิธีที่ใช้: ไล่ parentId ของแต่ละไฟล์บน Google Drive ขึ้นไปทีละชั้นจนถึงโฟลเดอร์ชั้นสุดท้าย
-- ที่ drive-upload ตั้งชื่อเป็น uuid ของคำร้อง (โครงสร้าง: SmartLocal ไฟล์แนบ / <slug> / <ปี พ.ศ.>
-- / <ประเภท> / <uuid คำร้อง> / <ไฟล์>) แล้วจับคู่กลับ — mapping ด้านล่างมาจากการไล่จริงทีละไฟล์
--
-- คัดเฉพาะไฟล์ชื่อ "<uuid>.jpg" ซึ่งเป็นรูปแบบที่ CitizenForm.jsx ตั้งให้รูปที่ประชาชนแนบ
-- (`${crypto.randomUUID()}.jpg`) ไฟล์ที่เหลือในกลุ่มกำพร้าตรวจแล้วไม่ใช่ของคำร้อง:
--   - work_*.jpeg  = รูปผลการดำเนินการของเจ้าหน้าที่ อยู่คอลัมน์ complaints.work_photos
--                    และคำร้องเจ้าของมีรูปผลงานครบอยู่แล้ว (เป็นรุ่นที่ถูกแทนที่) จึงไม่ยัดกลับ
--   - photo_*.jpg / <timestamp>.jpg = ถูกใช้ในโมดูลท่องเที่ยว (tourism_places) และข่าวสาร (posts) อยู่แล้ว
--
-- เติม subject ย้อนหลังให้ drive_files ด้วย เพื่อให้ข้อมูลสอดคล้องกับความจริง และถ้าประชาชน
-- กดแนบไฟล์ชุดเดิมซ้ำในอนาคต attach_complaint_photos จะตรวจผ่านตามกติกาปกติ
--
-- idempotent: เติม subject เฉพาะแถวที่ยังเป็น null และเขียน attachments เฉพาะใบที่ยังว่าง
with recovered(file_id, complaint_id) as (values
  ('1TRE8YxggptCb4-BYKl0vEUrHoJoWjCc4', '83e9ddfa-a24e-4eca-aa16-d4aa645dd840'), -- ES-69-0133 namlao
  ('1CSce9LBoYQiJNjyn5YGgzeTjplen96-K', '1c71ee5e-4366-4679-a6f0-c50d20211aae'), -- ES-69-0150 namlao
  ('1n2CfdlRaFsvYtd3nKWgovuJu1qWPq-gR', '7350583d-a856-4e55-87be-4a353468ce69'), -- ES-69-0154 namlao
  ('1-idio2kNxgTCtWWqoZJ0JG6A3w3EfrsA', '3b7d7eb6-fc92-44bf-a778-82aac45e52ae')  -- ES-69-0007 thungkaew
),
fix_subject as (
  update public.drive_files df
  set subject = r.complaint_id
  from recovered r
  where df.id = r.file_id
    and df.subject is null
    and df.bucket = 'complaint-attachments'
    -- ไฟล์ต้องอยู่ อปท. เดียวกับคำร้อง กันแนบข้ามหน่วยงานถ้า mapping ผิด
    and df.municipality_id = (select c.municipality_id from public.complaints c where c.id = r.complaint_id::uuid)
  returning df.id
)
update public.complaints c
set attachments = array['https://umxssfahtuprnztlytdd.supabase.co/functions/v1/drive-file?id=' || r.file_id]
from recovered r
where c.id = r.complaint_id::uuid
  and coalesce(array_length(c.attachments,1),0) = 0
  and r.file_id in (select id from fix_subject);
