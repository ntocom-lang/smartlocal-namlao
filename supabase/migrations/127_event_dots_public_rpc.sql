-- SmartLocal 127: RPC สาธารณะสำหรับจุดสีในปฏิทินกิจกรรม
-- ให้ทุกคน (รวมประชาชนทั่วไปที่ RLS ปกติจะไม่เห็น event นอกกลุ่ม 'public' เลย)
-- เห็นว่า "มีกิจกรรมวันนี้ไหม และเป็นของกลุ่มไหน" ได้ โดยไม่เปิดเผยชื่อ/สถานที่/รายละเอียด
-- ของกิจกรรมที่จำกัดกลุ่มเลย — ยังต้องผ่าน RLS ปกติเป๊ะๆ ถ้าจะดูรายการเต็ม

create or replace function public.get_event_dots(p_municipality_id uuid, p_from date, p_to date)
returns table (event_date date, audiences text[])
language sql
security definer
set search_path = public
stable
as $$
  select event_date, audiences
  from events
  where municipality_id = p_municipality_id
    and event_date is not null
    and event_date >= p_from
    and event_date <= p_to;
$$;

grant execute on function public.get_event_dots(uuid, date, date) to anon, authenticated;
