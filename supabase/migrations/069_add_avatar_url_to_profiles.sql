-- เพิ่ม avatar_url ใน profiles + อัปเดต trigger ให้รองรับ LINE (picture) / Google (avatar_url)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '')
    ),
    NEW.raw_user_meta_data->>'phone',
    'citizen',
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'avatar_url'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'picture'), '')
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
      public.profiles.full_name
    ),
    avatar_url = COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'avatar_url'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'picture'), ''),
      public.profiles.avatar_url
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
