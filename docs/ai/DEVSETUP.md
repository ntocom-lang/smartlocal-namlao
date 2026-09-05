# DEVSETUP.md — ทำงานต่อเนื่องข้ามเครื่อง

โปรเจกต์นี้ทำงานจาก **PC ที่บ้าน / โน้ตบุคที่ทำงาน / มือถือ** ตั้งแต่ 2026-09-05
โดย **ไม่มีเครื่องไหนเปิดค้างให้รีโมทเข้า** — git คือช่องทางเดียวที่งานข้ามเครื่องได้

```
โค้ด + ประวัติ      -> GitHub (public)   smartlocal-namlao
.env.local + memory -> GitHub (private)  smartlocal-devconfig
persona ของ AI      -> generate จาก docs/ai/CORE.md ในเครื่อง (npm run ai:sync)
deploy              -> GitHub Actions เมื่อ master ขยับ ไม่ใช่จากเครื่อง dev
```

---

## ⚠️ อ่านก่อนแตะอะไรบนเครื่องใหม่

**`npm run dev` ต่อ Supabase ตัวเดียวกับ production** ไม่มีฐานทดสอบแยก
กด "บันทึก" ทดสอบเล่นๆ = ข้อมูลจริงของ อปท. เปลี่ยนจริงทันที และทุกไซต์ที่ live เห็นผลทันที

ใช้ tenant `demo` (เทศบาลตำบลสาธิต) เป็นสนามซ้อมเท่านั้น
รายละเอียดกับดักอื่นๆ อยู่ใน [NOTES.md](./NOTES.md) — อ่านก่อนเริ่มงานจริง

---

## ตั้งเครื่องใหม่ (~30 นาที)

ส่วนใหญ่หมดไปกับการดาวน์โหลดตัวติดตั้ง ไม่ใช่ข้อมูลโปรเจกต์

| # | ขั้น | หมายเหตุ |
|---|---|---|
| 1 | ลง **Git**, **Node 24**, **Antigravity**, **Google Chrome** | Chrome จำเป็นสำหรับ E2E (ใช้ `channel: 'chrome'`) |
| 2 | ล็อกอิน GitHub (`gh auth login`) และ Antigravity/Claude | ทำด้วยมือ อัตโนมัติไม่ได้และไม่ควร |
| 3 | `git clone https://github.com/ntocom-lang/smartlocal-namlao.git` | **ห้าม clone ลง Desktop หรือ Documents** (ดูข้อห้ามข้างล่าง) |
| 4 | `git clone https://github.com/ntocom-lang/smartlocal-devconfig.git` | วางไว้ระดับเดียวกับโปรเจกต์หลัก |
| 5 | `npm ci` | ~745 MB |
| 6 | `npm run ai:sync` | สร้าง `~/.claude/CLAUDE.md` + `~/.gemini/GEMINI.md` ให้ AI ทุกตัว |
| 7 | `npm run env:pull` | ดึง `.env.local` จาก devconfig |
| 8 | `npm run memory:link -- ../smartlocal-devconfig` | ผูก memory ของ Claude |
| 9 | `npm run doctor` | ต้องผ่านทุกข้อก่อนเริ่มงาน |

**path ที่แนะนำ:** `C:\dev\smartlocal` — สั้น ไม่มีช่องว่าง ไม่ผูกกับไดรฟ์ที่อาจไม่มี
ไม่ต้องใช้ path เดียวกับเครื่องอื่น สคริปต์คำนวณให้เอง

## ลง Windows ใหม่ / ย้ายโฟลเดอร์

รันขั้น 3–9 ซ้ำ **ไม่มีอะไรผูกกับ path อีกแล้ว**
ถ้าแค่ย้ายโฟลเดอร์ (โปรเจกต์เดิม) รันแค่ `npm run memory:link` พอ

### ก่อนล้างเครื่องทุกครั้ง

1. **เก็บ recovery code ของ 2FA ไว้นอกเครื่อง** (กระดาษ หรือ password manager)
   — GitHub / Cloudflare / Supabase ถ้าเข้าไม่ได้เพราะ 2FA ผูกกับมือถือเครื่องเดียว **deploy ไม่ได้ทั้งระบบ**
   ห้ามเก็บใน repo ใดทั้งสิ้น รวมถึง devconfig
2. `npm run handoff` ให้แน่ใจว่างานทุกอย่างอยู่บน origin
3. `git -C ../smartlocal-devconfig status` ต้องสะอาด (memory กับ env ถูก push แล้ว)
4. `npm run doctor` ต้องไม่เตือนเรื่อง branch ที่ยังไม่ push

---

## กิจวัตรประจำวัน

```bash
# ก่อนเลิกงานที่เครื่องหนึ่ง
npm run handoff              # commit ของค้างทั้งหมด + push ขึ้น origin
git -C ../smartlocal-devconfig add -A && git -C ../smartlocal-devconfig commit -m "memory" && git -C ../smartlocal-devconfig push

# เริ่มงานที่อีกเครื่อง
npm run resume <branch>      # fetch + ff-only + pull devconfig + doctor
```

ตั้งตัวแปร `SMARTLOCAL_DEVCONFIG` ชี้ไปที่ repo devconfig แล้ว `resume` จะ pull ให้เอง

