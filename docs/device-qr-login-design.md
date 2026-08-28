# ล็อกอินด้วย QR จากมือถือ (Device QR Login) — เอกสารออกแบบ

สถานะ: **เขียนโค้ดครบทั้ง 3 ก้อนแล้ว ยังไม่ deploy และยังไม่ทดสอบ** — 2026-08-27
(ติด MCP Supabase หลุด จึงยัง apply migration และ deploy edge function ไม่ได้)

## 1. ปัญหาที่แก้

เจ้าหน้าที่ไปใช้ PC เครื่องอื่นในสำนักงาน แล้วกดปุ่ม "เข้าสู่ระบบด้วย Google/LINE"
เบราว์เซอร์เครื่องนั้นยังจำ session ของเจ้าของเครื่องไว้ จึงเข้าเป็นบัญชีคนอื่นทันที
โดยไม่มีจังหวะให้เลือก และแอปมองว่าเป็นการล็อกอินที่ถูกต้องทุกประการ

ผลเสียที่แท้จริงไม่ใช่ความไม่สะดวก แต่คือ `audit_logs` บันทึก `actor_id` / `actor_name`
เป็นคนอื่น หลักฐานการอนุมัติ/แก้ไขคำร้องผิดตัว (ประเด็น สตง.) และเป็นการเข้าถึงข้อมูล
ส่วนบุคคลของประชาชนด้วยสิทธิ์ของผู้อื่น (PDPA)

ทางเลือกที่ให้เจ้าหน้าที่พิมพ์รหัสผ่านบนเครื่องคนอื่นก็ไม่ดี — เบราว์เซอร์เครื่องนั้นอาจจำ
รหัสผ่านไว้ และเจ้าหน้าที่มักตั้งรหัสผ่านซ้ำกับระบบอื่น

## 2. เป้าหมายการใช้งาน

เจ้าหน้าที่ที่ไม่เก่ง IT ต้องทำแค่ 2 อย่าง: **สแกน QR บนจอ PC** แล้ว **แตะเลขที่ตรงกัน**
ไม่ต้องจำรหัสผ่าน ไม่ต้องพิมพ์อะไรบนเครื่องคนอื่นเลย

## 3. ภาพรวม flow

```
   PC (ไม่ได้ล็อกอิน)                          มือถือเจ้าหน้าที่ (ล็อกอินค้างอยู่)
   ────────────────────                        ──────────────────────────────
1. เปิด /admin/login → แท็บ "เข้าด้วย QR"
2. POST device-login {action:'start'}
   ← code (สาธารณะ), verifier (ลับ อยู่แต่ในแรม PC), match_number
3. แสดง QR ที่ชี้ไป /device-login?code=…
   และแสดงเลข 2 หลักตัวใหญ่บนจอ
                                          4. สแกน QR → เปิดหน้าอนุมัติในแอปตัวเอง
                                          5. POST device-login {action:'info', code}
                                             ← ข้อมูลเครื่องที่ขอ + เลข 2 หลัก 3 ตัวเลือก
                                          6. เห็น "เครื่อง Windows/Chrome ที่ IP … ขอเข้าใช้
                                             งานในชื่อคุณ" → แตะเลขที่ตรงกับจอ PC
                                          7. POST device-login {action:'approve', code, pick}
                                             (แนบ JWT ของมือถือ) → status = approved
8. poll ทุก 3 วิ {action:'claim', code, verifier}
   ← token_hash (สร้างสดตอนนั้น ใช้ครั้งเดียว)
9. verifyOtp({type:'magiclink', token_hash}) → ได้ session → เข้า /admin
```

## 4. Schema

```sql
create table public.device_login_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,              -- อยู่ใน QR (สาธารณะ) — random 32 hex (128 bit)
  verifier_hash text not null,            -- sha256 ของ verifier ที่ PC เก็บไว้เอง ไม่เคยอยู่ใน QR
  match_number smallint not null,         -- เลข 2 หลักที่โชว์บนจอ PC (10-99)
  decoy_numbers smallint[] not null,      -- เลขหลอก 2 ตัวสำหรับให้มือถือเลือก
  status text not null default 'pending', -- pending | approved | claimed | denied | expired
  approved_user_id uuid references auth.users(id) on delete cascade,
  municipality_id uuid references public.municipalities(id),
  requester_ip inet,
  requester_user_agent text,
  attempt_count smallint not null default 0,  -- กันเดาเลข/เดา code
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  claimed_at timestamptz
);

create index on public.device_login_requests (code);
create index on public.device_login_requests (expires_at);

alter table public.device_login_requests enable row level security;
-- ไม่มี policy ใดๆ ให้ anon/authenticated เลย — ทุกการเข้าถึงผ่าน Edge Function
-- (service_role) เท่านั้น เพื่อไม่ให้ payload ของ Realtime หรือ PostgREST หลุดข้อมูลออกไป
revoke all on public.device_login_requests from anon, authenticated;
```

