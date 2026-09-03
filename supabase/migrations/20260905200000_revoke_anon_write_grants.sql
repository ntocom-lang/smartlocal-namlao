-- 20260905200000_revoke_anon_write_grants.sql
--
-- ถอนสิทธิ์เขียนระดับตารางที่ anon ไม่ได้ใช้ออกให้หมด เหลือเฉพาะ INSERT 3 ตารางที่
-- ประชาชนซึ่งไม่ล็อกอินต้องใช้จริง
--
-- ต้นเหตุ: Supabase ตั้ง `GRANT ALL ON ALL TABLES TO anon` มาให้ตั้งแต่ต้น anon จึงมี
-- INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES ครบบน 47 ตาราง โดยมี RLS เป็นด่านเดียว
--
-- **TRUNCATE คือข้อที่ต้องรีบถอนที่สุด เพราะ Postgres ไม่บังคับใช้ RLS กับ TRUNCATE**
-- ทดสอบยืนยันแล้ว 2026-09-03: `set role anon; truncate ...` ทำได้สำเร็จทั้งที่ตารางเปิด RLS
-- ที่ยังไม่กลายเป็นเหตุจริงเพราะ PostgREST ไม่มีทางให้ยิง TRUNCATE ออกไปได้ (เปิดแค่
-- SELECT/INSERT/UPDATE/DELETE/RPC) และ anon เป็น JWT role ไม่ใช่ login role จึงต่อ
-- Postgres ตรงๆ ไม่ได้ — แต่เป็นการพึ่ง "ทางเข้าไม่มี" แทนที่จะพึ่ง "สิทธิ์ไม่มี"
-- ถ้าวันหนึ่งมี RPC ที่เผลอเขียนแบบ SECURITY INVOKER แล้วสั่ง TRUNCATE ก็จบทันที
--
-- UPDATE/DELETE ยิงผ่าน PostgREST ได้จริงแต่ RLS คุมอยู่ — ตรวจแล้วไม่มี policy ไหน
-- ที่ anon ทำสำเร็จ (ตัวเดียวที่ไม่ได้อ้าง auth คือ municipalities.admin_update_municipality
-- ซึ่งต้องผ่าน is_municipality_admin()) การถอนจึงเป็นชั้นที่สอง ไม่เปลี่ยนพฤติกรรม
--
-- ── 3 ตารางที่ยังต้องให้ INSERT ไว้ (ตรวจจาก policy ที่ anon ทำสำเร็จจริง) ──────────
--   complaints            — "anyone can submit complaint" (user_id IS NULL OR ...)
--   document_requests     — "public can insert document_requests"
--   satisfaction_ratings  — "anyone can insert general satisfaction"
-- ทั้งสามคือ flow ของประชาชนที่ไม่ล็อกอิน ถอนแล้วเว็บพัง
--
-- ── กับดักที่ตรวจแล้วว่าไม่ติด ─────────────────────────────────────────────────
-- trigger ที่ทำงานตอน anon ส่งคำร้อง (generate_complaint_ref_no → เขียน complaint_seq,
-- assign_complaint_number_per_municipality ฯลฯ) เป็น SECURITY DEFINER ทุกตัว จึงรันด้วย
-- สิทธิ์เจ้าของฟังก์ชัน ไม่ใช่ anon → ถอน grant ของ complaint_seq ได้
-- ฟังก์ชันที่ anon เรียกได้และเป็น SECURITY INVOKER มีแต่ของ PostGIS ไม่แตะตารางเรา
--
-- ไม่แตะ SELECT — หน้าสาธารณะอ่านหลายตาราง การรัดฝั่งอ่านเป็นคนละเรื่องและเสี่ยงกว่ามาก
-- ข้ามตารางที่เป็นของ extension (PostGIS) เพราะไม่ใช่ของเรา

do $$
declare
  r    record;
  keep text[] := array['complaints', 'document_requests', 'satisfaction_ratings'];
begin
  for r in
    select c.oid::regclass as tbl, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (
        select 1 from pg_depend d
        where d.objid = c.oid and d.deptype = 'e'   -- ของ extension เช่น PostGIS
      )
  loop
    execute format('revoke truncate, trigger, references, update, delete on %s from anon', r.tbl);
    if not (r.relname = any (keep)) then
      execute format('revoke insert on %s from anon', r.tbl);
    end if;
  end loop;
end $$;

-- หมายเหตุที่ต้องรู้: ไฟล์นี้ถอนของ "ตารางที่มีอยู่ตอนนี้" เท่านั้น
-- ALTER DEFAULT PRIVILEGES ของ Supabase ยังตั้งให้ตารางที่สร้างใหม่ได้ GRANT ALL กับ anon อีก
-- migration ที่สร้างตารางใหม่หลังจากนี้ต้อง revoke เองทุกครั้ง (กติกาเดียวกับ RPC ใหม่)
