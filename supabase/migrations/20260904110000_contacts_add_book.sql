-- แยก emergency_contacts ออกเป็น 2 สมุด: สายด่วนฉุกเฉิน กับ ทำเนียบเบอร์โทรสำคัญ
--
-- ที่มา: หน้าเดียวชื่อ "สายด่วนฉุกเฉิน 24 ชั่วโมง" พื้นแดง แต่ข้างในมีเบอร์สำนักงานอำเภอ
-- กับเบอร์ผู้ใหญ่บ้านที่รับสายเฉพาะเวลาราชการ ประชาชนโทรตีสองแล้วไม่มีคนรับ
-- เก็บตารางเดิมไว้ (ไม่แยกตารางใหม่) เพราะ RLS/GRANT/trigger seed ของตารางนี้ตั้งไว้ถูกแล้ว
-- ตารางใหม่ต้องเขียนใหม่ทั้งชุด และเคยพลาด GRANT จนหน้าเว็บล่มมาแล้ว
--
-- ค่า book ต้องตรงกับ CONTACT_BOOKS ใน src/lib/contactBooks.js
--
-- default 'urgent' โดยตั้งใจ: แถวเดิมทุกแถวยังอยู่หน้าเดิมทันทีหลัง migrate
-- ไม่มีเบอร์ไหนหายจากหน้าจอที่ประชาชนเคยเห็น การย้ายไปสมุดใหม่ทำในไฟล์ backfill ถัดไป
--
-- GRANT: ตารางนี้ให้สิทธิ์ระดับตาราง (ไม่ใช่ column-level เหมือน municipalities)
-- คอลัมน์ใหม่จึงได้สิทธิ์ SELECT ของ anon/authenticated อัตโนมัติ ไม่ต้อง GRANT เพิ่ม
--
-- trigger seed_default_emergency_contacts ไม่ต้องแก้: 191/1669 ไม่ได้ระบุ book
-- จึงตกที่ default 'urgent' ซึ่งถูกต้องอยู่แล้ว

alter table public.emergency_contacts
  add column if not exists book text not null default 'urgent';

alter table public.emergency_contacts
  add column if not exists note text;

alter table public.emergency_contacts
  add column if not exists consent_at timestamptz;

alter table public.emergency_contacts
  drop constraint if exists emergency_contacts_book_check;

alter table public.emergency_contacts
  add constraint emergency_contacts_book_check
  check (book in ('urgent', 'directory'));

-- หน้าประชาชนทั้งสองหน้า query ด้วย (municipality_id, book) แล้วเรียง display_order
create index if not exists emergency_contacts_book_idx
  on public.emergency_contacts (municipality_id, book, display_order);

comment on column public.emergency_contacts.book is
  'สมุดที่รายการนี้สังกัด: urgent = สายด่วนฉุกเฉิน, directory = ทำเนียบเบอร์โทรสำคัญ (ดู src/lib/contactBooks.js)';

comment on column public.emergency_contacts.note is
  'บรรทัดรองใต้ชื่อ เช่น "ผู้ใหญ่บ้าน หมู่ 3" หรือ "จ-ศ 08.30-16.30" — ไม่บังคับ';

comment on column public.emergency_contacts.consent_at is
  'PDPA: เวลาที่แอดมินยืนยันว่าเจ้าของเบอร์ยินยอมให้เผยแพร่สาธารณะ null = ยังไม่ได้ยืนยัน (ไม่ได้บล็อกการแสดงผล เป็นร่องรอยตรวจสอบ)';
