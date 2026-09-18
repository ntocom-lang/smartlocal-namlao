-- สถานการณ์น้ำ-ฝน เฟส 5/6 — เปิดโมดูล 'water-situation' ให้ อปท. ที่ตั้งค่าสถานีแล้วเท่านั้น
--
-- ⚠️ ต่างจาก waste/waterworks ที่เติมคีย์ให้ "ทุกแถว" — ที่นี่ตั้งใจเปิดเฉพาะ namlao + demo
-- เพราะหน้านี้ใช้ได้ต่อเมื่อมีสถานีใน water_station_config แล้ว อปท. ที่ยังไม่มีสถานีถ้าเห็นเมนู
-- จะกดเข้าไปเจอหน้าว่าง (ตัดสินใจโดยเจ้าของระบบ 2569-09-18)
--
-- ผลต่อด่าน scripts/check-backend-uniformity.mjs: จะขึ้นคำเตือนว่า อปท. อื่น "ขาด" คีย์นี้
-- ซึ่งเป็นการปิดโดยตั้งใจ ด่านนั้นบล็อก deploy เฉพาะเมื่อคีย์ไม่อยู่ในแถวไหนเลย
-- ⇒ ต้อง apply ไฟล์นี้ "ก่อน" merge โค้ดที่เพิ่มคีย์ใน src/lib/staffModules.js เสมอ
--
-- เปิดให้ อปท. อื่นทีหลัง: เพิ่มสถานีใน water_station_config ก่อน แล้วค่อยติ๊กโมดูล
-- "สถานการณ์น้ำ-ฝน" ในแผง superadmin (ถ้าติ๊กก่อน ประชาชนจะเห็นหน้า "ยังไม่ได้ตั้งค่าสถานี")

DO $$
DECLARE
  missing text;
BEGIN
  IF to_regclass('public.water_station_config') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150000–20260918150300 ก่อนไฟล์นี้';
  END IF;

  -- ห้ามเปิดโมดูลให้ อปท. ที่ยังไม่มีสถานี — เมนูจะพาไปหน้าว่าง
  SELECT string_agg(t.slug, ', ') INTO missing
  FROM (VALUES ('namlao'), ('demo')) AS t(slug)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.water_station_config AS c
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    WHERE m.slug = t.slug AND c.is_active
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '% ยังไม่มีสถานีใน water_station_config — apply 20260918150300 ก่อน', missing;
  END IF;
END;
$$;

BEGIN;

-- enabled_modules = NULL แปลว่าเปิดทุกโมดูลอยู่แล้ว (isModuleEnabled) จึงข้ามแถวนั้น
UPDATE public.municipalities
SET enabled_modules = array_append(enabled_modules, 'water-situation')
WHERE slug IN ('namlao', 'demo')
  AND enabled_modules IS NOT NULL
  AND NOT ('water-situation' = ANY (enabled_modules));

COMMIT;
