-- =====================================================
-- SmartLocal: ตาราง posts (ข่าวสำคัญ + ภาพกิจกรรม)
-- =====================================================

CREATE TABLE IF NOT EXISTS posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('news', 'activity')),
  title           text NOT NULL,
  excerpt         text,
  image_url       text,
  event_date      date,
  is_published    boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_muni_type_idx ON posts(municipality_id, type);
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- ทุกคนอ่านได้ (ที่ published)
DROP POLICY IF EXISTS "public read published posts" ON posts;
CREATE POLICY "public read published posts" ON posts
  FOR SELECT USING (is_published = true);

-- staff ขึ้นไปจัดการได้
DROP POLICY IF EXISTS "staff manage posts" ON posts;
CREATE POLICY "staff manage posts" ON posts
  FOR ALL
  USING    (get_my_role() IN ('superadmin', 'admin', 'officer', 'staff', 'viewer'))
  WITH CHECK (get_my_role() IN ('superadmin', 'admin', 'officer', 'staff', 'viewer'));

-- auto updated_at
CREATE OR REPLACE FUNCTION posts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS posts_updated_at ON posts;
CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_updated_at();
