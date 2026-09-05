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
