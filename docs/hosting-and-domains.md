# การ host และโดเมนของ SmartLocal

## สรุปสถานะ

| | เดิม | ใหม่ |
| --- | --- | --- |
| host | Vercel Hobby, 4 โปรเจกต์จาก repo เดียว | Cloudflare Workers, deployment เดียว |
| แยก อปท. | ชื่อโปรเจกต์ `smartlocal-{slug}.vercel.app` | subdomain ของโดเมนตัวเอง |
| build ต่อการ push | 4 ครั้ง (เพดาน 100/วัน) | 1 ครั้ง (เพดาน 500/เดือน) |
| ใช้เชิงพาณิชย์ | **ห้ามตามเงื่อนไข** | ไม่มีข้อห้าม |

Vercel ถูกเก็บไว้เป็นทางถอยระหว่างย้าย ยังไม่ลบ `vercel.json` กับ `api/`

---

## ทำไมต้องย้ายออกจาก Vercel

### 1. แผน Hobby ห้ามใช้เชิงพาณิชย์

> As stated in the fair use guidelines, the Hobby plan restricts users to
> **non-commercial, personal use only**.
> — <https://vercel.com/docs/plans/hobby>

SmartLocal กำลังจะขายให้ อปท. การขายแล้วยัง host บนแผนนี้ = ผิดเงื่อนไขที่เขียนไว้ชัด
Vercel มีสิทธิ์ระงับบัญชี และเพราะทั้ง 4 โปรเจกต์อยู่บัญชีเดียวกัน **จะดับพร้อมกันหมด
รวมน้ำเลาที่มีคำร้องจริงของประชาชน** สำหรับระบบที่ประชาชนใช้ยื่นเรื่องกับราชการ
นี่เป็นความเสี่ยงระดับที่รับไม่ได้ ส่วนแผน Pro ราคา 20 USD ต่อผู้ใช้ต่อเดือน
ซึ่งขัดนโยบายไม่มีค่าใช้จ่ายของโครงการ

### 2. โควตา build ไม่ scale ตามจำนวนลูกค้า

Hobby ให้ 100 deployment ต่อวัน และทุกโปรเจกต์ build จาก push เดียวกัน
จำนวนครั้งที่ push ได้ต่อวันจึงเท่ากับ 100 ÷ จำนวน อปท. — ขายได้มากขึ้นเท่ากับ
แก้โค้ดได้น้อยลง ซึ่งกลับหัวกลับหาง

**เกิดขึ้นจริงแล้ว** 28 ส.ค. 2569: ทำ PR #29–#33 ติดกันในวันเดียวจนชนเพดาน
คอมมิตที่ merge แล้ว (`d6c1c57` — แถบบอกตัวตนเจ้าหน้าที่ + ออกจากระบบอัตโนมัติ)
ขึ้น production ไม่ได้ทั้งวัน เช็คขึ้น `failure` พร้อม `upgradeToPro=build-rate-limit`
ทั้ง 4 โปรเจกต์

## ทำไมถึงเลือก Cloudflare Workers

| ประเด็น | หลักฐาน |
| --- | --- |
| ใช้เชิงพาณิชย์ | Self-Serve Subscription Agreement ไม่มีข้อห้ามเรื่องนี้ |
| ไฟล์เว็บ (JS/CSS/รูป) | *"Requests to static assets are free and unlimited"* |
| โค้ดฝั่งเซิร์ฟเวอร์ | 100,000 ครั้ง/วัน · CPU 10 ms ต่อครั้ง |
| build | 500 ครั้ง/เดือน ไม่หารด้วยจำนวน อปท. |
| wildcard | Worker route `*.domain/*` รองรับในตัว |

⚠️ **ข้อควรระวังข้อเดียวที่เจอ** — §2.2.1(h) ของ Self-Serve Subscription Agreement
ห้าม *"process or collect personal or business credit card information on any web
property that is receiving Free Services"* ตอนนี้ไม่กระทบเพราะ SmartLocal ไม่รับชำระเงิน
**แต่ถ้าวันหน้าจะทำระบบชำระค่าธรรมเนียม/ภาษีออนไลน์ให้ อปท. ต้องกลับมาทบทวนข้อนี้ก่อน**

---

## สถาปัตยกรรม

### ทำไมไม่ต้องแก้โค้ดแอปเลย

ทั้งสามชั้นอ่าน slug จาก subdomain อยู่แล้วและสอดคล้องกัน

| ชั้น | ที่อยู่ | พฤติกรรมกับ custom domain |
| --- | --- | --- |
| client | `detectTenantSlug()` ใน [`../src/contexts/TenantContext.jsx`](../src/contexts/TenantContext.jsx) | คืน `parts[0]` |
| server | `detectSlug()` ใน [`../worker/index.js`](../worker/index.js) | ตรรกะเดียวกัน |
| router | `computeBasename()` ใน [`../src/lib/basename.js`](../src/lib/basename.js) | คืน `''` |

