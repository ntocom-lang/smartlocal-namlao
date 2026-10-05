# SmartLocal

ระบบบริการภาครัฐดิจิทัลสำหรับองค์กรปกครองส่วนท้องถิ่น (อบต./เทศบาล) ด้าน Smart Governance ให้ประชาชนยื่นเรื่อง ติดตามสถานะ และเข้าถึงข้อมูลของหน่วยงาน พร้อมเครื่องมือช่วยเจ้าหน้าที่จัดการงานและรายงานผล

รองรับหลายหน่วยงาน (multi-tenant) ด้วยโค้ดชุดเดียว โดยเลือกหน่วยงานจาก hostname บน production ส่วนโมดูลที่เปิดใช้และหน้าตาหน้าแรกขึ้นอยู่กับการตั้งค่าของแต่ละหน่วยงาน

## ความสามารถหลัก

| ส่วนงาน | ตัวอย่างการใช้งาน |
| --- | --- |
| บริการประชาชน | แจ้งเหตุ/แจ้งซ่อม ยื่นคำขอเอกสาร และติดตามเรื่องของตนเอง |
| งานเจ้าหน้าที่ | รับเรื่อง มอบหมายงาน ติดตามสถานะ และดูรายงาน |
| งานบริการและทรัพยากร | บริการประปา ตารางเก็บขยะ การใช้รถส่วนกลาง และการจองรถรับส่งผู้ป่วย |
| ข้อมูลสาธารณะ | ข่าว กิจกรรม สถานที่ท่องเที่ยว ข้อมูลแผนที่ สถานการณ์น้ำ และ PM2.5 |
| เอกสารและมือถือ | แบบพิมพ์ A4 และการติดตั้งเว็บเป็น PWA ตามความพร้อมของ browser |

ระบบช่วยเตรียมข้อมูลและทำงานตามกฎที่กำหนด การใช้ดุลพินิจ การลงนาม และการอนุมัติที่ต้องใช้อำนาจของเจ้าหน้าที่ ยังต้องให้ผู้มีอำนาจดำเนินการตามระเบียบของเรื่องนั้น

## อ่านก่อนรันหรือทดสอบ

> **localhost ไม่ใช่ฐานทดสอบแยก** การตั้งค่าของทีมต่อ Supabase ตัวเดียวกับ production การกดบันทึกในเครื่องจึงเปลี่ยนข้อมูลจริงได้ทันที ใช้ tenant `demo` และข้อมูลสมมติที่ติดป้าย `[TEST]` สำหรับการทดสอบ พร้อมล้างข้อมูลทดสอบเมื่อเสร็จ

- ห้ามนำข้อมูลส่วนบุคคลของประชาชน รหัสผ่าน หรือ secret มาใส่ใน repo ภาพตัวอย่าง หรือ log ที่เผยแพร่
- ตัวแปร `VITE_*` เป็นค่าฝั่ง browser ห้ามใส่ `service_role`, private key หรือ token ฝั่ง server
- ใช้เฉพาะขอบเขตฟรีที่ไม่ต้องผูกบัตรหรือเครื่องมือ Local ตามนโยบายงบ 0 บาท ห้ามเปิด paid plan หรือ pay-as-you-go
- อ่าน [กติกาความปลอดภัย](docs/ai/SAFETY.md) และ [กับดักทางเทคนิค](docs/ai/NOTES.md) ก่อนแตะฐานข้อมูลหรือ deploy

## เทคโนโลยี

| ส่วน | เทคโนโลยีใน repo |
| --- | --- |
| Runtime สำหรับพัฒนาและ CI | Node.js 24 ตาม [.nvmrc](.nvmrc) และ npm |
| Frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4 |
| Backend | Supabase: PostgreSQL, Auth, Storage, Realtime และ Edge Functions |
| Hosting | Cloudflare Workers และ static assets |
| แผนที่และกราฟ | Leaflet และ Recharts |
| ตรวจสอบ | ESLint, Node.js tests และ Playwright |

เวอร์ชันและคำสั่งทั้งหมดอยู่ใน [package.json](package.json) ใช้ `npm ci` เพื่อติดตั้งตาม [package-lock.json](package-lock.json) การดูแลใช้บริการเดิมภายในโควตาฟรี ซึ่งมีข้อจำกัดด้านปริมาณใช้งาน ทีมยังต้องดูแล dependency สิทธิ์เข้าถึง และการสำรองข้อมูล

