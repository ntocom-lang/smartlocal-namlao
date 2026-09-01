-- เบอร์สายด่วนเริ่มต้นสำหรับ อปท. ที่ยังไม่มีข้อมูลเลย
--
-- ทำไมมีแค่ 2 เบอร์: 191 (ตำรวจ) และ 1669 (เจ็บป่วยฉุกเฉิน) เป็นหมายเลขระดับประเทศ
-- ใช้เหมือนกันทุกพื้นที่ จึงตั้งเป็นค่าเริ่มต้นได้อย่างปลอดภัย
-- ส่วนไฟฟ้า/ประปา/ดับเพลิง ไม่ใส่ให้ เพราะหลายแห่งใช้เบอร์สำนักงานในพื้นที่
-- ถ้าใส่เบอร์ส่วนกลางไปจะทำให้ประชาชนโทรผิดหน่วยงาน
--
-- เงื่อนไข: เฉพาะ tenant ที่ยังไม่มี contact "แถวใดเลย"
-- ห้ามใช้เงื่อนไข "ยังไม่มีเบอร์ 191" เพราะ อปท. ที่ตั้งใจลบทิ้งจะโดนยัดกลับทุกครั้งที่รัน

insert into public.emergency_contacts
  (municipality_id, label, number, emoji, color, bg, display_order, is_active)
select m.id, d.label, d.number, d.emoji, d.color, d.bg, d.display_order, true
from public.municipalities m
cross join (values
  ('ตำรวจ',           '191',  '👮', '#1d4ed8', '#dbeafe', 1),
  ('เจ็บป่วยฉุกเฉิน', '1669', '🚑', '#dc2626', '#fee2e2', 2)
) as d(label, number, emoji, color, bg, display_order)
where not exists (
  select 1 from public.emergency_contacts e where e.municipality_id = m.id
);

-- tenant ที่สร้างใหม่ต้องได้ 2 เบอร์นี้อัตโนมัติ ไม่ต้องพึ่งคนกรอก
-- ระบบไม่มีขั้นตอน onboarding อัตโนมัติอื่น จึงผูกไว้กับ trigger ตรงนี้
create or replace function public.seed_default_emergency_contacts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.emergency_contacts
    (municipality_id, label, number, emoji, color, bg, display_order, is_active)
  values
    (new.id, 'ตำรวจ',           '191',  '👮', '#1d4ed8', '#dbeafe', 1, true),
    (new.id, 'เจ็บป่วยฉุกเฉิน', '1669', '🚑', '#dc2626', '#fee2e2', 2, true);
  return new;
end;
$$;

drop trigger if exists trg_seed_emergency_contacts on public.municipalities;
create trigger trg_seed_emergency_contacts
after insert on public.municipalities
for each row execute function public.seed_default_emergency_contacts();
