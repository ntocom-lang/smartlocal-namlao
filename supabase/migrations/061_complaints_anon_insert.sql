-- 061_complaints_anon_insert.sql
-- อนุญาตให้ประชาชนที่ไม่ได้ login (anon) ยื่นคำร้องได้
-- ตามหลักการรับเรื่องร้องเรียนแบบไม่เปิดเผยตัวตน

-- ดูก่อนว่ามี policy ที่ต้อง drop ไหม
drop policy if exists "citizens can insert complaints" on complaints;
drop policy if exists "authenticated can insert complaints" on complaints;
drop policy if exists "anyone can submit complaint" on complaints;

-- อนุญาตทั้ง anon และ authenticated insert
create policy "anyone can submit complaint"
  on complaints for insert
  to anon, authenticated
  with check (true);

-- อ่านได้เฉพาะ authenticated (เจ้าหน้าที่และเจ้าของ)
drop policy if exists "users read own complaints" on complaints;
create policy "users read own complaints"
  on complaints for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'officer', 'superadmin')
        and profiles.municipality_id = complaints.municipality_id
    )
  );