## เริ่มพัฒนาในเครื่อง

ต้องมี Git, Node.js 24 และ npm สำหรับ browser tests ต้องมี browser ตามที่ test นั้นกำหนด รายละเอียดการตั้งเครื่องและทำงานข้ามเครื่องอยู่ใน [DEVSETUP.md](docs/ai/DEVSETUP.md)

### 1. รับ source code

เลือกโฟลเดอร์ที่ไม่อยู่ใน OneDrive เช่น หลีกเลี่ยง Desktop และ Documents

```powershell
git clone https://github.com/ntocom-lang/smartlocal-namlao.git
cd smartlocal-namlao
git fetch origin master
```

ถ้ามี repo อยู่แล้ว ให้เปิดทรีหลักและรันเฉพาะ `git fetch origin master`

### 2. สร้าง worktree สำหรับงานของตนเอง

ทำงานใน worktree แยกจาก `origin/master` ไม่แก้หรือสลับสาขาในทรีหลัก และไม่แตะไฟล์ที่ session อื่นแก้ค้างไว้ เปลี่ยนชื่อ worktree และ branch ให้ตรงกับงานแต่ละชิ้น

```powershell
git worktree add "D:/tmp/wt-smartlocal" -b codex/my-task origin/master
cd "D:/tmp/wt-smartlocal"
npm ci
```

เครื่องที่ไม่มีไดรฟ์ D: ให้ใช้ `C:/dev/wt-smartlocal` แทน

### 3. ตั้งค่า environment ใน worktree

ใช้ [.env.example](.env.example) เป็นรายการอ้างอิง แล้วให้ผู้ดูแลที่ได้รับสิทธิ์จัดเตรียม `.env.local` ใน worktree ค่าจริงต้องรับจากช่องทางของทีม ไม่ใส่ลงใน README หรือ commit ขึ้น repo

| ตัวแปร | ใช้สำหรับ |
| --- | --- |
| `VITE_SUPABASE_URL` | URL ของ Supabase project ที่ได้รับอนุญาต |
| `VITE_SUPABASE_ANON_KEY` | คีย์ anon ฝั่ง browser โดยยังต้องควบคุมสิทธิ์ด้วย RLS |
| `VITE_TENANT_SLUG` | เลือกหน่วยงานบน localhost ใช้ `demo` สำหรับการทดสอบ |

**อย่าคัดลอกค่า tenant แล้วทดสอบทันที:** `.env.example` ระบุ `namlao` ต้องเปลี่ยนเป็น `demo` และตรวจชื่อหน่วยงานบนหน้าจอก่อนทดสอบการบันทึกทุกครั้ง

worktree ใหม่ไม่มี `.env.local` ติดมาด้วย หากไม่ตั้งค่า Supabase แอปจะแจ้งว่าขาด environment และ build อาจไม่ผ่านการตรวจของ `postbuild`

### 4. รันเว็บ

```powershell
npm run dev
```

เปิด URL ที่ Vite แสดงใน terminal การแก้ source code จะอัปเดตหน้าจอผ่าน HMR

หากต้องการตรวจไฟล์ build ในเครื่อง ให้รันจาก worktree ที่ตั้งค่า environment แล้ว:

```powershell
npm run build
npm run preview
```

คำสั่งนี้สร้างไฟล์ใน `dist/` และเปิด preview ในเครื่อง ไม่ใช่การ deploy และหน้า preview ยังเชื่อมต่อฐานข้อมูลตาม environment ที่ใช้ตอน build

## ตรวจสอบก่อนส่งงาน

| คำสั่ง | ตรวจอะไร |
| --- | --- |
| `npm run lint:blocking` | ข้อผิดพลาด ESLint ที่เป็นด่านบล็อกของโปรเจกต์ |
| `npm run lint` | ESLint ทั้ง repo อาจพบข้อผิดพลาดเดิมที่ต้องแยกจากงานปัจจุบัน |
| `npm run check:uniform` | ความสอดคล้องของ backend ทุกหน่วยงาน และอ่านการเปิดโมดูลจาก DB เมื่อมี environment |
| `npm run ai:check` | เอกสารกติกาที่ generate ตรงกับต้นฉบับหรือไม่ |
| `git diff --check` | ช่องว่างและรูปแบบ diff ที่ผิดปกติ |

