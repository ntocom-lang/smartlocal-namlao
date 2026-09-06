#!/usr/bin/env node
/**
 * ai-sync.mjs — สร้างไฟล์ instruction ของ AI ทุกตัวจากต้นฉบับชุดเดียว
 *
 *   ต้นฉบับ : docs/ai/CORE.md (หลักการสากล) + docs/ai/DOMAIN.md (เฉพาะโปรเจกต์) + docs/ai/SAFETY.md
 *             + docs/ai/ADAPTERS.md (ส่วนต่างเฉพาะเครื่องมือ)
 *   ปลายทาง : AGENTS.md, .agents/rules/domain.md, docs/ai/web-snippets.md,
 *             ~/.claude/CLAUDE.md, ~/.gemini/GEMINI.md, ~/.codex/AGENTS.md
 *
 * ทำไมต้องมี: 3 ไฟล์สุดท้ายอยู่นอก git ⇒ เครื่องใหม่จะไม่มีเลย และการ copy ด้วยมือ
 * เคยพังจริง — กฎ "$0 Budget Policy" หายไปจาก 4 ใน 5 ปลายทาง (ตรวจพบ 2026-09-05)
 *
 *   npm run ai:sync    เขียนไฟล์จริง (สำรองไฟล์นอก git เป็น .bak.<YYYYMMDD-HHMM> ก่อน)
 *   npm run ai:check   ตรวจอย่างเดียว ไม่เขียน — ต่างเมื่อไรคืน exit 1 (ใช้ใน CI)
 *
 * กฎการแปลงถ้อยคำอยู่ในตัวแปร RULES ข้างล่าง เป็น "ข้อมูล" ไม่ใช่ logic
 * ถ้ากฎไหนหาข้อความต้นทางไม่เจอ (เพราะมีคนแก้ถ้อยคำใน CORE.md) สคริปต์จะหยุดทันที
 * ไม่ปล่อยให้ drift กลับมาเงียบๆ แบบเดิม
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHECK = process.argv.includes('--check');
// CI ไม่มี ~/.claude, ~/.gemini ⇒ ต้องตรวจเฉพาะไฟล์ใน repo ไม่งั้น workflow แดงตลอด
const REPO_ONLY = process.argv.includes('--repo-only');
const DUMP_DIR = process.argv.find((a) => a.startsWith('--dump-dir='))?.slice('--dump-dir='.length) ?? null;
const HOME = homedir();
const EOL_SPLIT = /\r?\n/;
const FENCE = '```';

const die = (msg) => {
  console.error(`\n[ai-sync] ล้มเหลว: ${msg}\n`);
  process.exit(1);
};

/* ─────────────────────────── อ่านต้นฉบับ ─────────────────────────── */

const read = (p) => readFileSync(p, 'utf8').split(EOL_SPLIT);

const trimBlank = (arr) => {
  const b = [...arr];
  while (b.length && !b[0].trim()) b.shift();
  while (b.length && !b.at(-1).trim()) b.pop();
  return b;
};

/** แตกไฟล์เป็น section ตามหัวข้อ [ชื่อ] — บรรทัดก่อนหัวข้อแรกถือเป็นคำนำ ไม่ถูกนำไปใช้ */
function sections(lines, label) {
  const out = new Map();
  let key = null;
  let buf = [];
  const flush = () => {
    if (key !== null) out.set(key, trimBlank(buf));
  };
  for (const line of lines) {
    if (/^\[.+\]$/.test(line.trim())) {
      flush();
      key = line.trim();
      buf = [];
    } else if (key !== null) {
      buf.push(line);
    }
  }
  flush();
  if (out.size === 0) die(`อ่าน section จาก ${label} ไม่ได้เลย — รูปแบบไฟล์เปลี่ยนไปหรือเปล่า`);
  return out;
}

