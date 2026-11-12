-- รูปอาคารสำนักงานของ อปท. — ภาพข่าวคำร้อง (complaintNewsImage.js) วางไว้ใต้โลโก้ในแถบหัวแบบแบนเนอร์
-- แอดมินอัปโหลดเองที่ตั้งค่าระบบ แท็บแบรนด์และรูปภาพ · ไม่ตั้ง = แถบหัวพื้นน้ำเงินอย่างเดียว (พฤติกรรมเดิม)
-- ตั้งชื่อกลางๆ ไม่ผูกกับภาพข่าว เอกสาร/หน้าอื่นใช้ต่อได้
-- การแก้ไขใช้สิทธิ์ UPDATE ระดับตาราง + RLS เดิมของ municipalities (แบบเดียวกับ smart_city_image_url / tourism_background_url)
begin;

-- ALTER ต้องได้ ACCESS EXCLUSIVE lock — มี transaction ค้างบนตารางนี้ให้ล้มเร็ว ดีกว่ารอจนการอ่าน municipalities ของทุกเว็บต่อคิวค้าง
set local lock_timeout = '5s';

alter table public.municipalities
  add column if not exists office_photo_url text;

comment on column public.municipalities.office_photo_url is
  'Public image URL of the municipality office building (no people). Used under the logo in complaint news images.';

-- ตารางนี้ใช้ column-level SELECT grant — ADD COLUMN ไม่ได้สิทธิ์อัตโนมัติ (บทเรียน 42501 "ไม่พบหน่วยงาน")
-- URL รูปอาคารเป็นข้อมูลสาธารณะ ไม่มีข้อมูลส่วนบุคคล จึงให้ anon อ่านได้เหมือนรูปแบนเนอร์อื่น
grant select (office_photo_url) on public.municipalities to anon, authenticated;

-- ด่านตรวจ: สิทธิ์ไม่ตรงที่คาด (ฐานจริงถูกแก้ไม่ตรง repo) = ย้อนทั้งไฟล์
do $$
begin
  if not has_column_privilege('anon', 'public.municipalities', 'office_photo_url', 'SELECT')
     or not has_column_privilege('authenticated', 'public.municipalities', 'office_photo_url', 'SELECT')
     or not has_column_privilege('authenticated', 'public.municipalities', 'office_photo_url', 'UPDATE')
     or has_column_privilege('anon', 'public.municipalities', 'office_photo_url', 'UPDATE') then
    raise exception 'office_photo_url: สิทธิ์ไม่ตรงที่คาด (ต้องการ anon/authenticated SELECT, authenticated UPDATE, anon ไม่มี UPDATE)';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
