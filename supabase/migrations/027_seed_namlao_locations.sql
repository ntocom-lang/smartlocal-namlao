-- =====================================================
-- SmartLocal 027: ข้อมูลตั้งต้น - สถานที่เกิดเหตุ เทศบาลตำบลน้ำเลา
-- ปรับชื่อหมู่บ้านให้ตรงกับข้อมูลจริงก่อน apply
-- =====================================================

DO $$
DECLARE
  muni_id uuid;
BEGIN
  SELECT id INTO muni_id FROM municipalities WHERE slug = 'namlao';
  IF muni_id IS NULL THEN RETURN; END IF;

  INSERT INTO locations (municipality_id, name, sort_order)
  SELECT muni_id, v.name, v.ord
  FROM (VALUES
    ( 1, 'หมู่ 1 บ้านบุญแจ่ม'),
    ( 2, 'หมู่ 2 บ้านน้ำเลา'),
    ( 3, 'หมู่ 3 บ้านแม่ยาง'),
    ( 4, 'หมู่ 4 บ้านท่าข้าม'),
    ( 5, 'หมู่ 5 บ้านนาอุ่น'),
    ( 6, 'หมู่ 6 บ้านสะเอียบ'),
    ( 7, 'หมู่ 7 บ้านห้วยโป่ง'),
    ( 8, 'หมู่ 8 บ้านดอนแก้ว'),
    ( 9, 'หมู่ 9 บ้านร้องกวาง'),
    (10, 'หมู่ 10 บ้านวังหงส์')
  ) AS v(ord, name)
  WHERE NOT EXISTS (
    SELECT 1 FROM locations l
    WHERE l.municipality_id = muni_id AND l.name = v.name
  );
END;
$$;