**`handoff` สร้าง commit ชื่อ `wip(handoff): <ชื่อเครื่อง> @ <เวลา>`** — ไม่ต้องกังวลว่าจะรก
ตอนเปิด PR ค่อย squash ทีเดียว

โหมด `--restore` คืน working tree ให้เหมือนตอน handoff เป๊ะ (ถอน commit wip ออก)
แต่ทำให้ branch ถอยหลังจาก origin ⇒ push ครั้งถัดไปต้อง force
สคริปต์จะปฏิเสธถ้า branch นั้นมี PR เปิดอยู่

---

## ทำอะไรได้ที่ไหน

| | PC / โน้ตบุค | มือถือ |
|---|---|---|
| เครื่องมือ | Antigravity (สลับ backend: Claude/GPT/Gemini/Grok) | `claude.ai/code` + GitHub app |
| แก้โค้ด | เต็มที่ | เฉพาะงานที่ตรวจได้ด้วยการอ่านโค้ด |
| `npm run dev` ดูของจริง | ✅ | ❌ sandbox ไม่มี `.env.local` |
| E2E / migration / DB | ✅ | ❌ ต่อ Supabase ไม่ได้ |
| deploy | ผ่าน CI (push/merge เข้า master) | กด merge ใน GitHub app |
| ส่งงานต่อ | `npm run handoff` / `npm run resume` | ไม่ต้อง — ทำงานบน branch/PR |

**บนมือถือ:** งานที่ต้องเห็นหน้าจอจริงหรือแตะ DB ให้รอเครื่องคอม
ไม่งั้นจะได้โค้ดที่ "ดูเหมือนถูก" แต่ไม่เคยรันจริง — รีวิว PR ที่แตะ DB บนคอมก่อน merge เสมอ

**ปรึกษาบนมือถือ** (แก้โค้ดไม่ได้ แต่ได้ persona เดียวกัน เพราะ persona ผูกกับบัญชีไม่ใช่เครื่อง):
Gemini Gem "SmartLocal SME" · ChatGPT Project · Grok
เนื้อหาสำหรับตั้งค่าอยู่ใน [web-snippets.md](./web-snippets.md)

---

## ข้อห้าม

| ห้าม | เพราะ |
|---|---|
| **clone ลง Desktop / Documents** | Windows 11 เปิด OneDrive backup โฟลเดอร์พวกนี้อัตโนมัติ → sync `node_modules` 745 MB แข่งกับ git → ไฟล์ล็อก, `.git/index` พัง, ได้ไฟล์ซ้ำชื่อ `xxx-DESKTOP-A1B2C3.js` |
| **deploy จากเครื่อง dev** | `.env.local` มี `VITE_TENANT_SLUG` ที่ vite ฝังลงบันเดิล ทำให้ทุก อปท. กลายเป็นตัวเดียวกัน (เกิดจริง) — `predeploy-check.js` บล็อกไว้แล้ว ฉุกเฉินใช้ `ALLOW_LOCAL_DEPLOY=1` |
| **`npm run handoff` บน master** | push เข้า master = deploy ขึ้น production ทันที — สคริปต์ปฏิเสธให้แล้ว |
| **ให้ agent เรียก `handoff`/`resume` เอง** | `[SAFETY]` ใน AGENTS.md ห้าม agent commit/push — ผู้ใช้ต้องรันเอง |
| **แก้ `AGENTS.md` / `.agents/rules/domain.md` / `web-snippets.md` ตรงๆ** | เป็นไฟล์ generated — แก้ที่ `docs/ai/CORE.md`, `DOMAIN.md`, `SAFETY.md` แล้วรัน `npm run ai:sync` |
| **เอา `.chrome-test-profiles/` ขึ้น cloud** | 2 GB + มี session ล็อกอินจริงของ อปท. (PDPA) — เครื่องใหม่ต้องล็อกอินสร้างเอง |
| **ใส่คีย์ฝั่ง server ใน `.env.local`** | ไฟล์นี้รับเฉพาะ `VITE_*` ที่ลงบันเดิลอยู่แล้ว — `service_role`, Cloudflare token ต้องอยู่ใน GitHub Secrets (`env:pull`/`env:push` บล็อกให้แล้ว) |
| **เปลี่ยน `smartlocal-devconfig` เป็น public** | มี memory ที่บันทึกช่องโหว่ที่ยังไม่ปิด — `memory:link` ตรวจ visibility ให้ก่อนย้ายไฟล์ |

---

## สิ่งที่ยังทำไม่ได้ (ยอมรับไว้ ไม่ใช่ของที่ลืมทำ)

- **งานที่รันค้าง** (dev server, watch, agent ที่กำลังทำงาน) ข้ามเครื่องไม่ได้ — ผลตรงจากการเลือกไม่เปิดเครื่องค้าง
- **Claude session (`--resume`)** ข้ามเครื่องไม่ได้ ข้ามได้แค่ memory — เครื่องใหม่ต้องเริ่ม session ใหม่โดยมี MEMORY.md ครบ
- **`.chrome-test-profiles/`** ต้องสร้างใหม่ทุกเครื่อง
- **Android/Capacitor build** ต้องติด toolchain แยกต่อเครื่อง
