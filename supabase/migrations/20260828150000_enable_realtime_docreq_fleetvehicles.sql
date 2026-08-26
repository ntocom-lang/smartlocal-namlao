-- 20260828150000_enable_realtime_docreq_fleetvehicles.sql
--
-- publication supabase_realtime ปัจจุบันมีแค่ complaints + fleet_trips (ยืนยันจาก
-- pg_publication_tables) แต่ในโค้ดมี subscription postgres_changes รออยู่แล้ว 6 จุดบน 2 ตารางที่
-- ยังไม่อยู่ใน publication — ทั้งหมดเป็น dead code มาตลอดเหมือนที่ complaints เคยเป็น:
--
--   document_requests (3 จุด)
--     src/pages/StaffDashboard.jsx:567   INSERT/UPDATE -> กล่องคำขอเอกสารของเจ้าหน้าที่
--     src/pages/StaffDashboard.jsx:1713  '*'           -> badge จำนวนคำขอค้าง
--   fleet_vehicles (3 จุด)
--     src/components/fleet/FleetDashboard.jsx:202 '*'  -> การ์ดสรุปยานพาหนะ
--     src/components/fleet/FleetVehicles.jsx:214/225   INSERT/UPDATE -> ตารางยานพาหนะ
--
-- ── ตรวจก่อนเปิด (เกณฑ์เดียวกับตอนเปิด complaints) ─────────────────────────────
-- 1) RLS SELECT รัดกุมแล้วทั้งคู่ — realtime ใช้ policy ตัวเดียวกับ query ปกติ
--    document_requests: policy "read document_requests" (migration 20260802071000)
--      เจ้าของคำขอ / superadmin / admin ในเทศบาล / officer ในกองเดียวกัน /
--      staff ที่ถูกมอบหมายเท่านั้น — anon ไม่เข้าเงื่อนไขข้อไหนเลย จึงไม่ได้รับ event
--    fleet_vehicles: policy "fleet_vehicles_select" -> fleet_can_read_asset()
--      (migration 20260816130000) ผูก fleet_role + department_id + is_pool
--
-- 2) ไม่มี masking bypass — ทั้งสองจุดฝั่ง client ดึงด้วย select('*') ตรงจากตารางอยู่แล้ว
--    ไม่ได้ผ่าน RPC ที่ mask PII แบบ list_complaints_for_staff ของฝั่งคำร้อง payload ของ
--    realtime จึงมีฟิลด์ชุดเดียวกับที่ผู้ใช้คนนั้น SELECT ได้อยู่แล้ว ไม่เปิดอะไรใหม่
--
-- 3) replica identity ต้องเป็น default — RLS ไม่ถูกใช้กับ DELETE ถ้าเป็น full ข้อมูลเต็มแถว
--    ของคำขอเอกสาร (มีชื่อ/เบอร์/ที่อยู่ประชาชน) จะหลุดไปหา subscriber ทุกคนโดยไม่ผ่าน RLS
--    ผิด PDPA — ข้อนี้บังคับด้วย guard ข้างล่าง ไม่ปล่อยให้เป็นแค่คอมเมนต์
--
-- ── ผลข้างเคียงที่ยอมรับแล้ว ────────────────────────────────────────────────────
-- คำขอเอกสารที่เพิ่งเข้ามายังไม่มี assigned_to ⇒ policy ข้อ staff (assigned_to = auth.uid())
-- ไม่เข้า staff จะยังไม่เห็น INSERT event ส่วน admin กับ officer เจ้าของกองเห็นทันที
-- (trigger route_document_request_department_trigger เติม department_id ให้ตั้งแต่ก่อน INSERT)
-- ตรงกับ flow จริงที่ admin/officer เป็นคนรับเรื่องแล้วค่อยมอบหมาย
--
-- ภาระที่เพิ่ม: ทุก event ถูกเช็คสิทธิ์ 1 ครั้งต่อ subscriber 1 คน ประมวลผลด้วย thread เดียว
-- ที่ปริมาณปัจจุบันแทบเป็นศูนย์
--
-- ย้อนกลับได้ทันทีด้วย:
--   alter publication supabase_realtime drop table public.document_requests;
--   alter publication supabase_realtime drop table public.fleet_vehicles;

-- guard: ปฏิเสธการเปิด realtime ถ้าตารางถูกตั้ง replica identity full ไว้ (relreplident = 'f')
-- ดักกรณีมีคนไปกดเปลี่ยนผ่าน dashboard ซึ่งไม่ทิ้งร่องรอยไว้ในไฟล์ migration
do $$
declare
  bad_table text;
begin
  select c.relname into bad_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('document_requests', 'fleet_vehicles')
    and c.relreplident = 'f'
  limit 1;

  if bad_table is not null then
    raise exception
      'ยกเลิก: ตาราง public.% ถูกตั้ง replica identity full อยู่ — payload ของ DELETE จะมีข้อมูลเต็มแถวและไม่ผ่าน RLS (PDPA) แก้ด้วย: alter table public.% replica identity default; แล้วรัน migration นี้ใหม่',
      bad_table, bad_table;
  end if;
end $$;

-- idempotent: ALTER PUBLICATION ... ADD TABLE จะ error ถ้าตารางเป็นสมาชิกอยู่แล้ว
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'document_requests'
  ) then
    alter publication supabase_realtime add table public.document_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fleet_vehicles'
  ) then
    alter publication supabase_realtime add table public.fleet_vehicles;
  end if;
end $$;