**เหตุผลที่ไม่เก็บ token ไว้ใน table:** magic-link token ถูกสร้างสดตอน PC มา claim เท่านั้น
ต่อให้ตารางรั่วก็ไม่มี token ให้ขโมย และไม่ต้องพึ่ง RLS ที่ payload ของ Realtime อาจเปิดเผยเกิน

## 5. Edge Function `device-login` (action เดียวจบ 4 กรณี)

รวมเป็น function เดียวเพื่อลด boilerplate และให้ rate limit อยู่จุดเดียว

| action | ผู้เรียก | ตรวจอะไร | คืนอะไร |
|---|---|---|---|
| `start` | PC (anon) | rate limit ต่อ IP | `code`, `verifier`, `match_number`, `expires_at` |
| `info` | มือถือ (ต้องมี JWT) | code ยังไม่หมดอายุ/ยังไม่ถูกใช้ | ข้อมูลเครื่องที่ขอ + ตัวเลข 3 ตัวเลือกสลับลำดับ |
| `approve` | มือถือ (ต้องมี JWT) | เลขที่แตะถูกต้อง, role ของผู้ใช้, `attempt_count` | `ok` |
| `claim` | PC (anon) | `sha256(verifier)` ตรงกับ `verifier_hash` | `token_hash` (ครั้งเดียว) แล้วปิดคำขอเป็น `claimed` |

`claim` เรียก `auth.admin.generateLink({ type: 'magiclink', email })` ด้วย service_role
แล้วส่งเฉพาะ `properties.hashed_token` กลับไป ฝั่ง PC เรียก
`supabase.auth.verifyOtp({ type: 'magiclink', token_hash })` เพื่อแลกเป็น session จริง

## 6. มาตรการความปลอดภัย (ทุกข้อจำเป็น ไม่ใช่ของแถม)

1. **QRLJacking** — ช่องโหว่ที่ใช้โจมตี LINE/WhatsApp Web ได้จริง: คนร้ายเอา QR ของ
   เครื่องตัวเองไปให้เจ้าหน้าที่สแกน แล้วได้ session ของเจ้าหน้าที่ไป
   ตัวกัน: **number matching** — เลขอยู่บนจอ PC เท่านั้น คนร้ายที่ส่ง QR มาทางไลน์/
   กระดาษไม่มีทางบอกได้ว่าต้องแตะเลขอะไร เดาถูก 1 ใน 3 และผิดครั้งเดียวคำขอถูกยกเลิกทันที
2. **verifier แบบ PKCE** — `code` ที่อยู่ใน QR ใช้ claim ไม่ได้ ต้องมี `verifier` ที่อยู่ใน
   แรมของ PC เครื่องที่ขอเท่านั้น ต่อให้คนร้ายถ่ายรูป QR ไปก็เอา session ไปไม่ได้
3. **อายุสั้น + ใช้ครั้งเดียว** — 2 นาที, `claimed` แล้วใช้ซ้ำไม่ได้, cron ลบของเก่า
4. **แสดงข้อมูลเครื่องที่ขอ** — OS/เบราว์เซอร์/IP บนหน้าอนุมัติ ให้ตัดสินใจได้ว่าใช่เครื่อง
   ตรงหน้าจริงไหม
5. **rate limit** ที่ `start` (ต่อ IP) และ `attempt_count` ที่ `approve`
6. **audit log** ทุกการอนุมัติ ลงตาราง `audit_logs` เดิม (action = `device_login_approve`)
   พร้อม IP/user agent ของเครื่องปลายทาง — ผู้ตรวจสอบต้องตามได้ว่า session นั้นเกิดจาก
   การอนุมัติของใคร จากเครื่องไหน เมื่อไร
