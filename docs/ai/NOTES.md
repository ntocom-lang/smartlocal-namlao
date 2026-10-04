# NOTES.md — กับดักทางเทคนิคของโปรเจกต์นี้ที่เคยพังจริง

ทุกข้อในไฟล์นี้มาจากเหตุการณ์ที่เกิดขึ้นจริงและเสียเวลาไล่หาสาเหตุมาแล้ว
อ่านก่อนแตะเรื่องที่เกี่ยวข้อง จะได้ไม่ต้องเจ็บซ้ำ

> ไฟล์นี้อยู่ใน repo สาธารณะโดยตั้งใจ — มีแต่กติกาทางเทคนิค **ไม่มี** ชื่อ/สถานะของ อปท. ลูกค้า,
> รหัสโปรเจกต์, บัญชีผู้ดูแล หรือช่องโหว่ที่ยังไม่ได้ปิด ของพวกนั้นอยู่ใน repo `smartlocal-devconfig` (private)
> **เพิ่มอะไรที่นี่ ให้ถามตัวเองก่อนว่าคนนอกอ่านแล้วได้เปรียบในการโจมตีหรือไม่**

---

## 1. ฐานข้อมูล: localhost = production

`npm run dev` ต่อ Supabase **ตัวเดียวกับทุก tenant บน production** ไม่มี staging ไม่มี branch แยก
⇒ กดบันทึกในเครื่อง = เขียน DB จริงทันที ทุกไซต์ที่ live เห็นผลทันทีโดยไม่ต้อง deploy

อันตรายที่สุดคือฟีเจอร์ที่ทำให้ **ข้อมูลรูปแบบใหม่เข้าคอลัมน์เดิม** (data URL ในคอลัมน์ข้อความ,
JSON key ใหม่, enum ค่าใหม่) เพราะ client รุ่นเก่าที่ยัง live อยู่อ่านไม่เป็น
เคสจริง: base64 ยาว 8,818 ตัวอักษรถูก render เป็นข้อความเต็มหน้าจอบนเว็บของ อปท. หนึ่ง
ทั้งที่โค้ดใหม่ไม่มีบั๊กเลย

**กติกา:** ต้อง deploy โค้ดที่อ่านรูปแบบใหม่เป็นก่อน แล้วค่อยให้ทดสอบบันทึกข้อมูลรูปแบบใหม่
และใช้ tenant `demo` เป็นสนามซ้อมเท่านั้น

## 2. `.env.local` ฝัง tenant slug ลงบันเดิล

`detectTenantSlug()` เช็ค `import.meta.env.VITE_TENANT_SLUG` เป็นเงื่อนไขแรก
Vite ฝังค่า env ลงบันเดิล **ตอน build** ⇒ build จากเครื่องที่มี `.env.local`
minifier เห็นว่า `if` ข้อแรกจริงเสมอ จึง **ลบตรรกะอ่าน hostname ทิ้งทั้งหมด**
ผลคือทุกโดเมนแสดงข้อมูลของ อปท. เดียวกันหมด

ตรวจจากภายนอกไม่เห็น เพราะ SSR (`worker/index.js`) อ่าน hostname ตรงๆ
`<title>` กับ og:tag จึงถูกต้องทุกโดเมน ผิดเฉพาะตอน React บูต — `curl` ทดสอบเท่าไรก็ผ่านหมด

**กติกา:** ห้าม build production จากเครื่อง dev — `scripts/predeploy-check.js` บล็อกไว้แล้ว
(ข้ามได้ด้วย `ALLOW_LOCAL_DEPLOY=1` เมื่อจำเป็นจริง) และ CI มี guard ที่ `exit 1`
ถ้าเจอ `VITE_TENANT_SLUG` หรือไฟล์ `.env*` ใน working tree

## 3. Migration ต้องแยกไฟล์ตามเฟส

