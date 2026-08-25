-- v2 (2026-08-24) กลายเป็น critical path ของทุกหมวดคำร้องทุกเทศบาลไปแล้ว — เหตุผลเดียวกับตอนสร้าง v2:
-- ไม่แก้ v2 ตรงๆ เพราะพลาดแล้วยื่นคำร้องไม่ได้ทั้งระบบ สร้างฟังก์ชันใหม่แยก (เพิ่ม p_extra_data jsonb
-- default null ต่อท้าย) ให้ CitizenForm.jsx เปลี่ยนมาเรียกตัวนี้แทนทั้งหมด (ทุกหมวด ไม่ใช่แค่ odor)
-- v1/v2 ปล่อยไว้เฉยๆ ไม่ลบ กันกรณีมีจุดอื่นเรียกอยู่ที่ยังหาไม่เจอ
create or replace function public.submit_citizen_complaint_v3(
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
  p_issue_type      text default null,
  p_extra_data      jsonb default null
)
returns table (id uuid, ref_no text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is not null and p_user_id <> auth.uid() then
    raise exception 'user_id ไม่ตรงกับผู้ใช้ที่ login';
  end if;

  insert into public.complaints (
    id, municipality_id, category, form_type, village, detail, phone,
    reporter_name, latitude, longitude, user_id, channel, department, issue_type, extra_data
  ) values (
    p_id, p_municipality_id, p_category, p_form_type, p_village, p_detail, p_phone,
    p_reporter_name, p_latitude, p_longitude, p_user_id, p_channel, p_department, p_issue_type, p_extra_data
  );

  return query select c.id, c.ref_no from public.complaints c where c.id = p_id;
end;
$$;

revoke all on function public.submit_citizen_complaint_v3(
  uuid, uuid, text, text, text, text, text, text, double precision, double precision, uuid, text, text, text, jsonb
) from public;
grant execute on function public.submit_citizen_complaint_v3(
  uuid, uuid, text, text, text, text, text, text, double precision, double precision, uuid, text, text, text, jsonb
) to anon, authenticated;
