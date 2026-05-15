-- =====================================================
-- SmartLocal 018: Fix multi-tenant RLS isolation
-- ทุก policy ต้องกั้น municipality_id ไม่ให้รั่วข้าม อบต
-- =====================================================

-- ─── Helper function ──────────────────────────────────────────────────────────
-- SECURITY DEFINER เพื่อกัน infinite recursion ใน RLS
CREATE OR REPLACE FUNCTION get_my_municipality_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT municipality_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ─── complaints ───────────────────────────────────────────────────────────────

-- ลบ policy เก่าที่ USING(true) → อ่านได้หมดทุก อบต
DROP POLICY IF EXISTS "municipality staff can read all complaints" ON complaints;

-- ประชาชน: อ่านได้เฉพาะคำร้องของตัวเอง
DROP POLICY IF EXISTS "citizen read own complaints" ON complaints;
CREATE POLICY "citizen read own complaints"
  ON complaints FOR SELECT
  USING (user_id = auth.uid());

-- Admin/superadmin: อ่านได้เฉพาะ municipality ของตัวเอง
-- superadmin ไม่มี municipality_id → อ่านได้ทุก อบต (สิทธิ์ system owner)
DROP POLICY IF EXISTS "admin read municipality complaints" ON complaints;
CREATE POLICY "admin read municipality complaints"
  ON complaints FOR SELECT
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'technician')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- หมายเหตุ: policy จาก 014 ยังคงอยู่และทำงานร่วมกัน (OR)
-- "technician read assigned complaints" USING (assigned_to = auth.uid())
-- "admin update complaints"
-- "technician update assigned complaints"

-- ─── emergency_contacts ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "public can read active emergency contacts" ON emergency_contacts;
DROP POLICY IF EXISTS "allow all for authenticated" ON emergency_contacts;
DROP POLICY IF EXISTS "public read active emergency contacts" ON emergency_contacts;

-- ทุกคนอ่านได้ (แสดงบนหน้าแรก ไม่ต้อง login)
CREATE POLICY "public read active emergency contacts"
  ON emergency_contacts FOR SELECT
  USING (is_active = true);

-- Admin: แก้ไขได้เฉพาะ municipality ของตัวเอง
DROP POLICY IF EXISTS "admin manage own emergency contacts" ON emergency_contacts;
CREATE POLICY "admin manage own emergency contacts"
  ON emergency_contacts FOR ALL
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin')
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- ─── locations ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin can manage locations" ON locations;
DROP POLICY IF EXISTS "public read locations" ON locations;
DROP POLICY IF EXISTS "admin manage own locations" ON locations;

-- ทุกคนอ่านได้ (citizen form ต้องดึง dropdown)
CREATE POLICY "public read locations"
  ON locations FOR SELECT
  USING (true);

-- Admin: แก้ไขได้เฉพาะ municipality ของตัวเอง
CREATE POLICY "admin manage own locations"
  ON locations FOR ALL
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );

-- ─── complaint_categories ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin can manage complaint_categories" ON complaint_categories;
DROP POLICY IF EXISTS "public read complaint_categories" ON complaint_categories;
DROP POLICY IF EXISTS "admin manage own complaint_categories" ON complaint_categories;

-- ทุกคนอ่านได้ (citizen form ต้องดึงประเภทคำร้อง)
CREATE POLICY "public read complaint_categories"
  ON complaint_categories FOR SELECT
  USING (true);

-- Admin: แก้ไขได้เฉพาะ municipality ของตัวเอง
CREATE POLICY "admin manage own complaint_categories"
  ON complaint_categories FOR ALL
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );
