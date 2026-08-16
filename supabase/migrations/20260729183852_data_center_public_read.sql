-- เปิดให้ประชาชน/guest (anon) และผู้ใช้ทั่วไป อ่านเฉพาะรายการที่ active ได้ — ไม่มี PII ในตารางนี้
-- (ชื่อสถานที่/หมวดหมู่/พิกัดสาธารณะ เช่น โรงพยาบาล ร้านอาหาร จุดทิ้งขยะ ฯลฯ) ปลอดภัยที่จะเปิดสาธารณะ
-- policy staff-tier เดิมยังอยู่ครบ (composed แบบ OR กัน ไม่ชนกัน) staff ยังเห็น archived ได้ตามเดิม
drop policy if exists "dce public read active" on public.data_center_entries;
create policy "dce public read active"
on public.data_center_entries for select
to anon, authenticated
using (status = 'active');
;
