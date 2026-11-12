# AI Instructions — Single Source of Truth

**โครงสร้าง 4 ไฟล์ต้นฉบับ (แก้ได้เฉพาะ 4 ไฟล์นี้):**
- `docs/ai/CORE.md` = **หลักการสากล** ใช้ได้ทุกโปรเจกต์ทุกสายงาน (ไม่มีชื่อโดเมนเฉพาะ)
- `docs/ai/DOMAIN.md` = **ความเชี่ยวชาญเฉพาะโปรเจกต์นี้** (Smart City ภาครัฐไทย) — มีเฉพาะโปรเจกต์นี้เท่านั้น
  โปรเจกต์อื่นที่ไม่ใช่สายงานนี้ ให้สร้าง `docs/ai/DOMAIN.md` ของตัวเองแยกต่างหาก ไม่ต้องแก้ CORE.md
- `docs/ai/SAFETY.md` = กติกาสำหรับ agent ที่แก้ไฟล์ในเครื่องได้ (IDE/CLI) — ไม่ sync ไปฝั่งเว็บ
- `docs/ai/ADAPTERS.md` = ส่วนต่างเฉพาะเครื่องมือที่ต้องออกที่ไฟล์ global (ตอนนี้มี Claude: เลือกรุ่นและ effort,
  Antigravity: แนะนำรุ่นของ agent, Codex)
- `docs/ai/claude/` = ค่าตั้ง Claude Code (`settings.json` รุ่น/effort เริ่มต้น + `agents/*.md` subagent) — ไม่ใช่ข้อความ instruction

**ปลายทางทั้งหมดถูก generate โดย `scripts/ai-sync.mjs` — ห้ามแก้ไฟล์เหล่านี้ตรงๆ:**

| ปลายทาง | เนื้อหา | ใครอ่าน |
|---|---|---|
| `AGENTS.md` (root) | CORE + DOMAIN + SAFETY + มาตรฐานการพิมพ์ | Claude Code (ผ่าน `CLAUDE.md`) และเครื่องมือที่อ่าน AGENTS.md |
| `.agents/rules/domain.md` | DOMAIN ทั้งไฟล์ (รวมมาตรฐานการพิมพ์) | Antigravity — Workspace Rules |
| `~/.claude/CLAUDE.md` | CORE ล้วน **ไม่มี DOMAIN** + `[Adapter — Claude: เลือกรุ่นและ effort]` | Claude Code ทุกโปรเจกต์ (global) ทั้ง extension ใน VS Code และใน Antigravity |
| `~/.claude/settings.json` | merge เฉพาะ `model` / `effortLevel` / `maxEffortLevel` / `modelSettings` (ทีละรุ่น) จาก `docs/ai/claude/settings.json` คีย์อื่นของเครื่องคงไว้ | Claude Code |
| `~/.claude/agents/*.md` | คัดลอกจาก `docs/ai/claude/agents/` | Claude Code (subagent ที่ตั้งรุ่น/effort ในตัว) |
| `~/.gemini/GEMINI.md` | CORE ล้วน **ไม่มี DOMAIN** + `[Adapter — Antigravity: แนะนำรุ่นของ agent]` | Antigravity — Global Rules ทุก backend (Claude/GPT/Gemini/Grok) |
| `~/.codex/AGENTS.md` | CORE ล้วน **ไม่มี DOMAIN** + `[Adapter — Codex]` | Codex (CLI / cloud / IDE extension) ทุกโปรเจกต์ (global) |
| `docs/ai/web-snippets.md` | CORE + DOMAIN เฉพาะหัวข้อใน `WEB_DOMAIN_KEYS` (ตอนนี้ `[ระบบอัจฉริยะ ...]`) + Adapter รายเว็บ · สคริปต์กันบล็อกยาวเกิน 11,500 ตัวอักษร | ต้นทางสำหรับ paste เข้า Gemini Gem / ChatGPT Project / Claude Project (paste เองทุกครั้งที่เปลี่ยน) |

