-- สถานการณ์น้ำ-ฝน — อ่างเก็บน้ำ เฟส 4/4: ใส่อ่างเก็บน้ำขนาดกลางที่อยู่ใกล้แต่ละ อปท.
--
-- กฎ (เจ้าของระบบเลือก 2569-09-18): อ่างเก็บน้ำขนาดกลางทุกแห่งในรัศมี 15 กม. จากพิกัดสำนักงาน
-- ใน municipalities ที่ "มีข้อมูลจริง" — คำนวณจาก ThaiWater thaiwater30/analyst/dam (dam_medium)
--   น้ำเลา / demo : แม่คำปอง 3.6 กม. (อยู่ใน ต.น้ำเลา เอง) + แม่ถาง 4.3 กม.
--   ตำหนักธรรม    : แม่ถาง 10.2 กม. + แม่คำปอง 11.2 กม.
--   ทุ่งแค้ว       : ไม่มี — อ่างที่ใกล้ที่สุดคือห้วยขอน (id 59207, 12.5 กม.) แต่ต้นทางมีแค่ชื่อ
--                    (วันที่ 1970-01-01 ปริมาตร null ความจุ 0) ใส่ไปก็ขึ้น "ไม่มีข้อมูล" ตลอด
--                    ทั้งชุดมีแถวแบบนี้ 317 จาก 862 อ่าง — ถ้าจะเพิ่มอ่างให้ อปท. อื่นต้องกรองก่อนเสมอ
--   ทั้งสองอ่างอยู่ในลุ่มน้ำยม กรมชลประทานเป็นเจ้าของข้อมูล
--
-- station_code = dam.id ของต้นทาง (ห้ามจับคู่ด้วยชื่ออ่าง เหตุผลเดียวกับสถานีฝน/ระดับน้ำ)
-- is_primary = อ่างอยู่ในตำบลของ อปท. นั้นเอง (หน้าเว็บขึ้นป้าย "ในตำบล")
-- display_order เรียงใกล้ไปไกลเหมือนสถานีชนิดอื่น

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'water_station_config_station_type_check'
      AND pg_get_constraintdef(oid) LIKE '%dam%'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260918180000_water_station_type_dam.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

INSERT INTO public.water_station_config (
  municipality_id, station_type, station_code, station_name,
  tambon_name, amphoe_name, province_name, river_name, agency_name,
  latitude, longitude, distance_km, is_primary, display_order
)
SELECT
  m.id, s.station_type, s.station_code, s.station_name,
  s.tambon_name, s.amphoe_name, s.province_name, s.river_name, s.agency_name,
  s.latitude, s.longitude, s.distance_km, s.is_primary, s.display_order
FROM public.municipalities AS m
JOIN (VALUES
  ('namlao',     'dam', '305', 'อ่างเก็บน้ำแม่คำปอง', 'น้ำเลา',   'ร้องกวาง', 'แพร่', NULL, 'ชป.', 18.256344, 100.344356,  3.6, true,  1),
  ('namlao',     'dam', '304', 'อ่างเก็บน้ำแม่ถาง',   'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ชป.', 18.221104, 100.319328,  4.3, false, 2),
  ('demo',       'dam', '305', 'อ่างเก็บน้ำแม่คำปอง', 'น้ำเลา',   'ร้องกวาง', 'แพร่', NULL, 'ชป.', 18.256344, 100.344356,  3.6, true,  1),
  ('demo',       'dam', '304', 'อ่างเก็บน้ำแม่ถาง',   'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ชป.', 18.221104, 100.319328,  4.3, false, 2),
  ('tamnaktham', 'dam', '304', 'อ่างเก็บน้ำแม่ถาง',   'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ชป.', 18.221104, 100.319328, 10.2, false, 1),
  ('tamnaktham', 'dam', '305', 'อ่างเก็บน้ำแม่คำปอง', 'น้ำเลา',   'ร้องกวาง', 'แพร่', NULL, 'ชป.', 18.256344, 100.344356, 11.2, false, 2)
) AS s(
  slug, station_type, station_code, station_name,
  tambon_name, amphoe_name, province_name, river_name, agency_name,
  latitude, longitude, distance_km, is_primary, display_order
) ON m.slug = s.slug
ON CONFLICT (municipality_id, station_type, station_code) DO NOTHING;

-- ตรวจผลในไฟล์เดียวกัน — slug ผิดหรือ อปท. หายไป INSERT จะผ่านแบบได้ 0 แถวเงียบๆ
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s=%s', t.slug, cnt.n), ', ') INTO bad
  FROM (VALUES ('namlao', 2), ('demo', 2), ('tamnaktham', 2), ('thungkaew', 0)) AS t(slug, expected)
  CROSS JOIN LATERAL (
    SELECT count(*) AS n
    FROM public.water_station_config AS c
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    WHERE m.slug = t.slug AND c.station_type = 'dam' AND c.is_active
  ) AS cnt
  WHERE cnt.n <> t.expected;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'จำนวนอ่างไม่ตรงที่คาด (น้ำเลา 2 · demo 2 · ตำหนักธรรม 2 · ทุ่งแค้ว 0) ได้ %', bad;
  END IF;
END;
$$;

COMMIT;
