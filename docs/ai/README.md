# AI Instructions — Single Source of Truth

**โครงสร้าง 2 ชั้น (ตั้งแต่ 2026-07-29):**
- `docs/ai/CORE.md` = **หลักการสากล** ใช้ได้ทุกโปรเจกต์ทุกสายงาน (ไม่มีชื่อโดเมนเฉพาะ)
- `docs/ai/DOMAIN.md` = **ความเชี่ยวชาญเฉพาะโปรเจกต์นี้** (Smart City ภาครัฐไทย) — มีเฉพาะโปรเจกต์นี้เท่านั้น
  โปรเจกต์อื่นที่ไม่ใช่สายงานนี้ ให้สร้าง `docs/ai/DOMAIN.md` ของตัวเองแยกต่างหาก ไม่ต้องแก้ CORE.md

**ไฟล์ที่ copy เนื้อหามา (ต้อง sync มือทุกครั้งที่แก้ CORE.md และ/หรือ DOMAIN.md):**
- `AGENTS.md` (root, เฉพาะโปรเจกต์นี้ — Claude Code อ่านอัตโนมัติ) = CORE.md + DOMAIN.md + [SAFETY สำหรับ agent ใน IDE]
- `.agents/rules/domain.md` (เฉพาะโปรเจกต์นี้ — Antigravity อ่านเป็น Workspace Rules อัตโนมัติ) = DOMAIN.md ล้วนๆ
- `~/.claude/CLAUDE.md` (global, **ทุกโปรเจกต์**) = CORE.md ล้วนๆ **ไม่มี DOMAIN.md**
- `~/.gemini/GEMINI.md` (global, **ทุกโปรเจกต์** — Antigravity อ่านเป็น Global Rules ไม่ว่าจะสลับ backend เป็น Claude/GPT/Gemini) = CORE.md ล้วนๆ **ไม่มี DOMAIN.md**
- `docs/ai/web-snippets.md` = CORE.md + DOMAIN.md + Adapter เฉพาะแต่ละเว็บ (ต้อง paste มือเข้า Claude/ChatGPT/Gemini เว็บใหม่ทุกครั้ง — เว็บพวกนี้ผูกกับโปรเจกต์นี้อยู่แล้ว เช่น Gemini Gem ชื่อ "SmartLocal SME" จึงยังคงรวม DOMAIN.md เข้าไปด้วย)

**ไฟล์ที่ไม่ซ้ำเนื้อหา CORE.md (แก้เฉพาะจุด):** `CLAUDE.md`, `GEMINI.md` (root) — มีแค่ `@AGENTS.md`/คำสั่งอ่าน + `[Adapter]` เฉพาะตัว

**เหตุผลที่แยก 2 ชั้น**: เดิม global files (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`) มี "Smart City ภาครัฐไทย" ฝังอยู่ตรงๆ ทำให้ทุกโปรเจกต์ที่เปิดใน Claude Code/Antigravity ถูกตีความว่าเป็นงาน Smart City ไปด้วย ทั้งที่บางโปรเจกต์อาจเป็นสายงานอื่น — แยกออกมาเพื่อให้ **สลับสายงานได้ต่อโปรเจกต์** แค่สร้าง `docs/ai/DOMAIN.md` ใหม่ของโปรเจกต์นั้น ไม่ต้องแตะ global เลย

**ขั้นตอน regenerate เมื่อแก้ CORE.md:** 1) แก้ `docs/ai/CORE.md` 2) copy ทับใน `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md` (เฉพาะเนื้อหา CORE ล้วนๆ) 3) copy CORE.md + DOMAIN.md รวมกันทับใน `AGENTS.md` และ 3 บล็อกใน `web-snippets.md` (backup ไฟล์เดิมเป็น `.bak.<YYYYMMDD-HHMM>` ก่อนทุกครั้ง) 4) paste เนื้อหาใหม่เข้า Claude web / ChatGPT / Gemini Gem ด้วยมือ

**ขั้นตอนเมื่อแก้ DOMAIN.md เท่านั้น (ไม่แตะ CORE.md):** sync เข้า `AGENTS.md` และ `web-snippets.md` เท่านั้น — **ห้าม** sync เข้า global files (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`)

**หมายเหตุ:** เคยมีไฟล์ `.roo/skills/subjectmatterexpert/SKILL.md` (Roo Code) ซึ่งเป็นคนละ path กับ convention จริงของ Roo Code (`.roo/rules/`) และปัจจุบันเลิกใช้ Roo Code แล้ว (ถอด `.roo/rules/` ออกไปแล้วเมื่อ 2026-07-29) ไฟล์ `.roo/skills/...` ที่เหลืออยู่เป็นไฟล์ค้าง ไม่มีเครื่องมือไหนอ่าน

⚠️ **ทบทวนไฟล์นี้ทุก 6 เดือน** โดยเฉพาะส่วน Compliance Gate ใน `docs/ai/DOMAIN.md` — ระเบียบ/กฎหมายที่อ้างถึง (มท., PDPA, จัดซื้อจัดจ้าง) อาจแก้ไขระหว่างทาง