const core = sections(read('docs/ai/CORE.md'), 'docs/ai/CORE.md');
const domain = sections(read('docs/ai/DOMAIN.md'), 'docs/ai/DOMAIN.md');
const safety = sections(read('docs/ai/SAFETY.md'), 'docs/ai/SAFETY.md');
const adapters = sections(read('docs/ai/ADAPTERS.md'), 'docs/ai/ADAPTERS.md');

const need = (map, key, file) => {
  const v = map.get(key);
  if (!v) die(`ไม่พบหัวข้อ ${key} ใน ${file}`);
  return v;
};

const CORE_ROLE = need(core, '[บทบาท]', 'CORE.md');
const CORE_RULES = need(core, '[หลักการ]', 'CORE.md');
const CORE_FORMAT = need(core, '[รูปแบบผลลัพธ์]', 'CORE.md');

const DOM_ROLE_K = '[บทบาทเสริม]';
const DOM_GATE_K = '[Compliance Gate เฉพาะโดเมนนี้]';
const DOM_PRINT_K = '[มาตรฐานการพิมพ์เอกสารราชการ — บังคับทุกใบ]';
const DOM_ROLE = need(domain, DOM_ROLE_K, 'DOMAIN.md');
const DOM_GATE = need(domain, DOM_GATE_K, 'DOMAIN.md');
const DOM_PRINT = need(domain, DOM_PRINT_K, 'DOMAIN.md');

const SAFETY_K = '[SAFETY สำหรับ agent ใน IDE]';
const SAFETY_BODY = need(safety, SAFETY_K, 'SAFETY.md');

// Codex ไม่อ่านไฟล์ชื่อ CODEX.md — อ่าน AGENTS.md ของรีโป (ซึ่ง AI ตัวอื่นอ่านด้วย) กับ ~/.codex/AGENTS.md
// ⇒ adapter เฉพาะตัวมันต้องออกที่ global ไม่ใช่ AGENTS.md ไม่งั้นไปกวน AI ตัวอื่น
const ADAPTER_CODEX_K = '[Adapter — Codex]';
const ADAPTER_CODEX = need(adapters, ADAPTER_CODEX_K, 'ADAPTERS.md');

/* ───────────── กฎแปลงถ้อยคำ (data — แก้ตรงนี้ที่เดียว) ───────────── */

const RULES = {
  // CORE (กลางๆ ใช้ได้ทุกโปรเจกต์) -> ฉบับของโปรเจกต์นี้ ที่พูดถึง อปท. ตรงๆ
  project: [
    ['กำลังคนของทีมที่ดูแลต่อเองได้', 'กำลังคนของ อปท. ดูแลต่อเองได้'],
    ['"ยังไม่พร้อมใช้งานจริง"', '"ยังไม่พร้อมใช้งานราชการ"'],
    ['(2) เว็บทางการพร้อมลิงก์', '(2) เว็บราชการทางการพร้อมลิงก์'],
    ['ยกหน่วยงาน/องค์กร/โครงการ', 'ยกหน่วยงาน/เมือง/โครงการ'],
  ],
  // CORE -> ฉบับ global ที่ต้องอ่านรู้เรื่องไม่ว่าเปิดโปรเจกต์ไหน
  global: [
    ['ดูเพิ่มใน docs/ai/DOMAIN.md', 'ดูเพิ่มใน docs/ai/DOMAIN.md ของโปรเจกต์นั้น'],
    ['ดูใน docs/ai/DOMAIN.md ถ้ามี', 'ดูใน docs/ai/DOMAIN.md ของโปรเจกต์นั้น ถ้ามี'],
  ],
};

/** แทนที่ข้อความ — ต้องเจอพอดี 1 ครั้ง ไม่งั้นหยุด (กันถ้อยคำต้นฉบับเปลี่ยนแล้วกฎเงียบ) */
function substitute(lines, rules, label) {
  let text = lines.join('\n');
  for (const [from, to] of rules) {
    const hits = text.split(from).length - 1;
    if (hits !== 1) {
      die(
        `กฎแทนที่ของ ${label} เจอข้อความ "${from}" ${hits} ครั้ง (ต้องเจอ 1 ครั้ง)\n` +
          '           แปลว่าถ้อยคำใน docs/ai/CORE.md เปลี่ยนไป — แก้กฎในตัวแปร RULES ให้ตรงก่อน',
      );
    }
    text = text.split(from).join(to);
  }
  return text.split('\n');
}

