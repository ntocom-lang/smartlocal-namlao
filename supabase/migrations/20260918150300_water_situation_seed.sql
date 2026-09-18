-- สถานการณ์น้ำ-ฝน เฟส 4/6 — สถานีเริ่มต้นของเทศบาลตำบลน้ำเลา + สนามซ้อม demo
--
-- เลือกด้วยกฎที่อธิบายและตรวจย้อนได้ ไม่ได้หยิบตามใจ (คำนวณจากข้อมูลต้นทาง 2569-09-18):
--   ฝน      = ทุกสถานีในรัศมี 10 กม. จากพิกัดสำนักงาน (18.2592070, 100.3105803) → 8 สถานี
--             ทุกสถานีอยู่ใน อ.ร้องกวาง — บ้านบุญแจ่มเป็นสถานีเดียวที่อยู่ใน ต.น้ำเลา (is_primary)
--   ระดับน้ำ = ใน อ.ร้องกวาง ไม่มีสถานีวัดระดับน้ำเลย จึงใช้ 2 สถานีที่ใกล้ที่สุดในลุ่มน้ำยม
--             YOM003 หนองม่วงไข่ = สถานีบนตัวแม่น้ำยมที่ใกล้ที่สุด (14.1 กม.)
--             Y.38 บ้านแม่คำมีตำหนักธรรม = สถานีระดับน้ำที่ใกล้ที่สุด แต่อยู่บนน้ำแม่คำมี (7.7 กม.)
--             ห้ามเรียก Y.38 ว่า "แม่น้ำยม" — ต้นทางระบุลำน้ำเป็นน้ำแม่คำมี (สาขาในลุ่มน้ำยม)
--
-- demo ได้ชุดเดียวกันเพราะใช้พิกัดสำนักงานเดียวกับน้ำเลา — ใช้ตรวจหน้าจอบน localhost
-- (VITE_TENANT_SLUG=demo) โดยไม่ต้องแตะการตั้งค่าของ อปท. จริง
--
-- เพิ่ม อปท. อื่นทีหลัง: คำนวณด้วยกฎเดียวกันจากพิกัดสำนักงานของแห่งนั้น แล้วเพิ่มไฟล์ seed ใหม่
-- (อย่าแก้ไฟล์นี้ — ไฟล์ที่ apply แล้วต้องคงเนื้อหาเดิมให้ย้อนตรวจได้)

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
CROSS JOIN (VALUES
  ('rain', 'STN0911', 'บ้านบุญแจ่ม', 'น้ำเลา', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.267415, 100.333578, 2.6, true, 1),
  ('rain', 'RES040', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'สสน.', 18.232890, 100.313510, 2.9, false, 2),
  ('rain', 'MOU350', 'สถานีวิจัยต้นน้ำยม', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'พพภ', 18.234600, 100.354800, 5.4, false, 3),
  ('rain', 'STN1211', 'บ้านป่ากล้วย', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.223637, 100.273272, 5.6, false, 4),
  ('rain', 'STN1215', 'บ้านผาราง', 'ทุ่งศรี', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.316285, 100.324273, 6.5, false, 5),
  ('rain', 'RES041', 'อ่างเก็บน้ำแม่เติ๊ก', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'สสน.', 18.199780, 100.295650, 6.8, false, 6),
  ('rain', 'STN2129', 'วังโป่ง', 'ร้องกวาง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.330513, 100.327475, 8.1, false, 7),
  ('rain', 'MOU341', 'สะพานน้ำแม่ถาง', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'พพภ', 18.216600, 100.388500, 9.5, false, 8),
  ('waterlevel', 'YOM003', 'หนองม่วงไข่', 'น้ำรัด', 'หนองม่วงไข่', 'แพร่', 'แม่น้ำยม', 'สสน.', 18.265910, 100.177060, 14.1, false, 1),
  ('waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', 'ตำหนักธรรม', 'หนองม่วงไข่', 'แพร่', 'น้ำแม่คำมี', 'ชป.', 18.266430, 100.237633, 7.7, false, 2)
) AS s(
  station_type, station_code, station_name,
  tambon_name, amphoe_name, province_name, river_name, agency_name,
  latitude, longitude, distance_km, is_primary, display_order
)
WHERE m.slug IN ('namlao', 'demo')
ON CONFLICT (municipality_id, station_type, station_code) DO NOTHING;

-- ตรวจผลในไฟล์เดียวกัน — slug สะกดผิดหรือ อปท. ไม่มีในฐาน INSERT จะผ่านแบบได้ 0 แถวเงียบๆ
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(slug, ', ') INTO bad
  FROM (VALUES ('namlao'), ('demo')) AS t(slug)
  WHERE (
    SELECT count(*)
    FROM public.water_station_config AS c
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    WHERE m.slug = t.slug AND c.is_active
  ) <> 10;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'คาดว่า % จะมีสถานี 10 แห่ง แต่ไม่ครบ — ตรวจ slug และตาราง municipalities', bad;
  END IF;
END;
$$;

COMMIT;
