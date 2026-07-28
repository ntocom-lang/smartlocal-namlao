-- 145_building_permit_form_data.sql
-- เก็บข้อมูลแบบ ข.๑ (คำขออนุญาตก่อสร้าง/ดัดแปลง/รื้อถอน/เคลื่อนย้ายอาคาร) แบบเต็ม
-- เป็น JSONB เพราะมีฟิลด์ตามเงื่อนไข (เช่น กรณีเคลื่อนย้ายอาคารมีที่อยู่ปลายทางเพิ่ม)
-- และไม่มีการ query filter รายฟิลด์ย่อยฝั่ง SQL — ใช้อ่านคืนทั้งก้อนเพื่อ render แบบฟอร์มพิมพ์เท่านั้น

alter table public.document_requests
  add column if not exists permit_form_data jsonb;
