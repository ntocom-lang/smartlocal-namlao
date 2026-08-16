-- เปิดสิทธิ์อ่านตาราง departments ให้ staff-tier role (officer/staff/technician/viewer/council)
--
-- เดิม "fdept_read" (สร้างครั้งล่าสุดใน 20260727085529_137_lock_blanket_true_policies_batch2_retry.sql)
-- อนุญาตแค่ผู้ใช้ที่มี fleet_role (my_fleet()) หรือ role admin/superadmin เท่านั้น — ตกค้างจากตอนตารางนี้
-- ยังชื่อ fleet_departments เฉพาะระบบพาหนะ (ก่อน rename ใน 20260719072303_rename_fleet_departments_to_departments.sql)
--
-- แต่ตั้งแต่ 20260802071000_scope_department_operational_records.sql คอลัมน์ department_id ของ
-- data_center_entries / approval_requests / document_requests / org_projects / tourism_places ผูก FK
-- มาที่ตารางนี้ทั่วระบบแล้ว ผลคือ role ปกติที่ไม่ใช่ fleet user (officer/staff/viewer/council) เห็น
-- department_id ในตารางที่ RLS ตัวเองอนุญาตอยู่แล้ว แต่ SELECT ชื่อกองจากตาราง departments ไม่ได้เลย
--
-- แก้ให้ตรงกับ pattern สิทธิ์อ่านของ "dce staff read own municipality" (151_data_center_entries.sql):
-- staff-tier ทุก role เห็นได้เฉพาะเทศบาลตัวเอง, superadmin เห็นได้ทุกเทศบาล
-- ไม่แตะ "fdept_write" — สิทธิ์เขียนยังจำกัดเฉพาะ fleet_admin/fleet_staff/admin/superadmin เหมือนเดิม

BEGIN;

DROP POLICY IF EXISTS "fdept_read" ON public.departments;
CREATE POLICY "fdept_read" ON public.departments FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR get_my_role() = 'superadmin'
  OR (
    get_my_role() = ANY (ARRAY['admin', 'viewer', 'council', 'officer', 'staff', 'technician'])
    AND municipality_id = get_my_municipality_id()
  )
);

COMMIT;
