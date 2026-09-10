-- 20260910010629_attach_complaint_photos_accept_proxy_url.sql
--
-- แก้บั๊ก: ประชาชนแนบรูปในคำร้อง ไฟล์ขึ้น Google Drive สำเร็จ (มีแถวใน drive_files จริง)
-- แต่ complaints.attachments ว่างทุกใบตั้งแต่ 17 ส.ค. 2569 — เจ้าหน้าที่จึงเห็นคำร้องไม่มีรูป
--
-- ต้นเหตุ: commit f713be7 (20 ส.ค. 2569) เปลี่ยน URL ของไฟล์รูป public ที่ drive-upload คืนกลับ
-- จาก https://drive.google.com/uc?id=FILE_ID เป็น proxy ของเราเอง
-- <SUPABASE_URL>/functions/v1/drive-file?id=FILE_ID (เพราะ hotlink ตรงจาก Drive ไม่เสถียร —
-- uc?id= เด้งหน้าเลือกบัญชี Google บนมือถือ ส่วน lh3.googleusercontent.com โดน ORB บล็อกใน
-- Chromium/Edge) แต่ attach_complaint_photos ยังรู้จักแค่ pattern uc?id= เหมือนเดิม URL ใหม่จึง
-- ไม่ผ่าน validation ทุกครั้ง ฟังก์ชัน return false ทั้งชุดโดยไม่เขียนอะไรลงตาราง
--
-- ⚠️ บั๊กหน้าตาเดียวกันนี้เคยเกิดแล้วเมื่อ 7 ส.ค. (ดู 20260807141109) — validation ตัวนี้ผูกกับ
-- รูปแบบ URL ที่ drive-upload สร้าง ใครแก้ URL ฝั่ง Edge Function ต้องมาแก้ที่นี่คู่กันเสมอ
--
-- สิ่งที่ยังคงไว้ครบ ไม่ได้ลดความเข้มของการตรวจ (ดูเหตุผลใน 20260905180000):
--   - ไฟล์ต้องมีแถวจริงใน drive_files ที่ bucket = 'complaint-attachments'
--   - subject ต้องตรงกับ complaint id ที่กำลังแนบ (กันสวมรอยแนบไฟล์ของคำร้องอื่น)
--   - municipality_id ต้องเป็น อปท. เดียวกับคำร้อง
--   - URL proxy ต้องอยู่บนโดเมน *.supabase.co เท่านั้น ไม่งั้นผู้ยิง RPC จะยัด URL ปลายทางเป็น
--     โดเมนตัวเองที่ลงท้ายด้วย /functions/v1/drive-file?id=<id ของจริง> แล้วให้เจ้าหน้าที่เปิดได้
--
-- CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน จึงยกเนื้อเดิมมาครบทุกบรรทัด ห้ามตัดทอนเหลือ stub
create or replace function public.attach_complaint_photos(p_complaint_id uuid, p_urls text[])
returns boolean
language plpgsql
security definer
set search_path = 'public'
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

    -- Google Drive: รับได้ 2 รูปแบบที่ drive-upload สร้าง
    --   (1) https://drive.google.com/uc?id=FILE_ID                     — ไฟล์ที่ไม่ใช่รูป เช่น PDF
    --   (2) https://<ref>.supabase.co/functions/v1/drive-file?id=FILE_ID — รูปทุกชนิด (proxy)
    v_drive_id := substring(u from '^https://drive\.google\.com/uc\?id=([^&]+)$');
    if v_drive_id is null then
      v_drive_id := substring(u from '^https://[a-z0-9-]+\.supabase\.co/functions/v1/drive-file\?id=([^&]+)$');
    end if;

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
