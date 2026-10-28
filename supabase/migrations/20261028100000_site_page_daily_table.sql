-- สถิติรายหน้าของเว็บไซต์ เฟส 1/2: ตารางเก็บยอดรายหน้า (CREATE TABLE เปล่า — แยกไฟล์ตามเฟส NOTES.md ข้อ 3)
--
-- ต่อยอดตัวนับการเข้าชมเดิม (site_open_daily, 20260930100000) ตามที่เจ้าของระบบขอ 2569-10-28:
-- "อยากรู้ว่าหน้าไหนที่คนสนใจ และเข้ามาใช้บริการมากที่สุด จะได้เป็นข้อมูลในการพัฒนาต่อไป"
--
-- page_key = ชื่อกลุ่มของหน้า ไม่ใช่ URL จริง (เช่น 'complaint', 'water-situation', 'track')
--   ฝั่งเว็บแปลง pathname เป็นชื่อกลุ่มก่อนส่ง (src/lib/siteOpenStats.js pageKeyForPath) ตัวแปรใน URL
--   อย่างโทเคนติดตามเรื่อง (/t/<โทเคน>) หรือรหัสตรวจสอบ (/v/<รหัส>) ไม่มีทางเข้ามาถึงตารางนี้
--   CHECK ข้างล่างกันรูปแบบแปลกๆ แม้มีคนเรียกฟังก์ชันตรงด้วย anon key
-- opens    = ครั้งที่หน้านี้ถูกเปิด (นับตั้งแต่วินาทีที่ apply เป็นต้นไป ผลรวมทุกหน้าของวัน = ยอดรวมของวันนั้นใน
--            site_open_daily เสมอ ยกเว้นวัน apply ที่การเข้าชมก่อน apply ไม่มีแถวรายหน้า — ไม่มีการเติมย้อนหลัง)
-- visitors = ครั้งแรกของวันที่เครื่องหนึ่งเปิดหน้านี้ (เครื่องเดียวกลับมาคนละวันนับทุกวัน)
--
-- ขนาด: ชื่อหน้าราว 40 ชื่อ × 365 วัน × 4 อปท. ≲ 60,000 แถว/ปี (ตัวจริงน้อยกว่านี้เพราะหน้าที่ไม่มีใครเปิดไม่มีแถว)
-- ฟังก์ชันฝั่งเซิร์ฟเวอร์จำกัดชื่อหน้าไม่เกิน 60 ชื่อต่อ อปท. ต่อวัน — ตารางโตเกินนี้ไม่ได้แม้โดนยิงมั่ว

BEGIN;

CREATE TABLE IF NOT EXISTS public.site_page_daily (
  municipality_id uuid    NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  visit_date      date    NOT NULL,
  page_key        text    NOT NULL CHECK (page_key ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  opens           integer NOT NULL DEFAULT 0 CHECK (opens >= 0),
  visitors        integer NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  PRIMARY KEY (municipality_id, visit_date, page_key)
);

COMMIT;
