-- สถานการณ์น้ำ-ฝน — เปิดโมดูลให้ อบต.ทุ่งแค้ว และ อบต.ตำหนักธรรม (สถานีเพิ่มแล้วที่ 20260918160000)
--
-- หลังไฟล์นี้: เปิดใช้ 4 แห่ง (namlao, demo, thungkaew, tamnaktham) เหลือ muangphrae แห่งเดียว
-- ที่ยังปิดอยู่ เพราะไม่มีพิกัดสำนักงานใน municipalities จึงคำนวณสถานีตามกฎรัศมีไม่ได้
-- (ตั้งพิกัดก่อน → เพิ่มไฟล์ seed → แล้วค่อยเปิดโมดูล — ถ้าเปิดก่อนจะได้หน้า "ยังไม่ได้ตั้งค่าสถานี")
--
-- ⚠️ ต้อง apply ไฟล์นี้ก่อน merge เหมือนรอบก่อน — ตัว check:uniform ดูแค่ว่ามี อปท. ไหนมีคีย์นี้บ้าง
-- แต่ประชาชนของ 2 แห่งนี้จะเห็นเมนูทันทีที่ deploy ถ้าคีย์ถูกเปิดไว้แล้วแต่ยังไม่มีสถานี จะเจอหน้าว่าง

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t.slug, ', ') INTO missing
  FROM (VALUES ('thungkaew'), ('tamnaktham')) AS t(slug)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.water_station_config AS c
    JOIN public.municipalities AS m ON m.id = c.municipality_id
    WHERE m.slug = t.slug AND c.is_active
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '% ยังไม่มีสถานีใน water_station_config — apply 20260918160000 ก่อน', missing;
  END IF;
END;
$$;

BEGIN;

UPDATE public.municipalities
SET enabled_modules = array_append(enabled_modules, 'water-situation')
WHERE slug IN ('thungkaew', 'tamnaktham')
  AND enabled_modules IS NOT NULL
  AND NOT ('water-situation' = ANY (enabled_modules));

COMMIT;
