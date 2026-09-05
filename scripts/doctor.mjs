#!/usr/bin/env node
/**
 * doctor.mjs — ตรวจว่าเครื่องนี้พร้อมทำงานกับโปรเจกต์นี้จริง
 *
 * มีไว้เพราะโปรเจกต์นี้ทำงานข้าม 2 เครื่อง (PC บ้าน / โน้ตบุคที่ทำงาน) ตั้งแต่ 2026-09-05
 * สิ่งที่ git ไม่พามาให้ (node เวอร์ชัน, node_modules, .env.local, ไฟล์ instruction ที่เป็น
 * global, playwright browser) คือจุดที่เครื่องสองเครื่องเริ่มไม่เหมือนกันโดยไม่มีอะไรฟ้อง
 *
 *   npm run doctor
 *
 * ❌ = ต้องแก้ก่อนทำงานต่อ (คืน exit 1)   ⚠️ = ใช้งานได้ แต่ควรรู้ไว้
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const problems = [];
const warnings = [];
const ok = [];

const fail = (msg, hint) => problems.push({ msg, hint });
const warn = (msg, hint) => warnings.push({ msg, hint });
const pass = (msg) => ok.push(msg);

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const tryGit = (args, fallback = null) => {
  try {
    return git(args);
  } catch {
    return fallback;
  }
};

/* ── 1. เวอร์ชัน node ต้องตรงกับที่ CI ใช้ ─────────────────────────── */
// CI ตรึงไว้ที่ node-version: '24' ใน .github/workflows/deploy.yml
// ถ้าเครื่อง dev คนละ major จะเจอ "รันในเครื่องผ่าน แต่ CI พัง" (หรือกลับกัน) โดยหาสาเหตุยาก
if (existsSync('.nvmrc')) {
  const want = readFileSync('.nvmrc', 'utf8').trim().replace(/^v/, '');
  const have = process.versions.node;
  if (have.split('.')[0] !== want.split('.')[0]) {
    fail(`node เป็น v${have} แต่ .nvmrc กำหนด v${want}`, `ติดตั้ง node ${want} (nvm-windows: nvm install ${want} && nvm use ${want})`);
  } else {
    pass(`node v${have} ตรงกับ .nvmrc`);
  }
} else {
  warn('ไม่มีไฟล์ .nvmrc', 'ควรมีไว้ตรึงเวอร์ชัน node ให้ตรงกันทุกเครื่อง');
}

/* ── 2. node_modules ตรงกับ lockfile ปัจจุบันหรือยัง ───────────────── */
// เคสที่เจอบ่อย: pull มาแล้ว lockfile เปลี่ยน แต่ลืม npm ci
// เทียบเวลาแก้ไขแทนการไล่ทีละแพ็กเกจ เพราะเร็วและจับเคสนี้ได้ตรง
const nmLock = 'node_modules/.package-lock.json';
if (!existsSync('node_modules')) {
  fail('ยังไม่มี node_modules', 'รัน npm ci');
} else if (!existsSync(nmLock)) {
  warn('ไม่มี node_modules/.package-lock.json', 'เทียบความสดของ dependency ไม่ได้ — ถ้าไม่แน่ใจให้รัน npm ci');
} else if (statSync('package-lock.json').mtimeMs > statSync(nmLock).mtimeMs) {
  fail('package-lock.json ใหม่กว่า node_modules ที่ติดตั้งไว้', 'รัน npm ci');
} else {
  pass('node_modules ตรงกับ lockfile');
}

/* ── 3. .env.local ครบตาม .env.example ไหม ────────────────────────── */
// .env.local ถูก git ignore ⇒ ไม่ติดมากับ clone เครื่องใหม่จะไม่มีเลย
// ห้ามพิมพ์ "ค่า" ออกมาเด็ดขาด รายงานแค่ชื่อคีย์
const envKeys = (path) =>
  !existsSync(path)
    ? null
    : readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/))
        .filter(Boolean)
        .map((m) => m[1]);

const wantEnv = envKeys('.env.example') ?? [];
const haveEnv = envKeys('.env.local');
if (haveEnv === null) {
  fail('ไม่มีไฟล์ .env.local', 'คัดลอกจาก repo devconfig (npm run env:pull) — ไฟล์นี้ถูก git ignore จึงไม่ติดมากับ clone');
} else {
  const missing = wantEnv.filter((k) => !haveEnv.includes(k));
  if (missing.length) warn(`.env.local ขาดคีย์: ${missing.join(', ')}`, 'เทียบกับ .env.example แล้วเติมให้ครบ');
  else pass(`.env.local มีคีย์ครบ ${haveEnv.length} ตัว`);
}

