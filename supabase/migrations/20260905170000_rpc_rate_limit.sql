-- 20260905170000_rpc_rate_limit.sql
--
-- ตัวนับอัตราเรียก RPC สำหรับผู้ใช้ที่ไม่ล็อกอิน + ใช้กับ get_complaint_by_ref
--
-- ต้นเหตุ: ref_no เป็นเลขเรียง (ES-69-0106..0147, NAML-2569-0094..0101) ยิงไล่ 200 ครั้ง
-- เจอครบทุกใบโดยไม่มีอะไรกั้น สิ่งที่ harvest ได้คือ หมวด/สถานะ/วันที่ ของคำร้องทุกใบ
-- และเบอร์โทรที่ปิดกลางไว้ (092xxxx402 = เปิด 6 จาก 10 หลัก)
-- ตัวฟังก์ชัน mask ฟิลด์อ่อนไหวไว้ดีอยู่แล้ว (subject/detail/ที่อยู่/พิกัด/ชื่อ/รูป เป็น NULL
-- สำหรับคนนอก) ที่เหลือจึงเป็นปัญหา "ยิงรัวได้ไม่จำกัด" ไม่ใช่ "ข้อมูลรั่วต่อครั้ง"
--
-- ── การเลือกตัวระบุผู้เรียก: จุดที่พลาดง่ายที่สุดของไฟล์นี้ ──────────────────────────
-- ทดสอบกับ production จริงแล้ว (2026-09-03):
--   ปกติ                        → x-forwarded-for = <ip จริง>
--   ส่ง X-Forwarded-For: 1.2.3.4 → x-forwarded-for = "1.2.3.4,<ip จริง>"
--   ส่ง CF-Connecting-IP: ...    → Cloudflare ตอบ 403 ปัดทั้งคำขอ
-- แปลว่า **ตัวแรก** ของ x-forwarded-for เป็นค่าที่ผู้เรียกกำหนดเองได้ ถ้าเขียนแบบที่
-- นิยมกันคือหยิบตัวแรก จะข้าม rate limit ได้ด้วย header เดียว — ต้องใช้ cf-connecting-ip
-- เป็นหลัก และถ้าไม่มีให้หยิบ **ตัวท้าย** ของ x-forwarded-for (ค่าที่ proxy ที่เชื่อถือได้
-- ต่อท้ายเข้ามา) ไม่ใช่ตัวแรก
--
-- ── fail-open โดยตั้งใจ ──────────────────────────────────────────────────────────
-- ถ้าหาตัวระบุผู้เรียกไม่ได้เลย ให้ "ผ่าน" ไม่ใช่ "ปฏิเสธ" เพราะถ้าเลือกทางหลัง
-- ผู้ใช้ทุกคนจะถูกนับรวมเป็นคนเดียวกันแล้วหน้าติดตามสถานะล่มพร้อมกันทั้งระบบ
-- ซึ่งเสียหายกว่าการที่ใครสักคนยิงรัวได้ (และในทางปฏิบัติ cf-connecting-ip มาเสมอ)
--
-- โควตา 30 ครั้ง/5 นาที ตั้งเผื่อ CGNAT ของเครือข่ายมือถือที่ผู้ใช้หลายคนใช้ IP เดียวกัน
-- ประชาชนที่เช็กสถานะเรื่องตัวเองไม่มีทางแตะเพดานนี้ ส่วนคนไล่ยิง 200 ครั้งจะใช้เวลา
-- ราวครึ่งชั่วโมงแทนที่จะเป็นไม่กี่วินาที

create table if not exists public.rpc_rate_limit (
  bucket       text        not null,
  client       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 1,
  primary key (bucket, client, window_start)
);

-- ไม่มี policy สักอัน = ไม่มีใครแตะได้นอกจากฟังก์ชัน SECURITY DEFINER ข้างล่าง
alter table public.rpc_rate_limit enable row level security;
revoke all on public.rpc_rate_limit from anon, authenticated;

create or replace function public.rpc_rate_limit_hit(
  _bucket text,
  _limit  integer,
  _window interval
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_headers json;
  v_client  text;
  v_xff     text;
  v_window  timestamptz;
  v_secs    numeric;
  v_hits    integer;
begin
  -- ผู้ใช้ที่ล็อกอินแล้วนับราย uid ตรงๆ ไม่ต้องพึ่ง IP
  v_client := auth.uid()::text;

  if v_client is null then
    begin
      v_headers := current_setting('request.headers', true)::json;
    exception when others then
      v_headers := null;
    end;

    -- cf-connecting-ip ปลอมไม่ได้ (ทดสอบแล้วได้ 403) จึงเชื่อถือได้ที่สุด
    v_client := nullif(btrim(coalesce(v_headers->>'cf-connecting-ip', '')), '');

    if v_client is null then
      v_xff := coalesce(v_headers->>'x-forwarded-for', '');
      -- เอา "ตัวท้าย" ไม่ใช่ตัวแรก — ตัวแรกผู้เรียกใส่เองได้
      v_client := nullif(btrim(split_part(v_xff, ',', greatest(1,
        array_length(string_to_array(v_xff, ','), 1)))), '');
    end if;
  end if;

  -- หาตัวระบุไม่ได้ = ปล่อยผ่าน ดูเหตุผลในหัวไฟล์
  if v_client is null then
    return true;
  end if;

  v_secs   := extract(epoch from _window);
  v_window := to_timestamp(floor(extract(epoch from now()) / v_secs) * v_secs);

  insert into public.rpc_rate_limit (bucket, client, window_start, hits)
  values (_bucket, v_client, v_window, 1)
  on conflict (bucket, client, window_start)
  do update set hits = public.rpc_rate_limit.hits + 1
  returning hits into v_hits;

  -- เก็บกวาดแบบสุ่ม ~1% ของคำขอ เพื่อไม่ให้ทุกคำขอต้องจ่ายค่า DELETE
  -- และไม่ต้องพึ่ง pg_cron ซึ่งโปรเจกต์นี้ไม่ได้เปิดใช้
  if random() < 0.01 then
    delete from public.rpc_rate_limit where window_start < now() - interval '1 day';
  end if;

  return v_hits <= _limit;
end;
$function$;

revoke all on function public.rpc_rate_limit_hit(text, integer, interval) from public, anon, authenticated;