7. **จำกัดเฉพาะเจ้าหน้าที่** — `approve` ปฏิเสธถ้า role เป็น `citizen` (ประชาชนไม่มีเหตุ
   ต้องล็อกอินบน PC สำนักงาน ยิ่งเปิดกว้างยิ่งเพิ่มพื้นที่ถูกโจมตี)

## 7. ข้อจำกัดที่ต้องรู้ก่อนตัดสินใจ

- **บัญชีที่ไม่มีอีเมลจริงใน `auth.users` ใช้ไม่ได้** — `generateLink` ต้องใช้อีเมล
  บัญชีที่สมัครด้วย LINE ล้วนอาจไม่มี ต้องนับจำนวนก่อนว่ากระทบใครบ้าง
  (ยังตรวจไม่ได้ ณ เวลาที่เขียน เพราะ MCP Supabase หลุด) เจ้าหน้าที่ปัจจุบันสมัครด้วย
  อีเมลทั้งหมด จึงคาดว่าไม่กระทบ แต่ต้องยืนยันด้วยข้อมูลจริง
- **ไม่ได้แก้ปัญหา session ค้างบนเครื่องเพื่อน** — เจ้าหน้าที่ยังต้องกดออกจากระบบอยู่ดี
  ต้องทำคู่กับ idle timeout + แถบแสดงตัวตนใน back office
- **session ที่ได้จาก QR ยัง persist ลง localStorage ของเครื่องนั้นตามค่าเริ่มต้นของ client**
  (สร้างครั้งเดียวใน src/lib/supabase.js เปลี่ยนเป็นรายครั้งไม่ได้) เหมาะจะทำเป็นงานต่อ:
  ให้ session ที่มาจาก QR ไม่ persist หรือหมดอายุเองเมื่อไม่ใช้งาน
- **มือถือต้องล็อกอินค้างไว้** — ถ้ามือถือหลุด session เอง ก็ต้องล็อกอินด้วยรหัสผ่านก่อน
- **ต้องเพิ่ม dependency** สำหรับวาด QR (`qrcode`, MIT) — ต้องวาดฝั่ง client ล้วน
  ห้ามใช้บริการวาด QR ออนไลน์ เพราะ `code` จะรั่วออกนอกระบบ

## 8. ไฟล์ที่จะแตะ

| ไฟล์ | งาน |
|---|---|
| `supabase/migrations/…_device_login.sql` | table + grants + cron ลบของหมดอายุ |
| `supabase/functions/device-login/index.ts` | 4 action ตามตารางข้อ 5 |
| `src/pages/DeviceLoginApprove.jsx` | หน้าอนุมัติบนมือถือ (`/device-login`) |
| `src/components/auth/QrLoginPanel.jsx` | แผง QR + เลข 2 หลัก + poll |
| `src/pages/AdminLogin.jsx` | เพิ่มแท็บ "เข้าสู่ระบบด้วย QR" |
| `src/App.jsx` | route `/device-login` |
| `package.json` | เพิ่ม `qrcode` |

## 9. แผนลงมือ (แบ่ง 3 ก้อน ทดสอบทีละก้อน)

1. DB + Edge Function + ทดสอบด้วย curl ให้ครบทุกเคสความปลอดภัย (เดาเลขผิด, verifier ผิด,
   หมดอายุ, ใช้ซ้ำ, ประชาชนกดอนุมัติ)
2. หน้าอนุมัติบนมือถือ
3. แผง QR บน PC + ต่อ session จริง แล้วทดสอบกับเครื่องจริง 2 เครื่อง

## 10. ความเสี่ยง / สิ่งที่ต้องตัดสินใจ

- ต้องยืนยันโควตา Edge Function invocation ของแพลนปัจจุบัน — poll ทุก 3 วิ นาน 2 นาที
  = ~40 ครั้งต่อการล็อกอิน 1 ครั้ง ถ้าใช้กันวันละ 50 ครั้งคือ ~60K ครั้ง/เดือน
  ประเมินว่ายังอยู่ในโควตาฟรี แต่ต้องเปิดดูตัวเลขฉบับปัจจุบันก่อน ไม่ใช้ความจำ
- ยังไม่ตัดสินใจ: จะเปิด QR login ให้ role ไหนบ้าง (ข้อเสนอ: เจ้าหน้าที่ทุก role ยกเว้น
  `citizen`) และจะให้ superadmin ใช้ได้ไหม