/* ── 4. ไฟล์ instruction ของ AI ตรงกับต้นฉบับไหม (รวมไฟล์ global) ── */
// จุดสำคัญของเครื่องใหม่: ~/.claude/CLAUDE.md กับ ~/.gemini/GEMINI.md ไม่อยู่ใน git
// ถ้าไม่รัน ai:sync AI ทุกตัวบนเครื่องนั้นจะไม่มีหลักการติดตัวเลย
try {
  execFileSync(process.execPath, ['scripts/ai-sync.mjs', '--check'], { stdio: 'pipe' });
  pass('ไฟล์ instruction ของ AI ตรงกับต้นฉบับครบทุกปลายทาง');
} catch {
  fail('ไฟล์ instruction ของ AI ไม่ตรงกับ docs/ai/CORE.md + DOMAIN.md + SAFETY.md', 'รัน npm run ai:sync');
}

/* ── 5. Google Chrome ของเครื่อง (จำเป็นเฉพาะตอนรัน E2E) ───────────── */
// เทสต์ในโปรเจกต์นี้ launch ด้วย channel: 'chrome' = Google Chrome ที่ติดตั้งในเครื่อง
// ไม่ใช่ chromium ที่ playwright บันเดิลมา (ดูคอมเมนต์ใน tests/fleet-form3-layout.test.mjs)
// ⇒ ต้องตรวจ Chrome ไม่ใช่ตรวจ playwright browser
//
// ส่วน .chrome-test-profiles/ (2 GB, มี session ล็อกอินจริงของ อปท.) sync ข้ามเครื่องไม่ได้
// ทั้งเรื่องขนาดและ PDPA — เครื่องใหม่ต้องล็อกอินสร้าง profile เอง
const chromePaths = [
  join(process.env['ProgramFiles'] ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
if (chromePaths.some((p) => existsSync(p))) pass('Google Chrome พร้อมใช้ (เทสต์ใช้ channel: chrome)');
else warn('ไม่พบ Google Chrome ในเครื่อง', 'ติดตั้ง Google Chrome ก่อนรัน E2E — เทสต์ใช้ channel: chrome ไม่ใช่ chromium ของ playwright');

/* ── 6. git: remote / branch / งานที่ยังไม่ push ──────────────────── */
const remote = tryGit(['remote', 'get-url', 'origin']);
if (!remote) warn('ไม่มี git remote ชื่อ origin', 'ตรวจว่า clone มาถูก repo');
else if (!remote.includes('smartlocal-namlao')) warn(`remote origin = ${remote}`, 'ไม่ใช่ repo ที่คาดไว้ ตรวจอีกที');
else pass('git remote origin ถูกต้อง');

const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === 'master') {
  warn('ตอนนี้อยู่บน branch master', 'push เข้า master = deploy จริงทันที — แยก branch ก่อนเริ่มงาน');
} else if (branch) {
  pass(`อยู่บน branch ${branch}`);
}

// branch ที่ไม่มี upstream และมี commit เกิน origin/master = งานที่อยู่ในเครื่องนี้เครื่องเดียว
// ย้ายเครื่องแล้วจะไม่เห็น ฮาร์ดดิสก์พังแล้วหายถาวร
const stranded = (tryGit(['for-each-ref', '--format=%(refname:short)|%(upstream:short)', 'refs/heads'], '') || '')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('|'))
  .filter(([, up]) => !up)
  .map(([name]) => name)
  .filter((name) => Number(tryGit(['rev-list', '--count', `origin/master..${name}`], '0')) > 0);

if (stranded.length) {
  warn(`branch ที่ยังไม่ push และมีงานเกิน master: ${stranded.join(', ')}`, 'push ขึ้น origin ไม่งั้นย้ายเครื่องแล้วงานหาย');
} else {
  pass('ไม่มี branch ที่งานค้างอยู่เครื่องนี้เครื่องเดียว');
}