/** แทนบรรทัดที่ขึ้นต้นด้วย prefix ด้วยชุดบรรทัดใหม่ — ต้องเจอพอดี 1 บรรทัด */
function replaceLine(lines, prefix, replacement, label) {
  const idx = [];
  lines.forEach((l, i) => {
    if (l.trim().startsWith(prefix)) idx.push(i);
  });
  if (idx.length !== 1) {
    die(`${label}: หาบรรทัดที่ขึ้นต้นด้วย "${prefix}" เจอ ${idx.length} บรรทัด (ต้องเจอ 1 บรรทัด)`);
  }
  return [...lines.slice(0, idx[0]), ...replacement, ...lines.slice(idx[0] + 1)];
}

const indent = (lines, pad) => lines.map((l) => (l.trim() ? pad + l : l));

/* ─────────────────────── ประกอบเนื้อหาแต่ละแบบ ─────────────────────── */

// [บทบาท] ฉบับโปรเจกต์ = CORE.[บทบาท] โดยแทนบรรทัดท้ายด้วยเนื้อ DOMAIN.[บทบาทเสริม]
const roleProject = replaceLine(
  CORE_ROLE,
  'ความเชี่ยวชาญเฉพาะโดเมนของโปรเจกต์นี้',
  DOM_ROLE,
  '[บทบาท] ฉบับโปรเจกต์',
);

// [หลักการ] ฉบับโปรเจกต์ = CORE.[หลักการ] โดยยัด Compliance Gate ของโดเมนแทน 2 บรรทัดกลางๆ ในข้อ 3
let rulesProject = replaceLine(CORE_RULES, 'ตรวจว่ากระทบข้อบังคับ', indent(DOM_GATE, '   '), '[หลักการ] ข้อ 3');
rulesProject = replaceLine(rulesProject, '(รายชื่อระเบียบ/กฎหมายเฉพาะโดเมน', [], '[หลักการ] ข้อ 3');
rulesProject = substitute(rulesProject, RULES.project, '[หลักการ] ฉบับโปรเจกต์');

// sections() เก็บเฉพาะเนื้อ ไม่เก็บบรรทัดหัวข้อ — ตอนประกอบกลับต้องใส่หัวข้อเอง
const ROLE_K = '[บทบาท]';
const RULES_K = '[หลักการ]';
const FORMAT_K = '[รูปแบบผลลัพธ์]';

const bodyProject = [ROLE_K, ...roleProject, '', RULES_K, ...rulesProject, '', FORMAT_K, ...CORE_FORMAT];
const bodyGlobal = substitute(
  [ROLE_K, ...CORE_ROLE, '', RULES_K, ...CORE_RULES, '', FORMAT_K, ...CORE_FORMAT],
  RULES.global,
  'ฉบับ global',
);

let repo = 'ไม่ทราบ repo';
try {
  repo = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
    .trim()
    .replace(/\.git$/, '')
    .split('/')
    .slice(-2)
    .join('/');
} catch {
  /* ไม่ใช่ git repo ก็ไม่เป็นไร ใช้ค่าเริ่มต้น */
}

const HEAD_AGENTS =
  'AUTO-GENERATED จาก docs/ai/CORE.md + docs/ai/DOMAIN.md ห้ามแก้ที่นี่ — แก้ต้นฉบับที่ docs/ai/CORE.md (หลักการสากล) หรือ docs/ai/DOMAIN.md (เฉพาะโปรเจกต์นี้) แล้ว sync มาไฟล์นี้';

