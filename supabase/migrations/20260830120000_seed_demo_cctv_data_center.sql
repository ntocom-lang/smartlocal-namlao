-- 20260830120000_seed_demo_cctv_data_center.sql
--
-- ใส่จุดกล้องวงจรปิดจำลองในศูนย์ข้อมูลดิจิทัลของสนามซ้อม (slug=demo) เท่านั้น
-- กลุ่ม "ปุ่มลอยบนแผนที่" + ประเภท "กล้องวงจรปิด" ตามข้อตกลงใน DataCenterMapView.jsx
-- เพื่อให้ขึ้นเป็นปุ่มลอยบนแผนที่สาธารณะ
--
-- ห้ามรันใส่ อปท. จริง — เจอ slug อื่นในชุด INSERT นี้ไม่ได้ เพราะกรอง municipality_id จาก demo เท่านั้น
-- ข้อมูลทั้งหมดขึ้นต้น [TEST] ไม่ใช่พิกัดกล้องจริง ไม่มีข้อมูลบุคคล

DO $$
DECLARE
  v_demo_id uuid;
  v_lat     double precision;
  v_lng     double precision;
  v_inserted int;
BEGIN
  SELECT id, latitude, longitude
    INTO v_demo_id, v_lat, v_lng
  FROM public.municipalities
  WHERE slug = 'demo';

  IF v_demo_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ อปท. slug=demo — ต้องมีสนามซ้อมก่อน (ดู 20260829113107_seed_demo_tenant.sql)';
  END IF;

  -- พิกัดสำนักงานเทศบาลของ demo ถ้ายังว่าง ใช้จุดอ้างอิงแพร่ (ค่า default ของ GoogleMapCanvas)
  v_lat := COALESCE(v_lat, 18.1448);
  v_lng := COALESCE(v_lng, 100.1417);

  INSERT INTO public.data_center_entries
    (municipality_id, group_name, category, name, description, latitude, longitude, status)
  SELECT v_demo_id, s.group_name, s.category, s.name, s.description, s.lat, s.lng, 'active'
  FROM (VALUES
    (
      'ปุ่มลอยบนแผนที่',
      'กล้องวงจรปิด',
      '[TEST] CCTV หน้าอาคารเทศบาล',
      'จุดจำลองสำหรับทดสอบแผนที่ Data Center — ไม่ใช่กล้องจริง ห้ามส่งทีมตรวจ',
      v_lat,
      v_lng
    ),
    (
      'ปุ่มลอยบนแผนที่',
      'กล้องวงจรปิด',
      '[TEST] CCTV สี่แยกตลาดสาธิต',
      'จุดจำลองสำหรับทดสอบแผนที่ Data Center — ไม่ใช่กล้องจริง ห้ามส่งทีมตรวจ',
      v_lat + 0.0012,
      v_lng + 0.0008
    ),
    (
      'ปุ่มลอยบนแผนที่',
      'กล้องวงจรปิด',
      '[TEST] CCTV สวนสาธารณะสาธิต',
      'จุดจำลองสำหรับทดสอบแผนที่ Data Center — ไม่ใช่กล้องจริง ห้ามส่งทีมตรวจ',
      v_lat - 0.0010,
      v_lng - 0.0009
    ),
    (
      'ปุ่มลอยบนแผนที่',
      'กล้องวงจรปิด',
      '[TEST] CCTV แยกโรงเรียนสาธิต',
      'จุดจำลองสำหรับทดสอบแผนที่ Data Center — ไม่ใช่กล้องจริง ห้ามส่งทีมตรวจ',
      v_lat + 0.0022,
      v_lng - 0.0012
    ),
    (
      'ปุ่มลอยบนแผนที่',
      'กล้องวงจรปิด',
      '[TEST] CCTV ลานจอดรถเทศบาล',
      'จุดจำลองสำหรับทดสอบแผนที่ Data Center — ไม่ใช่กล้องจริง ห้ามส่งทีมตรวจ',
      v_lat - 0.0006,
      v_lng + 0.0021
    )
  ) AS s(group_name, category, name, description, lat, lng)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.data_center_entries e
    WHERE e.municipality_id = v_demo_id
      AND e.name = s.name
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.data_center_group_icons
    (municipality_id, group_name, category, emoji)
  VALUES
    (v_demo_id, 'ปุ่มลอยบนแผนที่', '', '🛡️'),
    (v_demo_id, 'ปุ่มลอยบนแผนที่', 'กล้องวงจรปิด', '🎥')
  ON CONFLICT (municipality_id, group_name, category)
  DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = now();

  RAISE NOTICE 'demo CCTV seed: municipality=% inserted=% (0 = มีอยู่แล้ว)', v_demo_id, v_inserted;
END $$;
