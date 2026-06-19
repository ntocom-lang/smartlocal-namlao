ALTER TABLE public.municipalities
  ADD COLUMN IF NOT EXISTS pwa_short_name text;
