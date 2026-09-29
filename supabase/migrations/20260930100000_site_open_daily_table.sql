-- สถิติการเข้าชมเว็บไซต์ เฟส 1/2: ตาราง
--
-- อปท. ขอ "สถิติจำนวนผู้เข้าชม" — ตัวนับท้ายเว็บ + หน้า /reports/visitors
-- 1 แถว = ยอดของ อปท. หนึ่งในวันหนึ่ง (วันตามเวลาไทย) เก็บแต่ตัวเลขรวม ไม่มีตัวระบุบุคคลใดๆ
--   opens    = การเข้าชม (ครั้ง) ตัวเลขหลักที่แสดงบนเว็บ: ทุกครั้งที่หน้าแสดงผล
--              ทั้งเปิดเว็บ รีเฟรช และเปลี่ยนหน้า
--   visitors = เครื่องไม่ซ้ำต่อวัน ตัวรอง ไม่แสดงบนเว็บ — เก็บไว้ตอบถ้ามีคนถามว่า "กี่คนจริง"
--              เพราะ opens นับซ้ำคนเดิมได้หลายครั้ง ห้ามเอาไปพูดว่าเป็นจำนวนคน
--
-- แยกไฟล์จากสิทธิ์/ฟังก์ชัน (20260930100100) ตามกติกาแยก DDL ตามเฟส (docs/ai/NOTES.md ข้อ 3)

BEGIN;

CREATE TABLE IF NOT EXISTS public.site_open_daily (
  municipality_id uuid    NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- วันตามเวลาไทย (Asia/Bangkok) ฝั่ง server เป็นคนตัดวัน ไม่เชื่อนาฬิกาเครื่องผู้ใช้
  visit_date      date    NOT NULL,
  opens           integer NOT NULL DEFAULT 0 CHECK (opens >= 0),
  visitors        integer NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  PRIMARY KEY (municipality_id, visit_date)
);

COMMIT;
