-- 137_lock_blanket_true_policies_batch2.sql
-- ปิดช่องโหว่กลุ่ม A (ตั้งชื่อ admin/staff แต่ role จริง = PUBLIC/authenticated แบบไม่มีเงื่อนไข)
-- และกลุ่ม B (ทั้งโมดูล Fleet เปิดให้ authenticated ทุกคนอ่าน/เขียนข้ามเทศบาลได้หมด)
-- พบระหว่างสแกน pg_policy หา USING(true)/WITH CHECK(true) ทั้ง schema — ไม่มีในไฟล์
-- migration ใดๆ ในโค้ด (schema drift จากการแก้ตรงใน SQL Editor/Dashboard)

-- ══════════════ กลุ่ม A ══════════════

-- locations: SELECT public คงไว้ (ข้อมูลอ้างอิงสาธารณะ), เขียนได้เฉพาะ admin เทศบาลตัวเอง
-- (พบ policy "admin manage own locations" ที่ scope ถูกอยู่แล้วปนอยู่ด้วย — เป็น drift
-- เก่าที่ไม่เคยถูกใช้จริงเพราะ "admin can manage locations" แบบเปิดโล่งบังอยู่ ลบทิ้งทั้งคู่)
DROP POLICY IF EXISTS "admin can manage locations" ON public.locations;
DROP POLICY IF EXISTS "admin manage own locations" ON public.locations;
CREATE POLICY "admin manage own municipality locations" ON public.locations
  FOR ALL
  USING (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
  WITH CHECK (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()));

-- complaint_categories: เดียวกัน (พบ drift เดิม "admin manage own complaint_categories" ปนอยู่เช่นกัน)
DROP POLICY IF EXISTS "admin can manage complaint_categories" ON public.complaint_categories;
DROP POLICY IF EXISTS "admin manage own complaint_categories" ON public.complaint_categories;
CREATE POLICY "admin manage own municipality complaint_categories" ON public.complaint_categories
  FOR ALL
  USING (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
  WITH CHECK (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()));

-- tourism_places: เดียวกัน (เดิม "admin write" ครอบคลุมแค่ USING ไม่มี WITH CHECK ด้วยซ้ำ)
DROP POLICY IF EXISTS "admin write" ON public.tourism_places;
CREATE POLICY "admin manage own municipality tourism_places" ON public.tourism_places
  FOR ALL
  USING (get_my_role() IN ('admin','superadmin','staff','officer') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
  WITH CHECK (get_my_role() IN ('admin','superadmin','staff','officer') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()));

-- satisfaction_responses: insert สาธารณะคงไว้ (แบบสำรวจ), select จำกัดเฉพาะเจ้าหน้าที่เทศบาลตัวเอง
DROP POLICY IF EXISTS "admin can select" ON public.satisfaction_responses;
CREATE POLICY "staff read own municipality satisfaction_responses" ON public.satisfaction_responses
  FOR SELECT
  USING (get_my_role() IN ('admin','superadmin','officer','staff','viewer') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()));

-- complaint_timeline: จำกัดตามเจ้าของคำร้อง/เจ้าหน้าที่เทศบาลเดียวกัน ไม่ใช่ PUBLIC
DROP POLICY IF EXISTS "staff read timeline" ON public.complaint_timeline;
DROP POLICY IF EXISTS "staff insert timeline" ON public.complaint_timeline;
DROP POLICY IF EXISTS "timeline_select" ON public.complaint_timeline; -- ของเดิมจาก 107 ที่ถูก "staff read timeline" (PUBLIC) บังไว้

CREATE POLICY "scoped read complaint_timeline" ON public.complaint_timeline
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_timeline.complaint_id AND c.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = complaint_timeline.complaint_id
        AND c.municipality_id = get_my_municipality_id()
        AND get_my_role() IN ('superadmin','admin','officer','staff','technician','viewer','council')
    )
  );