เลือก tests ที่เกี่ยวข้องกับงานจาก `package.json` ก่อนรันให้ตรวจว่า test เป็น Local หรือเชื่อมต่อระบบจริง คำสั่ง E2E ที่มี `:write` หรือ `:cleanup` สามารถเปลี่ยนข้อมูลได้ ต้องใช้ Demo และสิทธิ์ที่ได้รับอนุญาตเท่านั้น ดู [แนวทางทดสอบตามบทบาท](docs/testing/TEST_ROLE_MATRIX.md)

## Deploy

ทางหลักคือ **PR → ผู้ดูแล merge เข้า `master` → GitHub Actions build และ deploy ขึ้น Cloudflare Workers** ตาม [deploy workflow](.github/workflows/deploy.yml) โดยใช้ environment ที่ผู้ดูแลตั้งไว้ใน GitHub Secrets

- CI ตรวจความสอดคล้องของ backend และกันบันเดิลที่ตั้ง `VITE_TENANT_SLUG` ก่อน deploy
- ห้ามนำ build จากเครื่องพัฒนาขึ้น production ตามปกติ เพราะ `.env.local` มีค่าที่ใช้ทดสอบเฉพาะเครื่อง
- การแก้เฉพาะ Markdown, `docs/` หรือ `supabase/` ถูกยกเว้นจากการ deploy อัตโนมัติ การ merge migration จึงไม่ได้ apply ฐานข้อมูลให้
- แยกตรวจและอนุมัติ migration ก่อน apply อย่าสั่งรวมทั้งหมดโดยยังไม่ตรวจประวัติฐานข้อมูล
- หลัง deploy ให้ตรวจผล CI และ smoke test ด้วย `npm run test:smoke` รวมถึงตรวจพฤติกรรมจริงของฟีเจอร์ที่เปลี่ยน

Agent ต้องขออนุญาตก่อน commit/push และไม่มีสิทธิ์ merge หรือ deploy เองจากคำสั่งให้แก้ไฟล์เพียงอย่างเดียว รายละเอียด hosting อยู่ใน [hosting-and-domains.md](docs/hosting-and-domains.md)

## โครงสร้างโครงการ

```text
src/                 หน้าเว็บ components, contexts และ utilities
public/              ไฟล์ static และฟอนต์
worker/              Cloudflare Worker และการให้บริการเว็บ
supabase/functions/  Edge Functions
supabase/migrations/ SQL migrations
scripts/             เครื่องมือตรวจสอบ build และจัดการงานพัฒนา
tests/               Unit, browser, workflow และ layout tests
docs/                คู่มือและบันทึกทางเทคนิค
```

## เอกสารสำหรับผู้ดูแลและผู้พัฒนา

- [AGENTS.md](AGENTS.md) — กติกาการทำงานของ agent อ่านก่อนลงมือ
- [การตั้งเครื่องและส่งงานข้ามเครื่อง](docs/ai/DEVSETUP.md)
- [ต้นฉบับและวิธี sync กติกา AI](docs/ai/README.md) — ห้ามแก้ไฟล์ generated โดยตรง
- [กับดักทางเทคนิคที่เคยเกิดขึ้น](docs/ai/NOTES.md)
- [Hosting และโดเมน](docs/hosting-and-domains.md)
- [มาตรฐานเอกสารราชการ](src/lib/govDocStyle.js) และ [ช่องลงนาม](src/lib/govSignBlock.js) — ใช้ร่วมกันสำหรับแบบพิมพ์ตามกติกาของโครงการ

README นี้อธิบายโครงสร้างและขั้นตอนทำงาน ไม่ได้ยืนยันว่าทุกโมดูลเปิดใช้ในทุกหน่วยงาน หรือว่าแบบพิมพ์ทุกใบผ่านการรับรองตามระเบียบ ผู้ดูแลต้องตรวจการตั้งค่าและข้อกำหนดของงานที่จะใช้งานจริง
