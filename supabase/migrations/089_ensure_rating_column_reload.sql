-- 089_ensure_rating_column_reload.sql
-- ถ้า migration 031 ยังไม่ถูก apply หรือ schema cache หลุด ให้รัน migration นี้
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS rating smallint CHECK (rating >= 1 AND rating <= 5);

-- Reload PostgREST schema cache ให้รู้จัก column rating
NOTIFY pgrst, 'reload schema';
