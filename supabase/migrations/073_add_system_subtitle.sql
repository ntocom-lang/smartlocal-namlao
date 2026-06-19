ALTER TABLE public.municipalities
  ADD COLUMN IF NOT EXISTS system_subtitle text;
