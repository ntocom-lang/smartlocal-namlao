-- =====================================================
-- Fix posts RLS: ใช้ subquery แทน get_my_role()
-- เหตุผล: get_my_role() ทำให้ INSERT/UPDATE/DELETE แขวนค้าง
-- =====================================================

-- ลบ policy เดิมทั้งหมด
DROP POLICY IF EXISTS "public read published posts" ON posts;
DROP POLICY IF EXISTS "staff manage posts"          ON posts;
DROP POLICY IF EXISTS "read published posts"        ON posts;
DROP POLICY IF EXISTS "auth read all posts"         ON posts;
DROP POLICY IF EXISTS "staff read all posts"        ON posts;
DROP POLICY IF EXISTS "staff read drafts"           ON posts;
DROP POLICY IF EXISTS "staff insert posts"          ON posts;
DROP POLICY IF EXISTS "staff write posts"           ON posts;
DROP POLICY IF EXISTS "staff update posts"          ON posts;
DROP POLICY IF EXISTS "staff delete posts"          ON posts;

-- 1. ทุกคน (รวม anon) อ่านเฉพาะที่ published
CREATE POLICY "read published posts" ON posts
  FOR SELECT USING (is_published = true);

-- 2. staff+ อ่านได้ทุก row (รวม draft)
CREATE POLICY "staff read drafts" ON posts
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('superadmin','admin','officer','staff','viewer','council','technician')
  );

-- 3. staff+ เพิ่มได้
CREATE POLICY "staff insert posts" ON posts
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('superadmin','admin','officer','staff')
  );

-- 4. staff+ แก้ไขได้
CREATE POLICY "staff update posts" ON posts
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('superadmin','admin','officer','staff')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('superadmin','admin','officer','staff')
  );

-- 5. staff+ ลบได้
CREATE POLICY "staff delete posts" ON posts
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('superadmin','admin','officer','staff')
  );
