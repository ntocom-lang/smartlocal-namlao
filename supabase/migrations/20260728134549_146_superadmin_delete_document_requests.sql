-- 146_superadmin_delete_document_requests.sql
-- document_requests ไม่เคยมี DELETE policy มาก่อน (มีแค่ insert/read/update) — เพิ่มให้เฉพาะ
-- superadmin ลบได้ ผ่าน RLS จริง ไม่ใช่แค่ซ่อนปุ่มฝั่ง UI เพราะเป็นข้อมูลคำขอของประชาชน

drop policy if exists "superadmin delete document_requests" on public.document_requests;
create policy "superadmin delete document_requests"
on public.document_requests
for delete
to authenticated
using (get_my_role() = 'superadmin');
-- History version aligned with linked Supabase project.
