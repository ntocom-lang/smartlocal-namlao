-- Staff role can attach/update official documents on complaints (Export Draft PDF /
-- upload signed PDF + เลขรับ) but must never change status, assignment, or any other
-- field via this path. No existing UPDATE policy covers role='staff' at all, so this
-- was previously silently failing (RLS blocks the row, Postgres reports 0 rows
-- affected, and supabase-js does not surface that as an error).

create policy "staff can update complaint documents"
on complaints for update
using (municipality_id = get_my_municipality_id() and get_my_role() = 'staff')
with check (municipality_id = get_my_municipality_id() and get_my_role() = 'staff');

create or replace function enforce_staff_document_only_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if get_my_role() = 'staff' then
    if NEW.status is distinct from OLD.status
       or NEW.assigned_to is distinct from OLD.assigned_to
       or NEW.priority is distinct from OLD.priority
       or NEW.category is distinct from OLD.category
       or NEW.detail is distinct from OLD.detail
       or NEW.subject is distinct from OLD.subject
       or NEW.location_name is distinct from OLD.location_name
       or NEW.village is distinct from OLD.village
       or NEW.reporter_name is distinct from OLD.reporter_name
       or NEW.phone is distinct from OLD.phone
       or NEW.latitude is distinct from OLD.latitude
       or NEW.longitude is distinct from OLD.longitude
       or (NEW.location::text is distinct from OLD.location::text)
       or NEW.form_type is distinct from OLD.form_type
       or NEW.department is distinct from OLD.department
       or NEW.due_date is distinct from OLD.due_date
       or NEW.progress_note is distinct from OLD.progress_note
       or NEW.rejection_reason is distinct from OLD.rejection_reason
       or NEW.closed_at is distinct from OLD.closed_at
       or NEW.ref_no is distinct from OLD.ref_no
       or NEW.rating is distinct from OLD.rating
       or NEW.channel is distinct from OLD.channel
       or NEW.complaint_number is distinct from OLD.complaint_number
       or NEW.user_id is distinct from OLD.user_id
       or NEW.municipality_id is distinct from OLD.municipality_id
       or NEW.technician_note is distinct from OLD.technician_note
       or NEW.work_photos is distinct from OLD.work_photos
       or NEW.attachments is distinct from OLD.attachments
    then
      raise exception 'staff role may only update document fields on complaints (draft_pdf_path, official_receipt_no, final_document_path, document_uploaded_at, document_uploaded_by)';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_staff_document_only_update on complaints;
create trigger trg_staff_document_only_update
before update on complaints
for each row execute function enforce_staff_document_only_update();
