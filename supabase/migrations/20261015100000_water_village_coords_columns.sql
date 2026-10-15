-- สถานการณ์น้ำ-ฝนรายหมู่ (เฟส 1) ไฟล์ 1/3 — เพิ่มพิกัดกลางหมู่ลงทะเบียนหมู่เดิม
-- (ตารางผูกหมู่↔สถานีอยู่ 20261015100100 · สิทธิ์/ข้อจำกัด/RPC อยู่ 20261015100200)
--
-- ทะเบียนหมู่ของระบบมีตารางเดียวคือ waste_villages (เลขหมู่ + ชื่อ จากโมดูลตารางเก็บขยะ)
-- เอกสารออกแบบสั่งไม่สร้างทะเบียนซ้ำ จึงเพิ่มพิกัดลงตารางนี้ ไม่ใช่ตารางใหม่
-- พิกัด = "จุดกลางหมู่" ที่เจ้าหน้าที่ปักครั้งเดียว ใช้บอกว่าสถานีวัดอยู่ห่างจากหมู่กี่ กม. และเรียงสถานีที่ใกล้
-- ไม่บังคับกรอก — หมู่ที่ไม่มีพิกัดยังผูกสถานีได้ (ระบบถอยไปใช้ระยะจากสำนักงานที่เก็บไว้ใน water_station_config)
--
-- ⚠️ ไม่ต้อง GRANT เพิ่ม: waste_villages ให้สิทธิ์ authenticated ระดับตาราง (20260914100100) ไม่ใช่รายคอลัมน์
--    ต่างจาก municipalities (NOTES §4) · upsert เดิมของหน้าตารางเก็บขยะส่งแค่ municipality_id/moo_no/name
--    ON CONFLICT DO UPDATE จึงไม่แตะสองคอลัมน์นี้ ค่าที่ปักไว้ไม่ถูกทับ
-- ข้อจำกัดของคอลัมน์ (CHECK) อยู่ไฟล์ 3 ตามกติกา 1 ไฟล์ = 1 เฟส (NOTES §3)
--
-- ไฟล์นี้เพิ่มคอลัมน์ว่างล้วน apply ก่อน deploy ได้ปลอดภัย แถวเดิมไม่เปลี่ยน

DO $$
BEGIN
  IF to_regclass('public.waste_villages') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260914100000_waste_schedule_tables.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

ALTER TABLE public.waste_villages
  ADD COLUMN IF NOT EXISTS latitude  numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

COMMIT;
