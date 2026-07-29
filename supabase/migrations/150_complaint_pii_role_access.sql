-- SmartLocal 150: complaint RBAC + PII minimisation
--
-- หลักการ:
--   1. superadmin อ่านข้อมูลเต็มได้ทุกเทศบาล (ช่วงพัฒนา/ตรวจสอบระบบ)
--   2. admin อ่านข้อมูลเต็มได้เฉพาะเทศบาลที่ตนสังกัด
--   3. officer/staff อ่านได้เมื่อรับผิดชอบโดยตรงหรืออยู่กองเดียวกับคำร้อง
--   4. technician อ่านได้เฉพาะงานที่ assigned ให้ตนเอง
--   5. viewer/council ห้าม SELECT ตาราง complaints โดยตรง และใช้ RPC แบบตัด PII
--   6. หน้ารายการปกปิดชื่อ/โทรศัพท์ (ยกเว้น superadmin) และเปิดข้อมูลเต็มผ่าน
--      get_complaint_private_detail ซึ่งเขียน audit_logs ทุกครั้ง

-- เทียบกองของผู้ใช้กับข้อความ department ที่บันทึกในคำร้อง โดยห่อด้วย
-- SECURITY DEFINER เพื่อไม่ให้ RLS ของ profiles/departments วนกลับมาหากัน
create or replace function public.complaint_matches_my_department(p_department text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.departments d on d.id = p.department_id
    where p.id = auth.uid()
      and p.municipality_id = d.municipality_id
      and p_department is not null
      and lower(btrim(p_department)) in (
        lower(btrim(d.name)),
        lower(btrim(coalesce(d.short_name, ''))),
        lower(btrim(coalesce(d.code, '')))
      )
  )
$$;

revoke all on function public.complaint_matches_my_department(text) from public, anon;
grant execute on function public.complaint_matches_my_department(text) to authenticated;

create or replace function public.mask_complaint_reporter_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(p_name), '') is null then null
    when char_length(btrim(p_name)) = 1 then left(btrim(p_name), 1) || '***'
    else left(btrim(p_name), 1) || repeat('*', least(greatest(char_length(btrim(p_name)) - 1, 3), 8))
  end
$$;

create or replace function public.mask_complaint_phone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  with cleaned as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as phone
  )
  select case
    when char_length(phone) < 6 then nullif(repeat('*', char_length(phone)), '')
    else left(phone, 3) || '-XXX-' || right(phone, 3)
  end
  from cleaned
$$;

-- ลบ policy SELECT ที่ซ้อนกันแบบ permissive (PostgreSQL รวมด้วย OR) แล้วสร้าง
-- policy เดียว เพื่อไม่ให้ policy กว้างกว่ามาหักล้าง assigned-only policy
drop policy if exists "admin read municipality complaints" on public.complaints;
drop policy if exists "staff read own municipality complaints" on public.complaints;
drop policy if exists "technician read assigned complaints" on public.complaints;
drop policy if exists "viewer read municipality complaints" on public.complaints;
drop policy if exists "users read own complaints" on public.complaints;
drop policy if exists "citizen read own complaints" on public.complaints;
drop policy if exists "complaints select by role scope" on public.complaints;

create policy "complaints select by role scope"
on public.complaints
for select
to authenticated
using (
  user_id = auth.uid()
  or public.get_my_role() = 'superadmin'
  or (
    public.get_my_role() = 'admin'
    and municipality_id = public.get_my_municipality_id()
  )
  or (
    public.get_my_role() in ('officer', 'staff')
    and municipality_id = public.get_my_municipality_id()
    and (
      assigned_to = auth.uid()
      or public.complaint_matches_my_department(department)
    )
  )
  or (
    public.get_my_role() = 'technician'
    and assigned_to = auth.uid()
  )
);

-- ปิดช่อง UPDATE ข้ามกอง/ข้ามเทศบาลจาก policy เดิมที่กว้างเกินไป
drop policy if exists "admin update complaints" on public.complaints;
drop policy if exists "admins can update complaints" on public.complaints;
drop policy if exists "staff update complaint status" on public.complaints;
drop policy if exists "technician update assigned complaints" on public.complaints;
drop policy if exists "staff can update complaint documents" on public.complaints;
drop policy if exists "admin update complaints in role scope" on public.complaints;
drop policy if exists "officer update complaints in role scope" on public.complaints;

create policy "admin update complaints in role scope"
on public.complaints
for update
to authenticated
using (
  public.get_my_role() = 'superadmin'
  or (
    public.get_my_role() = 'admin'
    and municipality_id = public.get_my_municipality_id()
  )
)
with check (
  public.get_my_role() = 'superadmin'
  or (
    public.get_my_role() = 'admin'
    and municipality_id = public.get_my_municipality_id()
  )
);

