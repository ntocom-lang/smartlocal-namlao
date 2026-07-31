-- =====================================================
-- Migration: Seed Secondary Roads & Highway 5093 (ถนนทางหลวงชนบท พร.5093 / อ่างเก็บน้ำแม่คำปอง / เส้นทางท้องถิ่น)
-- =====================================================

DO $$
DECLARE
  muni_id uuid;
BEGIN
  -- ค้นหา municipality_id สำหรับ 'namlao'
  SELECT id INTO muni_id FROM public.municipalities WHERE slug = 'namlao';
  IF muni_id IS NULL THEN RETURN; END IF;

  -- 1. ทางหลวงชนบท พร.5093 (ถนนสายหลัก 5093)
  INSERT INTO public.data_center_entries (
    municipality_id, group_name, category, name, description,
    latitude, longitude, route_color, route_points, status
  )
  SELECT
    muni_id,
    'โครงสร้างพื้นฐาน',
    'ถนนสายหลัก',
    'ทางหลวงชนบท พร.5093 (ถนนสายหลัก 5093)',
    'ทางหลวงชนบท พร.5093 เส้นทางสายหลักเชื่อมต่อระหว่างตำบลน้ำเลาและหมู่บ้านต่างๆ ในเขตเทศบาล',
    18.330000,
    100.320000,
    '#dc2626',
    '[
      {"lat": 18.315000, "lng": 100.305000},
      {"lat": 18.322000, "lng": 100.312000},
      {"lat": 18.330000, "lng": 100.320000},
      {"lat": 18.338000, "lng": 100.328000},
      {"lat": 18.345000, "lng": 100.335000},
      {"lat": 18.352000, "lng": 100.342000}
    ]'::jsonb,
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.data_center_entries
    WHERE municipality_id = muni_id AND name = 'ทางหลวงชนบท พร.5093 (ถนนสายหลัก 5093)'
  );

  -- 2. ถนนสายรอง ทางไปอ่างเก็บน้ำแม่คำปอง
  INSERT INTO public.data_center_entries (
    municipality_id, group_name, category, name, description,
    latitude, longitude, route_color, route_points, status
  )
  SELECT
    muni_id,
    'โครงสร้างพื้นฐาน',
    'ถนนสายรอง',
    'ถนนสายรอง ทางไปอ่างเก็บน้ำแม่คำปอง',
    'เส้นทางถนนสายรองทางหลวงท้องถิ่น เชื่อมต่อระหว่างชุมชนไปยังอ่างเก็บน้ำแม่คำปอง และพื้นที่ทำการเกษตร',
    18.338500,
    100.325000,
    '#2563eb',
    '[
      {"lat": 18.330000, "lng": 100.320000},
      {"lat": 18.332500, "lng": 100.322000},
      {"lat": 18.335000, "lng": 100.324000},
      {"lat": 18.337000, "lng": 100.325500},
      {"lat": 18.340000, "lng": 100.327500},
      {"lat": 18.343000, "lng": 100.330000}
    ]'::jsonb,
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.data_center_entries
    WHERE municipality_id = muni_id AND name = 'ถนนสายรอง ทางไปอ่างเก็บน้ำแม่คำปอง'
  );

  -- 3. ถนนเลียบคลองส่งน้ำชลประทาน
  INSERT INTO public.data_center_entries (
    municipality_id, group_name, category, name, description,
    latitude, longitude, route_color, route_points, status
  )
  SELECT
    muni_id,
    'โครงสร้างพื้นฐาน',
    'ถนนสายรอง',
    'ถนนเลียบคลองส่งน้ำชลประทาน (สายห้วยโป่ง-ดอนแก้ว)',
    'ถนนสายรองสำหรับการสัญจร ขนส่งผลผลิตทางการเกษตร และตรวจตราคลองส่งน้ำ',
    18.325000,
    100.315000,
    '#059669',
    '[
      {"lat": 18.320000, "lng": 100.310000},
      {"lat": 18.323000, "lng": 100.313000},
      {"lat": 18.326000, "lng": 100.316000},
      {"lat": 18.328000, "lng": 100.319000}
    ]'::jsonb,
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.data_center_entries
    WHERE municipality_id = muni_id AND name = 'ถนนเลียบคลองส่งน้ำชลประทาน (สายห้วยโป่ง-ดอนแก้ว)'
  );

  -- 4. ถนนสายรอง เชื่อมบ้านบุญแจ่ม - บ้านน้ำเลา
  INSERT INTO public.data_center_entries (
    municipality_id, group_name, category, name, description,
    latitude, longitude, route_color, route_points, status
  )
  SELECT
    muni_id,
    'โครงสร้างพื้นฐาน',
    'ถนนสายรอง',
    'ถนนสายรอง เชื่อมบ้านบุญแจ่ม - บ้านน้ำเลา',
    'ถนนทางหลวงท้องถิ่นสายรองสำหรับสัญจรระหว่างหมู่บ้าน',
    18.334000,
    100.318000,
    '#d97706',
    '[
      {"lat": 18.331000, "lng": 100.315000},
      {"lat": 18.334000, "lng": 100.318000},
      {"lat": 18.337000, "lng": 100.321000}
    ]'::jsonb,
    'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.data_center_entries
    WHERE municipality_id = muni_id AND name = 'ถนนสายรอง เชื่อมบ้านบุญแจ่ม - บ้านน้ำเลา'
  );

END;
$$;