**ไฟล์ที่ไม่ซ้ำเนื้อหา CORE.md (แก้มือได้ตามปกติ):** `CLAUDE.md`, `GEMINI.md` (root)
— มีแค่คำสั่งอ่าน `AGENTS.md` + `[Adapter]` เฉพาะตัว `ai-sync.mjs` ไม่แตะ 2 ไฟล์นี้

## วิธีใช้

```bash
npm run ai:sync     # แก้ต้นฉบับแล้วรันคำสั่งนี้คำสั่งเดียว จบทุกปลายทาง
npm run ai:check    # ตรวจอย่างเดียว ไม่เขียน — ต่างเมื่อไรคืน exit 1 (CI ใช้ตัวนี้)
```

- `ai:sync` สำรองไฟล์นอก git (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`) เป็น `.bak.<YYYYMMDD-HHMM>` ให้ก่อนเขียนทับเสมอ
- ไฟล์ที่อยู่ใน repo ไม่ต้องสำรอง เพราะ `git diff` / `git checkout` ย้อนได้อยู่แล้ว
- `.github/workflows/ai-docs-check.yml` รัน `ai:check --repo-only` ทุก push/PR
  (`--repo-only` เพราะ runner ไม่มีไฟล์ global 2 ตัว — ฝั่งนั้นตรวจด้วย `npm run doctor` บนเครื่อง dev)
- Codex อ่าน `AGENTS.md` ของรีโปเองอัตโนมัติ (มาตรฐาน AGENTS.md) ⇒ ฝั่งโปรเจกต์ไม่ต้องตั้งอะไรเพิ่ม
  ที่ต้อง generate คือ global `~/.codex/AGENTS.md` เพราะ **Codex ไม่อ่านไฟล์ชื่อ `CODEX.md`**
  adapter เฉพาะตัวมันจึงยัดลง `AGENTS.md` ไม่ได้ (จะไปกวน AI ตัวอื่นที่อ่านไฟล์เดียวกัน)
- **ตั้งเครื่องใหม่**: `git clone` แล้วรัน `npm run ai:sync` ครั้งเดียว AI ทุกตัวได้บริบทครบ
  ไม่ต้อง copy ไฟล์ global ข้ามเครื่อง เพราะ generate จาก `CORE.md` ที่อยู่ใน repo ได้ทั้งหมด

## กฎแปลงถ้อยคำ

`CORE.md` เขียนแบบกลางๆ แล้วถูกแปลงเป็น 2 เวอร์ชัน:
- **ฉบับโปรเจกต์** (AGENTS.md, web-snippets) — เปลี่ยน "ทีม" เป็น "อปท.", ยัด Compliance Gate ของโดเมนเข้าข้อ 3 ฯลฯ
- **ฉบับ global** — เติม "ของโปรเจกต์นั้น" ให้อ่านรู้เรื่องไม่ว่าเปิดโปรเจกต์ไหน

กฎทั้งหมดอยู่ในตัวแปร `RULES` ใน `scripts/ai-sync.mjs` เป็น**ข้อมูล ไม่ใช่ logic**
**ถ้าแก้ถ้อยคำใน `CORE.md` จนกฎหาข้อความต้นทางไม่เจอ สคริปต์จะหยุดทันทีพร้อมบอกว่ากฎไหนพัง**
— ตั้งใจให้เป็นแบบนี้ ดีกว่าปล่อยให้ drift เงียบๆ แบบเดิม

## ทำไมต้องแยก CORE กับ DOMAIN

เดิม global files (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`) มี "Smart City ภาครัฐไทย" ฝังอยู่ตรงๆ
ทำให้ทุกโปรเจกต์ที่เปิดใน Claude Code/Antigravity ถูกตีความว่าเป็นงาน Smart City ไปด้วย
ทั้งที่บางโปรเจกต์อาจเป็นสายงานอื่น — แยกออกมาเพื่อให้ **สลับสายงานได้ต่อโปรเจกต์**
แค่สร้าง `docs/ai/DOMAIN.md` ใหม่ของโปรเจกต์นั้น ไม่ต้องแตะ global เลย

## บันทึกเหตุการณ์