create policy "officer update complaints in role scope"
on public.complaints
for update
to authenticated
using (
  public.get_my_role() = 'officer'
  and municipality_id = public.get_my_municipality_id()
  and (
    assigned_to = auth.uid()
    or public.complaint_matches_my_department(department)
  )
)
with check (
  public.get_my_role() = 'officer'
  and municipality_id = public.get_my_municipality_id()
  and (
    assigned_to = auth.uid()
    or public.complaint_matches_my_department(department)
  )
);

create policy "technician update assigned complaints"
on public.complaints
for update
to authenticated
using (
  public.get_my_role() = 'technician'
  and assigned_to = auth.uid()
)
with check (
  public.get_my_role() = 'technician'
  and assigned_to = auth.uid()
);

-- Trigger enforce_staff_document_only_update จาก migration 131 ยังคุมให้ staff
-- แก้ได้เฉพาะช่องเอกสาร แม้ policy นี้อนุญาตเฉพาะแถวในกอง/งานที่รับผิดชอบแล้ว
create policy "staff can update complaint documents"
on public.complaints
for update
to authenticated
using (
  public.get_my_role() = 'staff'
  and municipality_id = public.get_my_municipality_id()
  and (
    assigned_to = auth.uid()
    or public.complaint_matches_my_department(department)
  )
)
with check (
  public.get_my_role() = 'staff'
  and municipality_id = public.get_my_municipality_id()
  and (
    assigned_to = auth.uid()
    or public.complaint_matches_my_department(department)
  )
);

-- รายการคำร้องสำหรับหน้าจอและรายงาน
-- superadmin ได้ค่าจริงทั้งหมด ส่วน role อื่นเห็นชื่อ/โทรศัพท์แบบ masked และ
-- viewer/council จะถูกตัดรายละเอียด จุดพิกัด ไฟล์ และ user_id เพิ่มเติม
create or replace function public.list_complaints_for_staff(p_municipality_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select p.id, p.role, p.municipality_id
    from public.profiles p
    where p.id = auth.uid()
  ), scoped as (
    select c.*, a.role as actor_role
    from public.complaints c
    cross join actor a
    where
      (
        a.role = 'superadmin'
        and (p_municipality_id is null or c.municipality_id = p_municipality_id)
      )
      or (
        a.role = 'admin'
        and c.municipality_id = a.municipality_id
        and c.municipality_id = p_municipality_id
      )
      or (
        a.role in ('officer', 'staff')
        and c.municipality_id = a.municipality_id
        and c.municipality_id = p_municipality_id
        and (
          c.assigned_to = a.id
          or public.complaint_matches_my_department(c.department)
        )
      )
      or (
        a.role = 'technician'
        and c.municipality_id = a.municipality_id
        and c.municipality_id = p_municipality_id
        and c.assigned_to = a.id
      )
      or (
        a.role in ('viewer', 'council')
        and c.municipality_id = a.municipality_id
        and c.municipality_id = p_municipality_id
      )
  )
  select
    case
      when s.actor_role = 'superadmin' then
        to_jsonb(s) - 'actor_role'
        || jsonb_build_object(
          'profiles', case when rp.id is null then null else jsonb_build_object(
            'id', rp.id,
            'full_name', rp.full_name,
            'phone', rp.phone,
            'email', rp.email,
            'avatar_url', rp.avatar_url,
            'created_at', rp.created_at
          ) end
        )
      when s.actor_role in ('viewer', 'council') then
        (to_jsonb(s) - array[
          'actor_role', 'phone', 'reporter_name', 'user_id', 'detail',
          'latitude', 'longitude', 'location', 'location_name', 'village',
          'attachments', 'work_photos', 'technician_note', 'progress_note',
          'rejection_reason', 'draft_pdf_path', 'final_document_path',
          'document_uploaded_by', 'gdrive_url', 'gdrive_file_id'
        ]::text[])
        || jsonb_build_object(
          'phone', public.mask_complaint_phone(s.phone),
          'reporter_name', public.mask_complaint_reporter_name(coalesce(s.reporter_name, rp.full_name)),
          'profiles', case when rp.id is null then null else jsonb_build_object(
            'full_name', public.mask_complaint_reporter_name(rp.full_name),
            'phone', public.mask_complaint_phone(coalesce(s.phone, rp.phone))
          ) end
        )
      else
        (to_jsonb(s) - array[
          'actor_role', 'phone', 'reporter_name', 'user_id', 'location',
          'attachments', 'work_photos', 'draft_pdf_path', 'final_document_path',
          'document_uploaded_by', 'gdrive_url', 'gdrive_file_id'
        ]::text[])
        || jsonb_build_object(
          'phone', public.mask_complaint_phone(coalesce(s.phone, rp.phone)),
          'reporter_name', public.mask_complaint_reporter_name(coalesce(s.reporter_name, rp.full_name)),
          'profiles', case when rp.id is null then null else jsonb_build_object(
            'full_name', public.mask_complaint_reporter_name(rp.full_name),
            'phone', public.mask_complaint_phone(coalesce(s.phone, rp.phone))
          ) end
        )
    end
  from scoped s
  left join public.profiles rp on rp.id = s.user_id
  order by s.created_at desc
