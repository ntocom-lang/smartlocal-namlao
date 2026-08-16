-- แก้บั๊ก: อัปโหลดรูปคำร้องขึ้น Google Drive สำเร็จ (เห็นแถวใน drive_files จริง) แต่บันทึกลง
-- complaints.attachments ไม่ผ่าน ("attach_failed") — สาเหตุคือ attach_complaint_photos เดิม
-- ตรวจ URL ทุกตัวด้วย regex '/complaint-attachments/{complaint_id}/' ซึ่งเป็นรูปแบบ path ของ
-- Supabase Storage เท่านั้น URL ใหม่จาก Google Drive (https://drive.google.com/uc?id=FILE_ID)
-- ไม่มี path แบบนั้นเลย เลยไม่ผ่าน validation ทุกครั้ง (ตั้งใจเขียนกันไว้แต่แรกเพื่อกันแนบ URL
-- แปลกปลอม/ของคำร้องอื่นสวมรอยผ่าน RPC ตัวนี้ — ต้องคงไว้ ไม่ใช่แค่ตัดออก)
--
-- แก้โดยรับ URL ได้ 2 รูปแบบ: (1) Supabase Storage path เดิม (ของคำร้องเก่าก่อนย้ายระบบ ยังมีโค้ด
-- fallback อ่านได้อยู่) หรือ (2) Drive URL ที่ตรงกับแถวจริงใน drive_files ที่ bucket=complaint-attachments
-- (ยืนยันว่าไฟล์ถูกอัปโหลดผ่าน drive-upload function ของเราเองจริง ไม่ใช่ลิงก์ภายนอกที่ใครก็ยัดเข้ามาได้)
create or replace function public.attach_complaint_photos(p_complaint_id uuid, p_urls text[])
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_rows int;
  u text;
  v_drive_id text;
begin
  foreach u in array p_urls loop
    if u ~* ('/complaint-attachments/' || p_complaint_id::text || '/') then
      continue; -- URL แบบเก่า (Supabase Storage) อยู่ในโฟลเดอร์ของคำร้องนี้เอง ผ่าน
    end if;

    v_drive_id := substring(u from 'drive\.google\.com/uc\?id=([^&]+)');
    if v_drive_id is not null and exists (
      select 1 from drive_files where id = v_drive_id and bucket = 'complaint-attachments'
    ) then
      continue; -- ไฟล์บน Google Drive ที่อัปโหลดผ่าน drive-upload function จริง เข้า bucket ถูกต้อง ผ่าน
    end if;

    return false; -- URL แปลกปลอม ไม่ผ่านทั้งสองรูปแบบ ปฏิเสธทั้งชุด
  end loop;

  update complaints set attachments = p_urls where id = p_complaint_id
    and ((user_id = auth.uid() and auth.uid() is not null)
      or (user_id is null and created_at > now() - interval '15 minutes'));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;