/* ── 7. memory ของ Claude ผูกกับ repo devconfig หรือยัง ───────────── */
// ชื่อโฟลเดอร์มาจาก path ของโปรเจกต์ (แทน : \ / เว้นวรรค . ด้วย -)
// ย้ายโฟลเดอร์โปรเจกต์เมื่อไร junction จะชี้ผิดเงียบๆ ต้องรัน memory:link ใหม่
const memKey = process.cwd().split('').map((c) => (':\\/ .'.includes(c) ? '-' : c)).join('');
const memDir = join(homedir(), '.claude', 'projects', memKey, 'memory');
if (!existsSync(memDir)) {
  warn('ยังไม่มีโฟลเดอร์ memory ของ Claude สำหรับ path นี้', 'ถ้าย้ายโฟลเดอร์โปรเจกต์มา ให้รัน npm run memory:link');
} else {
  let linked = false;
  try {
    linked = lstatSync(memDir).isSymbolicLink();
  } catch {
    /* ตรวจไม่ได้ก็ไม่เป็นไร */
  }
  if (!linked) {
    warn('memory ของ Claude ยังเป็นโฟลเดอร์ธรรมดา ไม่ได้เชื่อมกับ devconfig', 'รัน npm run memory:link เพื่อให้ memory ข้ามเครื่องได้');
  } else {
    // junction ที่ชี้ไปโฟลเดอร์ที่ถูกลบ/ย้าย จะยังดูเหมือนลิงก์ปกติทุกอย่าง แต่เปิดไม่ได้
    // ⇒ Claude จะเริ่ม session โดยไม่มี memory เลยแบบเงียบๆ ต้องจับให้ได้ตรงนี้
    try {
      const n = readdirSync(memDir).length;
      pass(`memory ของ Claude เชื่อมกับ devconfig แล้ว (${n} ไฟล์)`);
    } catch {
      fail('junction ของ memory ชี้ไปที่ที่ไม่มีอยู่แล้ว — Claude จะไม่มี memory เลย', 'repo devconfig ถูกย้ายหรือลบ? รัน npm run memory:link ใหม่');
    }
  }
}

/* ── 8. เตือนเรื่อง DB จริง เฉพาะครั้งแรกของเครื่องนี้ ──────────────── */
const marker = join('tmp', '.doctor-seen');
const firstRun = !existsSync(marker);

/* ─────────────────────────── สรุปผล ─────────────────────────── */
console.log('');
for (const m of ok) console.log(`  ✅ ${m}`);
for (const w of warnings) console.log(`  ⚠️  ${w.msg}\n       -> ${w.hint}`);
for (const p of problems) console.log(`  ❌ ${p.msg}\n       -> ${p.hint}`);

if (firstRun) {
  console.log('');
  console.log('  ┌────────────────────────────────────────────────────────────────────┐');
  console.log('  │ อ่านก่อนเริ่มงานบนเครื่องนี้                                        │');
  console.log('  │                                                                    │');
  console.log('  │ โปรเจกต์นี้ไม่มีฐานข้อมูลสำหรับทดสอบแยก — localhost ต่อ Supabase   │');
  console.log('  │ ตัวเดียวกับ production                                             │');
  console.log('  │ ⇒ กด "บันทึก" ทดสอบเล่นๆ ที่ npm run dev = ข้อมูลจริงของ อปท.      │');
  console.log('  │   เปลี่ยนจริงทันที                                                 │');
  console.log('  │                                                                    │');
  console.log('  │ ใช้ tenant "demo" (เทศบาลตำบลสาธิต) เป็นสนามซ้อมเท่านั้น           │');
  console.log('  └────────────────────────────────────────────────────────────────────┘');
  try {
    mkdirSync('tmp', { recursive: true });
    writeFileSync(marker, new Date().toISOString(), 'utf8');
  } catch {
    /* เขียน marker ไม่ได้ก็แค่เตือนซ้ำครั้งหน้า ไม่ใช่เรื่องใหญ่ */
  }
}

console.log('');
if (problems.length) {
  console.log(`  สรุป: มี ${problems.length} เรื่องที่ต้องแก้ก่อน (และ ${warnings.length} เรื่องที่ควรรู้)\n`);
  process.exit(1);
}
console.log(`  สรุป: เครื่องนี้พร้อมทำงาน${warnings.length ? ` (มี ${warnings.length} เรื่องที่ควรรู้)` : ''}\n`);
