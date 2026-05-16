-- =====================================================
-- SmartLocal 023: Fix handle_new_user() รองรับ Google OAuth
-- Google OAuth เก็บชื่อใน metadata key 'name' ไม่ใช่ 'full_name'
-- =====================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '')
    ),
    NEW.raw_user_meta_data->>'phone',
    'citizen'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      profiles.full_name
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
