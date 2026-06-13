-- 062_complaint_ref_lookup.sql
-- RPC สำหรับประชาชนที่ไม่ได้ login ค้นหาคำร้องด้วยเลขอ้างอิง

drop function if exists get_complaint_by_ref(_ref_no text, _municipality_id uuid);

create or replace function get_complaint_by_ref(_ref_no text, _municipality_id uuid)
returns table (
  id uuid, ref_no text, category text, subject text, detail text,
  status text, created_at timestamptz, due_date date,
  village text, latitude double precision, longitude double precision,
  phone text, reporter_name text,
  attachments jsonb, work_photos jsonb, technician_note text
)
language sql
security definer
set search_path = public
as $$
  select
    id, ref_no, category, subject, detail,
    status, created_at, due_date,
    village, latitude, longitude,
    phone, reporter_name,
    to_jsonb(attachments), work_photos, technician_note
  from complaints
  where ref_no = upper(trim(_ref_no))
    and municipality_id = _municipality_id
  limit 1;
$$;

grant execute on function get_complaint_by_ref(text, uuid) to anon, authenticated;
