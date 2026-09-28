-- สมุดลงเวลาของงานอัตโนมัติ เฟส 1/2: ตาราง
--
-- ปัญหาที่แก้: thaiwater-watchdog ตรวจแค่ว่า "ข้อมูลน้ำยังสด" (water_readings.fetched_at) ถ้า
-- water-alert-notify พังเอง (error · ข้อมูลเกินเพดาน · secret ไม่ตรง · cron หาย) ข้อมูลยังสดตามปกติ
-- ตัวเฝ้าระวังจึงรายงานว่าปกติทั้งที่แจ้งเตือนน้ำ-ฝนหยุดส่งไปแล้ว — ไม่มีใครรู้เลย
--
-- 1 แถว = 1 งาน: งานเขียนเวลาที่ทำสำเร็จครั้งล่าสุด (+ error ครั้งล่าสุด) ทุกรอบ
-- thaiwater-watchdog อ่านแถวนี้ ถ้าไม่สำเร็จนานเกินเกณฑ์ = งานหยุดทำงาน → แจ้งกลุ่มผู้ดูแลระบบ
-- ตั้งชื่อกลางไว้ให้งานอัตโนมัติตัวอื่นใช้ร่วมได้ภายหลัง
--
-- แยกไฟล์จากสิทธิ์ (140100) ตามกติกาแยก DDL ตามเฟส

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_heartbeats (
  -- ชื่อ Edge Function ของงาน เช่น 'water-alert-notify'
  job_name      text PRIMARY KEY CHECK (job_name ~ '^[a-z0-9-]{1,64}$'),
  -- ครั้งล่าสุดที่ทำงานจบครบรอบ (ไม่นับโหมดทดสอบ)
  last_ok_at    timestamptz,
  -- error ครั้งล่าสุด — ไม่ล้างเมื่อกลับมาสำเร็จ ดูคู่กับ last_ok_at ว่าอันไหนใหม่กว่า
  last_error_at timestamptz,
  last_error    text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMIT;
