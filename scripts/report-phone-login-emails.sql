-- รายงานอย่างเดียว ไม่แก้ข้อมูลใดๆ — วางทั้งไฟล์นี้ลง Supabase SQL Editor แล้วกด Run ได้เลย
--
-- ใช้ดูว่า "บัญชีที่สมัครด้วยเบอร์โทร" ใบไหนบ้างที่รูปแบบอีเมลปลอมยังไม่ตรงมาตรฐานใหม่
-- (คนที่พิมพ์ +66 81 234 5678 ตอนสมัครได้บัญชี 66812345678@... ส่วนคนที่พิมพ์ 081-234-5678
--  ได้ 0812345678@... ทั้งที่เป็นเบอร์เดียวกัน)
--
-- ⚠️ ไฟล์นี้ "ไม่" แก้ข้อมูล และห้ามเขียน UPDATE auth.users เองเด็ดขาด
--    อีเมลของผู้ใช้ถูกเก็บซ้ำอยู่ที่ auth.identities ด้วย (ทั้งคอลัมน์ email และใน identity_data)
--    แก้ตารางเดียวจะทำให้สองที่ไม่ตรงกันแล้วผู้ใช้ล็อกอินไม่ได้ทั้งบัญชี
--    ถ้าวันหลังเจอบัญชีที่ต้องย้ายจริง ต้องแก้ผ่าน auth.admin.updateUserById() ฝั่งเซิร์ฟเวอร์
--    เท่านั้น (เขียนสคริปต์ Node ใหม่ ใช้ service_role key แบบ legacy — คีย์ sb_secret_ รูปแบบ
--    ใหม่ยังใช้กับ Admin API ของโปรเจกต์นี้ไม่ได้)
--
-- ตรรกะการแปลงเลขด้านล่างตรงกับ normalizeThaiPhone() ใน src/lib/authProviders.js
-- (ตรวจแล้วให้ผลเหมือนกันทั้ง 12 เคสทดสอบ รวมเคสขอบอย่าง 0066 กับเลขสั้นผิดรูปแบบ)

with phone_users as (
  select
    u.id,
    lower(u.email) as email,
    regexp_replace(split_part(lower(u.email), '@', 1), '[^0-9]', '', 'g') as digits,
    u.last_sign_in_at
  from auth.users u
  where lower(u.email) like '%@phone.smartlocal.app'
),

-- ขั้นที่ 1: ตัดรหัสประเทศออก (0066xxx / 66xxx)
stripped as (
  select
    p.*,
    case
      when p.digits like '0066%' then substr(p.digits, 5)
      when p.digits like '66%' and length(p.digits) >= 10 then substr(p.digits, 3)
      else p.digits
    end as core
  from phone_users p
),

-- ขั้นที่ 2: เบอร์ในประเทศต้องขึ้นต้นด้วย 0 เสมอ แล้วประกอบกลับเป็นอีเมล
targeted as (
  select
    s.id,
    s.email,
    s.last_sign_in_at,
    case
      when s.core = '' then null
      when s.core like '0%' then s.core || '@phone.smartlocal.app'
      else '0' || s.core || '@phone.smartlocal.app'
    end as target_email
  from stripped s
),

classified as (
  select
    t.*,
    case
      when t.target_email is null
        then 'D. ผิดรูปแบบ ต้องดูเอง'
      when t.target_email = t.email
        then 'A. ตรงมาตรฐานแล้ว ไม่ต้องทำอะไร'
      when exists (
        select 1 from auth.users o
        where lower(o.email) = t.target_email and o.id <> t.id
      )
        then 'C. ชนกับบัญชีที่มีอยู่แล้ว (ต้องเลือกเองว่าเก็บใบไหน)'
      when (select count(*) from targeted t2 where t2.target_email = t.target_email) > 1
        then 'C. ชนกันเองสองใบขึ้นไป (ต้องเลือกเองว่าเก็บใบไหน)'
      else 'B. ย้ายได้เลย'
    end as status
  from targeted t
)

select
  status                                     as "สถานะ",
  count(*) over (partition by status)        as "จำนวนในสถานะนี้",
  email                                      as "อีเมลปัจจุบัน",
  target_email                               as "อีเมลหลังรวมรูปแบบ",
  last_sign_in_at                            as "เข้าใช้ล่าสุด",
  id                                         as "user id"
from classified
order by status, email;
