-- เปิด-ปิดเมนูเจ้าหน้าที่รายหน่วยงานได้ครบทุกเมนู (หน้าจัดการโมดูล ใช้นำเสนอ อปท.) — เติมคีย์ 4 ตัวให้ทุก อปท.
--
-- เมนู 4 ตัวนี้เดิมไม่มีคีย์ใน enabled_modules จึงเปิดให้ทุก อปท. เสมอ ปิดไม่ได้:
--   'local-plan'        แผนพัฒนาท้องถิ่น
--   'water-events'      เหตุการณ์น้ำ-ฝน (ยังต้องเปิด 'water-situation' ด้วยเหมือนเดิม)
--   'performance'       ผลการปฏิบัติงาน (ยังต้องเปิด 'complaints' ด้วยเหมือนเดิม)
--   'borrowable-assets' พัสดุ/ครุภัณฑ์
-- โค้ดที่เพิ่มคีย์เหล่านี้เข้า MANAGED_MODULE_KEYS (src/lib/staffModules.js) ถือว่า "แถวที่ไม่มีคีย์ = ปิด"
--
-- ⚠️ ต้องรัน "ก่อน" deploy เว็บและ Edge Function local-plan-monthly-reminder
--    ไม่งั้นเมนูทั้ง 4 หายจากทุก อปท. และแจ้งเตือนแผนพัฒนาวันที่ 1 ข้ามทุก อปท.
-- รันก่อนโค้ดได้ปลอดภัย: โค้ดเก่าไม่รู้จักคีย์เหล่านี้ ค่าที่เกินมาไม่มีผลกับอะไร
-- รันซ้ำได้: เติมเฉพาะคีย์ที่ยังขาด ไม่ซ้ำ ไม่ลบคีย์อื่น · แถว enabled_modules IS NULL (= เปิดทุกโมดูล) ไม่แตะ
-- ไม่แตะ GRANT/RLS/ฟังก์ชัน: แก้ค่าในคอลัมน์ที่มีอยู่แล้วอย่างเดียว
--
-- ::text[] — ไม่มี migration ไหนสร้างคอลัมน์นี้ (drift) ถ้าจริงเป็น varchar[] ตัว @> จะ error ถ้าไม่ cast
-- array_position แทน "NOT (k = ANY ...)" — ถ้าอาร์เรย์มีสมาชิก NULL ปน, = ANY ได้ NULL แล้วคีย์ถูกกรองทิ้งเงียบๆ
-- (ผลตรวจ migration-reviewer 2569-11-09) · ตรวจผลท้ายบล็อก ไม่ครบ = RAISE ยกเลิกทั้งไฟล์

DO $$
DECLARE
  v_keys CONSTANT text[] := ARRAY['local-plan', 'water-events', 'performance', 'borrowable-assets'];
  v_rows integer;
  v_left integer;
BEGIN
  UPDATE public.municipalities AS m
     SET enabled_modules = m.enabled_modules || ARRAY(
           SELECT t.k
             FROM unnest(v_keys) WITH ORDINALITY AS t(k, ord)
            WHERE array_position(m.enabled_modules::text[], t.k) IS NULL
            ORDER BY t.ord
         )
   WHERE m.enabled_modules IS NOT NULL
     AND NOT (m.enabled_modules::text[] @> v_keys);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT count(*) INTO v_left
    FROM public.municipalities
   WHERE enabled_modules IS NOT NULL
     AND NOT (enabled_modules::text[] @> v_keys);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ยังมี % แถวที่ไม่มีคีย์ครบ 4 ตัว — ยกเลิกทั้งไฟล์', v_left;
  END IF;

  RAISE NOTICE 'เติมคีย์เมนูให้ % หน่วยงาน', v_rows;
END $$;