`namlao.example.com` → slug `namlao` ทันที ไม่ต้องตั้ง env var ไม่ต้องแก้อะไร
และแต่ละ อปท. ยังได้ origin ของตัวเอง จึงแยก PWA / session / localStorage
เหมือนตอนใช้ `smartlocal-{slug}.vercel.app` ทุกประการ

### การ route ของ Workers

- `dist/` ถูก serve เป็น static asset → **ฟรี ไม่นับโควตา ไม่เรียก Worker**
- [`../scripts/postbuild.js`](../scripts/postbuild.js) เปลี่ยนชื่อ `dist/index.html`
  เป็น `_template.html` ทุก route ของ SPA จึงไม่ตรงกับไฟล์ไหน
- `not_found_handling: "none"` ทำให้ request ที่ไม่ตรงกับ asset ตกไปที่ Worker
- Worker ดึง shell ด้วย `env.ASSETS.fetch()` แล้วฉีด `<title>` กับ og: tag
  ด้วย `HTMLRewriter`

> **ห้ามตั้ง `run_worker_first: true`** ใน [`../wrangler.jsonc`](../wrangler.jsonc)
> จะทำให้ทุกไฟล์ JS/CSS/รูปวิ่งผ่าน Worker เผาโควตา 100,000 ครั้ง/วันทิ้ง
> และเสียข้อดี "static asset ฟรี" ไปทั้งหมด

### กับดักที่เจอตอนพอร์ต: ชื่อตัวแปรทับ tenant

`wrangler dev` **ดูด `.env.local` เข้ามาเป็น env ให้อัตโนมัติ** และในไฟล์นั้นมี
`VITE_TENANT_SLUG=namlao` อยู่ (ไว้ให้ Vite dev server กับ build ของ Capacitor)
ถ้า Worker อ่านชื่อเดียวกันแล้ววันหนึ่งค่านั้นหลุดขึ้น production
**ทุก อปท. จะถูกฉีด og:tag เป็นน้ำเลาหมดโดยไม่มีอะไรฟ้อง**

Worker จึงใช้ชื่อ `DEV_TENANT_SLUG` ที่ชนกันไม่ได้ตั้งแต่แรก
ทดสอบในเครื่องด้วย `npx wrangler dev --var DEV_TENANT_SLUG:thungkaew`

### กับดักเดียวกันฝั่ง client — เกิดขึ้นจริงแล้ว 2026-08-28

การป้องกันข้างบนดักไว้แค่ฝั่ง Worker **ฝั่ง client โดนเหมือนกันและหนักกว่า**
เพราะ Vite ฝังค่า env ลงบันเดิล **ตอน build** ไม่ใช่ตอนรัน

`detectTenantSlug()` เดิมเช็ค `import.meta.env.VITE_TENANT_SLUG` เป็นเงื่อนไขแรก
พอเปลี่ยนจาก build บน CI ของ Vercel (ไม่มี `.env.local` เพราะถูก gitignore)
มาเป็น `npm run cf:deploy` ที่ build ในเครื่อง minifier เห็นว่า `if` ข้อแรก
เป็นจริงเสมอ จึงลบตรรกะอ่าน hostname ทิ้งทั้งก้อน เหลือ

```js
function detectTenantSlug(){ return "namlao" }
```

ผลคือ **ทุก อปท. แสดงข้อมูลของน้ำเลา ซึ่งเป็นคำร้องจริงของประชาชน**

**ตรวจจากภายนอกไม่เห็นเลย** เพราะฝั่ง SSR อ่าน hostname ตรงๆ `<title>` กับ og:tag
จึงถูกต้องทุกโดเมน ผิดเฉพาะตอน React บูตขึ้นมา — curl ทดสอบเท่าไรก็ผ่านหมด

แก้แล้วโดยสลับลำดับ: **hostname มาก่อน env var เสมอ** และค่าที่ฝังตอน build
ใช้ได้เฉพาะเมื่อ `hostname` เป็น `localhost`/`127.0.0.1` เท่านั้น

**เช็คก่อน deploy ทุกครั้ง** — คำสั่งนี้ต้องไม่คืนอะไร

```bash
grep -oE 'function [A-Za-z0-9_$]+\(\)\{return`[a-z]+`\}' dist/assets/index-*.js
```

และพึงระลึกว่า **ทุกค่าใน `.env.local` ถูกฝังลงบันเดิลตอน build ในเครื่อง**
ไม่ใช่แค่ tenant slug — ถ้าค่าในเครื่องต่างจากที่ควรใช้บน production
จะฝังค่าผิดโดยไม่มีอะไรฟ้อง (ตรวจแล้ว 2026-08-28: Google Maps, Supabase anon
และ VAPID key ตรงกับที่ Vercel ใช้)