const HEAD_RULES = [
  'AUTO-GENERATED จาก docs/ai/DOMAIN.md ห้ามแก้ที่นี่ — แก้ต้นฉบับที่ docs/ai/DOMAIN.md แล้ว sync มาไฟล์นี้',
  '(ไฟล์นี้มีไว้ให้ Antigravity IDE อ่านเป็น Workspace Rules อัตโนมัติ คู่กับ Global Rules ที่ ~/.gemini/GEMINI.md)',
];

const HEAD_GLOBAL = [
  `AUTO-GENERATED จาก docs/ai/CORE.md ของ repo ${repo} ห้ามแก้ที่นี่ — แก้ต้นฉบับแล้วรัน npm run ai:sync`,
  '(ไฟล์นี้เป็น global ใช้ร่วมทุกโปรเจกต์ จึงมีเฉพาะหลักการสากล ไม่มีเนื้อหาเฉพาะโดเมน)',
  '',
];

/**
 * ไล่ section ของ DOMAIN.md ตามลำดับที่อยู่ในไฟล์ ไม่ใช่ไล่ชื่อแบบตายตัว
 * ⇒ เพิ่มหัวข้อใหม่ใน DOMAIN.md แล้วมันไหลไปทุกปลายทางเองโดยไม่ต้องแก้สคริปต์
 * (ถ้าไล่ชื่อตายตัว หัวข้อใหม่จะถูกทิ้งเงียบๆ ซึ่งเป็น drift แบบเดียวกับที่กำลังแก้อยู่)
 */
const domainSection = (key) => [key, ...need(domain, key, 'DOMAIN.md')];
const domainKeys = [...domain.keys()];

/**
 * Antigravity Workspace Rules = DOMAIN ทั้งไฟล์ รวม [มาตรฐานการพิมพ์เอกสารราชการ]
 * (ตัดสินใจ 2026-09-05: Antigravity เป็น IDE หลักที่เขียนโค้ดจริงทั้ง 4 backend
 *  กฎฟอนต์/ขอบกระดาษเป็นกฎเขียนโค้ด ไม่ใช่กฎเชิงนโยบาย จึงต้องอยู่ในไฟล์ที่ IDE อ่าน)
 */
const bodyAgentsRules = domainKeys.flatMap((k, i) => (i === 0 ? domainSection(k) : ['', ...domainSection(k)]));

// AGENTS.md เอา [บทบาทเสริม] กับ [Compliance Gate] ไปยัดในเนื้อหลักแล้ว ที่เหลือต่อท้าย
const domainExtra = domainKeys
  .filter((k) => k !== DOM_ROLE_K && k !== DOM_GATE_K)
  .flatMap((k) => ['', ...domainSection(k)]);

/** web-snippets.md: เก็บคำอธิบายรอบๆ ไว้ทั้งหมด เปลี่ยนเฉพาะเนื้อในเฟนซ์ที่ขึ้นต้นด้วย [บทบาท] */
function buildWebSnippets() {
  const lines = read('docs/ai/web-snippets.md');
  const out = [];
  let i = 0;
  let replaced = 0;
  while (i < lines.length) {
    if (lines[i].trim() !== FENCE) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const close = lines.indexOf(FENCE, i + 1);
    if (close === -1) die('web-snippets.md: เจอเฟนซ์เปิดที่ไม่มีคู่ปิด');
    const inner = lines.slice(i + 1, close);
    if (inner[0]?.trim() !== '[บทบาท]') {
      out.push(...lines.slice(i, close + 1));
      i = close + 1;
      continue;
    }
    // ในเฟนซ์เต็ม: เนื้อหลัก + [Adapter — <เว็บ>] ต่อท้าย — เปลี่ยนเฉพาะเนื้อหลัก คง adapter ไว้
    const ad = inner.findIndex((l) => l.trim().startsWith('[Adapter'));
    if (ad === -1) die('web-snippets.md: เฟนซ์ [บทบาท] ไม่มีบล็อก [Adapter — ...] ต่อท้าย');
    out.push(FENCE, ...bodyProject, '', ...trimBlank(inner.slice(ad)), FENCE);
    replaced += 1;
    i = close + 1;
  }
  if (replaced !== 3) die(`web-snippets.md: ควรมี 3 บล็อกที่ต้องอัปเดต แต่เจอ ${replaced}`);
  return out.join('\n');
}

