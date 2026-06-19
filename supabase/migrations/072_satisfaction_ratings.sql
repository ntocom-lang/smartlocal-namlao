-- 072_satisfaction_ratings.sql
CREATE TABLE IF NOT EXISTS public.satisfaction_ratings (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  municipality_id  uuid REFERENCES public.municipalities(id) ON DELETE CASCADE,
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          text,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE public.satisfaction_ratings ENABLE ROW LEVEL SECURITY;

-- ประชาชนส่งได้โดยไม่ต้องล็อกอิน (anonymous insert)
DROP POLICY IF EXISTS "anyone can insert satisfaction" ON public.satisfaction_ratings;
CREATE POLICY "anyone can insert satisfaction" ON public.satisfaction_ratings
  FOR INSERT WITH CHECK (true);

-- admin/staff อ่านได้
DROP POLICY IF EXISTS "admin reads satisfaction" ON public.satisfaction_ratings;
CREATE POLICY "admin reads satisfaction" ON public.satisfaction_ratings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'superadmin', 'officer', 'staff')
        AND (municipality_id = satisfaction_ratings.municipality_id OR role = 'superadmin')
    )
  );
