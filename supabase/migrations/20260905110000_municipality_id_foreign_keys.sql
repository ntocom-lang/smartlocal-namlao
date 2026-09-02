-- 20260905110000_municipality_id_foreign_keys.sql
--
-- ใส่ FK บน municipality_id ให้ 8 ตารางที่ยังไม่มี ตรวจพบ 2026-09-03 ว่าทั้งหมดนี้
-- ประกาศคอลัมน์ municipality_id ไว้เฉยๆ ไม่ผูกกับ municipalities เลย ผลคือ อปท.
-- 2 รายที่ถูกลบทิ้งไว้ orphan 63 แถว (ล้าง config ไปแล้วในไฟล์ 20260905100000)
--
-- **ON DELETE RESTRICT ทุกตาราง** ไม่ใช้ CASCADE เพราะ:
--   - CASCADE จะทำให้การลบ อปท. ทำลายคำร้อง/ล็อกตรวจสอบเงียบๆ ซึ่งเป็นความล้มเหลว
--     คนละแบบแต่แย่พอกันสำหรับระบบราชการที่ สตง. อาจขอดูย้อนหลัง
--   - ปัญหาต้นเรื่องคือ "ลบ อปท. ได้โดยไม่ต้องคิด" RESTRICT บังคับให้ต้องล้างข้อมูลลูก
--     อย่างตั้งใจก่อน ซึ่งเป็นพฤติกรรมที่ต้องการพอดี
--
-- **ห้ามใช้ ON DELETE SET NULL กับ profiles เด็ดขาด** — ในระบบนี้
-- profiles.municipality_id = NULL คือสัญญาณ superadmin (ข้ามการลดสิทธิ์รายเทแนนต์)
-- SET NULL จึงเท่ากับยกระดับสิทธิ์อัตโนมัติทุกครั้งที่ลบ อปท.
--
-- NOT VALID เฉพาะ 3 ตารางที่ยังมี orphan ค้างโดยตั้งใจ (complaints 5, profiles 1,
-- complaint_categories 2 tombstone) — NOT VALID ข้ามการตรวจแถวเดิมเท่านั้น
-- แถวใหม่/แถวที่ถูก UPDATE ยังถูกบังคับ และ RESTRICT ฝั่งพ่อยังทำงานเต็มที่

begin;

-- ── ตารางที่ล้าง orphan หมดแล้ว: ตรวจได้เต็มตาราง ────────────────────────────────
alter table public.category_assignments
  add constraint category_assignments_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict;

alter table public.locations
  add constraint locations_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict;

alter table public.emergency_contacts
  add constraint emergency_contacts_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict;

alter table public.staff
  add constraint staff_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict;

alter table public.fleet_audit_log
  add constraint fleet_audit_log_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict;

-- ── ตารางที่ยังมี orphan ค้างโดยตั้งใจ: NOT VALID ────────────────────────────────
alter table public.complaints
  add constraint complaints_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict
  not valid;

alter table public.profiles
  add constraint profiles_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict
  not valid;

alter table public.complaint_categories
  add constraint complaint_categories_municipality_id_fkey
  foreign key (municipality_id) references public.municipalities(id) on delete restrict
  not valid;

commit;
