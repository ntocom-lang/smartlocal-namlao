#!/usr/bin/env node
/**
 * link-memory.mjs — เชื่อม memory ของ Claude Code เข้ากับ repo devconfig (private)
 *
 *   npm run memory:link                 ใช้ path จาก $SMARTLOCAL_DEVCONFIG หรือ ../smartlocal-devconfig
 *   npm run memory:link -- <path>       ระบุ path ของ devconfig เอง
 *   npm run memory:link -- --dry-run    ดูว่าจะทำอะไรบ้าง โดยยังไม่แตะไฟล์
 *
 * ปัญหาที่แก้: Claude Code เก็บ memory ไว้ที่ ~/.claude/projects/<key>/memory
 * โดย <key> มาจาก "path ของโปรเจกต์" ⇒ ย้ายโฟลเดอร์ หรือ clone ลงอีกเครื่องคนละ path
 * = กลายเป็นโปรเจกต์ใหม่ memory ทั้งก้อนหายเงียบๆ
 *
 * วิธีแก้: ย้ายไฟล์ memory จริงไปไว้ใน repo devconfig แล้วทำ junction ชี้กลับมา
 * ⇒ sync ข้ามเครื่องด้วย git ปกติ และย้ายโฟลเดอร์เมื่อไรก็แค่รันคำสั่งนี้ใหม่
 *
 * ⚠️ ต้องเป็น private repo เท่านั้น — memory มีอีเมล superadmin, project id,
 *    ชื่อ/สถานะขายของ อปท. ลูกค้า และบันทึกช่องโหว่ที่ยังไม่ปิด
 */
import { existsSync, readdirSync, mkdirSync, copyFileSync, unlinkSync, rmdirSync, lstatSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const explicitPath = argv.find((a) => !a.startsWith('--')) ?? null;

const die = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error('');
  process.exit(1);
};
const step = (msg) => console.log(`${DRY ? '[dry-run] ' : ''}${msg}`);

/* ── 1. คำนวณชื่อโฟลเดอร์ที่ Claude Code ใช้ ─────────────────────── */
// สูตรยืนยันจากของจริง 3 ตัวบนเครื่องนี้ (2026-09-05):
//   d:\VS Code\E-Service\SmartLocal v1.1 -> d--VS-Code-E-Service-SmartLocal-v1-1
//   d:\VS Code\ISP System                -> d--VS-Code-ISP-System
//   ...\RKitV3.3-public                  -> ...-RKitV3-3-public
// คือแทน  :  \  /  (เว้นวรรค)  .  ด้วย -  โดยไม่แปลงตัวพิมพ์เล็กใหญ่
//
// ⚠️ นี่เป็นพฤติกรรมภายในของ Claude Code ไม่ใช่ API ที่รับประกัน วันหนึ่งอาจเปลี่ยน
//    จึงต้องยืนยันว่าโฟลเดอร์นั้นมีอยู่จริงก่อนเสมอ ห้ามเดาแล้วสร้างเอง
const MANGLE = ':\\/ .';
const mangle = (p) => [...p].map((c) => (MANGLE.includes(c) ? '-' : c)).join('');

const projectsDir = join(homedir(), '.claude', 'projects');
if (!existsSync(projectsDir)) die(`ไม่พบ ${projectsDir}`, 'เปิดโปรเจกต์นี้ด้วย Claude Code สักครั้งก่อน แล้วค่อยรันใหม่');

const wantKey = mangle(process.cwd());
// Windows ไม่สนตัวพิมพ์ และ node คืน drive letter เป็นตัวใหญ่บ้างเล็กบ้าง จึงต้องเทียบแบบ case-insensitive
const found = readdirSync(projectsDir).find((d) => d.toLowerCase() === wantKey.toLowerCase());

if (!found) {
  console.error(`\n❌ ไม่พบโฟลเดอร์ memory ที่ตรงกับ path นี้`);
  console.error(`   path ปัจจุบัน : ${process.cwd()}`);
  console.error(`   คาดว่าจะเป็น  : ${wantKey}`);
  console.error(`\n   โฟลเดอร์ที่มีอยู่จริงใน ${projectsDir}:`);
  for (const d of readdirSync(projectsDir)) console.error(`     ${d}`);
  console.error(`\n   ถ้าเพิ่งย้ายโฟลเดอร์โปรเจกต์มา ให้เปิด Claude Code ที่ path ใหม่สักครั้งก่อน`);
  console.error(`   แล้วค่อยรันคำสั่งนี้ซ้ำ (สคริปต์นี้ไม่เดาชื่อโฟลเดอร์ให้)\n`);
  process.exit(1);
}

const memDir = join(projectsDir, found, 'memory');
step(`โฟลเดอร์ memory ของ path นี้: ${memDir}`);

/* ── 2. หา repo devconfig ─────────────────────────────────────────── */
const devconfig = resolve(explicitPath ?? process.env.SMARTLOCAL_DEVCONFIG ?? join('..', 'smartlocal-devconfig'));
if (!existsSync(devconfig)) {
  die(
    `ไม่พบ repo devconfig ที่ ${devconfig}`,
    'clone repo private ของคุณมาก่อน แล้วส่ง path มา: npm run memory:link -- <path>\n' +
      '   หรือกำหนดถาวรด้วยตัวแปร SMARTLOCAL_DEVCONFIG',
  );
}
if (!existsSync(join(devconfig, '.git'))) die(`${devconfig} ไม่ใช่ git repo`, 'memory ต้องอยู่ใน repo ถึงจะ sync ข้ามเครื่องได้');

