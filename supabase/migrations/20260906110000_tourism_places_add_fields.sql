-- 20260906110000_tourism_places_add_fields.sql
--
-- เฟส 2 ของการรื้อโมดูล "เที่ยว กิน พัก ชอป บริการ" — เติมคอลัมน์ที่ขาดจนทำให้หน้าเว็บ
-- ตอบคำถามพื้นฐานที่สุดของคนหาร้านไม่ได้เลย
--
-- ไฟล์นี้ "เพิ่มคอลัมน์อย่างเดียว" ไม่มีการอ้างถึงคอลัมน์ใหม่ใน statement อื่น
-- (constraint/index/backfill อยู่ใน 20260906120000) เพราะ ADD COLUMN แล้วอ้างถึงในไฟล์
-- เดียวกันเคยเจอ 42703 มาแล้วในโปรเจกต์นี้
--
-- เหตุผลรายคอลัมน์:
--   latitude/longitude  ตอนอนุมัติคำขอ BusinessRegistrationAdmin.jsx แปลงพิกัดที่ประชาชน
--                       กรอกมาเป็นสตริง maps_url แล้วทิ้งตัวเลขไป ทำให้ทำแผนที่รวม /
--                       เรียง "ใกล้ฉัน" ไม่ได้ ทั้งที่มีข้อมูลอยู่แล้ว
--   opening_hours       เก็บเป็น jsonb ไม่ใช่ text เพราะต้องคำนวณป้าย "เปิดอยู่/ปิดแล้ว"
--                       ได้จริง ถ้าเก็บเป็นข้อความอิสระจะทำได้แค่โชว์เฉยๆ
--                       รูปแบบ: {"mon":["08:30","16:30"], "tue":null, ...}
--                       null = ปิดทั้งวัน / ไม่มีคีย์วันไหน = ไม่ได้ระบุ
--   hours_note          ข้อความอิสระที่ jsonb ไม่รองรับ เช่น "ปิดวันพระ", "โทรนัดล่วงหน้า"
--                       และใช้รับค่าเดิมจาก business_registrations.operating_hours ที่เป็น text
--   facebook_url        ร้านค้าท้องถิ่นส่วนใหญ่ไม่มีเว็บไซต์ แต่มีเพจ — ฟอร์มลงทะเบียนเก็บอยู่แล้ว
--   line_id             ช่องทางสั่งของจริงของร้านในต่างจังหวัด — ฟอร์มเก็บอยู่แล้วแต่ไม่เคยแสดง
--   is_featured         ปักหมุด "แนะนำ" แยกจาก display_order ที่ตอนนี้ถูกใช้ปนกัน
--                       (ของที่อนุมัติอัตโนมัติยัด display_order = 999 ไปกองท้ายหมด)
--   village_no          กรอง "ในหมู่ที่ฉันอยู่" — เป็นหน่วยพื้นที่ที่ประชาชน อบต. ใช้สื่อสารจริง
--   price_range         1-4 (฿ ถึง ฿฿฿฿) สำหรับหมวดกิน/พัก
--   updated_at          ไว้บอก "อัปเดตล่าสุดเมื่อ" — ข้อมูลร้านค้าเก่าเกิน 1 ปีต้องเตือน
--                       เจ้าหน้าที่ให้ทบทวน ไม่งั้นเบอร์โทรผิดจะอยู่บนเว็บราชการไปเรื่อยๆ

begin;

alter table public.tourism_places
  add column if not exists latitude      double precision,
  add column if not exists longitude     double precision,
  add column if not exists opening_hours jsonb,
  add column if not exists hours_note    text,
  add column if not exists facebook_url  text,
  add column if not exists line_id       text,
  add column if not exists is_featured   boolean not null default false,
  add column if not exists village_no    text,
  add column if not exists price_range   smallint,
  add column if not exists updated_at    timestamptz not null default now();

commit;
