-- ============================================================
-- Tourism Reviews — Migration
-- รัน SQL นี้ใน Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS tourism_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid REFERENCES municipalities(id) ON DELETE CASCADE,
  place_id        uuid NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_name   text,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  UNIQUE (place_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tourism_reviews_place
  ON tourism_reviews (place_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tourism_reviews_municipality
  ON tourism_reviews (municipality_id);

-- RLS
ALTER TABLE tourism_reviews ENABLE ROW LEVEL SECURITY;

-- ทุกคนอ่านได้
DROP POLICY IF EXISTS "public can select tourism_reviews" ON tourism_reviews;
CREATE POLICY "public can select tourism_reviews"
  ON tourism_reviews FOR SELECT
  USING (true);

-- เฉพาะ authenticated เขียนได้ (insert/update ของตัวเอง)
DROP POLICY IF EXISTS "authenticated can insert own tourism_reviews" ON tourism_reviews;
CREATE POLICY "authenticated can insert own tourism_reviews"
  ON tourism_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "authenticated can update own tourism_reviews" ON tourism_reviews;
CREATE POLICY "authenticated can update own tourism_reviews"
  ON tourism_reviews FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "authenticated can delete own tourism_reviews" ON tourism_reviews;
CREATE POLICY "authenticated can delete own tourism_reviews"
  ON tourism_reviews FOR DELETE
  USING (auth.uid() = user_id);
-- Archived: this legacy file had no migration version and was ignored by Supabase CLI.