// กันพลาดร้ายแรง: ถ้าเผลอชี้ไป repo สาธารณะ memory จะหลุดออกสู่อินเทอร์เน็ตถาวร
try {
  const url = execFileSync('git', ['-C', devconfig, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const vis = execFileSync('gh', ['repo', 'view', url, '--json', 'visibility', '-q', '.visibility'], {
    encoding: 'utf8',
  }).trim();
  if (vis.toUpperCase() !== 'PRIVATE') {
    die(`repo devconfig เป็น ${vis} ไม่ใช่ PRIVATE`, 'memory มีข้อมูลอ่อนไหว ห้ามเก็บใน repo สาธารณะเด็ดขาด');
  }
  step(`ตรวจแล้ว: ${url} เป็น private ✅`);
} catch {
  console.log('⚠️  ตรวจ visibility ของ devconfig ไม่ได้ (ไม่มี gh หรือไม่ได้ล็อกอิน)');
  console.log('    ยืนยันเองว่า repo นี้เป็น private ก่อนไปต่อ — memory มีข้อมูลอ่อนไหว');
}

const store = join(devconfig, 'claude-memory');

/* ── 3. ถ้า memory ยังเป็นโฟลเดอร์จริง ให้ย้ายไฟล์เข้า devconfig ─── */
const isLink = existsSync(memDir) && lstatSync(memDir).isSymbolicLink();

if (isLink) {
  console.log('\n✅ เชื่อมไว้อยู่แล้ว — ไม่ต้องทำอะไร');
  console.log(`   ${memDir}  ->  (junction)`);
  process.exit(0);
}

if (!DRY) mkdirSync(store, { recursive: true });

if (existsSync(memDir)) {
  const files = readdirSync(memDir);
  const clash = files.filter((f) => existsSync(join(store, f)));
  if (clash.length) {
    die(
      `ไฟล์ต่อไปนี้มีอยู่แล้วทั้งสองที่: ${clash.join(', ')}`,
      'ตรวจด้วยตัวเองว่าจะเก็บฉบับไหน แล้วลบอีกฝั่งออกก่อน — สคริปต์นี้ไม่เขียนทับ memory ให้',
    );
  }
  step(`ย้ายไฟล์ memory ${files.length} ไฟล์ -> ${store}`);
  if (!DRY) {
    // ใช้ copy+unlink ไม่ใช่ rename เพราะ memory อยู่ C: แต่ repo อาจอยู่ D: (rename ข้ามไดรฟ์ = EXDEV)
    // และตรวจขนาดไฟล์ปลายทางก่อนลบต้นทางทุกไฟล์ — memory หายแล้วเอาคืนไม่ได้
    for (const f of files) {
      const from = join(memDir, f);
      const to = join(store, f);
      copyFileSync(from, to);
      if (statSync(to).size !== statSync(from).size) die(`คัดลอก ${f} ไม่ครบ`, 'หยุดก่อน ยังไม่ลบต้นฉบับ — ตรวจพื้นที่ดิสก์');
      unlinkSync(from);
    }
    rmdirSync(memDir); // ต้องว่างก่อน ไม่งั้น rmdir จะ error เอง — ตั้งใจให้เป็นแบบนั้น
  }
} else {
  step(`ยังไม่มีโฟลเดอร์ memory เดิม — จะสร้าง junction ใหม่เลย`);
}

/* ── 4. สร้าง junction ─────────────────────────────────────────────── */
// ใช้ junction (mklink /J) ไม่ใช่ symlink เพราะ Windows ต้องใช้สิทธิ์ admin
// หรือเปิด Developer Mode ถึงจะสร้าง symlink ได้ ส่วน junction สร้างได้ด้วยสิทธิ์ปกติ
step(`สร้าง junction: ${memDir} -> ${store}`);
if (!DRY) {
  if (platform() === 'win32') {
    execFileSync('cmd', ['/c', 'mklink', '/J', memDir, store], { stdio: 'pipe' });
  } else {
    execFileSync('ln', ['-s', store, memDir]);
  }
}

/* ── 5. ตรวจผล ────────────────────────────────────────────────────── */
if (DRY) {
  console.log('\n[dry-run] ยังไม่ได้แตะไฟล์จริง — ตัดคำสั่ง --dry-run ออกเพื่อทำจริง\n');
  process.exit(0);
}

if (!lstatSync(memDir).isSymbolicLink()) die('สร้าง junction แล้วแต่ตรวจไม่เจอ', 'ตรวจสิทธิ์การเขียนใน ~/.claude/projects');
const n = readdirSync(memDir).length;
console.log(`\n✅ เชื่อมแล้ว — memory ${n} ไฟล์อยู่ใน ${store} และ sync ข้ามเครื่องด้วย git ได้`);
console.log(`   อย่าลืม commit + push ใน repo devconfig ด้วย`);
console.log(`   ย้ายโฟลเดอร์โปรเจกต์เมื่อไร ให้รันคำสั่งนี้ใหม่อีกครั้ง\n`);
