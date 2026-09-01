-- EventsManager.jsx เดิม hardcode รายการสถานที่ 3 ค่า โดยผันตาม org_type อย่างเดียว รวมถึงค่า
-- "โดมหลัง{อบต./เทศบาล}" ซึ่ง assume ว่าผังอาคารของทุก อปท. เหมือนกัน — จริงๆ บางแห่งโดมอยู่ด้านข้าง
-- อยู่ด้านหน้า หรือไม่มีโดมเลย (มีศาลาประชาคม/อาคารเอนกประสงค์แทน) จึงให้แต่ละ อปท. ตั้งรายการเอง
--
-- event_location_presets: array ของ string เช่น ["ห้องประชุมสภา","โดมหน้าสำนักงาน"]
--   ค่าว่าง [] = ให้ฝั่งแอปใช้ค่าเริ่มต้นกลางๆ ที่คำนวณจาก org_type (ไม่ seed ลง DB เพื่อไม่ต้อง
--   backfill ทุก tenant และ tenant ใหม่ที่สมัครทีหลังก็ได้ค่าเริ่มต้นเดียวกันอัตโนมัติ)
--   ปุ่ม "อื่นๆ (ระบุ)" ในฟอร์มยังพิมพ์สถานที่นอกรายการได้เหมือนเดิม ไม่ถูกจำกัดด้วยคอลัมน์นี้
alter table municipalities
  add column if not exists event_location_presets jsonb not null default '[]'::jsonb;

-- กัน UI/ผู้เรียก API เขียน object หรือ string เดี่ยวลงมาแล้วฝั่งแอป .map() พังตอน render ฟอร์ม
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.municipalities'::regclass
      and conname = 'municipalities_event_location_presets_is_array'
  ) then
    alter table municipalities
      add constraint municipalities_event_location_presets_is_array
      check (jsonb_typeof(event_location_presets) = 'array');
  end if;
end $$;

-- municipalities ใช้ column-level SELECT grant (ไม่ใช่ grant ทั้งตาราง) เพื่อกัน anon อ่านคอลัมน์
-- ความลับอย่าง calendar_token / google_cloud_email / google_project_id — ผลข้างเคียงคือคอลัมน์ที่
-- ADD ทีหลัง "ไม่" ได้สิทธิ์อัตโนมัติ ถ้าลืม GRANT ตรงนี้ TenantContext ที่ select เป็น explicit list
-- จะได้ 42501 ทั้ง query แล้วหน้าเว็บขึ้น "ไม่พบหน่วยงานรหัส ... ในระบบ" ทุก tenant
-- (ชื่อสถานที่ประชุมไม่ใช่ข้อมูลลับ + ประชาชนเห็นในหน้าปฏิทินอยู่แล้ว จึงให้ anon อ่านได้)
grant select (event_location_presets) on public.municipalities to anon, authenticated;
