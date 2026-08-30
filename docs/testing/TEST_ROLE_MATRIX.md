# SmartLocal Test Role Matrix

ไฟล์นี้เก็บเฉพาะ alias และขอบเขตสิทธิ์สำหรับทดสอบระบบ ห้ามบันทึก password, OTP,
access token, refresh token, recovery code หรือ browser storage/session ลงในไฟล์นี้

ข้อมูลที่สร้างระหว่างทดสอบทุกชนิดต้องขึ้นต้นด้วย `[TEST]` และต้องไม่ใช้ข้อมูลประชาชนจริง

## สนามซ้อม: ทดสอบที่ `demo` เท่านั้น

> [!CAUTION]
> **อปท. ที่ห้ามใช้ทดสอบเด็ดขาด:** `namlao` (มีคำร้องจริงของประชาชน),
> `tamnaktham`, `thungkaew`, `muangphrae` (เตรียมส่งมอบ/ส่งมอบแล้ว)

| | |
|---|---|
| slug สนามซ้อม | `demo` |
| ชื่อที่แสดง | เทศบาลตำบลสาธิต |
| URL | https://demo.rk-networks.com/ |
| สร้างโดย | `supabase/migrations/20260829113107_seed_demo_tenant.sql` |
| บัญชีทดสอบ | `supabase/seed_demo_accounts.sql` (17 บัญชี ครบ 8 role · 3 fleet_role · ทั้ง 7 กอง) |
| โครงตั้งต้น | กอง/ฝ่าย 7 · หมวดหมู่เรื่องร้องเรียน 11 · ผังจ่ายงาน 11 (คัดลอกค่าตั้งค่าจากน้ำเลา ไม่มีข้อมูลบุคคล) |

**สิ่งที่ต้องรู้ก่อนทดสอบ**

- **เลขที่คำร้องแยกไม่ออก** สนามซ้อมกับ อปท. จริงได้ `ES-69-xxxx` / `OS-69-xxxx`
  เหมือนกันหมด (ตั้งแต่ `129_complaint_channel_ref_no.sql` เลิกใช้ slug เป็น prefix)
  ตัวเดียวที่แยกได้จริงคือ `municipality_id` — อย่าใช้เลขที่คำร้องตัดสิน
- **`demo.rk-networks.com` เปิดสาธารณะ** ใครเดา URL ถูกก็เข้าได้ จึงห้ามใส่ข้อมูลจริง
  ของใครลงไปเด็ดขาด ทั้งของประชาชนและของเจ้าหน้าที่ (PDPA)
- **หมวด `odor` ถูกปิดในสนามซ้อม** เจตนา — หมวดเฉพาะกิจนี้มี RLS ที่ทำให้คำร้องหายเงียบ
  ถ้าไม่มีคนถูก assign (ดู `20260828110000_odor_adhoc_namlao_only.sql`)
- **สนามซ้อมกัน "ข้อมูลปน" ได้ แต่ไม่กัน "schema พัง"** — migration ที่เขียนผิด
  ยังลงทุก อปท. พร้อมกันเหมือนเดิม เพราะใช้ Supabase project เดียวกัน

**ด่านที่ใส่ไว้แล้ว** (ทดสอบว่าทำงานจริงแล้ว ไม่ใช่แค่เขียนไว้)

| ไฟล์ | พฤติกรรม |
|---|---|
| `scripts/test-complaint-lifecycle.mjs` | default `demo` · ตั้ง `TEST_TENANT_SLUG` เป็น อปท. จริง → `exit 1` · จงใจไม่อ่าน `VITE_TENANT_SLUG` |
| `supabase/seed_demo_accounts.sql` | ยิงลง `demo` เท่านั้น · เจอ อปท. จริง → `RAISE EXCEPTION` · บังคับให้กรอกรหัสผ่านเอง ไม่ hardcode |

## สิทธิ์หลักของระบบ

ทุกบัญชีอยู่ใน อปท. `demo` (ยกเว้น Super Admin) · รหัสผ่านไม่บันทึกในไฟล์นี้
สร้าง/รีเซ็ตด้วย `supabase/seed_demo_accounts.sql`

ครอบคลุมครบ **8 role · 3 fleet_role · ทั้ง 7 กองของสนามซ้อม** ไม่มีกองไหนเหลือ 0 คน
และทุกบัญชีผูก `position_id` กับทำเนียบตำแหน่งจริง เพื่อให้คอลัมน์ "สังกัดและตำแหน่ง"
ในหน้าจัดการผู้ใช้มีข้อมูลให้เรียงทดสอบ

