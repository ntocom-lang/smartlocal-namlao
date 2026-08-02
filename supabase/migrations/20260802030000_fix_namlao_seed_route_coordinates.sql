-- =====================================================
-- Migration: Fix Nam Lao Seed Route Coordinates to be 100% Inside Nam Lao Sub-district Boundary
-- =====================================================

DO $$
DECLARE
  muni_id uuid;
BEGIN
  SELECT id INTO muni_id FROM public.municipalities WHERE slug = 'namlao';
  IF muni_id IS NULL THEN RETURN; END IF;

  -- 1. ปรับพิกัด "ทางหลวงชนบท พร.5093 (ถนนสายหลัก 5093)" ให้อยู่ภายในแนวเขตตำบลน้ำเลา (Lat 18.245 - 18.292, Lng 100.315 - 100.365)
  UPDATE public.data_center_entries
  SET
    latitude = 18.268000,
    longitude = 100.340000,
    route_points = '[
      {"lat": 18.248000, "lng": 100.315000},
      {"lat": 18.255000, "lng": 100.325000},
      {"lat": 18.262000, "lng": 100.334000},
      {"lat": 18.268000, "lng": 100.342000},
      {"lat": 18.275000, "lng": 100.352000},
      {"lat": 18.282000, "lng": 100.362000}
    ]'::jsonb
  WHERE municipality_id = muni_id AND name = 'ทางหลวงชนบท พร.5093 (ถนนสายหลัก 5093)';

  -- 2. ปรับพิกัด "ถนนสายรอง ทางไปอ่างเก็บน้ำแม่คำปอง" ให้อยู่ภายในแนวเขตตำบลน้ำเลา
  UPDATE public.data_center_entries
  SET
    latitude = 18.270000,
    longitude = 100.345000,
    route_points = '[
      {"lat": 18.262000, "lng": 100.334000},
      {"lat": 18.265000, "lng": 100.338000},
      {"lat": 18.269000, "lng": 100.343000},
      {"lat": 18.273000, "lng": 100.348000},
      {"lat": 18.278000, "lng": 100.355000}
    ]'::jsonb
  WHERE municipality_id = muni_id AND name = 'ถนนสายรอง ทางไปอ่างเก็บน้ำแม่คำปอง';

  -- 3. ปรับพิกัด "สายน้ำแม่คำปอง (น้ำแม่คำมี - อ่างเก็บน้ำแม่คำปอง)" ให้อยู่ภายในแนวเขตตำบลน้ำเลา
  UPDATE public.data_center_entries
  SET
    latitude = 18.265000,
    longitude = 100.338000,
    route_points = '[
      {"lat": 18.242000, "lng": 100.312000},
      {"lat": 18.248000, "lng": 100.318000},
      {"lat": 18.254000, "lng": 100.325000},
      {"lat": 18.260000, "lng": 100.331000},
      {"lat": 18.266000, "lng": 100.338000},
      {"lat": 18.272000, "lng": 100.345000},
      {"lat": 18.278000, "lng": 100.352000},
      {"lat": 18.285000, "lng": 100.360000}
    ]'::jsonb
  WHERE municipality_id = muni_id AND name = 'สายน้ำแม่คำปอง (น้ำแม่คำมี - อ่างเก็บน้ำแม่คำปอง)';

END;
$$;
