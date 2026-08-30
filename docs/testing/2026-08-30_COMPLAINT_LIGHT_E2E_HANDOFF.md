# E2E Handoff: แจ้งเรื่องไฟฟ้าสาธารณะจนปิดเรื่อง

วันที่ทดสอบ: 30 สิงหาคม 2569  
ระบบเป้าหมาย: `https://demo.rk-networks.com` — เทศบาลตำบลสาธิต  
เลขอ้างอิง: `ES-69-0004`  
ผลรวม: Workflow หลักจบครบ แต่พบ 4 defects และ 1 diagnostic issue

## ขอบเขตและข้อมูลทดสอบ

- ใช้เฉพาะบัญชี `demo-citizen`, `demo-admin`, `demo-technician-2`
- หมวด: ไฟฟ้าสาธารณะ
- ลักษณะปัญหา: ไฟดับทั้งดวง
- รายละเอียดขึ้นต้น `[TEST] E2E` และระบุชัดว่าไม่ให้ส่งทีมช่างจริง
- สถานที่: `[TEST] จุดจำลองหน้าอาคารเทศบาล ไม่ใช่สถานที่จริง`
- โทรศัพท์: `0000000000`
- ไม่มีรูปบุคคล ไม่มีรูปสถานที่จริง ไม่มี GPS และไม่มีข้อมูลประชาชนจริง
- ไม่บันทึกหรือแสดง credential/token ในรายงาน

## ผลการทดสอบตามลำดับงาน

| ขั้นตอน | บัญชี | ผล |
|---|---|---|
| Login และส่งคำร้อง | `demo-citizen` | PASS — สร้าง `ES-69-0004` สำเร็จและผ่าน consent modal |
| รับเรื่อง | `demo-admin` | PASS — `new → received` พร้อมบันทึก timeline |
| มอบหมาย | `demo-admin` | PASS — มอบหมาย `[TEST] ช่างไฟฟ้า สำนักปลัด` สำเร็จ |
| เห็นเฉพาะงานที่มอบหมาย | `demo-technician-2` | PASS — งานปรากฏใน “งานของฉัน” |
| เริ่มดำเนินการ | `demo-technician-2` | PASS — `received → in_progress` |
| รายงานดำเนินการเสร็จ | `demo-technician-2` | PASS แบบมี defect — `in_progress → done` ได้โดยไม่มีรูปหลักฐาน |
| ตรวจสิทธิ์ปิดเรื่อง | `demo-technician-2` | PASS — ไม่พบปุ่ม `ปิดเรื่อง`; ช่างหยุดที่ `done/รอปิดเรื่อง` |
| ปิดเรื่องขั้นสุดท้าย | `demo-admin` | PASS — `done → closed` |
| ประชาชนติดตามผล | `demo-citizen` | PASS — แสดง `ES-69-0004`, สถานะ “ปิดเรื่องแล้ว” และแบบประเมินความพึงพอใจ |

## Defects ที่ต้องแก้

### P1 — ช่างปิดงานได้โดยไม่มีรูปหลักฐาน

Actual:

- หน้าช่างแสดง “ยังไม่มีรูปหลักฐาน”
- กด `✅ ปิดงาน` ได้ และสถานะเปลี่ยนเป็น `done/รอปิดเรื่อง` สำเร็จ
- หลังปิดงานยังแสดง “ยังไม่มีรูปหลักฐาน”

Root cause ที่เห็นจาก source:

- `src/pages/TechnicianDashboard.jsx:247` กำหนด `const needsPhoto = false` แบบ hardcode
- UI warning/disabled gate ที่ `:449-457` จึงไม่มีวันทำงาน

Expected:

- ถ้านโยบายกำหนดให้ต้องมีหลักฐาน ต้องปิดปุ่มจนมี `work_photos.length > 0`
- ต้องมี server-side/database validation ด้วย เพราะ UI guard อย่างเดียว bypass ได้
- ถ้ารูปเป็น optional จริง ให้ลบข้อความ/โค้ดที่สื่อว่าเป็นข้อบังคับและกำหนด requirement ให้ชัด

Acceptance criteria:

1. Technician ที่ไม่มีรูปกด `done` ไม่ได้ทั้งจาก UI และ direct API
2. เมื่อมีรูป `[TEST]` ที่ผ่าน validation แล้วจึงเปลี่ยนเป็น `done` ได้
3. Admin ยังปิดเรื่องจาก `done → closed` ได้ตามเดิม

### P1 — Telegram notification ล้มเหลวทุกสถานะ

Actual:

- Console พบ `Telegram notification failed: Edge Function returned a non-2xx status code` จำนวน 5 ครั้ง
- ตรงกับจุดสร้างคำร้อง, Admin รับเรื่อง, Technician เริ่มงาน, Technician ปิดงาน และ Admin ปิดเรื่อง
- Workflow หลักไม่ rollback จึงดูเหมือนสำเร็จ แม้ notification ไม่ถูกส่ง

Root cause ที่น่าจะเป็นไปได้จาก configuration/code:

- Demo tenant ไม่มี `telegram_group_id`
- `supabase/functions/notify-telegram/index.ts:383-385` คืน HTTP 422 เมื่อไม่ได้ตั้ง group
- Client `src/lib/notifyTelegram.js:23-37` log ทุก non-2xx เป็น error

Expected สำหรับ demo tenant:

- ห้ามส่ง notification ไปกลุ่มจริง
- เลือกอย่างใดอย่างหนึ่ง: disable notification สำหรับ `slug=demo` หรือคืน `200 { ok: true, skipped: true }` เมื่อ channel ไม่ถูก configure
- Production tenant ที่เปิด Telegram ต้องยัง fail observably เมื่อ config เสียจริง

Acceptance criteria:

1. E2E ของ demo ไม่มี console error และไม่ส่งข้อความไปกลุ่มจริง
2. มี audit result ระบุ `skipped/not_configured` แยกจาก `failed`
3. Production tenant ที่ตั้ง group/token ถูกต้องส่งได้หนึ่งครั้งต่อ idempotency key

### P2 — Popup “เพิ่มเบอร์มือถือ” แสดงซ้ำหลังข้าม

Actual:

- บัญชีทั้ง Citizen, Admin และ Technician ไม่มีเบอร์ จึงเห็น popup หลัง login
- หลังคลิก `ข้ามไปก่อน` popup กลับมาอีกเมื่อเข้า `/complaint`, เลือกหมวด, เข้า `/admin`, `/staff`, `/technician` หรือ `/my-complaints`
- Popup overlay ขัดจังหวะการทำงานทุก role

Root cause candidate:

- `src/App.jsx:357-423` เรียก `setShowPhoneReminder(true)` ทุกครั้งที่ profile ไม่มี phone
- `src/App.jsx:474-511` เรียก `checkAndFixProfile` ทั้งจาก `getSession()` และ `SIGNED_IN`
- ไม่มี session-scoped dismissal/dedupe; modal render อยู่ที่ `src/App.jsx:541-542`

Expected:

- Email-based account กดข้ามแล้วไม่เตือนซ้ำภายใน session เดียวกัน
- Staff/Admin/Technician ไม่ควรถูก popup citizen onboarding บล็อกหน้าปฏิบัติงาน
- บัญชี LINE ที่ไม่มี email และถูกกำหนด `required=true` ยังต้องบังคับตามเดิม

Acceptance criteria:

1. `demo-citizen` กดข้ามหนึ่งครั้งแล้วเปลี่ยน route ได้โดย popup ไม่กลับมาใน session เดิม
2. Admin/Technician เข้า back-office ได้โดยไม่ถูก popup ซ้ำ
3. Logout/login ใหม่จะแสดงอีกครั้งได้ตาม policy
4. LINE no-email required flow ไม่ถดถอย

### P2 — หน้า Login ของ demo แสดงชื่อระบบของน้ำเลา

Actual:

- Header/Footer แสดง “เทศบาลตำบลสาธิต” ถูกต้อง
- ข้อความใต้หัวข้อ Login แสดง “เข้าสู่ระบบเทศบาลตำบลน้ำเลา”

Root cause:

- `src/pages/AuthPage.jsx:341` เลือก `tenant.system_name` ก่อน `tenant.name`
- Migration `supabase/migrations/20260829113107_seed_demo_tenant.sql:33-43` copy `m.system_name` จาก source tenant มาให้ demo

Expected:

- Demo tenant ต้องมี `system_name` ที่สอดคล้องกับเทศบาลตำบลสาธิต เช่น `เทศบาลตำบลสาธิต` หรือ `SmartLocal Demo`
- ห้ามแก้ production tenant อื่นโดยไม่ตั้งใจ

Acceptance criteria:

1. `/auth` บน `demo.rk-networks.com` ไม่มีคำว่า “น้ำเลา”
2. Header, login subtitle, PWA name และเอกสาร demo ใช้ชื่อเดียวกัน
3. Seed/migration แบบ rerun-safe แก้เฉพาะ `slug='demo'`

## Diagnostic issue

### P3 — Stale refresh token error ตอนเริ่ม session

พบหนึ่งครั้ง:

```text
AuthApiError: Invalid Refresh Token: Refresh Token Not Found
```

หลังจากนั้น login ด้วยบัญชี demo สำเร็จ จึงยังไม่ถือเป็น blocker แต่อาจทำให้ผู้ใช้เห็น session กระพริบหรือเกิด log noise ควรตรวจ startup auth flow ว่า stale token ถูก clear แล้วเข้าสู่ signed-out state แบบเงียบและ deterministic

Acceptance criteria:

- เปิดเว็บด้วย stale/ถูกลบ refresh token แล้วแสดง signed-out state โดยไม่มี uncaught console error
- Login ครั้งถัดไปสำเร็จโดยไม่ต้อง reload

## สิ่งที่ผ่านและต้องห้ามทำพัง

- Consent ก่อนส่งคำร้องทำงาน
- Citizen สร้างและติดตามคำร้องของตนได้
- Admin เป็นผู้รับเรื่องและมอบหมาย
- Technician เห็นงานที่ `assigned_to` เป็นตนเอง
- Technician ทำได้ถึง `done` แต่ไม่มี final-close control
- Admin ปิด `done → closed`
- Citizen เห็นสถานะปิดและแบบประเมิน

## งานที่ให้ Claude ทำ

1. แก้เฉพาะ defects ข้างต้น โดยเริ่มจาก P1
2. ห้ามเปลี่ยนอำนาจงาน: Admin รับ/มอบหมาย/ปิดเรื่อง; Technician รายงานเสร็จเท่านั้น
3. ใช้ `[TEST]` data เท่านั้น ห้ามใช้ PII, รูปจริง หรือ GPS จริง
4. ห้ามใส่ credential/secret ใน source, test log หรือรายงาน
5. ถ้าต้องแก้ database ให้ทำ migration แบบ narrow และขออนุมัติก่อน apply production
6. เพิ่ม automated regression test ครอบคลุม workflow และ acceptance criteria
7. รัน build, scoped lint, test และ `git diff --check`; รายงานแยก local/commit/push/deploy/database state

## สถานะส่งมอบ

- ทดสอบบน demo production URL เท่านั้น
- ไม่แก้ source code
- ไม่ commit/push/deploy
- ไม่แก้ schema
- เก็บ `ES-69-0004` ในสถานะ closed เป็น audit evidence; ยังไม่ได้ลบ