| Test Email | `role` | `fleet_role` | สังกัด | ตำแหน่งในทำเนียบ | ใช้ทดสอบอะไร |
|---|---|---|---|---|---|
| `demo-admin` | `admin` | `fleet_admin` | สำนักปลัด | ปลัด อบต. | จัดการระบบและผู้ใช้ใน อปท. ตนเอง ไม่ข้าม tenant |
| `demo-officer-eng` | `officer` | `fleet_staff` | กองช่าง | ผอ.กองช่าง | จัดการงานในกองตนเอง · **ต้องไม่เห็นงานกองอื่น** |
| `demo-officer-fin` | `officer` | `fleet_staff` | กองคลัง | ผอ.กองคลัง | คู่เทียบ พิสูจน์ว่าหัวหน้ากองแยกกันจริง |
| `demo-officer-edu` | `officer` | `fleet_staff` | กองการศึกษา | ผอ.กองการศึกษาฯ | หัวหน้ากองที่ไม่เกี่ยวกับงานซ่อม |
| `demo-officer-audit` | `officer` | `fleet_viewer` | ตรวจสอบภายใน | หัวหน้าหน่วยตรวจสอบภายใน | หัวหน้ากองที่ควรอ่านได้แต่ไม่ควรแก้งานคนอื่น |
| `demo-staff` | `staff` | *(ไม่มี)* | กองช่าง | เจ้าพนักงาน | **ต้องไม่เห็นเมนูยานพาหนะ** (คู่เทียบของ fleet) |
| `demo-staff-edu` | `staff` | *(ไม่มี)* | กองการศึกษา | ครู/ผู้ดูแลเด็ก | เจ้าหน้าที่กองที่ไม่มีงานซ่อม |
| `demo-staff-audit` | `staff` | *(ไม่มี)* | ตรวจสอบภายใน | นักวิชาการตรวจสอบภายใน | เจ้าหน้าที่หน่วยตรวจสอบ |
| `demo-technician` | `technician` | *(ไม่มี)* | กองช่าง | นายช่างโยธา | รับงานและอัปเดตสถานะ/หลักฐานหน้างาน |
| `demo-technician-2` | `technician` | *(ไม่มี)* | สำนักปลัด | ช่างไฟฟ้า | คู่เทียบ ทดสอบจ่ายงานข้ามกอง · **ต้องไม่เห็นงานที่ไม่ได้รับมอบหมาย** |
| `demo-viewer` | `viewer` | `fleet_viewer` | ผู้บริหาร | นายก อบต. | อ่านรายงาน/ภาพรวมได้ แก้หรือลบไม่ได้ |
| `demo-council` | `council` | `fleet_viewer` | สมาชิกสภาฯ | สมาชิกสภา | เมนูสภา โดยไม่มีสิทธิ์ Admin |
| `demo-citizen` | `citizen` | *(ไม่มี)* | ไม่สังกัด | — | เห็นเฉพาะข้อมูลของตนเอง |
| `demo-fleet-admin` | `staff` | `fleet_admin` | กองช่าง | นักวิชาการ | สร้าง/แก้/ลบข้อมูล Fleet และกำหนดสิทธิ์ |
| `demo-fleet-staff` | `staff` | `fleet_staff` | กองช่าง | พนักงานขับเครื่องจักรกล | ทำรายการตามกอง ถูกบล็อกคำสั่งที่สงวนให้ Admin |
| `demo-fleet-viewer` | `staff` | `fleet_viewer` | กองช่าง | พนักงานจ้างทั่วไป | อ่านอย่างเดียว ไม่มีปุ่มเขียน/ลบ |

ทุกบัญชีลงท้าย `@smartlocal.test` (TLD สงวนตาม RFC 2606 เป็นอีเมลจริงไม่ได้แน่นอน)

### Super Admin — ใช้แล้วลบทิ้งทันที

> [!CAUTION]
> `demo-superadmin@smartlocal.test` **ไม่ได้อยู่ใน อปท. ไหนเลย** (`municipality_id = NULL`)
> ซึ่งจำเป็น เพราะบั๊กที่ต้องทดสอบเกิดจาก policy ที่เทียบ
> `c.municipality_id = get_my_municipality_id()` แล้วได้ NULL
>
> **ผลที่เลี่ยงไม่ได้:** บัญชีนี้เข้าถึงข้อมูลทุก อปท. รวมคำร้องจริงของประชาชน
> (ตรวจแล้ว: มองเห็นคำร้อง 34 รายการรวมทุก อปท.) จำกัดขอบเขตไม่ได้ เพราะ
> `get_my_role() = 'superadmin'` เป็น OR branch แรกในแทบทุก policy และ
> `AuthContext.jsx` คืน role superadmin ก่อนเช็ค municipality เสมอ
>
> จึงต้อง: **ใช้รหัสผ่านคนละตัวกับบัญชีอื่น** (สคริปต์บังคับไว้แล้ว) ·
> ห้ามเขียนรหัสลงเอกสารหรือ repo · **ลบทิ้งทันทีที่ทดสอบเสร็จ**
> `delete from auth.users where email = 'demo-superadmin@smartlocal.test';`

## บัญชีเก่าที่เลิกใช้ทดสอบแล้ว