CREATE POLICY "staff insert own municipality timeline" ON public.complaint_timeline
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.complaints c
      WHERE c.id = complaint_timeline.complaint_id
        AND c.municipality_id = get_my_municipality_id()
        AND get_my_role() IN ('superadmin','admin','officer','staff','technician')
    )
  );

-- ══════════════ กลุ่ม B — Fleet module ══════════════
-- ทุกตารางมี municipality_id — บังคับ fleet_role (ผูกกับ municipality ตัวเอง) หรือ
-- admin/superadmin ของระบบหลัก อ่านได้ทุก fleet_role, เขียนได้เฉพาะ fleet_admin/fleet_staff

DROP POLICY IF EXISTS "fdept_read" ON public.departments;
DROP POLICY IF EXISTS "fdept_write" ON public.departments;
CREATE POLICY "fdept_read" ON public.departments FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "fdept_write" ON public.departments FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "fveh_read" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "fveh_write" ON public.fleet_vehicles;
CREATE POLICY "fveh_read" ON public.fleet_vehicles FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "fveh_write" ON public.fleet_vehicles FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "ffuel_read" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "ffuel_write" ON public.fleet_fuel_records;
CREATE POLICY "ffuel_read" ON public.fleet_fuel_records FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "ffuel_write" ON public.fleet_fuel_records FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "ftrip_read" ON public.fleet_trips;
DROP POLICY IF EXISTS "ftrip_write" ON public.fleet_trips;
CREATE POLICY "ftrip_read" ON public.fleet_trips FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "ftrip_write" ON public.fleet_trips FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "fmaint_read" ON public.fleet_maintenance;
DROP POLICY IF EXISTS "fmaint_write" ON public.fleet_maintenance;
CREATE POLICY "fmaint_read" ON public.fleet_maintenance FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "fmaint_write" ON public.fleet_maintenance FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "fbook_read" ON public.fleet_bookings;
DROP POLICY IF EXISTS "fbook_write" ON public.fleet_bookings;
CREATE POLICY "fbook_read" ON public.fleet_bookings FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "fbook_write" ON public.fleet_bookings FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "fbudget_read" ON public.fleet_budgets;
DROP POLICY IF EXISTS "fbudget_write" ON public.fleet_budgets;
CREATE POLICY "fbudget_read" ON public.fleet_budgets FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "fbudget_write" ON public.fleet_budgets FOR ALL
  USING ((SELECT frole FROM my_fleet()) = 'fleet_admin' AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) = 'fleet_admin' AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

DROP POLICY IF EXISTS "fvtype_read" ON public.fleet_vehicle_types;
DROP POLICY IF EXISTS "fvtype_write" ON public.fleet_vehicle_types;
CREATE POLICY "fvtype_read" ON public.fleet_vehicle_types FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
CREATE POLICY "fvtype_write" ON public.fleet_vehicle_types FOR ALL
  USING ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())))
  WITH CHECK ((SELECT frole FROM my_fleet()) IN ('fleet_admin','fleet_staff') AND municipality_id = (SELECT mun_id FROM my_fleet())
    OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())));

-- fleet_audit_log: อ่านได้เหมือนตารางอื่น แต่เขียนได้แค่ INSERT (append-only) กัน
-- การแก้ไข/ลบ log ย้อนหลัง ไม่มี UPDATE/DELETE policy ให้ fleet role เลย
DROP POLICY IF EXISTS "faudit_read" ON public.fleet_audit_log;
DROP POLICY IF EXISTS "faudit_write" ON public.fleet_audit_log;
CREATE POLICY "faudit_read" ON public.fleet_audit_log FOR SELECT USING (
  (SELECT frole FROM my_fleet()) IS NOT NULL AND municipality_id = (SELECT mun_id FROM my_fleet())
  OR (get_my_role() IN ('admin','superadmin') AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id()))
);
-- faudit_insert ของเดิม (108) scope ถูกต้องอยู่แล้ว (ตรวจสอบแล้วบน live DB) ไม่ต้องสร้างซ้ำ