---

## ขั้นตอนที่ต้องทำในบัญชี (ทำจาก repo ไม่ได้)

1. **จดโดเมนที่ Cloudflare Registrar** — DNS มาอยู่ที่ Cloudflare อัตโนมัติ
   ซึ่งเป็นเงื่อนไขที่ wildcard ต้องการอยู่แล้ว
2. **`wrangler deploy`** แล้วทดสอบบน `*.workers.dev` ก่อน
3. **เพิ่ม DNS record `*` แบบ proxied + Worker route `*.โดเมน/*`**
4. **ทดสอบครบทั้ง 4 อปท.** — ชื่อ/โลโก้/สีถูกต้อง และแชร์ลิงก์ลงไลน์แล้ว
   og:title ขึ้นชื่อ อปท. ถูก
5. ⚠️ **Supabase → Authentication → URL Configuration**
   เพิ่ม `https://*.โดเมน/**` ใน Redirect URLs และแก้ Site URL
   **ลืมข้อนี้ = เข้าสู่ระบบด้วย Google/LINE พังทั้งระบบบนโดเมนใหม่**
   (ฝั่ง Google/LINE console ไม่ต้องแก้ เพราะชี้ที่ callback ของ Supabase ซึ่งไม่เปลี่ยน)
6. **ตั้ง redirect ของ apex กับ www** — ดูหัวข้อข้างล่าง
7. **สลับ DNS มาที่ Cloudflare** เมื่อทดสอบผ่านหมดแล้ว
8. **ปลด Vercel** — ทำทีหลังสุด ดูหัวข้อข้างล่าง

### apex กับ www จะขึ้นหน้า error ถ้าไม่ตั้ง redirect

| URL | `parts[0]` | ผลลัพธ์ |
| --- | --- | --- |
| `namlao.example.com` | `namlao` | ✅ ถูกต้อง |
| `example.com` (apex) | `example` | ❌ ไม่มี slug นี้ → "ไม่พบรหัสหน่วยงาน" |
| `www.example.com` | `www` (excluded) | ❌ ตกไปโหมด path → `null` → error เดียวกัน |

ต้องตั้ง redirect ที่ apex/www ไปหน้า อปท. ตัวอย่าง ไม่งั้นคนที่พิมพ์โดเมนเปล่าๆ
(รวมถึง อปท. ที่กำลังพิจารณาซื้อ) จะเจอหน้า error เป็นหน้าแรก

### ปลด Vercel (ทำเมื่อมั่นใจแล้วเท่านั้น)

ปลด 4 โปรเจกต์ออกจาก git แล้วลบ `vercel.json`, `api/` และบรรทัด `copyFileSync`
ใน `scripts/postbuild.js`

**อย่าลบ `smartlocal-namlao.vercel.app` จนกว่าจะแน่ใจว่าไม่มีใครถือลิงก์นั้น** —
คนน้ำเลาที่ติดตั้ง PWA ไว้ผูกกับ origin นั้น ต้องประกาศให้ย้ายมาโดเมนใหม่ก่อน
และตรวจด้วยว่ามีใครถือลิงก์ `smartlocal-app.vercel.app` (โหมด path) อยู่หรือไม่

---

## ซื้อโดเมนเดียวใช้ได้ทุก อปท.

`*.example.com` นับเป็น **domain เดียว** ทุก อปท. วิ่งผ่านตัวเดียวกัน
รับลูกค้ารายใหม่ = เพิ่มแถวใน `municipalities` ให้ `slug` ตรงกับ subdomain **จบ**
ไม่ต้องซื้อโดเมนเพิ่ม ไม่ต้องแตะ DNS ไม่ต้องเข้า Cloudflare

ยกเว้นกรณีเดียว: อปท. ที่อยากใช้โดเมนราชการของตัวเอง (เช่น `.go.th` ที่หลายแห่ง
มีอยู่แล้ว) อันนั้น อปท. เป็นคนจดเอง แล้วเอามาผูกเพิ่มเป็น custom hostname

## ยังค้างอยู่

- **การ deploy อัตโนมัติเมื่อ push** ยังไม่ได้ตั้ง (Workers Builds หรือ GitHub Actions)
  เพราะแตะ CI config ต้องขออนุมัติแยก ระหว่างนี้ deploy ด้วย `npm run cf:deploy` มือ
- **ค่าโดเมนรายปี** เป็นรายจ่ายเดียวที่เหลือ Cloudflare ขายราคาต้นทุนไม่บวกกำไร
  ต้องยืนยันราคา TLD ตอนจดจริง
- **Cloudflare ไม่มีบริการอีเมล** ถ้าต้องการ `info@โดเมน` ต้องต่อบริการอื่นด้วย MX record
