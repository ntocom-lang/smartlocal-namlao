-- เพิ่ม "ลักษณะปัญหา" แบบเลือกตัวเลือก (เช่น ไฟดับทั้งดวง/ไฟกระพริบ/... สำหรับหมวดไฟฟ้าสาธารณะ) แยกจาก
-- ช่องรายละเอียดอิสระเดิม (complaints.detail) เพื่อให้กรอง/ออกรายงานสถิติตามลักษณะปัญหาได้จริงในอนาคต
alter table public.complaints
  add column if not exists issue_type text;

-- ไม่แก้ submit_citizen_complaint(...) เดิมตรงๆ (13 พารามิเตอร์) เพราะ Postgres ต้องรู้ signature เดิม
-- แน่ชัด 100% ก่อนถึงจะ DROP+CREATE ใหม่ให้ตรงได้ปลอดภัย และ RPC เดิมมีความสำคัญสูงมาก (ใช้โดยทุกหมวด
-- คำร้องของทุกเทศบาล พลาดแล้วยื่นคำร้องไม่ได้ทั้งระบบ) — สร้างฟังก์ชันใหม่แยกต่างหากแทน (เพิ่ม p_issue_type
-- default null ต่อท้าย) ให้ CitizenForm.jsx เปลี่ยนมาเรียกตัวนี้แทนทั้งหมด (ทุกหมวดคำร้อง ไม่ใช่แค่ไฟฟ้า)
-- ฟังก์ชันเดิม (13 พารามิเตอร์) ปล่อยไว้เฉยๆ ไม่ลบ กันกรณีมีจุดอื่นเรียกอยู่ที่ยังหาไม่เจอ
create or replace function public.submit_citizen_complaint_v2(
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
  p_department      text,
  p_issue_type      text default null
)
returns table (id uuid, ref_no text)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- กันสวมรอย — เงื่อนไขเดียวกับ submit_citizen_complaint เดิมทุกประการ
  if p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'user_id ไม่ตรงกับผู้ใช้ที่ login';
  end if;

  insert into public.complaints (
    id, municipality_id, category, form_type, village, detail, phone,
    reporter_name, latitude, longitude, user_id, channel, department, issue_type
  ) values (
    p_id, p_municipality_id, p_category, p_form_type, p_village, p_detail, p_phone,
    p_reporter_name, p_latitude, p_longitude, p_user_id, p_channel, p_department, p_issue_type
  );

  return query select c.id, c.ref_no from public.complaints c where c.id = p_id;
end;
$$;

revoke all on function public.submit_citizen_complaint_v2(
  uuid, uuid, text, text, text, text, text, text, double precision, double precision, uuid, text, text, text
) from public;
grant execute on function public.submit_citizen_complaint_v2(
  uuid, uuid, text, text, text, text, text, text, double precision, double precision, uuid, text, text, text
) to anon, authenticated;
