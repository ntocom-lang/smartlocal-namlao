-- สถานการณ์น้ำ-ฝน — เพิ่มสถานีให้ อบต.ทุ่งแค้ว และ อบต.ตำหนักธรรม (คีย์โมดูลอยู่ 20260918160100)
--
-- ใช้กฎเดียวกับน้ำเลา (20260918150300) คำนวณจากพิกัดสำนักงานของแต่ละแห่งใน municipalities:
--   ฝน      = ทุกสถานีในรัศมี 10 กม. → ทุ่งแค้ว 4 สถานี · ตำหนักธรรม 5 สถานี
--   ระดับน้ำ = สถานีบนแม่น้ำยมที่ใกล้ที่สุด + สถานีระดับน้ำที่ใกล้ที่สุด (ถ้าเป็นคนละตัว)
--             ทุ่งแค้ว: YOM003 เป็นทั้งสองอย่างในตัวเดียว จึงมีสถานีเดียว
--             ตำหนักธรรม: Y.38 อยู่ในตำบลตัวเอง ห่าง 0.7 กม. + YOM003 แม่น้ำยม 6.6 กม.
--
-- เมืองแพร่ (muangphrae) ยังเปิดไม่ได้ — municipalities.latitude/longitude ว่าง คำนวณรัศมีไม่ได้
-- ต้องตั้งพิกัดสำนักงานก่อน แล้วค่อยเพิ่มไฟล์ seed ใหม่
--
-- ลำดับการแสดงผลของสถานีระดับน้ำเปลี่ยนเป็น "ใกล้ไปไกล" ให้เหมือนกันทุกแห่งและเหมือนรายการฝน
-- (เดิมของน้ำเลา/demo เรียงแม่น้ำยมขึ้นก่อน — พอตำหนักธรรมมีสถานีในตำบลห่าง 0.7 กม.
--  กฎเดิมจะดันสถานีในตำบลไปอยู่อันดับสอง ซึ่งอ่านแล้วขัดกับคำอธิบายหัวข้อว่า "ใกล้สำนักงานที่สุด")

DO $$
BEGIN
  IF to_regclass('public.water_station_config') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150000_water_station_config_table.sql ก่อนไฟล์นี้';
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
  ('thungkaew', 'rain', 'RES038', 'อ่างเก็บน้ำห้วยยอย', 'ทุ่งแค้ว', 'หนองม่วงไข่', 'แพร่', NULL, 'สสน.', 18.309680, 100.136740, 1.8, true, 1),
  ('thungkaew', 'rain', 'YOM003', 'หนองม่วงไข่', 'น้ำรัด', 'หนองม่วงไข่', 'แพร่', NULL, 'สสน.', 18.265910, 100.177060, 4.8, false, 2),
  ('thungkaew', 'rain', 'STN1196', 'บ้านแดนชุมพล', 'แดนชุมพล', 'สอง', 'แพร่', NULL, 'ทน.', 18.367695, 100.205709, 9.4, false, 3),
  ('thungkaew', 'rain', 'STN2128', 'บ้านวังหงส์', 'ท่าข้าม', 'เมืองแพร่', 'แพร่', NULL, 'ทน.', 18.217791, 100.178461, 9.7, false, 4),
  ('thungkaew', 'waterlevel', 'YOM003', 'หนองม่วงไข่', 'น้ำรัด', 'หนองม่วงไข่', 'แพร่', 'แม่น้ำยม', 'สสน.', 18.265910, 100.177060, 4.8, false, 1),
  ('tamnaktham', 'rain', 'STN1211', 'บ้านป่ากล้วย', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.223637, 100.273272, 6.5, false, 1),
  ('tamnaktham', 'rain', 'YOM003', 'หนองม่วงไข่', 'น้ำรัด', 'หนองม่วงไข่', 'แพร่', NULL, 'สสน.', 18.265910, 100.177060, 6.6, false, 2),
  ('tamnaktham', 'rain', 'STN2128', 'บ้านวังหงส์', 'ท่าข้าม', 'เมืองแพร่', 'แพร่', NULL, 'ทน.', 18.217791, 100.178461, 8.8, false, 3),
  ('tamnaktham', 'rain', 'RES040', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'สสน.', 18.232890, 100.313510, 9.0, false, 4),
  ('tamnaktham', 'rain', 'STN0911', 'บ้านบุญแจ่ม', 'น้ำเลา', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.267415, 100.333578, 10.0, false, 5),
  ('tamnaktham', 'waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', 'ตำหนักธรรม', 'หนองม่วงไข่', 'แพร่', 'น้ำแม่คำมี', 'ชป.', 18.266430, 100.237633, 0.7, true, 1),
  ('tamnaktham', 'waterlevel', 'YOM003', 'หนองม่วงไข่', 'น้ำรัด', 'หนองม่วงไข่', 'แพร่', 'แม่น้ำยม', 'สสน.', 18.265910, 100.177060, 6.6, false, 2)
) AS s(
  slug, station_type, station_code, station_name,
  tambon_name, amphoe_name, province_name, river_name, agency_name,
  latitude, longitude, distance_km, is_primary, display_order
) ON m.slug = s.slug
ON CONFLICT (municipality_id, station_type, station_code) DO NOTHING;

-- เรียงสถานีระดับน้ำของน้ำเลา/demo ใหม่เป็น "ใกล้ไปไกล" ให้เหมือน อปท. ที่เพิ่งเพิ่ม
UPDATE public.water_station_config AS c
SET display_order = v.display_order
FROM (VALUES ('Y.38', 1::smallint), ('YOM003', 2::smallint)) AS v(station_code, display_order)
WHERE c.station_type = 'waterlevel'
  AND c.station_code = v.station_code
  AND c.display_order <> v.display_order
  AND c.municipality_id IN (SELECT id FROM public.municipalities WHERE slug IN ('namlao', 'demo'));

-- ตรวจผลในไฟล์เดียวกัน — slug ผิดหรือ อปท. หายไป INSERT จะผ่านแบบได้ 0 แถวเงียบๆ
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s=%s', t.slug, cnt.n), ', ') INTO bad
  FROM (VALUES ('thungkaew', 5), ('tamnaktham', 7)) AS t(slug, expected)
  CROSS JOIN LATERAL (
    SELECT count(*) AS n
    FROM public.water_station_config AS c
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    WHERE m.slug = t.slug AND c.is_active
  ) AS cnt
  WHERE cnt.n <> t.expected;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'จำนวนสถานีไม่ตรงที่คาด (ทุ่งแค้ว 5 · ตำหนักธรรม 7) ได้ %', bad;
  END IF;
END;
$$;

COMMIT;
