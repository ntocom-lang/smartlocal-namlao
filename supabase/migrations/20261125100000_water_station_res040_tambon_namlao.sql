-- แก้ตำบลของสถานีฝน RES040 (อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา) จาก "บ้านเวียง" เป็น "น้ำเลา"
-- และตั้ง is_primary (ป้าย "ในตำบล") ให้น้ำเลา + demo ให้ตรงกับตำบลที่แก้
--
-- ที่มา: เจ้าของระบบแจ้ง 2569-11-15 ว่าอ่างนี้อยู่ ต.น้ำเลา แต่การ์ดฝนหน้าสถานการณ์น้ำ-ฝนขึ้น ต.บ้านเวียง
-- หลักฐาน (เรียงจากหนักไปเบา):
--   1) คำยืนยันของเจ้าของระบบ (คนในพื้นที่)
--   2) ผังน้ำตำบลน้ำเลา (src/lib/waterSystem/namlao.js:45, :56) จัด "อ่างห้วยขึมโยธินฯ" + สถานีฝน RES040 เป็น inside
--   3) พิกัดสถานี 18.232890, 100.313510 อยู่ในเส้นเขต ต.น้ำเลา ของ public/boundaries/namlao.geojson
--      (adm3_pcode TH540205) แต่ห่างเส้นเขตด้านใต้เพียงราว 155 ม. และเส้นเขตชุดนี้เป็นแบบย่อ (generalized)
--      จึงเป็นหลักฐานประกอบ ไม่ใช่หลักฐานหลัก
-- ค่าผิดมาจากไฟล์ seed 20260918150300:39 (น้ำเลา + demo) และ 20260918160000:45 (ตำหนักธรรม) ที่คัดชื่อตำบลจาก
-- ข้อมูลต้นทางของ สสน. ณ 2569-09-18 · ไฟล์ seed ห้ามแก้ (apply แล้ว) จึงแก้ด้วยไฟล์นี้
-- สถานีอื่นของน้ำเลาตรวจด้วยวิธีเดียวกันแล้ว: ที่บันทึกเป็นน้ำเลาอยู่ในเขต ที่บันทึกเป็นตำบลอื่นอยู่นอกเขตทุกสถานี
-- (geojson มีเฉพาะเขต ต.น้ำเลา จึงยืนยันได้แค่ใน/นอกน้ำเลา ยืนยันชื่อตำบลอื่นไม่ได้)
--
-- thaiwater-sync ไม่เขียนตารางนี้ (อ่านแค่ id/station_type/station_code) และ seed ใช้ ON CONFLICT DO NOTHING
-- แก้ครั้งเดียวจึงไม่ถูกย้อนกลับ
--
-- ขอบเขต:
--   - tambon_name: แก้ทุก อปท. ที่มีแถว RES040 (น้ำเลา · demo · ตำหนักธรรม) เพราะเป็นข้อเท็จจริงของตัวสถานี
--   - is_primary = true (นิยาม: อยู่ตำบลเดียวกับสำนักงาน · 20260918150000:40): เฉพาะน้ำเลา + demo
--     (demo ใช้ชุดสถานีและพิกัดสำนักงานเดียวกับน้ำเลา ซึ่งตั้ง STN0911 เป็น true ไว้) · ตำหนักธรรมคง false
--   - จำกัดด้วยพิกัดเดิมของสถานี (±0.0005° ≈ 55 ม.) กันโดนแถวอื่น · รันซ้ำได้ ไม่เปลี่ยนอะไรเพิ่ม
--
-- ผลที่ตามมา (ไม่มีการเปลี่ยนโครงสร้าง/สิทธิ์/ฟังก์ชัน):
--   - การ์ดฝนแสดง "ต.น้ำเลา" + ป้าย "ในตำบล" เหมือน STN0911 · ตัวกรอง "เฉพาะในตำบล" ของน้ำเลานับ RES040
--   - ภาพแชร์ (shareWaterSituation) คำนวณ is_primary เองจากตำบล จึงได้ผลตรงกับหน้าหลัก
--   - ไม่แตะประวัติ: water_readings / water_daily_summary / water_event_* / water_village_stations ไม่ได้เก็บตำบลของสถานีซ้ำ
--   - ข้อความเตือนของ สสน. (water_warnings.tambon_name) ยังเป็นตำบลตามต้นฉบับ — พฤติกรรมเดิม ตั้งใจ "ตามต้นฉบับ"
--
-- ย้อนกลับ: UPDATE ชุดเดียวกัน สลับ 'น้ำเลา' ↔ 'บ้านเวียง' และ is_primary กลับเป็น false (updated_at เดิมจะหาย)

BEGIN;

UPDATE public.water_station_config AS c
SET tambon_name = 'น้ำเลา', updated_at = now()
WHERE c.station_type = 'rain'
  AND c.station_code = 'RES040'
  AND c.tambon_name = 'บ้านเวียง'
  AND c.amphoe_name = 'ร้องกวาง'
  AND c.province_name = 'แพร่'
  AND abs(c.latitude - 18.232890) < 0.0005
  AND abs(c.longitude - 100.313510) < 0.0005;

UPDATE public.water_station_config AS c
SET is_primary = true, updated_at = now()
FROM public.municipalities AS m
WHERE m.id = c.municipality_id
  AND m.slug IN ('namlao', 'demo')
  AND c.station_type = 'rain'
  AND c.station_code = 'RES040'
  AND c.tambon_name = 'น้ำเลา'
  AND NOT c.is_primary;

-- ตรวจผล: ถ้าค่าบนฐานไม่ตรงเงื่อนไข (UPDATE ได้ 0 แถวเงียบๆ) ให้ล้มทั้งก้อน
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.water_station_config
             WHERE station_code = 'RES040' AND tambon_name = 'บ้านเวียง') THEN
    RAISE EXCEPTION 'ยังมีแถว RES040 เป็นบ้านเวียง: ค่าในฐานไม่ตรงเงื่อนไขของไฟล์นี้';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.water_station_config c JOIN public.municipalities m ON m.id = c.municipality_id
                 WHERE m.slug = 'namlao' AND c.station_type = 'rain' AND c.station_code = 'RES040'
                   AND c.tambon_name = 'น้ำเลา' AND c.is_primary) THEN
    RAISE EXCEPTION 'แถว RES040 ของน้ำเลาไม่ได้เป็น ตำบลน้ำเลา + is_primary หลังแก้';
  END IF;
END;
$$;

COMMIT;
