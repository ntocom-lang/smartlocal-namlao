-- สถานการณ์น้ำ-ฝน — สถานีเตือนภัยน้ำหลาก-ดินถล่ม เฟส 2/3: ใส่สถานีเตือนภัยใกล้แต่ละ อปท.
--
-- กฎเดียวกับสถานีฝน: ทุกสถานีในรัศมี 10 กม. จากพิกัดสำนักงานใน municipalities
-- คำนวณจากรายชื่อสถานีของ ews.dwr.go.th (2,275 สถานี ดึง 2569-09-19)
--   น้ำเลา / demo : บ้านบุญแจ่ม 2.6 กม. (อยู่ใน ต.น้ำเลา) · ป่ากล้วย 5.6 · ผาราง 6.5 · วังโป่ง 8.1
--   ตำหนักธรรม    : ป่ากล้วย 6.5 · วังหงส์ 8.8 · บุญแจ่ม 10.0 (ปัดแล้ว — ใส่ไว้ให้ตรงกับรายการฝน)
--   ทุ่งแค้ว       : แดนชุมพล 9.4 · วังหงส์ 9.7
--
-- ชื่อ/ตำบล/พิกัดใช้ของกรมทรัพยากรน้ำเอง (บางสถานีต่างจาก ThaiWater เช่น วังหงส์ ThaiWater บอก ต.ท่าข้าม)
-- เพราะสถานะเตือนภัยเป็นของกรมทรัพยากรน้ำ ข้อความแจ้งเตือนควรอ้างข้อมูลชุดเดียวกับเขา
-- ตัดเครื่องหมาย * ท้ายชื่อ (ต้นทางใช้กำกับสถานีวัดระดับน้ำ) ออก
--
-- note = หมู่บ้านที่สถานีดูแล (sub_station ของต้นทาง) — ใช้ในข้อความ Telegram บอกเจ้าหน้าที่ว่า
-- ต้องแจ้งหมู่บ้านไหน สถานีวัดระดับน้ำ (วังโป่ง วังหงส์) ต้นทางไม่ได้ระบุหมู่บ้าน จึงเป็น NULL

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'water_station_config_station_type_check'
      AND pg_get_constraintdef(oid) LIKE '%ews%'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20260919100000_water_station_type_ews.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

INSERT INTO public.water_station_config (
  municipality_id, station_type, station_code, station_name,
  tambon_name, amphoe_name, province_name, river_name, agency_name,
  latitude, longitude, distance_km, is_primary, display_order, note
)
SELECT
  m.id, s.station_type, s.station_code, s.station_name,
  s.tambon_name, s.amphoe_name, s.province_name, s.river_name, s.agency_name,
  s.latitude, s.longitude, s.distance_km, s.is_primary, s.display_order, s.note
