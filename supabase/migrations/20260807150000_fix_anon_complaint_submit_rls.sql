-- แก้บั๊ก: ประชาชนที่ไม่ login ยื่นคำร้องไม่ได้เลย (ทดสอบยืนยันจริงผ่าน REST API ตรงๆ ข้าม browser)
--
-- สาเหตุ: client เดิมใช้ .insert({...}).select('id, ref_no').single() — PostgREST ต้องเช็ค SELECT RLS
-- policy ด้วยเพื่อคืนแถวที่เพิ่ง insert กลับมา (เอาไปโชว์เลขที่คำร้องให้ประชาชน) แต่ SELECT policy ของ
-- ตาราง complaints ("complaints select by role scope") ไม่มีเงื่อนไขไหนอนุญาต anon อ่านแถวของตัวเองได้
-- เลย (เช็คแต่ user_id = auth.uid() ซึ่งสำหรับคนไม่ login ทั้งสองฝั่งเป็น NULL — NULL = NULL ได้ UNKNOWN
-- ไม่ใช่ TRUE ตาม 3-valued logic ของ SQL) ทำให้ Postgres โยน "new row violates row-level security
-- policy for table complaints" แม้ว่า INSERT policy ("anyone can submit complaint") จะผ่านแล้วก็ตาม
--
-- แก้ด้วย SECURITY DEFINER RPC แทนการเปิด SELECT policy ให้ anon อ่านคำร้อง — เปิด SELECT ให้ anon จะ
-- เป็นช่องโหว่ PDPA ทันที เพราะตาราง complaints มีชื่อ-เบอร์โทร-ที่อยู่จริงของประชาชนคนอื่นปนกันอยู่
-- ฟังก์ชันนี้ bypass RLS เฉพาะตอน insert+คืนค่า id/ref_no แต่ยังคุม user_id ไม่ให้สวมรอยเป็นคนอื่นเอง
-- ในฟังก์ชัน (เงื่อนไขเดียวกับที่ RLS with_check เดิมเคยบังคับไว้)
create or replace function public.submit_citizen_complaint(
  p_id              uuid,
  p_municipality_id uuid,
  p_category        text,
  p_form_type       text,
  p_village         text,
  p_detail          text,
  p_phone           text,
  p_reporter_name   text,
  p_latitude        double precision,
  p_longitude       double precision,
  p_user_id         uuid,
  p_channel         text,
  p_department      text
)
returns table (id uuid, ref_no text)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- กันสวมรอย: ถ้าระบุ user_id มา ต้องตรงกับผู้ login จริงเท่านั้น (เหมือน RLS with_check เดิมทุกประการ
  -- "anyone can submit complaint" — user_id IS NULL OR user_id = auth.uid())
  if p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'user_id ไม่ตรงกับผู้ใช้ที่ login';
  end if;

  insert into public.complaints (
    id, municipality_id, category, form_type, village, detail, phone,
    reporter_name, latitude, longitude, user_id, channel, department
  ) values (
    p_id, p_municipality_id, p_category, p_form_type, p_village, p_detail, p_phone,
    p_reporter_name, p_latitude, p_longitude, p_user_id, p_channel, p_department
  );

  return query select c.id, c.ref_no from public.complaints c where c.id = p_id;
end;
$$;

revoke all on function public.submit_citizen_complaint(
  uuid, uuid, text, text, text, text, text, text, double precision, double precision, uuid, text, text
) from public;
grant execute on function public.submit_citizen_complaint(
  uuid, uuid, text, text, text, text, text, text, double precision, double precision, uuid, text, text
) to anon, authenticated;
