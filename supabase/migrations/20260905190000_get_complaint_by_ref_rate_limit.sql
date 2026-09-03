-- 20260905190000_get_complaint_by_ref_rate_limit.sql
--
-- ใส่ rate limit ให้ get_complaint_by_ref (ดูเหตุผลและวิธีเลือกตัวระบุผู้เรียกใน 20260905170000)
--
-- ตัวฟังก์ชันเดิมไม่แก้ตรรกะ mask เลย — ของเดิม mask ได้ดีอยู่แล้ว ที่เติมคือ 3 บรรทัดแรก
--
-- ใช้ SQLSTATE 'PT429' เพราะ PostgREST แปลง PTxxx เป็น HTTP status นั้นตรงๆ
-- ฝั่งหน้าเว็บจึงแยกได้ว่า "ยิงถี่เกินไป" ไม่ใช่ "ไม่พบเลขที่นี้" — ถ้าไม่แยก
-- ผู้ใช้จะเห็นว่าไม่พบเรื่องของตัวเองซึ่งชวนให้เข้าใจผิดหนักกว่าเดิม
-- (แก้ฝั่งหน้าเว็บใน src/pages/MyComplaints.jsx คอมมิตเดียวกัน)
--
-- return type ไม่เปลี่ยน จึงใช้ CREATE OR REPLACE ได้ ไม่ต้อง DROP
-- และเพราะไม่เปลี่ยน signature จึงไม่ต้องทำ v2/revoke แบบ set_document_signatory
-- ไฟล์นี้ apply ก่อน deploy ได้ปลอดภัย: โค้ดหน้าเว็บรุ่นเก่าจะได้ error 429 แทนผลลัพธ์
-- ซึ่งมันจัดการเป็น "ไม่พบ" อยู่แล้ว ไม่ใช่จอขาว

create or replace function public.get_complaint_by_ref(_ref_no text, _municipality_id uuid)
returns table(id uuid, ref_no text, category text, subject text, detail text, status text,
              created_at timestamp with time zone, due_date date, village text,
              latitude double precision, longitude double precision, phone text,
              reporter_name text, attachments jsonb, work_photos jsonb,
              technician_note text, rating smallint, can_rate boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row        complaints%rowtype;
  v_privileged boolean;
  v_owner      boolean;
  v_can_rate   boolean;
begin
  if not rpc_rate_limit_hit('complaint_by_ref', 30, interval '5 minutes') then
    raise exception 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' using errcode = 'PT429';
  end if;

  select * into v_row
  from complaints
  where complaints.ref_no = upper(trim(_ref_no))
    and complaints.municipality_id = _municipality_id
  limit 1;

  if not found then
    return;
  end if;

  -- privileged = เจ้าของคำร้อง หรือ เจ้าหน้าที่ municipality เดียวกัน
  v_privileged := (
    auth.uid() is not null and (
      v_row.user_id = auth.uid()
      or (
        get_my_role() in ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council')
        and get_my_municipality_id() = v_row.municipality_id
      )
    )
  );

  v_owner := auth.uid() is not null and v_row.user_id = auth.uid();

  -- เจ้าหน้าที่/คนอื่นที่ล็อกอินอยู่ให้คะแนนแทนไม่ได้ (rate_complaint จะปฏิเสธอยู่แล้ว
  -- ตรงนี้แค่ไม่ต้องโชว์ปุ่มให้กดเสียเที่ยว)
  v_can_rate :=
    v_row.status in ('closed', 'completed')
    and (auth.uid() is null or v_owner)
    and not exists (
      select 1 from satisfaction_ratings sr
      where sr.complaint_id = v_row.id
        and sr.is_verified = v_owner
    );

  return query
  select
    v_row.id, v_row.ref_no, v_row.category,
    case when v_privileged then v_row.subject else null end,
    case when v_privileged then v_row.detail  else null end,
    v_row.status, v_row.created_at, v_row.due_date,
    case when v_privileged then v_row.village   else null end,
    case when v_privileged then v_row.latitude  else null end,
    case when v_privileged then v_row.longitude else null end,
    case
      when v_privileged  then v_row.phone
      when v_row.phone is null then null
      else left(v_row.phone, 3) || repeat('x', greatest(0, length(v_row.phone) - 6)) || right(v_row.phone, 3)
    end,
    case when v_privileged then v_row.reporter_name else null end,
    case when v_privileged then to_jsonb(v_row.attachments) else null end,
    case when v_privileged then v_row.work_photos     else null end,
    case when v_privileged then v_row.technician_note else null end,
    case when v_privileged then v_row.rating else null end,
    v_can_rate;
end;
$function$;
