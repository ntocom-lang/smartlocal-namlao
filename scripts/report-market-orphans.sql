-- ตรวจก่อนยุบหน้า /market: คำขอที่ "อนุมัติแล้ว" แต่ไม่มีแถวคู่กันใน tourism_places
-- (ถ้ามี = เคยแสดงเฉพาะหน้า /market เท่านั้น พอ redirect ไป /tourism จะหายจากสายตาประชาชน)
-- รันใน Supabase SQL Editor แล้วดูเฉพาะจำนวน ไม่ต้องส่งผลลัพธ์ที่มีชื่อ/เบอร์ออกนอกระบบ (PDPA)

select
  m.name                                   as อปท,
  count(*)                                 as อนุมัติแล้วทั้งหมด,
  count(*) filter (where t.id is null)     as ไม่มีใน_tourism_places
from public.business_registrations b
join public.municipalities m on m.id = b.municipality_id
left join public.tourism_places t
       on t.municipality_id = b.municipality_id
      and t.name = b.business_name
where b.status = 'approved'
group by m.name
order by 3 desc;
