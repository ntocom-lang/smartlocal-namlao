-- 20260906130000_tourism_place_ratings_view.sql
--
-- เลิกดึง tourism_reviews ทั้งตารางมาบวกเฉลี่ยที่เบราว์เซอร์ (TourismPage.jsx ทำแบบนั้นอยู่)
-- ทุกครั้งที่เปิดหน้า = โหลดทุกรีวิวของ อปท. นั้น แค่เพื่อโชว์ดาวใต้ชื่อร้าน
--
-- เจตนาให้เป็น view แบบ security definer (ค่าเริ่มต้นของ postgres) ไม่ใช่ security_invoker
-- เพราะคืนเฉพาะค่าสรุป (place_id, จำนวน, ค่าเฉลี่ย) ไม่มีข้อมูลส่วนบุคคลของผู้รีวิวเลย
-- ทั้ง user_id, ชื่อ, ข้อความ ไม่ผ่าน view นี้ — ตัวเลขดาวเป็นข้อมูลสาธารณะของร้านอยู่แล้ว
-- ถ้าวันหนึ่งต้องการดึงตัวรีวิวรายอัน ให้ query tourism_reviews ตรงๆ ผ่าน RLS เหมือนเดิม

begin;

drop view if exists public.tourism_place_ratings;

create view public.tourism_place_ratings as
select
  r.place_id,
  r.municipality_id,
  count(*)::int                      as review_count,
  round(avg(r.rating)::numeric, 2)   as avg_rating
from public.tourism_reviews r
group by r.place_id, r.municipality_id;

revoke all on public.tourism_place_ratings from public;
grant select on public.tourism_place_ratings to anon, authenticated;

comment on view public.tourism_place_ratings is
  'ค่าเฉลี่ยดาว/จำนวนรีวิวต่อสถานที่ — สรุปล้วน ไม่มี PII เปิดอ่านสาธารณะโดยตั้งใจ';

commit;
