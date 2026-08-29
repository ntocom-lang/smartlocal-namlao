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
| บัญชีทดสอบ | `supabase/seed_demo_accounts.sql` (12 บัญชี ครบทุกสิทธิ์) |
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

> [!CAUTION]
> **Super Admin:** ไม่อนุญาตให้สร้างบัญชีทดสอบในระบบ (สงวนเฉพาะบัญชีจริงของผู้พัฒนาระบบเท่านั้น)

ทุกบัญชีอยู่ใน อปท. `demo` · รหัสผ่านชุดเดียวกันทั้งหมด ไม่บันทึกไว้ในไฟล์นี้
(อยู่ในหัวไฟล์ `seed_demo_accounts.sql` ตอนรัน แล้วต้องลบออกก่อน commit)

| ลำดับ | Test Email | `role` | `fleet_role` | สังกัด | ตำแหน่ง | ผลที่ต้องตรวจ | Chrome Profile |
|---:|---|---|---|---|---|---|---|
| 1 | `demo-admin@smartlocal.test` | `admin` | `fleet_admin` | สำนักปลัด | นักวิชาการคอมพิวเตอร์ | จัดการระบบและผู้ใช้ภายใน อปท. ตนเอง แต่ไม่ข้าม tenant | `TEST-admin` |
| 2 | `demo-officer-eng@smartlocal.test` | `officer` | `fleet_staff` | กองช่าง | ผู้อำนวยการกองช่าง | จัดการงานในกองตนเอง · **ต้องไม่เห็นงานกองคลัง** | `TEST-officer` |
| 3 | `demo-officer-fin@smartlocal.test` | `officer` | `fleet_staff` | กองคลัง | ผู้อำนวยการกองคลัง | คู่เทียบของข้อ 2 ใช้พิสูจน์ว่าหัวหน้ากองแยกกันจริง | `TEST-officer-fin` |
| 4 | `demo-staff@smartlocal.test` | `staff` | *(ไม่มี)* | กองช่าง | เจ้าพนักงานธุรการ | ใช้งานเฉพาะงานที่ได้รับมอบหมาย · **ต้องไม่เห็นเมนูยานพาหนะ** | `TEST-staff` |
| 5 | `demo-technician@smartlocal.test` | `technician` | *(ไม่มี)* | กองช่าง | นายช่างโยธาปฏิบัติงาน | รับงานและอัปเดตสถานะ/หลักฐานภาคสนามตามสิทธิ์ | `TEST-technician` |
| 6 | `demo-technician-2@smartlocal.test` | `technician` | *(ไม่มี)* | สำนักปลัด | นายช่างปฏิบัติงาน | คู่เทียบของข้อ 5 ใช้ทดสอบการจ่ายงานข้ามกอง | `TEST-technician-2` |
| 7 | `demo-viewer@smartlocal.test` | `viewer` | `fleet_viewer` | ผู้บริหาร | นายกเทศมนตรี | อ่านรายงาน/ภาพรวมได้ แต่แก้ไขหรือลบข้อมูลไม่ได้ | `TEST-viewer` |
| 8 | `demo-council@smartlocal.test` | `council` | `fleet_viewer` | สมาชิกสภาเทศบาลตำบล | สมาชิกสภาเทศบาลตำบล | เข้าถึงเมนูสภาและข้อมูลที่อนุญาต โดยไม่มีสิทธิ์ Admin | `TEST-council` |
| 9 | `demo-citizen@smartlocal.test` | `citizen` | *(ไม่มี)* | ไม่มีสังกัดภายใน | — | ใช้บริการประชาชนและเห็นเฉพาะข้อมูลของตนเอง | `TEST-citizen` |

## สิทธิ์ Fleet เพิ่มเติม

บัญชี Fleet ใช้ `profiles.role = staff` เหมือนกัน แต่แยก `fleet_role` เพื่อทดสอบ RLS
และปุ่มคำสั่งของโมดูลยานพาหนะโดยไม่ปนกับสิทธิ์หลัก
(คู่เทียบคือข้อ 4 ข้างบน — `staff` ที่ไม่มี `fleet_role` เลย)

| ลำดับ | Test Email | `role` | `fleet_role` | ผลที่ต้องตรวจ | Chrome Profile |
|---:|---|---|---|---|---|
| 10 | `demo-fleet-admin@smartlocal.test` | `staff` | `fleet_admin` | สร้าง/แก้ไข/ลบข้อมูล `[TEST]` และกำหนดสิทธิ์ Fleet | `TEST-fleet-admin` |
| 11 | `demo-fleet-staff@smartlocal.test` | `staff` | `fleet_staff` | ทำรายการตามกอง/รถส่วนกลาง และถูกบล็อกคำสั่งที่สงวนให้ Admin | `TEST-fleet-staff` |
| 12 | `demo-fleet-viewer@smartlocal.test` | `staff` | `fleet_viewer` | อ่านข้อมูลได้อย่างเดียว ไม่มีปุ่มหรือสิทธิ์เขียน/ลบ | `TEST-fleet-viewer` |

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
   - เปิด `supabase/seed_demo_accounts.sql` กรอก `v_password` (อย่างน้อย 12 ตัวอักษร)
     แล้วรันใน Supabase SQL Editor · **ลบรหัสผ่านออกจากไฟล์ก่อน commit ทุกครั้ง**
   - สคริปต์รันซ้ำได้ (uuid ตายตัว + upsert) ใช้รีเซ็ตรหัสผ่านทั้งชุดได้ด้วย
   - ล้างทิ้งทั้งชุด: `delete from auth.users where email like 'demo-%@smartlocal.test';`
2. **ตรวจก่อนล็อกอินทุกครั้ง:**
   - `municipality_id` ของบัญชีต้องเป็นของ `demo` เท่านั้น
     ถ้าเป็น `namlao`/`tamnaktham`/`thungkaew`/`muangphrae` ให้หยุดทันที
3. **เปิด Chrome Profile แยกอิสระ:**
   - `.\scripts\launch-test-profiles.ps1 -Role <role_name>`
   - ตัวอย่าง: `.\scripts\launch-test-profiles.ps1 -Role technician`
4. **ล็อกอินครั้งแรก:**
   - ผู้ดูแลล็อกอินด้วย Email ตามตารางใน Profile นั้น 1 ครั้ง เพื่อให้ Session ฝังใน Profile อิสระ
5. **ส่งต่อให้ Agent / Tester ทดสอบ:**
   - แจ้งเฉพาะ Alias หรือ Role ของ Profile ที่เปิดอยู่ เพื่อรัน UI / E2E Test โดยไม่ต้องรับรู้หรือส่ง Credential ในแชท

## เกณฑ์ส่งมอบการทดสอบ

- ตรวจทั้งเมนูที่อนุญาตและเมนูที่ต้องถูกปฏิเสธ (Negative Testing)
- ตรวจ CRUD/RLS ด้วยข้อมูล `[TEST]` เท่านั้น
- บันทึกผลเป็น `ผ่าน`, `ไม่ผ่าน` หรือ `Blocked` พร้อมหลักฐานที่ไม่มีข้อมูลส่วนบุคคล
- ลบข้อมูล `[TEST]` หลังจบรอบ โดยไม่ลบบัญชีจนกว่าจะยืนยันว่าไม่ต้องใช้ regression test ซ้ำ