- **2026-11-12** `docs/ai/claude/settings.json` เพิ่ม `modelSettings` (Opus 5.5 / Sonnet 5.5 = high)
  เพราะ `effortLevel` ชั้นบนสุดไม่มีผลกับ Opus 5.5 — PC ได้ high เพราะเคยกด `/effort` ไว้ เครื่องที่ตั้งจาก ai:sync อย่างเดียวไม่ได้
  สคริปต์ merge ทีละรุ่นและหยุดถ้าใส่ `max` (ตั้งถาวรไม่ได้) · เพิ่ม `[Adapter — Antigravity: แนะนำรุ่นของ agent]`
  ลง `~/.gemini/GEMINI.md` เพราะ agent ของ Antigravity สลับรุ่นเองไม่ได้ ทำได้แค่แนะนำบรรทัดแรก
  (ตรวจแล้ว: แชตหลักของ Claude Code สลับรุ่นตัวเองอัตโนมัติไม่ได้เช่นกัน ไม่มี hook ที่เปลี่ยนรุ่น/effort
  และไม่ใช้ skill สลับรุ่นรายเทิร์น เพราะ cache ผูกกับรุ่น สลับแต่ละครั้งต้องจ่ายขาเข้าเต็มราคาใหม่)
- **2026-07-29** แยกโครงสร้าง 2 ชั้น (CORE + DOMAIN)
- **2026-09-06** เพิ่มปลายทาง `~/.codex/AGENTS.md` + ต้นฉบับ `docs/ai/ADAPTERS.md`
  และเพิ่มข้อยกเว้น push ของ agent ฝั่งคลาวด์ใน `docs/ai/SAFETY.md`
  (เดิม "ห้าม commit/push เอง" ขัดกับ Codex cloud / Claude Code on the web ที่ส่งงานได้ทางเดียวคือ push)
- **2026-09-05** เลิก sync ด้วยมือ เปลี่ยนมาใช้ `scripts/ai-sync.mjs`
  เหตุผล: การ copy มือพังจริง — กฎ `$0 Budget Policy` ถูกเพิ่มใน `CORE.md` แล้ว sync เข้า `AGENTS.md` ตัวเดียว
  **หายไปจากอีก 4 ปลายทาง** (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `web-snippets.md` ทั้ง 3 บล็อก)
  โดยไม่มีใครรู้ ⇒ ทุกโปรเจกต์อื่นที่เปิดใน Claude Code/Antigravity ไม่มีกฎห้ามใช้บริการเสียเงินอยู่พักใหญ่
  พร้อมกันนั้น: แยก `[SAFETY สำหรับ agent ใน IDE]` ออกมาเป็น `docs/ai/SAFETY.md` (เดิมอยู่แค่ในไฟล์ generated
  ไม่มีต้นฉบับ ถ้า regenerate จะหายทั้งบล็อก) และเพิ่ม `[มาตรฐานการพิมพ์เอกสารราชการ]` เข้า
  `.agents/rules/domain.md` (เดิมถูกตัดทิ้ง ทำให้ Antigravity ไม่รู้กฎฟอนต์/ขอบกระดาษทั้งที่เป็นกฎเขียนโค้ด)

**หมายเหตุ:** เคยมีไฟล์ `.roo/skills/subjectmatterexpert/SKILL.md` (Roo Code) ซึ่งเป็นคนละ path
กับ convention จริงของ Roo Code (`.roo/rules/`) และปัจจุบันเลิกใช้ Roo Code แล้ว
(ถอด `.roo/rules/` ออกไปแล้วเมื่อ 2026-07-29) ไฟล์ที่เหลืออยู่เป็นไฟล์ค้าง ไม่มีเครื่องมือไหนอ่าน

⚠️ **ทบทวนไฟล์นี้ทุก 6 เดือน** โดยเฉพาะส่วน Compliance Gate ใน `docs/ai/DOMAIN.md` —
ระเบียบ/กฎหมายที่อ้างถึง (มท., PDPA, จัดซื้อจัดจ้าง) อาจแก้ไขระหว่างทาง
