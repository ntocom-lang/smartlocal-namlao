-- สถานการณ์น้ำ-ฝน — ข้อความเตือนของ สสน. เฟส 1/3: ตารางเก็บข้อความเตือน
--
-- ที่มา: ThaiWater thaiwater30/public/warning (API ตัวเดียวกับฝน/ระดับน้ำ ไม่ต้องใช้ key)
-- ต้นทางส่งเป็นรายการ { datetime, message } โดย message หนึ่งรายการรวมหลายสถานี คั่นด้วยบรรทัดว่าง
-- ตรวจ 2569-09-19: 7 รายการ รวม 25 สถานี มี 3 แบบ — น้ำล้นตลิ่ง/เท่าตลิ่ง · ฝนตกหนัก ·
-- [เสี่ยงเกิดน้ำท่วมฉับพลัน] ฝนตกหนักมาก · ทุกสถานีเขียน "ต.… อ.… จ.…" แยกได้ครบ 25/25
--
-- 1 แถว = ข้อความของ 1 สถานีตามต้นฉบับ (ไม่ตีความ ไม่ย่อ) + ตำบล/อำเภอ/จังหวัดที่แยกออกมาไว้จับคู่
-- กับ municipalities.district / province — ข้อความที่แยกชื่ออำเภอไม่ได้ thaiwater-sync ไม่เก็บ (ไม่เดา)
-- เก็บทั้งประเทศ (ไม่กี่สิบแถวต่อชั่วโมง) — อปท. ที่เปิดใช้ทีหลังได้ประโยชน์ทันทีโดยไม่ต้องแก้ sync
--
-- message ตัดที่ 500 ตัวอักษร (ใน Edge Function) ให้ UNIQUE ใช้ดัชนี btree ได้ — ภาษาไทย 3 ไบต์/ตัว
-- 500 ตัว ≈ 1,500 ไบต์ ต่ำกว่าเพดานราว 2,700 ไบต์ ข้อความจริงยาว 150–220 ตัว
--
-- แยกไฟล์จากสิทธิ์/RPC (100300) ตามกติกาแยก DDL ตามเฟส

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_warnings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL DEFAULT 'thaiwater',
  -- เวลาของรายการตามต้นทาง ("2026-09-19 09:00" เวลาไทย แปลงเป็น timestamptz แล้ว)
  issued_at     timestamptz NOT NULL,
  message       text NOT NULL,
  station_name  text,
  tambon_name   text,
  amphoe_name   text,
  province_name text,
  -- ครั้งล่าสุดที่รอบดึงข้อมูลยังเห็นข้อความนี้ในต้นทาง
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, issued_at, message)
);

-- RPC หาเฉพาะของอำเภอ/จังหวัดตัวเองในช่วง 24 ชม.
CREATE INDEX IF NOT EXISTS water_warnings_area_idx
  ON public.water_warnings (province_name, amphoe_name, issued_at DESC);

COMMIT;
