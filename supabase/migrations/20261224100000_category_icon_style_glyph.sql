-- เพิ่มรูปแบบไอคอนหมวดคำร้องแบบที่ 4: 'glyph' = ไอคอนทึบสีเดียว ใช้สีประจำ อปท. (--color-primary)
-- ที่มา: ทุ่งแค้วแจ้ง 2569-11-19 ว่าไอคอนหมวดร้องเรียนชุด OpenMoji ดูเด็กเมื่อเทียบกับ อปท. อื่น
-- เจ้าของระบบเลือกแบบ "ทึบสีเดียว" — เป็นตัวเลือกราย อปท. ค่าเริ่มต้นยังเป็น 'color' เหมือนเดิม
--
-- แตะเฉพาะ check constraint ของคอลัมน์เดิม ไม่แตะข้อมูล ไม่แตะสิทธิ์
-- (GRANT SELECT (category_icon_style) ให้ anon/authenticated มีอยู่แล้วจาก 20260821061600 — คอลัมน์เดิม ไม่ต้อง grant ใหม่)
--
-- constraint เดิมสร้างแบบไม่ตั้งชื่อใน 20260820235200 (Postgres ตั้งชื่อเอง ปกติ = municipalities_category_icon_style_check)
-- ไม่เดาชื่อ: ไล่ลบทุก CHECK บนตาราง municipalities ที่อ้างคอลัมน์นี้คอลัมน์เดียว แล้วสร้างใหม่แบบมีชื่อ
-- รันซ้ำได้ (idempotent)

begin;

-- ALTER ขอ ACCESS EXCLUSIVE บน municipalities ซึ่งทุก request อ่าน — ถ้ามี transaction ค้างถือ lock อยู่
-- อย่าให้ ALTER ไปต่อคิวจนเว็บค้างทุก อปท. รอไม่เกิน 5 วินาทีแล้ว rollback ทั้งก้อน รันใหม่ได้ทันที
set local lock_timeout = '5s';

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any (con.conkey)
    where con.conrelid = 'public.municipalities'::regclass
      and con.contype = 'c'
      and att.attname = 'category_icon_style'
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table public.municipalities drop constraint %I', r.conname);
  end loop;
end
$$;

alter table public.municipalities
  add constraint municipalities_category_icon_style_check
  check (category_icon_style in ('native', 'color', 'outline', 'glyph'));

commit;