FROM public.municipalities AS m
JOIN (VALUES
  ('namlao', 'ews', 'STN0911', 'บ้านบุญแจ่ม', 'น้ำเลา', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.267415, 100.333578, 2.6, true, 1, 'หมู่บ้านที่สถานีดูแล: บ้านห้วยทรายขาว, บ้านน้ำเลาใต้'),
  ('namlao', 'ews', 'STN1211', 'บ้านป่ากล้วย', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.223637, 100.273272, 5.6, false, 2, 'หมู่บ้านที่สถานีดูแล: บ้านเวียงใต้, บ้านบุญเริง, บ้านปง, บ้านศรีสิทธิ์'),
  ('namlao', 'ews', 'STN1215', 'บ้านผาราง', 'ทุ่งศรี', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.316285, 100.324273, 6.5, false, 3, 'หมู่บ้านที่สถานีดูแล: บ้านวังหม้อ, บ้านร้องเข็ม'),
  ('namlao', 'ews', 'STN2129', 'บ้านวังโป่ง', 'ร้องกวาง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.330513, 100.327475, 8.1, false, 4, NULL),
  ('demo', 'ews', 'STN0911', 'บ้านบุญแจ่ม', 'น้ำเลา', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.267415, 100.333578, 2.6, true, 1, 'หมู่บ้านที่สถานีดูแล: บ้านห้วยทรายขาว, บ้านน้ำเลาใต้'),
  ('demo', 'ews', 'STN1211', 'บ้านป่ากล้วย', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.223637, 100.273272, 5.6, false, 2, 'หมู่บ้านที่สถานีดูแล: บ้านเวียงใต้, บ้านบุญเริง, บ้านปง, บ้านศรีสิทธิ์'),
  ('demo', 'ews', 'STN1215', 'บ้านผาราง', 'ทุ่งศรี', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.316285, 100.324273, 6.5, false, 3, 'หมู่บ้านที่สถานีดูแล: บ้านวังหม้อ, บ้านร้องเข็ม'),
  ('demo', 'ews', 'STN2129', 'บ้านวังโป่ง', 'ร้องกวาง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.330513, 100.327475, 8.1, false, 4, NULL),
  ('tamnaktham', 'ews', 'STN1211', 'บ้านป่ากล้วย', 'บ้านเวียง', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.223637, 100.273272, 6.5, false, 1, 'หมู่บ้านที่สถานีดูแล: บ้านเวียงใต้, บ้านบุญเริง, บ้านปง, บ้านศรีสิทธิ์'),
  ('tamnaktham', 'ews', 'STN2128', 'บ้านวังหงส์', 'วังหงส์', 'เมืองแพร่', 'แพร่', NULL, 'ทน.', 18.217791, 100.178461, 8.8, false, 2, NULL),
  ('tamnaktham', 'ews', 'STN0911', 'บ้านบุญแจ่ม', 'น้ำเลา', 'ร้องกวาง', 'แพร่', NULL, 'ทน.', 18.267415, 100.333578, 10.0, false, 3, 'หมู่บ้านที่สถานีดูแล: บ้านห้วยทรายขาว, บ้านน้ำเลาใต้'),
  ('thungkaew', 'ews', 'STN1196', 'บ้านแดนชุมพล', 'แดนชุมพล', 'สอง', 'แพร่', NULL, 'ทน.', 18.367695, 100.205709, 9.4, false, 1, 'หมู่บ้านที่สถานีดูแล: บ้านโทกค่า, บ้านทุ่งน้าว'),
  ('thungkaew', 'ews', 'STN2128', 'บ้านวังหงส์', 'วังหงส์', 'เมืองแพร่', 'แพร่', NULL, 'ทน.', 18.217791, 100.178461, 9.7, false, 2, NULL)
) AS s(
  slug, station_type, station_code, station_name,
  tambon_name, amphoe_name, province_name, river_name, agency_name,
  latitude, longitude, distance_km, is_primary, display_order, note
) ON m.slug = s.slug
ON CONFLICT (municipality_id, station_type, station_code) DO NOTHING;

-- ตรวจผลในไฟล์เดียวกัน — slug ผิดหรือ อปท. หายไป INSERT จะผ่านแบบได้ 0 แถวเงียบๆ
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s=%s', t.slug, cnt.n), ', ') INTO bad
  FROM (VALUES ('namlao', 4), ('demo', 4), ('tamnaktham', 3), ('thungkaew', 2)) AS t(slug, expected)
  CROSS JOIN LATERAL (
    SELECT count(*) AS n
    FROM public.water_station_config AS c
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    WHERE m.slug = t.slug AND c.station_type = 'ews' AND c.is_active
  ) AS cnt
  WHERE cnt.n <> t.expected;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'จำนวนสถานีเตือนภัยไม่ตรงที่คาด (น้ำเลา 4 · demo 4 · ตำหนักธรรม 3 · ทุ่งแค้ว 2) ได้ %', bad;
  END IF;
END;
$$;

COMMIT;
