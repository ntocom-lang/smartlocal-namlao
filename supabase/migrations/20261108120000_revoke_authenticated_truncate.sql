-- 20261108120000_revoke_authenticated_truncate.sql
--
-- ถอนสิทธิ์ TRUNCATE / REFERENCES / TRIGGER ระดับตารางของ authenticated (และ anon) ใน schema public
-- ทั้งตารางที่มีอยู่ และตารางที่จะสร้างใหม่ต่อจากนี้ (default privileges)
--
-- ต้นเหตุ: Supabase ตั้ง default privileges ให้ทุกตารางที่ postgres สร้างใน public ได้ GRANT ALL กับ
-- anon/authenticated ไฟล์ 20260905200000 ถอนของ anon ไปแล้ว แต่ไม่ได้แตะ authenticated
-- ตรวจฐานจริง 2026-11-08 (อ่านอย่างเดียว): authenticated ยังมี TRUNCATE บนตารางของเรา 47 ตาราง
-- + view 2 ตัว (fleet_drivers_directory, tourism_place_ratings — anon ก็มีครบบน view ตัวหลัง)
--
-- ทำไมต้องถอน: **Postgres ไม่บังคับใช้ RLS กับ TRUNCATE** ใครมีสิทธิ์ TRUNCATE ล้างตารางได้ทั้งตาราง
-- ทุก อปท. ในคำสั่งเดียว (profiles, complaints, audit_logs ...) ที่ยังไม่เกิดเหตุเพราะ PostgREST
-- ไม่มีทางยิง TRUNCATE ออกไป = พึ่ง "ทางเข้าไม่มี" แทน "สิทธิ์ไม่มี"
-- ถ้าวันหนึ่งมีฟังก์ชัน SECURITY INVOKER ที่สั่ง TRUNCATE หรือ dynamic SQL ที่หลุด ก็จบทันที
-- REFERENCES / TRIGGER ถอนไปพร้อมกัน ตามมาตรฐานเดียวกับ 20261108100100 และ 20260905200000
-- (แอปไม่ได้ใช้ทั้งสามสิทธิ์ — ตรวจแล้วไม่มีโค้ดใน src/ หรือ supabase/functions สั่ง TRUNCATE)
--
-- ไม่เปลี่ยนพฤติกรรมของแอป: SELECT/INSERT/UPDATE/DELETE ไม่แตะ RLS ไม่แตะ
-- ฟังก์ชัน SECURITY DEFINER รันด้วยสิทธิ์ postgres จึงไม่กระทบเช่นกัน
--
-- ── ขอบเขต ─────────────────────────────────────────────────────────────────────
-- แตะเฉพาะ object ใน public ที่ postgres เป็นเจ้าของ (ยึดชื่อตรง ไม่ใช้ current_user — รันผ่านช่องทางอื่นแล้วกรองได้เซตว่างจะผ่านลวง) และไม่ใช่ของ extension
-- ของ supabase_admin (spatial_ref_sys, geometry_columns, geography_columns, ตารางใน schema net)
-- ข้ามโดยตั้งใจ: postgres ไม่ใช่ผู้ให้สิทธิ์ REVOKE จะ "ไม่ error แต่ไม่มีผล" (บทเรียน 2026-09-03)
-- ด่านตรวจท้ายไฟล์จึงตรวจเฉพาะชุดที่เราถอนได้จริง
--
-- ยังไม่ถอน MAINTAIN (PG17: VACUUM/CLUSTER/REINDEX/REFRESH) — รอเจ้าของระบบตัดสินแยก
--
-- รันซ้ำได้ (REVOKE ที่ไม่มีสิทธิ์ให้ถอนไม่ error) · ห่อ BEGIN/COMMIT ด่านตรวจไม่ผ่าน = ย้อนทั้งหมด
-- (ทุกช่องทาง รวม psql -f) · ต้องรันด้วย role postgres (SQL Editor ค่าเริ่มต้น) role อื่น = error ย้อนเอง

begin;

-- ── 1) object ที่มีอยู่ ─────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as obj
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relowner = 'postgres'::regrole
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke truncate, references, trigger on %s from authenticated, anon', r.obj);
  end loop;
end $$;

-- ── 2) ตารางที่จะสร้างใหม่ ─────────────────────────────────────────────────────────
-- ปิดต้นทาง: ตารางที่ postgres สร้างใน public ต่อจากนี้จะไม่ได้สามสิทธิ์นี้อีก
-- ใช้ได้เฉพาะตารางที่ postgres เป็นเจ้าของ ตารางที่สร้างผ่านช่องทาง supabase_admin ยังได้ ALL ตาม
-- default ของ supabase_admin (แก้ไม่ได้) ⇒ migration ใหม่ยังคงเขียน REVOKE เองต่อไป (defense in depth)
-- ไม่แตะ INSERT/UPDATE/DELETE ของ default — เป็นคนละเรื่อง ต้องตัดสินแยก
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated, anon;
-- entry แบบไม่ระบุ schema (ถ้ามี) ถูกบวกเพิ่มบน entry ราย schema REVOKE ข้างบนหักไม่ได้ จึงถอนอีกชั้น
-- ไม่มี entry นี้ = no-op (ฐานจริง 2026-11-08 ไม่มี)
alter default privileges for role postgres
  revoke truncate, references, trigger on tables from authenticated, anon;

-- ── 3) ด่านตรวจ: ไม่ผ่าน = RAISE ย้อนทั้งไฟล์ ──────────────────────────────────────────
do $$
declare
  v_left    text;
  v_default text;
begin
  -- กันผ่านลวงจากเซตว่าง: ฐานจริงมีตารางของ postgres ใน public ราว 120 ตาราง
  if (select count(*) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and c.relowner = 'postgres'::regrole) = 0 then
    raise exception 'ไม่พบตารางของ postgres ใน public — รันผิดฐาน?';
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into v_left
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and c.relowner = 'postgres'::regrole
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
    and (   has_table_privilege('authenticated', c.oid, 'TRUNCATE')
         or has_table_privilege('authenticated', c.oid, 'REFERENCES')
         or has_table_privilege('authenticated', c.oid, 'TRIGGER')
         or has_table_privilege('anon', c.oid, 'TRUNCATE')
         or has_table_privilege('anon', c.oid, 'REFERENCES')
         or has_table_privilege('anon', c.oid, 'TRIGGER'));

  if v_left is not null then
    raise exception 'revoke ไม่มีผลกับ: % (สิทธิ์อาจมาจาก PUBLIC หรือผู้ให้สิทธิ์คนอื่น)', v_left;
  end if;

  select string_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type, ', ') into v_default
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)   -- 0 = ทุก schema
    and d.defaclobjtype = 'r'
    and a.grantee in (0::oid, 'authenticated'::regrole::oid, 'anon'::regrole::oid)   -- 0 = PUBLIC
    and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');

  if v_default is not null then
    raise exception 'default privileges ยังให้: %', v_default;
  end if;
end $$;

commit;