`ALTER TABLE ... ADD COLUMN` แล้วมี statement อื่นในไฟล์เดียวกันอ้างคอลัมน์นั้น
พังด้วย `42703 column ... does not exist` ทั้งที่ `ALTER` อยู่บรรทัดก่อนหน้า
อาการเดียวกันเกิดกับ `CREATE TABLE` แล้วอ้างตารางนั้นในไฟล์เดียวกัน (`42P01`)

> กลไกที่แท้จริงยังไม่ได้ยืนยัน แต่การแยกไฟล์แก้ได้จริง ยืนยันแล้วหลายรอบ

**กติกา:** 1 ไฟล์ = 1 เฟส
1. DDL ที่เพิ่มคอลัมน์ (+ สแนปช็อตข้อมูลก่อนแก้)
2. `CREATE TABLE` เปล่าๆ ของตารางใหม่ทั้งหมด
3. DML / RLS / ฟังก์ชัน ที่อ้างของจากเฟส 1–2

ใส่ guard `DO $$ ... RAISE EXCEPTION` หัวไฟล์ทุกเฟสให้เช็คว่าเฟสก่อนหน้ารันแล้ว กันรันผิดลำดับ

## 4. `municipalities` ใช้ column-level GRANT

ตารางนี้ **ไม่ได้** `GRANT SELECT` ทั้งตารางให้ `anon`/`authenticated` แต่ให้เป็นราย column
เพื่อกันไม่ให้อ่านคอลัมน์ที่เป็นความลับ ⇒ คอลัมน์ที่ `ADD COLUMN` ทีหลัง **ไม่ได้สิทธิ์อัตโนมัติ**

`TenantContext` เลือกคอลัมน์เป็น explicit list ถ้าในลิสต์มีคอลัมน์ที่ role ไม่มีสิทธิ์
PostgREST คืน `42501 permission denied for table municipalities` **ทั้ง query**
แล้วแอปแปลผลเป็น "ไม่พบหน่วยงานรหัส ... ในระบบ" **ทุก tenant**
อาการเหมือนหา tenant ไม่เจอ ทำให้ไล่ผิดทางไปดู slug กับ RLS

**กติกา:** ทุก migration ที่ `ADD COLUMN` บน `municipalities` ต้องปิดท้ายด้วย
```sql
grant select (<col>) on public.municipalities to anon, authenticated;
notify pgrst, 'reload schema';
```
ถ้าคอลัมน์นั้นเป็นความลับให้ข้าม GRANT แต่ต้องไม่ใส่ชื่อคอลัมน์นั้นใน select ของ `TenantContext`
ตรวจได้ด้วย `information_schema.column_privileges` เทียบกับ `pg_attribute`

## 5. `CREATE OR REPLACE` เขียนทับทั้งฟังก์ชัน ไม่ใช่ patch

เคยมี trigger function บน production ถูกแทนที่ด้วย stub ที่เหลือแค่ branch เดียว
แล้วปิดท้ายด้วยคอมเมนต์ `-- ...เงื่อนไขเดิมทั้งหมดคงไว้...` **โดยไม่มี `RETURN NEW`**
→ PostgreSQL raise `2F005 control reached end of trigger procedure without RETURN`
กับ **ทุก** UPDATE ที่ไม่เข้า branch นั้น (แอดมินตั้ง role ไม่ได้ ผู้ใช้แก้โปรไฟล์ตัวเองไม่ได้)

เป็นรูปแบบความเสียหายที่ AI ทำได้ง่ายมาก และพังเงียบที่ชั้น DB
ไม่มีใครเห็นจนกว่าผู้ใช้จริงจะบ่น

**กติกา:** ห้ามเขียน `CREATE OR REPLACE FUNCTION` โดยใส่ placeholder แทนโค้ดเดิม
ต้องยกฟังก์ชันเดิมมาเต็มทุกบรรทัดเสมอ และ trigger function ต้องมี `RETURN` ทุกเส้นทาง

