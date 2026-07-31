-- =====================================================
-- Migration: Seed High-Precision GIS Waterway Line for Nam Mae Kham Mi / Mae Kampong Stream
-- =====================================================

DO $$
DECLARE
  muni_id uuid;
BEGIN
  SELECT id INTO muni_id FROM public.municipalities WHERE slug = 'namlao';
  IF muni_id IS NULL THEN RETURN; END IF;

  -- เพิ่มเส้นทางน้ำ "สายน้ำแม่คำปอง / น้ำแม่คำมี" คดโค้งตามแนวภูมิประเทศจริง
  INSERT INTO public.data_center_entries (
    municipality_id, group_name, category, name, description,
    latitude, longitude, route_color, route_points, status
  )
  SELECT
    muni_id,
    'โครงสร้างพื้นฐาน',
    'แหล่งน้ำ/สายน้ำ',
    'สายน้ำแม่คำปอง (น้ำแม่คำมี - อ่างเก็บน้ำแม่คำปอง)',
    'เส้นทางสายน้ำธรรมชาติ ไหลจากอ่างเก็บน้ำแม่คำปอง (ห้วยผาราง) ผ่านบ้านห้วยโป่ง บ้านน้ำเลา และอำเภอร้องกวาง',
    18.318000,
    100.329500,
    '#0284c7',
    '[
      {"lat": 18.297800, "lng": 100.352200},
      {"lat": 18.300500, "lng": 100.348500},
      {"lat": 18.303200, "lng": 100.345800},
      {"lat": 18.306800, "lng": 100.341200},
      {"lat": 18.310500, "lng": 100.337500},
      {"lat": 18.314200, "lng": 100.334000},
      {"lat": 18.318000, "lng": 100.329500},
      {"lat": 18.321800, "lng": 100.325000},
      {"lat": 18.325200, "lng": 100.321200},
      {"lat": 18.328000, "lng": 100.317500},
      {"lat": 18.331500, "lng": 100.313800},
      {"lat": 18.335000, "lng": 100.309200},
      {"lat": 18.339200, "lng": 100.304500}
    ]'::jsonb,
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.data_center_entries
    WHERE municipality_id = muni_id AND name = 'สายน้ำแม่คำปอง (น้ำแม่คำมี - อ่างเก็บน้ำแม่คำปอง)'
  );

END;
$$;
