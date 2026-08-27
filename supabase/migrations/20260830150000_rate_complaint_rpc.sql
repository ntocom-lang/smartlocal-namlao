-- 20260830150000_rate_complaint_rpc.sql
--
-- ปัญหาที่แก้: การให้คะแนนความพึงพอใจหลัง "ปิดเรื่อง" เขียนลง complaints.rating ไม่ได้เลย
--
-- SatisfactionModal.jsx สั่ง update complaints ตรงๆ (`.update({ rating }).eq('id', ...)`) แต่ตาราง
-- complaints ไม่มี UPDATE policy สำหรับ role citizen เจ้าของเรื่องแม้แต่ policy เดียว
-- (มีแต่ admin/officer/technician/staff — ดู 150_complaint_pii_role_access.sql)
-- RLS จึงกรองแถวทิ้ง Postgres รายงาน 0 rows และ supabase-js ไม่ถือว่าเป็น error
-- ผล: complaints.rating เป็น NULL ตลอดกาล → รายงาน LPA รายเรื่องทำไม่ได้ และเงื่อนไขกันถามซ้ำ
-- เหลือแค่ localStorage อย่างเดียว (ล้าง cache หรือเปลี่ยนเครื่อง = โดนถามใหม่)
--
-- ทำไมไม่เปิด UPDATE policy ให้ citizen: policy ระดับแถวคุมคอลัมน์ไม่ได้ การเปิดให้เจ้าของเรื่อง
-- UPDATE ได้ = เปิดให้แก้ status / detail / assigned_to ของคำร้องตัวเองด้วย จึงใช้ RPC
-- SECURITY DEFINER ที่เขียนเฉพาะ rating/rated_at แทน
--
-- ความสมบูรณ์ของข้อมูล (สตง./LPA):
--   1. คะแนนที่ผูกกับคำร้องเขียนได้ทางเดียวคือผ่าน rate_complaint() — trigger กันการ UPDATE
--      คอลัมน์ rating ตรงๆ ทุกทาง รวมถึง admin ที่มี UPDATE policy เต็ม (กันเจ้าหน้าที่ปั่นคะแนนตัวเอง)
--   2. คะแนนจากเจ้าของเรื่องที่ล็อกอิน = is_verified true และเป็นค่าเดียวที่ลง complaints.rating
--      คะแนนจากผู้ติดตามด้วย ref_no แบบไม่ล็อกอิน = is_verified false เก็บแยกไว้เป็น feedback
--      ไม่ปนกับตัวเลขที่ใช้อ้างอิงทางราชการ (ref_no เป็นเลขเรียงคาดเดาได้และไม่มี rate limit —
--      ดูบันทึกใน 20260829110000_mask_complaint_subject_public.sql)
--   3. unique index (complaint_id, is_verified) — 1 เรื่องได้คะแนน verified 1 ครั้ง + unverified 1 ครั้ง
--      กันทั้งการกดซ้ำและการยิงสแปมผูกเรื่องเดิม

-- ── 1. schema ────────────────────────────────────────────────────────────────
alter table public.complaints
  add column if not exists rated_at timestamptz;

alter table public.satisfaction_ratings
  add column if not exists complaint_id uuid references public.complaints(id) on delete set null,
  add column if not exists is_verified  boolean not null default false,
  add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- ไม่ใช้ partial index (where complaint_id is not null) เพราะ ON CONFLICT inference ต้องใส่
-- predicate เดียวกันซ้ำทุกครั้งจึงจะ match — และ Postgres ถือว่า NULL ไม่เท่ากับ NULL อยู่แล้ว
-- แถวประเมินรวม (complaint_id NULL) จึงมีได้ไม่จำกัดโดยไม่ต้องมีเงื่อนไข
create unique index if not exists satisfaction_ratings_complaint_once
  on public.satisfaction_ratings (complaint_id, is_verified);

create index if not exists satisfaction_ratings_municipality_created_idx
  on public.satisfaction_ratings (municipality_id, created_at desc);

-- ── 2. ปิดช่องปลอมแถวที่ผูกคำร้อง ────────────────────────────────────────────
-- policy เดิมเป็น WITH CHECK (true) ใครก็ insert อะไรก็ได้ ถ้าปล่อยไว้จะยิง complaint_id +
-- is_verified=true ตรงๆ ข้าม RPC ได้ทันที คงเฉพาะแบบประเมินรวม (complaint_id IS NULL)
-- ที่หน้า /satisfaction ใช้อยู่
drop policy if exists "anyone can insert satisfaction" on public.satisfaction_ratings;
drop policy if exists "anyone can insert general satisfaction" on public.satisfaction_ratings;
create policy "anyone can insert general satisfaction"
  on public.satisfaction_ratings
  for insert
  to anon, authenticated
  with check (
    complaint_id is null
    and is_verified = false
    and (created_by is null or created_by = auth.uid())
  );

-- ── 3. trigger กันการเขียน rating นอก RPC ────────────────────────────────────
create or replace function public.guard_complaint_rating_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (NEW.rating is distinct from OLD.rating
      or NEW.rated_at is distinct from OLD.rated_at)
     and coalesce(current_setting('app.rating_write', true), '') <> '1'
  then
    raise exception 'complaints.rating/rated_at แก้ไขได้เฉพาะผ่าน rate_complaint() เท่านั้น'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_complaint_rating on public.complaints;
