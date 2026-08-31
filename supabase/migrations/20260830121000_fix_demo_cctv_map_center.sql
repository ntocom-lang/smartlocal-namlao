-- 20260830121000_fix_demo_cctv_map_center.sql
--
-- จุด CCTV รอบแรกอยู่ที่ 18.1448,100.1417 แต่หน้าแผนที่ Data Center
-- เมื่อ municipalities.latitude/longitude ของ demo เป็น NULL จะ fallback ไปกรุงเทพฯ
-- (13.7563, 100.5018 ใน DataCenterMapView.jsx) — หมุดกับกล้องแผนที่คนละจังหวัด จึงมองไม่เห็น
--
-- แก้เฉพาะ slug=demo: ตั้งพิกัดสำนักงานให้เป็นจุดเดียวกับต้นแบบน้ำเลา (จังหวัดแพร่, ไม่มี PII)
-- แล้วย้ายจุด [TEST] CCTV ไปรอบจุดนั้นให้เห็นที่ซูม 13

DO $$
DECLARE
  v_demo_id uuid;
  v_lat     numeric;
  v_lng     numeric;
BEGIN
  SELECT id INTO v_demo_id FROM public.municipalities WHERE slug = 'demo';
  IF v_demo_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ อปท. slug=demo';
  END IF;

  SELECT latitude, longitude INTO v_lat, v_lng
  FROM public.municipalities WHERE slug = 'namlao';
  v_lat := COALESCE(v_lat, 18.259207);
  v_lng := COALESCE(v_lng, 100.3105803);

  UPDATE public.municipalities
  SET latitude = v_lat, longitude = v_lng
  WHERE id = v_demo_id;

  UPDATE public.data_center_entries e
  SET
    latitude = CASE e.name
      WHEN '[TEST] CCTV หน้าอาคารเทศบาล'  THEN v_lat
      WHEN '[TEST] CCTV สี่แยกตลาดสาธิต' THEN v_lat + 0.0011
      WHEN '[TEST] CCTV สวนสาธารณะสาธิต' THEN v_lat - 0.0010
      WHEN '[TEST] CCTV แยกโรงเรียนสาธิต' THEN v_lat + 0.0018
      WHEN '[TEST] CCTV ลานจอดรถเทศบาล'  THEN v_lat - 0.0007
      ELSE e.latitude
    END,
    longitude = CASE e.name
      WHEN '[TEST] CCTV หน้าอาคารเทศบาล'  THEN v_lng
      WHEN '[TEST] CCTV สี่แยกตลาดสาธิต' THEN v_lng + 0.0012
      WHEN '[TEST] CCTV สวนสาธารณะสาธิต' THEN v_lng - 0.0009
      WHEN '[TEST] CCTV แยกโรงเรียนสาธิต' THEN v_lng - 0.0014
      WHEN '[TEST] CCTV ลานจอดรถเทศบาล'  THEN v_lng + 0.0016
      ELSE e.longitude
    END,
    updated_at = now()
  WHERE e.municipality_id = v_demo_id
    AND e.name LIKE '[TEST] CCTV%';

  RAISE NOTICE 'demo map center + CCTV relocated to %, %', v_lat, v_lng;
END $$;
