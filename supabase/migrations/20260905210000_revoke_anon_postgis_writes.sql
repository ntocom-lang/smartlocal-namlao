-- 20260905210000_revoke_anon_postgis_writes.sql
--
-- ⚠️ ไฟล์นี้ "พยายาม" ถอนสิทธิ์เขียน spatial_ref_sys ออกจาก anon แต่ **คาดว่าจะไม่สำเร็จ**
-- ด้วยสิทธิ์ที่เรามี เก็บไว้เพื่อ (1) บันทึกช่องโหว่ (2) ให้ถอนได้อัตโนมัติทันทีที่สิทธิ์พอ
-- ตัว DO block ท้ายไฟล์จะตรวจผลจริงแล้ว RAISE WARNING ถ้ายังถอนไม่ได้ — ไม่ raise exception
-- เพราะไม่อยากให้ migration ทั้งชุดรันไม่ผ่านเพราะเรื่องที่แก้เองไม่ได้
--
-- ── ช่องโหว่ (ยืนยันกับ production แล้ว 2026-09-03) ────────────────────────────────
-- public.spatial_ref_sys เป็นตารางจริง 8,500 แถว **RLS ปิดอยู่** (ข้อยกเว้นเดียวของ schema นี้)
-- และ anon มี INSERT/UPDATE/DELETE/TRUNCATE ติดมาจาก GRANT ALL ของ Supabase
-- อยู่ใน schema public → PostgREST เปิดเป็น endpoint
--
-- ทดสอบจริง: `DELETE /rest/v1/spatial_ref_sys?srid=eq.999999` ด้วย publishable key
-- ตอบ **HTTP 204** (ใช้เงื่อนไขที่ไม่แมตช์แถวใดจึงไม่มีข้อมูลเสียหาย)
-- และในฐานข้อมูล `set role anon; delete ... where srid=2000` ลบได้ 1 แถวจริง (rollback แล้ว)
--
-- ผลกระทบไม่ใช่แค่ PostGIS เสีย: มี 6 ตารางใช้ชนิด geography จริง —
--   complaints.location, municipalities.location, data_center_entries.location,
--   civil_projects.location, infrastructure_works.location, business_registrations.location
-- ถ้า SRID 4326 ถูกลบ การเขียน/สืบค้นคอลัมน์เหล่านี้พัง = ประชาชนส่งคำร้องพร้อมปักหมุดไม่ได้
-- เป็นการโจมตีความพร้อมใช้งานด้วยคีย์ที่เปิดสาธารณะโดยการออกแบบ
--
-- ── ทำไมถึงแก้เองไม่ได้ ──────────────────────────────────────────────────────────
-- spatial_ref_sys มีเจ้าของเป็น `supabase_admin` ส่วน migration รันด้วย `postgres`
-- ซึ่งไม่ใช่สมาชิกของ supabase_admin และไม่ใช่ superuser
-- REVOKE โดยผู้ที่ไม่ใช่เจ้าของ **ไม่ error แต่ก็ไม่มีผล** (ครั้งแรกที่รันจึงดูเหมือนสำเร็จ
-- ทั้งที่สิทธิ์ยังอยู่ครบ — ต้องตรวจด้วย has_table_privilege เสมอ อย่าเชื่อว่าไม่มี error = สำเร็จ)
-- ด้วยเหตุผลเดียวกัน `alter table ... enable row level security` ก็ทำไม่ได้
--
-- ── ทางแก้ที่ต้องทำนอก migration (ต้องยืนยันกับ Supabase ก่อนลงมือ) ─────────────────
-- แนวทางมาตรฐานของ Supabase คือติดตั้ง PostGIS ไว้ใน schema `extensions` ไม่ใช่ `public`
-- ซึ่งจะทำให้ PostgREST ไม่เปิด endpoint ให้ตารางนี้เลย โปรเจกต์นี้ติดตั้งไว้ที่ public
-- การย้าย schema ของ extension ต้องใช้สิทธิ์เจ้าของเช่นกัน และกระทบคอลัมน์ geography ทั้ง 6 ตาราง
-- จึงต้องเปิดเรื่องกับ Supabase support ไม่ใช่รันเอง

revoke insert, update, delete, truncate, trigger, references
  on public.spatial_ref_sys from anon;

revoke insert, update, delete, truncate, trigger, references
  on public.spatial_ref_sys from authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE') then
    raise warning
      'ยังถอนสิทธิ์ DELETE ของ anon บน spatial_ref_sys ไม่ได้ (เจ้าของคือ %) — ช่องโหว่ยังเปิดอยู่ ต้องแก้ผ่าน Supabase support',
      (select pg_get_userbyid(relowner) from pg_class where oid = 'public.spatial_ref_sys'::regclass);
  else
    raise notice 'ถอนสิทธิ์เขียน spatial_ref_sys ออกจาก anon สำเร็จแล้ว';
  end if;
end $$;
