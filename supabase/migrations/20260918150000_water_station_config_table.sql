-- สถานการณ์น้ำ-ฝน เฟส 1/6 — ตารางสถานีตรวจวัดที่แต่ละ อปท. ติดตาม
-- (ค่าที่วัดได้อยู่ 20260918150100 · สิทธิ์/RPC 20260918150200 · สถานีเริ่มต้น 20260918150300
--  · คีย์โมดูล 20260918150400 · ตั้งเวลาดึงข้อมูล 20260918150500)
--
-- ที่มาของข้อมูล: คลังข้อมูลน้ำแห่งชาติ (ThaiWater) ของ สสน. — Edge Function thaiwater-sync
-- ดึงค่ามาเก็บทุกชั่วโมง หน้าเว็บอ่านจากฐานข้อมูลเราเท่านั้น ไม่ยิงไปต้นทางเอง
-- (ต้นทางส่งข้อมูลทั้งประเทศก้อนละ 2–5 MB มือถือประชาชนไม่ควรต้องโหลดทุกครั้งที่เปิดหน้า)
--
-- หลักการ "ตั้งค่าครั้งเดียว ที่เหลือระบบทำเอง": ผูกสถานีกับ municipality_id ไม่ใช่กับโค้ด
-- อปท. ใหม่แค่เพิ่มแถวที่นี่ แล้วเปิดโมดูล water-situation — ไม่ต้องแก้ Edge Function หรือหน้าเว็บ
--
-- station_code = tele_station_oldcode ของต้นทาง เป็นคีย์เดียวที่ใช้จับคู่
-- ⚠️ ห้ามจับคู่ด้วยชื่อสถานี: มีสถานี "บ้านน้ำเลา" อีกแห่งอยู่ อ.นครไทย จ.พิษณุโลก
--
-- distance_km วัดจากพิกัดสำนักงาน (municipalities.latitude/longitude) ด้วย haversine
-- ไม่ใช่จากสถานีในตำบล — ค่าเก็บตายตัวตอนตั้งค่า ถ้าย้ายพิกัดสำนักงานต้องคำนวณใหม่เอง
--
-- ไฟล์นี้สร้างของใหม่ล้วน apply ก่อน deploy ได้ปลอดภัย

BEGIN;

CREATE TABLE IF NOT EXISTS public.water_station_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  station_type    text NOT NULL CHECK (station_type IN ('rain', 'waterlevel')),
  station_code    text NOT NULL CHECK (char_length(btrim(station_code)) BETWEEN 1 AND 40),
  station_name    text NOT NULL CHECK (char_length(btrim(station_name)) BETWEEN 1 AND 120),
  -- ที่ตั้งตามต้นทาง — หน้าเว็บใช้บอกประชาชนตรงๆ ว่าสถานีอยู่ตำบล/อำเภอไหน
  -- (สถานีระดับน้ำที่ใกล้ที่สุดอาจอยู่นอกอำเภอ ต้องไม่ทำให้เข้าใจว่าวัดในหมู่บ้าน)
  tambon_name     text,
  amphoe_name     text,
  province_name   text,
  -- เฉพาะสถานีระดับน้ำ: ชื่อลำน้ำตามต้นทาง เช่น "แม่น้ำยม" / "น้ำแม่คำมี"
  river_name      text,
  -- ชื่อย่อหน่วยงานเจ้าของสถานีตามต้นทาง (ทน. / ชป. / สสน. / พพภ)
  agency_name     text,
  latitude        numeric,
  longitude       numeric,
  distance_km     numeric CHECK (distance_km IS NULL OR distance_km >= 0),
  -- true = สถานีอยู่ในตำบลเดียวกับสำนักงาน
  is_primary      boolean NOT NULL DEFAULT false,
  -- หมายเหตุเฉพาะกรณี เช่น สถานีปิดปรับปรุง — แสดงใต้ชื่อสถานีบนหน้าเว็บ
  note            text CHECK (note IS NULL OR char_length(note) <= 300),
  display_order   smallint NOT NULL DEFAULT 99,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipality_id, station_type, station_code)
);

CREATE INDEX IF NOT EXISTS water_station_config_active_idx
  ON public.water_station_config (municipality_id, is_active);

COMMIT;
