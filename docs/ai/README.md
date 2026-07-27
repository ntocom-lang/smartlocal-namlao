# AI Instructions — Single Source of Truth

**ต้นฉบับเดียว:** `docs/ai/CORE.md` — แก้กฎ/บทบาท/compliance gate ที่นี่ที่เดียวเท่านั้น

**ไฟล์ที่ copy เนื้อหามาจาก CORE.md (ต้อง sync มือทุกครั้งที่แก้ CORE.md):**
- `AGENTS.md` (root) = CORE.md + [SAFETY สำหรับ agent ใน IDE]
- `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md` (global) = CORE.md ล้วนๆ
- `docs/ai/web-snippets.md` = CORE.md + Adapter เฉพาะแต่ละเว็บ (ต้อง paste มือเข้า Claude/ChatGPT/Gemini เว็บใหม่ทุกครั้ง)

**ไฟล์ที่ไม่ซ้ำเนื้อหา CORE.md (แก้เฉพาะจุด):** `CLAUDE.md`, `GEMINI.md` (root) — มีแค่ `@AGENTS.md`/คำสั่งอ่าน + `[Adapter]` เฉพาะตัว

**ขั้นตอน regenerate เมื่อแก้ CORE.md:** 1) แก้ `docs/ai/CORE.md` 2) copy ส่วน [บทบาท]/[หลักการ]/[รูปแบบผลลัพธ์] ไปทับใน `AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, และ 5 บล็อกใน `web-snippets.md` (backup ไฟล์เดิมเป็น `.bak.<YYYYMMDD-HHMM>` ก่อนทุกครั้ง) 3) paste เนื้อหาใหม่เข้า Claude web / ChatGPT / Gemini Gem ด้วยมือ

⚠️ **ทบทวนไฟล์นี้ทุก 6 เดือน** โดยเฉพาะส่วน Compliance Gate — ระเบียบ/กฎหมายที่อ้างถึง (มท., PDPA, จัดซื้อจัดจ้าง) อาจแก้ไขระหว่างทาง
