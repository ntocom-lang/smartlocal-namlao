-- Public complaint pins for transparency without exposing complaint details or PII.
-- Coordinates are rounded to roughly 100 metres and rows have no complaint ID.

DROP FUNCTION IF EXISTS public.get_public_complaint_map_pins(uuid);

CREATE OR REPLACE FUNCTION public.get_public_complaint_map_pins(p_municipality_id uuid)
RETURNS TABLE (
  map_key      bigint,
  latitude     double precision,
  longitude    double precision,
  category     text,
  form_type    text,
  status       text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    row_number() OVER ()::bigint AS map_key,
    pins.latitude,
    pins.longitude,
    pins.category,
    pins.form_type,
    pins.status
  FROM (
    SELECT
      round(c.latitude::numeric, 3)::double precision   AS latitude,
      round(c.longitude::numeric, 3)::double precision AS longitude,
      c.category,
      c.form_type,
      c.status
    FROM public.complaints c
    INNER JOIN public.municipalities m ON m.id = c.municipality_id
    WHERE p_municipality_id IS NOT NULL
      AND c.municipality_id = p_municipality_id
      AND m.is_active = true
      AND c.latitude BETWEEN -90 AND 90
      AND c.longitude BETWEEN -180 AND 180
    ORDER BY c.created_at DESC
    LIMIT 500
  ) AS pins;
$$;

REVOKE ALL ON FUNCTION public.get_public_complaint_map_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_complaint_map_pins(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_complaint_map_pins(uuid) IS
  'Public-safe complaint pins: approximate coordinates and display metadata only; no complaint ID or details.';