create trigger trg_guard_complaint_rating
before update on public.complaints
for each row execute function public.guard_complaint_rating_write();

-- ── 4. RPC ให้คะแนน ──────────────────────────────────────────────────────────
create or replace function public.rate_complaint(
  p_complaint_id uuid,
  p_rating       int,
  p_comment      text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_c        public.complaints%rowtype;
  v_owner    boolean;
  v_comment  text;
  v_inserted uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'code', 'invalid_rating');
  end if;

  select * into v_c from public.complaints where id = p_complaint_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- 'completed' คือค่า legacy ของ 'closed' (ดู STATUS_COMPAT ใน MyComplaints.jsx)
  if v_c.status not in ('closed', 'completed') then
    return jsonb_build_object('ok', false, 'code', 'not_closed');
  end if;

  v_owner := auth.uid() is not null and v_c.user_id = auth.uid();

  -- คนล็อกอินที่ไม่ใช่เจ้าของเรื่อง (รวมเจ้าหน้าที่ทุก role) ให้คะแนนแทนไม่ได้
  -- ไม่งั้น admin ที่เห็นคำร้องทั้งเทศบาลกดให้ 5 ดาวย้อนหลังได้ทั้งหมด
  if auth.uid() is not null and not v_owner then
    return jsonb_build_object('ok', false, 'code', 'not_owner');
  end if;

  -- ข้อมูลเก่าที่มี complaints.rating ติดมาแล้ว (เช่นตั้งค่าจาก SQL ก่อนมี migration นี้)
  -- ต้องถือว่าประเมินแล้ว ไม่งั้นจะได้แถว satisfaction_ratings เพิ่มโดยที่ complaints.rating ไม่ขยับ
  if v_owner and v_c.rating is not null then
    return jsonb_build_object('ok', false, 'code', 'already_rated');
  end if;

  v_comment := left(nullif(btrim(coalesce(p_comment, '')), ''), 500);

  insert into public.satisfaction_ratings
    (municipality_id, rating, comment, complaint_id, is_verified, created_by)
  values
    (v_c.municipality_id, p_rating::smallint, v_comment, v_c.id, v_owner, auth.uid())
  on conflict (complaint_id, is_verified) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok', false, 'code', 'already_rated');
  end if;

  -- เฉพาะคะแนนจากเจ้าของเรื่องที่ยืนยันตัวตนแล้วเท่านั้นที่ขึ้นเป็นคะแนนทางการของคำร้อง
  if v_owner then
    perform set_config('app.rating_write', '1', true);
    update public.complaints
       set rating = p_rating::smallint, rated_at = now()
     where id = v_c.id
       and rating is null;
    perform set_config('app.rating_write', '0', true);
  end if;

  return jsonb_build_object('ok', true, 'verified', v_owner);
end;
$$;

revoke all on function public.rate_complaint(uuid, int, text) from public;
grant execute on function public.rate_complaint(uuid, int, text) to anon, authenticated;

comment on function public.rate_complaint(uuid, int, text) is
  'ให้คะแนนความพึงพอใจของคำร้องที่ปิดเรื่องแล้ว เจ้าของเรื่องที่ล็อกอิน = verified และลง complaints.rating, ผู้ติดตามด้วย ref_no แบบไม่ล็อกอิน = unverified เก็บเฉพาะใน satisfaction_ratings';

-- ── 5. get_complaint_by_ref: บอกฝั่ง UI ได้ว่ายังให้คะแนนได้อยู่ไหม ──────────
-- หน้าติดตามคำร้องด้วยเลขอ้างอิง (ไม่ล็อกอิน) เดิมไม่รู้เลยว่าเรื่องนี้ให้คะแนนไปหรือยัง
-- จึงซ่อน/แสดงปุ่มประเมินไม่ได้ เพิ่ม 2 คอลัมน์: rating (mask ตามสิทธิ์เหมือนฟิลด์อื่น)
-- และ can_rate ที่คำนวณฝั่งเซิร์ฟเวอร์ ไม่เปิดเผยว่ามีใครประเมินไว้แล้วหรือไม่เกินจำเป็น
-- เปลี่ยน return type ต้อง DROP ก่อน (CREATE OR REPLACE เปลี่ยนโครง TABLE(...) ไม่ได้)
drop function if exists public.get_complaint_by_ref(text, uuid);

create function public.get_complaint_by_ref(_ref_no text, _municipality_id uuid)
returns table(
  id uuid, ref_no text, category text, subject text, detail text, status text,
  created_at timestamp with time zone, due_date date, village text,
  latitude double precision, longitude double precision, phone text,
  reporter_name text, attachments jsonb, work_photos jsonb, technician_note text,
  rating smallint, can_rate boolean
)
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

revoke all on function public.get_complaint_by_ref(text, uuid) from public;
grant execute on function public.get_complaint_by_ref(text, uuid) to anon, authenticated;

-- คอลัมน์ใหม่ + signature ใหม่ของ RPC ต้องให้ PostgREST รีโหลด schema cache ไม่งั้น client
-- จะได้ PGRST202 (ไม่รู้จักฟังก์ชัน) จนกว่าจะมี DDL ตัวถัดไปมากระตุ้น
notify pgrst, 'reload schema';