> [!WARNING]
> `admin01@gmail.com` – `admin07@gmail.com` เคยเป็นบัญชีทดสอบตามเอกสารฉบับก่อน
> แต่ตรวจพบ 2026-08-29 ว่า **ทั้ง 7 บัญชีสังกัด `namlao`** ซึ่งเป็น อปท. ที่มีคำร้องจริง
> ของประชาชน การทดสอบด้วยบัญชีเหล่านี้เท่ากับล็อกอินเป็นแอดมิน/หัวหน้ากอง/ช่างของ อปท. จริง
>
> **ห้ามใช้ทดสอบอีก** ใช้ชุด `demo-*@smartlocal.test` แทน
>
> ยังไม่ได้ถอดออกจาก `namlao` — ต้องตรวจก่อนว่าเป็นบัญชีของเจ้าหน้าที่จริงหรือเป็น
> บัญชีทดสอบล้วน ถ้าเป็นอย่างหลังควรลบทิ้ง เพราะเป็นบัญชีสิทธิ์สูง 7 ตัวที่ค้างอยู่ใน
> อปท. ที่ให้บริการประชาชนจริง

## วิธีเตรียมและทดสอบระบบ

1. **สร้าง/รีเซ็ตบัญชีทดสอบ:**
   - เปิด `supabase/seed_demo_accounts.sql` กรอก **ทั้ง `v_password` และ `v_su_password`**
     (อย่างน้อย 12 ตัวอักษร และต้องไม่ซ้ำกัน — สคริปต์ปฏิเสธถ้าซ้ำ)
     แล้วรันใน Supabase SQL Editor · **ลบรหัสผ่านออกจากไฟล์ก่อน commit ทุกครั้ง**
   - สคริปต์รันซ้ำได้ (uuid ตายตัว + upsert) ใช้รีเซ็ตรหัสผ่านทั้งชุดได้ด้วย
   - ล้างทิ้งทั้งชุด: `delete from auth.users where email like 'demo-%@smartlocal.test';`
   - ลบเฉพาะ Super Admin หลังทดสอบเสร็จ:
     `delete from auth.users where email = 'demo-superadmin@smartlocal.test';`
2. **ตรวจก่อนล็อกอินทุกครั้ง:**
   - `municipality_id` ของบัญชีต้องเป็นของ `demo` เท่านั้น
     ถ้าเป็น `namlao`/`tamnaktham`/`thungkaew`/`muangphrae` ให้หยุดทันที
   - ยกเว้น `demo-superadmin` ที่ต้องเป็น `NULL` โดยเจตนา — ดูคำเตือนข้างบน
3. **ตั้งค่า Automated Login บนเครื่องทดสอบครั้งเดียว:**
   - สร้าง `.env.test.local` (ถูก `.gitignore` ด้วย `.env*` อยู่แล้ว) และใส่เฉพาะ:
     `DEMO_TEST_PASSWORD=...` กับ `DEMO_SUPERADMIN_PASSWORD=...`
   - บน Windows runner อ่านค่าเดียวกันจาก User Environment (`HKCU\\Environment`) เป็น fallback อัตโนมัติ
     จึงใช้ได้แม้ Claude/Codex ถูกเปิดก่อนตั้งค่า environment โดยไม่ต้องส่งรหัสผ่านในแชท
   - ห้าม commit, ห้ามส่งค่าในแชท และห้ามใช้รหัสนี้กับบัญชีจริง
4. **ตรวจ config โดยไม่เปิด browser:**
   - `npm run test:demo-roles:check`
5. **รันทั้ง 17 บัญชี:**
   - `npm run test:demo-roles`
   - runner ยอมรับเฉพาะ `https://demo.rk-networks.com`, ใช้ persistent session/Chrome autofill เดิมก่อน และ login อัตโนมัติจาก local credential เมื่อ session ไม่พร้อม
   - รันเฉพาะบางบัญชี: `npm run test:demo-roles -- --roles demo-admin,demo-technician`
   - ดู browser ระหว่างทดสอบ: `npm run test:demo-roles -- --headed --roles demo-admin`
6. **ผลทดสอบ:**
   - เขียนลง `test-results.log` เฉพาะ alias, `PASS / FAIL / BLOCKED` และเหตุผล โดยไม่บันทึก password, token หรือข้อมูลในหน้า
   - `demo-superadmin` ตรวจเฉพาะ auth/profile; runner ไม่เปิด module ที่อาจดึงข้อมูลข้าม อปท.

## เกณฑ์ส่งมอบการทดสอบ

- ตรวจทั้งเมนูที่อนุญาตและเมนูที่ต้องถูกปฏิเสธ (Negative Testing)
- ตรวจ CRUD/RLS ด้วยข้อมูล `[TEST]` เท่านั้น
- บันทึกผลเป็น `ผ่าน`, `ไม่ผ่าน` หรือ `Blocked` พร้อมหลักฐานที่ไม่มีข้อมูลส่วนบุคคล
- ลบข้อมูล `[TEST]` หลังจบรอบ โดยไม่ลบบัญชีจนกว่าจะยืนยันว่าไม่ต้องใช้ regression test ซ้ำ