**เคสที่ 2 (2026-10-01) — ยกมาครบทุกบรรทัด แต่ยกมาจากรุ่นเก่า:** `admin_update_user()` เคยแก้ให้คงสังกัด อปท.
ของประชาชนแล้ว (`20260829130000`) แต่ #108 (`20260909140100`) เขียนทับด้วยเนื้อที่ตั้งต้นจากรุ่นก่อนหน้านั้น
บั๊กกลับมาเงียบๆ 3 สัปดาห์ จนบัญชีประชาชนหลุดสังกัดจริง 2 บัญชี (#359 แก้ซ้ำ)

**กติกาเพิ่ม:** ตั้งต้นจาก migration ล่าสุดในรีโปที่นิยามฟังก์ชันนั้นเสมอ แล้วเทียบกับ `pg_get_functiondef`
ของฐานจริง — สองฝั่งไม่ตรงกันให้หยุดหาสาเหตุก่อน ห้ามเลือกฝั่งใดฝั่งหนึ่งมาเขียนต่อเอง
`admin_update_user()` มีเทสต์เฝ้าแล้ว (`npm run test:admin-update-user` รันใน CI ทุก push/PR)
ฟังก์ชันอื่นยังไม่มี ต้องเทียบเอง

## 6. Cache หลัง deploy — ห้ามใส่ TTL กลับให้ HTML

เคยมีช่วงหน้าขาวราว 5 นาทีทุก deploy: worker ตอบ HTML ด้วย `max-age=300`
ขณะที่ vite ล้าง `dist/` ทุก build ทำให้ asset รุ่นก่อนหายทันที
edge ที่ยังจ่าย HTML เก่าจึงชี้ไปไฟล์ที่ไม่มีแล้ว → 404 → หน้าขาว

แก้ครบ 3 ชั้นแล้ว — `worker/index.js` ให้ HTML เป็น `max-age=0, must-revalidate`,
`vite.config.js` ตั้ง `emptyOutDir: false` + `manifest: true`,
`scripts/postbuild.js` เก็บ asset ไว้ 2 รุ่น, `public/_headers` ให้ `/assets/*` เป็น `immutable`

**กติกา:** ห้ามใส่ TTL กลับให้ HTML และอาการ "deploy ซ้ำอีกรอบก็หาย" เป็นความเข้าใจผิด —
ที่แก้คือเวลาที่ผ่านไปจน cache หมดอายุ ไม่ใช่การ deploy ซ้ำ

## 7. มือถือค้างทุกคำสั่ง ไม่ใช่บั๊กของฟีเจอร์นั้น

การเปิด `<input type="file">` บนมือถือจริงทำให้หน้าเว็บถูกซ่อน (Page Visibility API)
แล้ว timer ต่ออายุ token ของ supabase-js อาจไม่กลับมาทำงานเมื่อหน้ากลับมาแสดง
โดยเฉพาะใน Capacitor wrapper ที่การตรวจ visibility ในตัว SDK ไม่น่าเชื่อถือ

พอค้างแล้ว **ทุก** คำสั่ง Supabase ที่ต้องยืนยันตัวตนจะค้างตลอดไปโดยไม่มี error
ไม่ใช่แค่การอัปโหลดไฟล์ — ทำให้บั๊กหน้าตาเหมือนปัญหาการอัปโหลดอยู่หลายรอบ
ทั้งที่จริงคือคำสั่ง `.update()` ธรรมดาตัวแรกที่ค้าง

แนวป้องกันทั้ง 3 ชั้นอยู่ใน `src/lib/supabase.js` — ผูก `document.visibilitychange`
เข้ากับ `startAutoRefresh()`/`stopAutoRefresh()` เอง, `noOpLock` override,
และ `fetchWithTimeout` (เพดาน 25 วินาทีทุก request)

**กติกา:** ถ้ามีรายงานว่า "บนคอมใช้ได้ บนมือถือจริงค้าง ไม่มี error"
ให้ตรวจว่าแนวป้องกันใน `src/lib/supabase.js` ยังอยู่ครบก่อน อย่าเพิ่งไปไล่โค้ดของฟีเจอร์นั้น

## 8. E2E ใช้ Google Chrome ของเครื่อง ไม่ใช่ chromium ของ playwright

เทสต์ทุกตัวใน `tests/` launch ด้วย `channel: 'chrome'`
⇒ เครื่องใหม่ต้องมี **Google Chrome ติดตั้งอยู่** ส่วน `npx playwright install chromium` ไม่จำเป็น

`.chrome-test-profiles/` (ประมาณ 2 GB) เก็บ session ล็อกอินจริงไว้ให้ใช้ซ้ำ
**ห้าม sync ข้ามเครื่องหรือขึ้น cloud ใดๆ** ทั้งเรื่องขนาดและ PDPA — เครื่องใหม่ต้องล็อกอินสร้างเอง
(`npm run doctor` ตรวจ Chrome ให้แล้ว)

## 9. กับดักเทสต์ UI ที่ mount หลาย view พร้อมกัน

หน้าที่มีหลายแท็บอาจ mount ทุก view ไว้พร้อมกันแล้วซ่อนด้วย CSS
⇒ selector ที่ไม่ระบุขอบเขตจะเจอ element ของแท็บที่มองไม่เห็นด้วย ทำให้เทสต์ผ่าน/ไม่ผ่านผิดความจริง

**กติกา:** จำกัดขอบเขต selector ให้อยู่ในแท็บที่กำลังทดสอบเสมอ
อย่าใช้ `page.getByText(...)` ลอยๆ กับหน้าที่มีหลายแท็บ

## 10. Migration ผ่าน MCP: version ไม่ตรงชื่อไฟล์

Supabase MCP `apply_migration` บันทึก `supabase_migrations.schema_migrations.version`
เป็น timestamp **ปัจจุบันจริง** ไม่ใช่ prefix ของชื่อไฟล์ (ซึ่งในรีโปนี้มักตั้งล่วงหน้า)

ทำให้ (1) `supabase db push` มองว่าไฟล์ยังไม่เคย apply แล้วยิงซ้ำ
(2) ถ้าแก้ชื่อไฟล์ให้ตรงกับ version ที่ระบบใส่ ไฟล์จะไปเรียงก่อน migration ที่มันต้องพึ่งพา
เวลา rebuild ฐานใหม่ ของเก่าจะเขียนทับของใหม่ (เคยทำให้เวอร์ชันที่มีช่องโหว่กลับมาทับตัวที่แก้แล้ว)

**กติกา:** apply เสร็จให้ UPDATE version ใน history ให้ตรง prefix ชื่อไฟล์ทันที
**ห้ามแก้ชื่อไฟล์ให้ตรงกับ history**
```sql
update supabase_migrations.schema_migrations
   set version = '<prefix ของชื่อไฟล์>'
 where version = '<ที่ระบบใส่>' and name = '<name>';
```

## 11. apply migration ทีละไฟล์เมื่อไม่มี MCP

Supabase CLI ติดตั้งอยู่แล้วและ auth ค้างใน Windows Credential Manager
(ไม่มีไฟล์ access token ให้อ่าน และ **ไม่ควร** พยายามดึงออกมา)

```bash
npx supabase db query --linked --project-ref <ref> -f <path/to/file.sql>
```
- ต้องใส่ `--linked` คู่กับ `--project-ref` เสมอ ใส่ `--project-ref` เดี่ยวๆ จะได้
  `LegacyDbQueryMutuallyExclusiveFlagsError`
- รันเป็น transaction เดียวผ่าน Management API ใช้ได้ทั้ง preflight และ apply จริง
- ต้องบันทึก `schema_migrations` เอง (ดูข้อ 10)
- คำสั่งที่ **เขียน** DB ต้องหยุดขออนุญาตผู้ใช้ก่อนเสมอ ห้ามหาทางอ้อม

## 12. อย่า INSERT ลง `auth.users` ตรงๆ

Seed ชุดเก่าเคย INSERT ลง `auth.users` โดยปล่อยช่อง token เป็น `NULL`
GoTrue เขียนด้วย Go และ map คอลัมน์พวกนั้นเป็น `string` ไม่ใช่ nullable
⇒ **แถวเดียวที่เป็น NULL ทำให้อ่านพังทั้งคิวรี** ไม่ใช่แค่แถวนั้น

อาการ: `auth.admin.listUsers()` ตอบ `Database error finding users`
ทั้งที่ service_role key ถูกต้อง (คีย์ผิดจะได้ `Invalid API key` ซึ่งคนละข้อความ)
และหน้า Dashboard > Authentication > Users ก็พังไปด้วย

**กติกา:** สร้างผู้ใช้ผ่าน Admin API เท่านั้น ถ้าจำเป็นต้อง INSERT ตรงๆ
ช่อง token ทุกช่องต้องเป็นสตริงว่าง ไม่ใช่ `NULL`

## 13. RLS ที่กรองด้วย `assigned_to` ต้องมีคนเขียนค่านั้นเสมอ

`document_requests` เคยติดกับดักนี้เต็มๆ — policy `read document_requests`
ให้ role `staff` เห็นเฉพาะแถวที่ `assigned_to = auth.uid()` แต่ไม่มีอะไรในระบบ
เขียน `assigned_to` ตอนสร้างคำขอเลย (ต่างจาก `complaints` ที่มี trigger
`auto_assign_complaint` อ่าน `category_assignments` มาตั้งให้)

ผลคือ **deadlock ที่ไม่มีใครเห็น**: staff เปิดเมนูคำขอเอกสารแล้วเจอหน้าว่าง
ตลอดกาล ซึ่งแยกไม่ออกจาก "วันนี้ไม่มีงาน" ไม่มี error ไม่มี log
ทั้งที่จริงๆ คือ RLS กรองทิ้งทั้งหมด อยู่แบบนี้มาตั้งแต่ migration 20260802071000

**กติกา:** ก่อนเขียน policy ที่กรองด้วยคอลัมน์ความสัมพันธ์ (`assigned_to`,
`created_by`, `department_id`) ต้องตอบให้ได้ก่อนว่า *ใครหรืออะไรเป็นคนใส่ค่านั้น
และใส่ตอนไหน* ถ้าคำตอบคือ "ยังไม่มี" แปลว่า role นั้นจะไม่เห็นอะไรเลย
ให้ทำตัวเติมค่าไปพร้อมกันในชุดเดียว ห้าม merge policy ก่อนแล้วค่อยตามทำทีหลัง

กับดักซ้อน: หน้าเจ้าหน้าที่เคยยัด `assigned_to = ตัวเอง` ลงไปในทุกครั้งที่กด
เปลี่ยนสถานะ เพื่อให้ "มีค่าอะไรสักอย่าง" — กลายเป็นว่าใครกดคนสุดท้าย
แย่งงานจากคนเดิมเงียบๆ และดันคนเดิมออกจากสายตา RLS ไปด้วย
การมอบหมายต้องเป็น action ของตัวเอง ไม่ใช่ผลข้างเคียงของการกดปุ่มอื่น

## 14. PostgREST คืนไม่เกิน 1,000 แถวต่อคำสั่ง แล้วตัดเงียบๆ

Supabase ตั้ง `max_rows = 1000` ให้ PostgREST — select ที่ผลเกินนี้ได้แค่ 1,000 แถวแรก
**ไม่มี error ไม่มีคำเตือน** `data.length` ดูปกติทุกอย่าง

เคยทำให้ Edge Function แจ้งเตือนส่งข้อความผิดเข้ากลุ่ม Telegram จริง: ดึงข้อมูลตรวจวัดของทุกสถานี
ย้อน 3 วันในคำสั่งเดียวได้ 2,016 แถว แถวเก่าที่ใช้เทียบกับ "เมื่อวาน" ถูกตัดหายทั้งหมด
แล้วโค้ดตีความว่า "ไม่มีค่าก่อนหน้า = เพิ่งเกิดเหตุ"

**กติกา:**
- query ที่จำนวนแถวโตตามจำนวน อปท./สถานี/วัน ต้องดึงทีละหน้าด้วย `.range()` แล้วเทียบกับ
  `count: 'exact'` ได้ไม่ครบให้หยุดและตอบ error (ตัวอย่าง `fetchReadings` ใน `water-alert-notify`)
- เลื่อนหน้าตามจำนวนแถวที่ได้จริง ไม่ใช่ขนาดหน้าที่ขอ และเรียงด้วยคีย์ที่ไม่ซ้ำ
- ตัวจำลองหรือ mock ของ Supabase ต้องจำลองเพดานนี้ด้วย ไม่งั้นเทสต์ผ่านแต่ของจริงพัง
- กติกาสำรองแบบ "ไม่มีข้อมูล = ถือว่าเข้าเงื่อนไข" อันตรายเสมอ เพราะสิ่งที่จุดชนวนมันคือ
  ความผิดพลาดของระบบเราเอง ไม่ใช่เหตุการณ์จริง
- หยุดแล้วตอบ error ต้องมีคนได้ยิน: งานอัตโนมัติลงสมุด `job_heartbeats` ทุกรอบ
  ให้ `thaiwater-watchdog` เฝ้า ไม่งั้น error ก็เงียบเท่ากับไม่มีตัวกัน

---

## 15. Supabase ตัดบริการทั้งโปรเจกต์ (HTTP 402) เพราะ Cached Egress เกินโควตาแผนฟรี

**เหตุการณ์จริง 2026-10-04:** ทุกเว็บ (ทั้ง 4 อปท.) ขึ้น "ไม่พบหน่วยงานรหัส …" ทั้งที่หน่วยงานอยู่ครบ — Supabase
ตอบ **402** ทั้ง REST/Auth/Storage (`exceed_cached_egress_quota`, ใช้ 7.4 จาก 5 GB ในรอบบิลเดียว)
ต้นเหตุ: แบนเนอร์หน้าแรกถูกโหลดครบทุกใบทุกครั้งที่เปิดเว็บ และแบนเนอร์เป็น PNG ที่อัปโหลดมาโดยไม่ย่อ
(ใบเดียวหนัก 4.72 MB) แก้ใน #416 (โหลดทีละใบ) + ย่อไฟล์ + ด่านกลางตามข้างล่าง

**ข้อเท็จจริงที่ต้องรู้ (ตรวจแล้ว):**
- โควตาแผนฟรีเป็นของทั้ง **organization** ไม่ใช่รายโปรเจกต์ — org นี้มีโปรเจกต์อื่นอยู่ด้วย ใช้โควตาร่วมกัน
- ตัวเลข "พื้นที่เก็บ" (Storage Size) กับ "ทราฟฟิก" (Cached Egress) เป็นคนละโควตา ไฟล์ 10 MB ที่ถูกโหลดซ้ำพันครั้ง
  ทะลุเพดานได้ทั้งที่พื้นที่เก็บใช้ไม่ถึง 30%
- รูปที่อัปโหลดขึ้น Google Drive **ไม่ได้ฟรีจากโควตา Supabase**: ระบบส่งรูปผ่าน Edge Function `drive-file`
  (เพราะ hotlink Drive ตรงโดน ORB/หน้าเลือกบัญชี) จึงกิน Edge Function invocations (500k/เดือน) และ Egress (5 GB)
  ฝั่งนี้ตั้ง Cache-Control 1 ปี immutable ไว้แล้ว ผู้ใช้เครื่องเดิมไม่โหลดซ้ำ

**วิธีตรวจเร็ว:** `curl -s -o /dev/null -w "%{http_code}" "<SUPABASE_URL>/rest/v1/" -H "apikey: <anon>"` — 402 = โดนตัด
(401 ตอนไม่ใส่ key เป็นเรื่องปกติ) · `/manifest.webmanifest` ของเว็บจะ 404 ทุก tenant เป็นอาการคู่กัน
เพราะ Worker ดึง tenant จาก Supabase ไม่ได้ · ปลดทันทีได้ทางเดียวคืออัปเกรดแผน (เสียเงิน — เจ้าของตัดสินใจเอง)
ไม่งั้นรอรอบบิลถัดไป

**กติกา:**
- รูปที่แสดงบนหน้าสาธารณะ (bucket ใน `PUBLIC_IMAGE_BUCKETS`) ที่หนักเกิน 500 KB ถูกย่อเป็น JPEG ด้านยาว ≤1600 px ก่อนอัปโหลด
  — บังคับที่ `uploadFile()` ใน `src/lib/driveStorage.js` จุดเดียวผ่าน `limitPublicImage` → `shrinkPhoto` (`src/lib/imageUtils.js`)
  ห้ามเอา bucket เอกสาร (payment-slips, official-documents, document-certs, org-documents, fleet-documents) เข้า
  `PUBLIC_IMAGE_BUCKETS` เพราะบีบแล้วตัวหนังสือในสแกนอ่านไม่ออก
- `shrinkPhoto` ไม่ขยายรูป, คืนไฟล์เดิมเมื่อประหยัดไม่ถึง 15% / ภาพมีส่วนโปร่งใส / ถอดรหัสไม่ได้ · ห้ามใช้ `compressImage`
  แทน: มันส่ง maxPx เป็น "ความกว้าง" ให้ createImageBitmap ขยายรูปแคบ (1200x2112 → 1600x2816 ไฟล์ใหญ่ขึ้น 139 → 322 KB)
  และรูปแนวตั้งด้านยาวเกิน (3000x4000 → 1600x2134) · ไฟล์จริงน้ำเลา: แบนเนอร์ 1.3–4.8 MB → 139–349 KB, หัวเว็บ 1,088 → 98 KB
- **โลโก้ ไอคอนแอป QR ต้องส่ง `keepFormat: true`** ให้ `uploadFile` (มีเทสต์กัน 3 จุดใน SystemSettingsAdmin.jsx) ไม่งั้นถูกแปลงเป็น JPEG
  — โลโก้ผูกกับไอคอนแอป PWA · รูปถ่ายหน้าตั้งค่าเข้ารหัส JPEG ผ่าน `PHOTO_JPEG` · ห้ามส่งไฟล์ดิบ (`file` จาก input) ตรงๆ
- คอมโพเนนต์สไลด์/แกลเลอรีต้องไม่ใส่ `<img>` ของทุกใบลง DOM พร้อมกัน (opacity 0 ไม่ได้หยุดการดาวน์โหลด) —
  ดู `slideIndexesToLoad` ใน `src/lib/bannerSlides.js`
- ก่อนอัปโหลดไฟล์เข้า Supabase Storage ด้วยมือ ใช้ชื่อไฟล์ใหม่เสมอ (ไม่ทับ) เพื่อย้อนกลับได้
- ตัวเลขโควตา (Free): Cached Egress 5 GB · Egress 5 GB · Edge Function 500k ครั้ง · Storage 1 GB · DB 500 MB ·
  Log Ingestion 1 GB (เริ่มบังคับต้นปี 2570) — ตรวจที่ Dashboard → Organization → Usage ก่อนกลับมาแผนฟรีเสมอ
  เกณฑ์ที่ใช้: Cached Egress เฉลี่ยต่อวันต้องต่ำกว่า ~0.11 GB (เผื่อ 30% ใต้เพดาน)
- `supabase db query --output-format json` escape ตัว `&` เป็นรหัส unicode (backslash ตามด้วย u0026) — ดึง URL ออกมา curl ต้อง JSON.parse ก่อน
  ไม่งั้นได้ 404 หลอก
- เทสต์: `npm run test:banner` และ `npm run test:image-guard`
