-- ค้นหาบริการ + คำถามที่พบบ่อย + คลังแบบฟอร์ม — เฟส 3/3: เติมคีย์โมดูล 'service-help' ให้ทุก อปท.
--
-- เปิดเป็นค่าเริ่มต้นทุกแห่ง (หลักหลังบ้านทุก อปท. เหมือนกัน) — ไม่มีข้อมูลก็ไม่เสียหาย:
-- หน้าค้นหายังค้นประเภทคำขอ/หมวดคำร้องที่มีอยู่แล้ว ส่วนแท็บแบบฟอร์มในหน้าค้นหาซ่อนเองจนกว่าจะมีไฟล์
-- อปท. ที่ไม่ต้องการปิดได้เองที่หน้าจัดการโมดูล
--
-- ⚠️ ต้องรัน "ก่อน" deploy เว็บ ไม่งั้นเมนูหายจากทุก อปท. (โค้ดถือว่าแถวที่ไม่มีคีย์ = ปิด)
-- รันก่อนโค้ดได้ปลอดภัย (โค้ดเก่าไม่รู้จักคีย์นี้) · รันซ้ำได้ · แถว enabled_modules IS NULL ไม่แตะ
-- รูปแบบเดียวกับ 20261113100000 (ผ่าน migration-reviewer แล้ว): ::text[] + array_position กัน NULL ปน

DO $$
DECLARE
  v_keys CONSTANT text[] := ARRAY['service-help'];
  v_rows integer;
  v_left integer;
BEGIN
  -- guard (ผลตรวจ L3): ถ้าเติมคีย์แล้ว deploy ทั้งที่ยังไม่มีตาราง/สิทธิ์ เมนูจะขึ้นแต่ query ได้ 42P01 ทุก อปท.
  IF to_regclass('public.service_forms') IS NULL OR to_regclass('public.service_faqs') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261203100000 และ 20261203100100 ก่อน';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_forms'
                   AND policyname = 'public read published service_forms') THEN
    RAISE EXCEPTION 'ยังไม่มี policy ของ service_forms — ต้องรัน 20261203100100 ก่อน';
  END IF;

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
    RAISE EXCEPTION 'ยังมี % แถวที่ไม่มีคีย์ service-help — ยกเลิกทั้งไฟล์', v_left;
  END IF;

  RAISE NOTICE 'เติมคีย์ service-help ให้ % หน่วยงาน', v_rows;
END $$;
