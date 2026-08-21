-- ภาพพื้นหลังส่วนเที่ยว กิน พัก OTOP ของแต่ละเทศบาล
-- URL เป็นข้อมูลสาธารณะที่หน้าแรกต้องอ่านได้ ส่วนการแก้ไขยังถูกควบคุมด้วย RLS เดิมของ municipalities
alter table public.municipalities
  add column if not exists tourism_background_url text;

comment on column public.municipalities.tourism_background_url is
  'Public image URL used as the large background of the tourism section on the citizen home page.';

grant select (tourism_background_url) on public.municipalities to anon, authenticated;
