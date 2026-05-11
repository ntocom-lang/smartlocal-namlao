-- =====================================================
-- SmartLocal: ตาราง profiles (User roles)
-- =====================================================

CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text,
  full_name        text,
  phone            text,
  role             text NOT NULL DEFAULT 'citizen'
                   CHECK (role IN ('superadmin', 'admin', 'citizen')),
  municipality_id  uuid REFERENCES municipalities(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Helper function (SECURITY DEFINER = bypass RLS ป้องกัน infinite recursion) ─
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop policies ก่อนสร้างใหม่ (ป้องกัน error ตอนรันซ้ำ)
DROP POLICY IF EXISTS "users read own profile" ON profiles;
DROP POLICY IF EXISTS "admins read all profiles" ON profiles;
DROP POLICY IF EXISTS "superadmin update profiles" ON profiles;
DROP POLICY IF EXISTS "admin update municipality profiles" ON profiles;

-- อ่านได้เฉพาะตัวเอง (ทุก role รวม citizen)
CREATE POLICY "users read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

-- superadmin และ admin อ่านได้ทุก profile (ใช้ function แทน subquery เพื่อกัน recursion)
CREATE POLICY "admins read all profiles"
  ON profiles FOR SELECT
  USING (get_my_role() IN ('superadmin', 'admin'));

-- superadmin อัปเดต role ได้ทุกคน
CREATE POLICY "superadmin update profiles"
  ON profiles FOR UPDATE
  USING (get_my_role() = 'superadmin');

-- admin อัปเดต role ได้เฉพาะ municipality ตัวเอง (ยกเว้น superadmin)
CREATE POLICY "admin update municipality profiles"
  ON profiles FOR UPDATE
  USING (
    get_my_role() = 'admin'
    AND municipality_id = (SELECT municipality_id FROM profiles WHERE id = auth.uid())
    AND role != 'superadmin'
  );

-- ─── Trigger: สร้าง profile อัตโนมัติเมื่อ signup ───────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'phone',
    'citizen'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── ตั้ง superadmin ─────────────────────────────────────────────────────────
INSERT INTO profiles (id, email, role)
SELECT id, email, 'superadmin'
FROM auth.users
WHERE email = 'ntocom@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'superadmin';

