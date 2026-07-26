-- 129: แยกช่องทางรับเรื่อง (ประชาชนออนไลน์ / เคาน์เตอร์ OSS) + เปลี่ยนรูปแบบ ref_no
-- เดิม (053_ref_no_sla.sql): SLUG-ปีพ.ศ.(4หลัก)-ลำดับ เช่น NAML-2569-0001
-- ใหม่: ES-ปีพ.ศ.(2หลัก)-ลำดับ (ช่องทางออนไลน์) / OS-ปีพ.ศ.(2หลัก)-ลำดับ (เคาน์เตอร์ OSS)
-- ref_no แถวเก่าไม่แตะ (trigger ยิงเฉพาะตอน ref_no ยังเป็น null ตอน insert)

alter table complaints
  add column if not exists channel text not null default 'citizen_online';

alter table complaints
  drop constraint if exists complaints_channel_check;
alter table complaints
  add constraint complaints_channel_check
  check (channel in ('citizen_online', 'oss_counter'));

comment on column complaints.channel is
  'citizen_online = ประชาชนกรอกเอง (เว็บ/ลิงก์จาก LINE OA rich menu); oss_counter = เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ OSS';

-- ลำดับรันแยกต่อ (เทศบาล, ปี, ช่องทาง) — ไม่ปนกันระหว่าง ES/OS
alter table complaint_seq
  add column if not exists channel text not null default 'citizen_online';

alter table complaint_seq drop constraint if exists complaint_seq_pkey;
alter table complaint_seq add primary key (municipality_id, year_be, channel);

create or replace function generate_complaint_ref_no()
returns trigger language plpgsql security definer as $$
declare
  v_year   int;
  v_seq    int;
  v_prefix text;
  v_ch     text;
begin
  v_ch     := coalesce(new.channel, 'citizen_online');
  v_prefix := case when v_ch = 'oss_counter' then 'OS' else 'ES' end;
  v_year   := extract(year from now())::int + 543;

  insert into complaint_seq (municipality_id, year_be, channel, last_seq)
  values (new.municipality_id, v_year, v_ch, 1)
  on conflict (municipality_id, year_be, channel)
  do update set last_seq = complaint_seq.last_seq + 1
  returning last_seq into v_seq;

  new.ref_no := v_prefix || '-' || right(v_year::text, 2) || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;
-- trg_complaint_ref_no (before insert when ref_no is null) จาก 053 ยังใช้ได้เหมือนเดิม ไม่ต้องแก้
