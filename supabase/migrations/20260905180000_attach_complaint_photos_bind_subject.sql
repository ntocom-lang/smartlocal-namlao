-- 20260905180000_attach_complaint_photos_bind_subject.sql
--
-- ⚠️ apply **หลัง** deploy edge function drive-upload รุ่นที่บันทึก drive_files.subject แล้ว
-- เท่านั้น ถ้า apply ก่อน ไฟล์ที่อัปโหลดระหว่างนั้นจะมี subject = NULL แล้วแนบรูปไม่ได้
--
-- ปิดช่องที่ต่อกันเป็นโซ่กับการ enumerate ref_no:
--   get_complaint_by_ref คืน id ของคำร้อง + ref_no เป็นเลขเรียง → ได้ uuid ของคำร้อง
--   → ถ้าคำร้องไม่ระบุตัวตนและอายุ < 15 นาที เรียกตัวนี้เขียนทับ attachments ได้
--
-- ของเดิมสาขา Google Drive เช็กแค่ว่าไฟล์มีอยู่ใน drive_files และ bucket ตรง —
-- ไม่ได้ผูกกับคำร้องไหน ไฟล์ของคำร้อง A จึงเอาไปยัดใส่คำร้อง B ได้
--
-- ของใหม่บังคับเพิ่ม 2 อย่าง: subject ต้องเป็น id ของคำร้องนั้นเอง และ municipality_id
-- ของไฟล์ต้องตรงกับของคำร้อง (กันการยัดข้ามเทแนนต์ แม้จะเดา uuid ถูก)
--
-- สาขา Supabase Storage เดิมเข้มอยู่แล้ว (path ต้องมี /complaint-attachments/<id>/)
-- จึงไม่แตะ
--
-- ที่จงใจไม่แก้ในไฟล์นี้: เงื่อนไข "คำร้องไม่ระบุตัวตนอายุ < 15 นาที" ยังอยู่เหมือนเดิม
-- เพราะเป็นสิ่งที่ทำให้ผู้แจ้งที่ไม่ล็อกอินแนบรูปต่อจากตอนส่งเรื่องได้ ซึ่งเป็น flow จริง
-- (src/pages/CitizenForm.jsx อัปโหลดรูปหลัง insert คำร้อง) การถอดออกจะทำให้แนบรูปไม่ได้เลย

create or replace function public.attach_complaint_photos(p_complaint_id uuid, p_urls text[])
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows     int;
  u          text;
  v_drive_id text;
  v_muni     uuid;
begin
  select municipality_id into v_muni from complaints where id = p_complaint_id;
  if v_muni is null then
    return false;
  end if;

  foreach u in array p_urls loop
    -- Supabase Storage: path ผูกกับ complaint id อยู่แล้ว
    if u ~* ('/complaint-attachments/' || p_complaint_id::text || '/') then
      continue;
    end if;

    -- Google Drive: ต้องเป็นไฟล์ที่อัปโหลดให้คำร้องนี้ ใน อปท. เดียวกันเท่านั้น
    v_drive_id := substring(u from 'drive\.google\.com/uc\?id=([^&]+)');
    if v_drive_id is not null and exists (
      select 1 from drive_files df
      where df.id = v_drive_id
        and df.bucket = 'complaint-attachments'
        and df.subject = p_complaint_id::text
        and df.municipality_id = v_muni
    ) then
      continue;
    end if;

    return false;
  end loop;

  update complaints set attachments = p_urls where id = p_complaint_id
    and ((user_id = auth.uid() and auth.uid() is not null)
      or (user_id is null and created_at > now() - interval '15 minutes'));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;