/* ───────────────────────────── ปลายทาง ───────────────────────────── */

const targets = [
  {
    path: 'AGENTS.md',
    inGit: true,
    build: () => [HEAD_AGENTS, '', ...bodyProject, '', SAFETY_K, ...SAFETY_BODY, ...domainExtra, ''].join('\n'),
  },
  {
    path: '.agents/rules/domain.md',
    inGit: true,
    build: () => [...HEAD_RULES, '', ...bodyAgentsRules, ''].join('\n'),
  },
  {
    path: join(HOME, '.claude', 'CLAUDE.md'),
    inGit: false,
    build: () => [...HEAD_GLOBAL, ...bodyGlobal, ''].join('\n'),
  },
  {
    path: join(HOME, '.gemini', 'GEMINI.md'),
    inGit: false,
    build: () => [...HEAD_GLOBAL, ...bodyGlobal, ''].join('\n'),
  },
  {
    path: join(HOME, '.codex', 'AGENTS.md'),
    inGit: false,
    build: () => [...HEAD_GLOBAL, ...bodyGlobal, '', ADAPTER_CODEX_K, ...ADAPTER_CODEX, ''].join('\n'),
  },
  { path: 'docs/ai/web-snippets.md', inGit: true, build: buildWebSnippets },
];

/* ──────────────────────────── เขียน / ตรวจ ──────────────────────────── */

// เทียบโดยไม่สนชนิด line ending — working tree เป็น CRLF (core.autocrlf=true) แต่ index เป็น LF
const norm = (s) => s.split(EOL_SPLIT).join('\n');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

let diffs = 0;
for (const t of targets) {
  if (REPO_ONLY && !t.inGit) {
    console.log(`  ข้าม         ${t.path}  (--repo-only)`);
    continue;
  }
  const next = t.build();
  const prev = existsSync(t.path) ? readFileSync(t.path, 'utf8') : null;
  if (prev !== null && norm(prev) === norm(next)) {
    console.log(`  ตรงอยู่แล้ว  ${t.path}`);
    continue;
  }
  diffs += 1;
  if (CHECK) {
    console.log(`  ต่าง         ${t.path}${prev === null ? '  (ยังไม่มีไฟล์)' : ''}`);
    // --dump-dir=<path> เขียนผลที่ "ควรจะเป็น" ลงโฟลเดอร์ให้ diff ดูได้ ตอน CI แดงจะได้รู้ว่าต่างตรงไหน
    if (DUMP_DIR) {
      const out = join(DUMP_DIR, t.path.replace(/[\\/:]/g, '_'));
      mkdirSync(DUMP_DIR, { recursive: true });
      writeFileSync(out, next, 'utf8');
      console.log(`               ผลที่ควรเป็น -> ${out}`);
    }
    continue;
  }
  // ไฟล์ที่อยู่นอก git ไม่มีประวัติให้ย้อน ต้องสำรองเอง
  if (prev !== null && !t.inGit) copyFileSync(t.path, `${t.path}.bak.${stamp()}`);
  mkdirSync(dirname(t.path), { recursive: true });
  writeFileSync(t.path, next, 'utf8');
  console.log(`  เขียนแล้ว    ${t.path}${prev === null ? '  (สร้างใหม่)' : ''}`);
}

if (CHECK && diffs > 0) {
  console.error(`\n[ai-check] ${diffs} ไฟล์ไม่ตรงกับต้นฉบับ — รัน "npm run ai:sync" แล้ว commit ผลลัพธ์\n`);
  process.exit(1);
}
console.log(CHECK ? '\n[ai-check] ทุกไฟล์ตรงกับต้นฉบับ' : `\n[ai-sync] เสร็จ — เปลี่ยน ${diffs} ไฟล์`);
