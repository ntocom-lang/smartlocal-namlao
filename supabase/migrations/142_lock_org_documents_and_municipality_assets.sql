-- 142_lock_org_documents_and_municipality_assets.sql
-- อีก 2 bucket ที่เจอระหว่าง schema drift audit — เปิดกว้างให้ authenticated
-- ทุกคนแบบไม่มี role/municipality scoping เลย (drift แบบเดียวกับที่เจอมาทั้งวัน)

-- org-documents: private bucket, path = {municipality_id}/{department}/{filename}
-- เดิม "authenticated can read/upload" + "admin can delete storage" (ตั้งชื่อ admin
-- แต่เงื่อนไขจริงคือ authenticated ทุกคน) ไม่เช็ค role หรือ path เลย
drop policy if exists "authenticated can read" on storage.objects;
drop policy if exists "authenticated can upload" on storage.objects;
drop policy if exists "admin can delete storage" on storage.objects;

create policy "org-documents staff read own municipality" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-documents'
    and get_my_role() in ('admin','superadmin','officer','staff')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

create policy "org-documents staff upload own municipality" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-documents'
    and get_my_role() in ('admin','superadmin','officer','staff')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

create policy "org-documents staff delete own municipality" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-documents'
    and get_my_role() in ('admin','superadmin','officer','staff')
    and (storage.foldername(name))[1] = get_my_municipality_id()::text
  );

-- municipality-assets: public-read bucket สำหรับโลโก้/QR/แบนเนอร์ระบบ path ไม่ได้ขึ้นต้น
-- ด้วย municipality_id เสมอ (logos/logo-{slug}.png, banners/{slug}/{uuid}.ext ฯลฯ) เลย
-- scope ด้วย path ตรงๆ ไม่ได้ง่ายเหมือน bucket อื่น — ปิดด้วย role admin/superadmin
-- ก่อน (แก้ปัญหา "citizen ธรรมดาก็เขียนทับได้" ซึ่งเป็นความเสี่ยงหลัก) ส่วนความเสี่ยง
-- admin เทศบาลหนึ่งเขียนทับของอีกเทศบาล (ถ้ารู้ slug) ยังเหลืออยู่ ต้องแก้ path
-- convention เป็น {municipality_id}/... ทั้งหมดถึงจะปิดได้สมบูรณ์ — ไม่ทำตอนนี้เพราะ
-- ต้องแก้โค้ด client หลายจุดใน SystemSettingsAdmin.jsx ด้วย
drop policy if exists "authenticated update municipality assets" on storage.objects;
drop policy if exists "authenticated upload municipality assets" on storage.objects;

create policy "admin update municipality assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'municipality-assets' and get_my_role() in ('admin','superadmin'));

create policy "admin upload municipality assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'municipality-assets' and get_my_role() in ('admin','superadmin'));
