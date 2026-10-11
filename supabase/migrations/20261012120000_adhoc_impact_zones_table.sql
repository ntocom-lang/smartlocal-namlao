-- วงรัศมีเรื่องเฉพาะกิจ (เช่น กลิ่นเหม็นจากฟาร์ม) — เฟส 1: จุดต้นทางที่เจ้าหน้าที่กำหนด + รัศมีหลายวง
--
-- ผู้รับผิดชอบ/แอดมินปักจุด "ฟาร์ม" (หรือเลือกจากสถานที่ในศูนย์ข้อมูลที่มีอยู่แล้ว) แล้วกำหนดรัศมีรอบจุดนั้น
-- เช่น 1 กม. + 2 กม. หรือกี่วงก็ได้ เปิด/ปิดแสดงบนแผนที่ได้ ระบบนับให้เองว่ามีคำร้องอยู่ในแต่ละวงกี่เรื่อง
-- (ตัวนับอยู่ใน 20261012120100) — ฝั่งเจ้าหน้าที่เท่านั้น ประชาชนไม่เห็น
--
-- แยกไฟล์ตามเฟส: ไฟล์นี้มีแค่ CREATE TABLE — index / RLS / สิทธิ์ / ฟังก์ชัน / trigger ไปอยู่ไฟล์ถัดไป
-- เพราะ CREATE TABLE แล้วอ้างตารางนั้นในไฟล์เดียวกันเคยพังด้วย 42P01 (ดู docs/ai/NOTES.md)
--
-- ⚠️ PDPA/ความเป็นธรรม: ตารางนี้เก็บ "จุดที่เจ้าหน้าที่ตั้งสมมติฐานว่าอาจเป็นต้นเหตุ" ไม่ใช่ผลตรวจวัดหรือข้อสรุป
--   ห้ามใช้ชื่อกล่าวหา และห้ามเปิดให้ role ที่กว้างกว่าที่เห็นหมุดเฉพาะกิจอยู่แล้ว (ดู can_view_adhoc_overlay)
CREATE TABLE IF NOT EXISTS public.adhoc_impact_zones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- complaint_categories.value ของหมวดเฉพาะกิจ (เช่น 'odor') — ไม่ผูก FK เพราะแอดมินลบ/ปิดหมวดได้
  -- การห้ามใช้หมวดที่ไม่ใช่เฉพาะกิจทำที่ policy INSERT/UPDATE (complaint_category_is_adhoc)
  category        text        NOT NULL,
  label           text        NOT NULL,
  -- ถ้าเลือกจากสถานที่ในศูนย์ข้อมูล เก็บ id ไว้อ้างอิง แต่ "คัดลอกพิกัดมาเก็บเอง" (latitude/longitude ด้านล่าง)
  -- สถานที่นั้นถูกย้าย/ลบทีหลังก็ไม่ทำให้วงรัศมีของเรื่องที่กำลังตรวจสอบขยับตามไปเงียบๆ
  source_entry_id uuid        REFERENCES public.data_center_entries(id) ON DELETE SET NULL,
  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  -- รัศมีเป็นเมตร เรียง/ตัดซ้ำโดย trigger ก่อนบันทึก
  radii_m         integer[]   NOT NULL DEFAULT ARRAY[1000, 2000],
  -- false = ปิดเรื่องแล้ว: ซ่อนจากแผนที่ของทุกคน (ต่างจากสวิตช์เปิด/ปิดส่วนตัวบนหน้าจอ ที่ไม่กระทบคนอื่น)
  is_active       boolean     NOT NULL DEFAULT true,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adhoc_impact_zones_label_len CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT adhoc_impact_zones_category_len CHECK (char_length(category) BETWEEN 1 AND 60),
  -- กรอบประเทศไทยแบบหยาบ เหมือน TH_BOUNDS ใน src/lib/odorAnalytics.js — กันพิกัดขยะ (0,0) ที่ทำให้แผนที่ซูมออกไปครึ่งโลก
  CONSTRAINT adhoc_impact_zones_lat CHECK (latitude BETWEEN 5 AND 21),
  CONSTRAINT adhoc_impact_zones_lng CHECK (longitude BETWEEN 96 AND 106),
  -- 1–6 วง ตั้งแต่ 50 ม. ถึง 20 กม. (เพดานเป็นสมมติฐานที่เจ้าของระบบยังไม่ได้ท้วง ปรับได้ที่ migration ถัดไป)
  CONSTRAINT adhoc_impact_zones_radii CHECK (
    cardinality(radii_m) BETWEEN 1 AND 6
    AND 50 <= ALL (radii_m)
    AND 20000 >= ALL (radii_m)
  )
);

COMMENT ON TABLE public.adhoc_impact_zones IS
  'วงรัศมีรอบจุดต้นทางของเรื่องเฉพาะกิจ (เช่น ฟาร์มที่ถูกร้องเรียนเรื่องกลิ่น) ที่เจ้าหน้าที่กำหนดเอง — เป็นสมมติฐานการตรวจสอบ ไม่ใช่ผลตรวจวัด ฝั่งเจ้าหน้าที่เท่านั้น';
