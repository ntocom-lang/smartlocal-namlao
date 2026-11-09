-- 20261114100000_close_anon_ref_rating.sql
--
-- ปิดช่อง "ยึดช่องคะแนน unverified" ของคำร้องจากผู้ไม่ล็อกอินที่ค้นด้วยเลขอ้างอิง
--
-- ปัญหา: satisfaction_ratings มี unique (complaint_id, is_verified) — 1 เรื่องมีช่อง unverified
-- ได้ช่องเดียว ใช้ร่วมกัน 3 ทาง: ค้นเลขอ้างอิงแบบไม่ล็อกอิน (rate_complaint), ลิงก์ /t/
-- (rate_complaint_by_track_token, via_link) และ สท. บันทึกแทน (rate_complaint_on_behalf,
-- rated_by_proxy) ใครกดก่อนได้ช่องไป
-- ref_no เป็นเลขเรียงคาดเดาได้ get_complaint_by_ref คืน id ให้ anon (rate limit 30/5 นาที/IP)
-- → คนนอกไล่ยิงคะแนนปลอมใส่ทุกเรื่องที่ปิดแล้วได้ราว 360 เรื่อง/ชม./IP และทำให้ สท. บันทึกแทน
-- ไม่ได้ (already_rated)
--
-- ทางที่เจ้าของระบบเลือก (2026-11-09 ทาง A): เลิกให้ผู้ไม่ล็อกอินให้คะแนนผ่านเลขอ้างอิง
--   ข้อมูลจริงวันที่ตัดสิน: คะแนนจากทางนี้ = 0 แถวทุก อปท. จึงไม่มีคะแนนจริงหาย
--   ผู้ยื่นที่มีบัญชีเข้าสู่ระบบแล้วประเมินได้ตามเดิม (verified) · ผู้ถือลิงก์ /t/ ยังประเมินได้
--
-- 1. rate_complaint: ถอน EXECUTE จาก anon อย่างเดียว ไม่แตะตัวฟังก์ชัน (เลี่ยงการเขียนทับ
--    ทั้งตัว — NOTES ข้อ 5) · role authenticated มี auth.uid() เสมอ ทางผู้ไม่ล็อกอินจึงปิดทั้งหมด
--    rate_complaint_by_track_token เรียก rate_complaint ภายใน SECURITY DEFINER (สิทธิ์ของ
--    เจ้าของฟังก์ชัน) และเรียกเฉพาะเจ้าของเรื่องที่ล็อกอิน — ไม่กระทบ
-- 2. get_complaint_by_ref: can_rate = เฉพาะเจ้าของเรื่องที่ล็อกอิน (เดิม auth.uid() is null
--    ก็ได้ true) ยกทั้งตัวจาก 20260905190000 ซึ่งตรงกับ pg_get_functiondef ของฐานจริง
--    (เทียบ 2026-11-09 ต่างแค่การตัดบรรทัด) แก้บรรทัด v_can_rate บรรทัดเดียว
--    return type/signature ไม่เปลี่ยน จึง CREATE OR REPLACE ได้ และไม่เปลี่ยน ACL เดิม
--
-- ลำดับ: รันไฟล์นี้ก่อน deploy หน้าเว็บได้ — หน้าเว็บรุ่นเก่าเปิดป็อปอัพประเมินเฉพาะเมื่อ
-- can_rate = true ซึ่งผู้ไม่ล็อกอินจะไม่ได้อีก

-- ── 1. ถอนสิทธิ์ anon ─────────────────────────────────────────────────────────
revoke execute on function public.rate_complaint(uuid, int, text) from anon;

-- ── 2. get_complaint_by_ref ──────────────────────────────────────────────────
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

  -- ให้คะแนนได้เฉพาะเจ้าของเรื่องที่ล็อกอิน (20261114100000) — ผู้ไม่ล็อกอินเลิกได้ปุ่มประเมิน
  -- เพราะ ref_no เดาได้ และ anon ไม่มีสิทธิ์เรียก rate_complaint แล้ว
  v_can_rate :=
    v_row.status in ('closed', 'completed')
    and v_owner
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

comment on function public.rate_complaint(uuid, int, text) is
  'ให้คะแนนความพึงพอใจของคำร้องที่ปิดเรื่องแล้ว เฉพาะเจ้าของเรื่องที่ล็อกอิน (verified ลง complaints.rating) — anon ถูกถอนสิทธิ์ 20261114100000 ผู้ไม่ล็อกอินให้คะแนนได้ทางเดียวคือลิงก์ /t/ (rate_complaint_by_track_token)';

-- ── 3. ด่านยืนยัน ────────────────────────────────────────────────────────────
-- REVOKE ถอนได้เฉพาะ grant ที่ผู้สั่งเป็น grantor — ถ้า anon=X มาจาก grantor อื่น คำสั่งผ่าน
-- เงียบๆ แต่สิทธิ์ยังอยู่ ด่านนี้ทำให้ทั้งไฟล์ rollback แทนการ "รันผ่านแต่ไม่ได้ปิดอะไร"
-- ⚠️ ถ้าอนาคต DROP + CREATE rate_complaint ใหม่ default privileges ของ Supabase จะคืน anon=X
--    ต้อง REVOKE ซ้ำทุกครั้ง
do $$
begin
  if has_function_privilege('anon', 'public.rate_complaint(uuid,int,text)', 'EXECUTE') then
    raise exception 'anon ยังเรียก rate_complaint ได้ — ยกเลิกทั้งไฟล์';
  end if;
  if not has_function_privilege('authenticated', 'public.rate_complaint(uuid,int,text)', 'EXECUTE') then
    raise exception 'authenticated เสียสิทธิ์ rate_complaint — ยกเลิกทั้งไฟล์';
  end if;
  if not has_function_privilege('anon', 'public.get_complaint_by_ref(text,uuid)', 'EXECUTE') then
    raise exception 'anon เสียสิทธิ์ get_complaint_by_ref (หน้าค้นเลขอ้างอิงจะพัง) — ยกเลิกทั้งไฟล์';
  end if;
end $$;

notify pgrst, 'reload schema';
