-- ตรวจ "auth user ที่ไม่มี profile" ว่ามีข้อมูลผูกอยู่ตารางไหนบ้าง ก่อนตัดสินใจลบ
-- รายงานอย่างเดียว ไม่แก้ข้อมูล — วางลง Supabase SQL Editor แล้วกด Run
--
-- ── ทำไมต้องเช็คก่อนลบ ───────────────────────────────────────────────────────
-- FK ที่ชี้มาที่ auth.users มีทั้ง ON DELETE CASCADE และ ON DELETE SET NULL ปนกัน
-- ลบ user ทิ้งเฉยๆ อาจทำให้:
--   • CASCADE  → ข้อมูลที่ผูกอยู่หายตามไปทันที กู้ไม่ได้
--   • SET NULL → แถวยังอยู่แต่ไม่รู้ว่าใครทำ ที่ต้องระวังเป็นพิเศษคือ audit_logs.actor_id
--                (ร่องรอยการตรวจสอบ — สตง./ป.ป.ช. ใช้ ห้ามทำให้ขาด)
--                หมายเหตุ: audit_logs เก็บ actor_name/actor_role ไว้ซ้ำเป็นข้อความอยู่แล้ว
--                ชื่อผู้กระทำจึงไม่หายไปทั้งหมด แต่ควรยืนยันก่อนอยู่ดี
--
-- ไม่ hardcode ทั้งชื่อตารางและ uuid — ไล่จาก foreign key ใน catalog ของ Postgres เอง
-- จึงไม่พลาดตารางที่เพิ่มมาทีหลังหรือที่ migration ในเครื่องไม่ตรงกับของจริง (schema drift)

with orphans as (
  select u.id
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
),

orphan_list as (
  select string_agg(quote_literal(id::text), ',') as ids from orphans
),

-- ทุกคอลัมน์ที่เป็น FK คอลัมน์เดียวชี้มาที่ผู้ใช้
fks as (
  select
    c.conrelid::regclass::text as tbl,
    a.attname                  as col
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum   = c.conkey[1]
  where c.contype = 'f'
    and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
    and array_length(c.conkey, 1) = 1
),

counted as (
  select
    f.tbl,
    f.col,
    (xpath(
      '/row/cnt/text()',
      query_to_xml(
        format('select count(*) as cnt from %s where %I::text in (%s)', f.tbl, f.col, o.ids),
        false, true, ''
      )
    ))[1]::text::bigint as n
  from fks f
  cross join orphan_list o
  where o.ids is not null
)

select
  tbl as "ตาราง",
  col as "คอลัมน์",
  n   as "จำนวนแถวที่ผูกกับ orphan"
from counted
where n > 0
order by n desc, tbl;

-- ── อ่านผลยังไง ──────────────────────────────────────────────────────────────
-- เห็นแค่ auth.identities เท่านั้น
--   = ปลอดภัย ลบได้ทั้งชุด (identities เป็น CASCADE ของ user เอง หายไปพร้อมกันตามปกติ)
--
-- มีตารางอื่นโผล่มาด้วย
--   = อย่าเพิ่งลบ ต้องดูทีละตารางว่าเป็นข้อมูลทดสอบหรือของจริง โดยเฉพาะถ้าเป็น
--     complaints / doc_requests / audit_logs ซึ่งอาจเป็นคำร้องจริงของประชาชนน้ำเลา
--     (บัญชี test-* ชุดเก่าเคยถูก seed ลง 'namlao' ก่อนย้ายมาใช้ tenant demo)