$$;

revoke all on function public.list_complaints_for_staff(uuid) from public, anon;
grant execute on function public.list_complaints_for_staff(uuid) to authenticated;

-- เปิดรายละเอียดแบบ full เฉพาะ need-to-know และบันทึก audit ทุกครั้งที่ staff
-- (รวม superadmin) อ่าน PII; citizen เปิดของตนเองไม่บันทึกเป็น staff access
create or replace function public.get_complaint_private_detail(
  p_complaint_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_complaint public.complaints%rowtype;
  v_reporter public.profiles%rowtype;
  v_full boolean := false;
  v_sanitized boolean := false;
  v_result jsonb;
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'authenticated profile required' using errcode = '42501';
  end if;

  select * into v_complaint
  from public.complaints
  where id = p_complaint_id;

  if not found then
    return null;
  end if;

  if v_complaint.user_id is not null then
    select * into v_reporter
    from public.profiles
    where id = v_complaint.user_id;
  end if;

  v_full :=
    v_actor.role = 'superadmin'
    or (
      v_actor.role = 'admin'
      and v_complaint.municipality_id = v_actor.municipality_id
    )
    or (
      v_actor.role in ('officer', 'staff')
      and v_complaint.municipality_id = v_actor.municipality_id
      and (
        v_complaint.assigned_to = v_actor.id
        or public.complaint_matches_my_department(v_complaint.department)
      )
    )
    or (
      v_actor.role = 'technician'
      and v_complaint.assigned_to = v_actor.id
    )
    or (
      v_actor.role = 'citizen'
      and v_complaint.user_id = v_actor.id
    );

  v_sanitized :=
    v_actor.role in ('viewer', 'council')
    and v_complaint.municipality_id = v_actor.municipality_id;

  if not v_full and not v_sanitized then
    raise exception 'complaint access denied' using errcode = '42501';
  end if;

  if v_full then
    v_result := to_jsonb(v_complaint)
      || jsonb_build_object(
        'profiles', case when v_reporter.id is null then null else jsonb_build_object(
          'id', v_reporter.id,
          'full_name', v_reporter.full_name,
          'phone', v_reporter.phone,
          'email', v_reporter.email,
          'avatar_url', v_reporter.avatar_url,
          'created_at', v_reporter.created_at
        ) end
      );

    if v_actor.role <> 'citizen' then
      insert into public.audit_logs (
        municipality_id, actor_id, actor_name, actor_role, action,
        resource_type, resource_id, resource_label, metadata
      ) values (
        v_complaint.municipality_id,
        v_actor.id,
        coalesce(v_actor.full_name, v_actor.email, v_actor.id::text),
        v_actor.role,
        'view_pii',
        'complaint',
        v_complaint.id::text,
        coalesce(v_complaint.ref_no, v_complaint.complaint_number, v_complaint.id::text),
        jsonb_build_object(
          'reason', left(nullif(btrim(p_reason), ''), 200),
          'fields', jsonb_build_array('reporter_name', 'phone', 'contact_profile', 'exact_location')
        )
      );
    end if;
  else
    v_result :=
      (to_jsonb(v_complaint) - array[
        'phone', 'reporter_name', 'user_id', 'detail',
        'latitude', 'longitude', 'location', 'location_name', 'village',
        'attachments', 'work_photos', 'technician_note', 'progress_note',
        'rejection_reason', 'draft_pdf_path', 'final_document_path',
        'document_uploaded_by', 'gdrive_url', 'gdrive_file_id'
      ]::text[])
      || jsonb_build_object(
        'phone', public.mask_complaint_phone(coalesce(v_complaint.phone, v_reporter.phone)),
        'reporter_name', public.mask_complaint_reporter_name(coalesce(v_complaint.reporter_name, v_reporter.full_name)),
        'profiles', case when v_reporter.id is null then null else jsonb_build_object(
          'full_name', public.mask_complaint_reporter_name(v_reporter.full_name),
          'phone', public.mask_complaint_phone(coalesce(v_complaint.phone, v_reporter.phone))
        ) end
      );
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_complaint_private_detail(uuid, text) from public, anon;
grant execute on function public.get_complaint_private_detail(uuid, text) to authenticated;

comment on function public.list_complaints_for_staff(uuid) is
  'Role-scoped complaint list. PII masked for every role except superadmin; viewer/council receive sanitized operational data.';
comment on function public.get_complaint_private_detail(uuid, text) is
  'Need-to-know complaint detail. Full PII access is audit logged; superadmin always receives full detail.';
