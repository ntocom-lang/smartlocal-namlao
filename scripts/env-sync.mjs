#!/usr/bin/env node
/**
 * env-sync.mjs — ย้าย .env.local ระหว่างโปรเจกต์กับ repo devconfig (private)
 *
 *   npm run env:pull              devconfig -> โปรเจกต์  (ตั้งเครื่องใหม่ / รับค่าที่อีกเครื่องแก้)
 *   npm run env:push              โปรเจกต์ -> devconfig  (แก้คีย์ในเครื่องแล้วส่งกลับ)
 *   npm run env:pull -- <path>    ระบุ path ของ devconfig เอง
 *
 * ทำไมไม่เก็บใน repo หลัก: repo หลักเป็น public และ .github/workflows/deploy.yml
 * จะ exit 1 ทันทีถ้าเจอ .env.local ใน working tree ของ CI (กัน VITE_TENANT_SLUG
 * หลุดลงบันเดิลจนทุก อปท. กลายเป็นตัวเดียวกัน — เกิดจริง 2026-08-28)
 *
 * ⚠️ รับเฉพาะตัวแปร VITE_* เท่านั้น ตัวแปรอื่น = คีย์ฝั่ง server ซึ่งห้ามอยู่ในไฟล์นี้
 *    ของพวกนั้นอยู่ใน GitHub Secrets ที่อ่านกลับออกมาไม่ได้ตามที่ควรเป็น
 */
import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const PUSH = argv.includes('--push');
const explicit = argv.find((a) => !a.startsWith('--')) ?? null;

const die = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error('');
  process.exit(1);
};

const devconfig = resolve(explicit ?? process.env.SMARTLOCAL_DEVCONFIG ?? join('..', 'smartlocal-devconfig'));
if (!existsSync(devconfig)) {
  die(`ไม่พบ repo devconfig ที่ ${devconfig}`, 'clone มาก่อน แล้วส่ง path มา หรือกำหนดตัวแปร SMARTLOCAL_DEVCONFIG');
}

const store = join(devconfig, 'env', '.env.local');
const local = '.env.local';
const [from, to] = PUSH ? [local, store] : [store, local];

if (!existsSync(from)) die(`ไม่พบไฟล์ต้นทาง ${from}`, PUSH ? 'ยังไม่มี .env.local ในโปรเจกต์' : 'ยังไม่มีไฟล์ใน devconfig — ใช้ npm run env:push ส่งขึ้นไปก่อน');

/* ── กันคีย์ฝั่ง server หลุดเข้าไฟล์นี้ ─────────────────────────────── */
// vite ฝังเฉพาะตัวแปรที่ขึ้นต้น VITE_ ลงบันเดิล ⇒ ค่าพวกนั้นเป็นสาธารณะโดยธรรมชาติอยู่แล้ว
// ตัวแปรอื่นแปลว่ามีคนเผลอเอาคีย์ฝั่ง server มาใส่ ซึ่งเป็นคนละระดับความเสี่ยงกันเลย
const badKeys = readFileSync(from, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/))
  .filter(Boolean)
  .map((m) => m[1])
  .filter((k) => !k.startsWith('VITE_'));

if (badKeys.length) {
  die(
    `${from} มีตัวแปรที่ไม่ใช่ VITE_: ${badKeys.join(', ')}`,
    'คีย์ฝั่ง server ห้ามอยู่ในไฟล์นี้ — ย้ายไป GitHub Secrets หรือ wrangler secret แทน',
  );
}

/* ── เตือนก่อนเขียนทับของที่ต่างกัน ───────────────────────────────── */
if (existsSync(to) && readFileSync(to, 'utf8') !== readFileSync(from, 'utf8')) {
  const backup = `${to}.bak.${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}`;
  copyFileSync(to, backup);
  console.log(`⚠️  ปลายทางเดิมต่างจากต้นทาง — สำรองไว้ที่ ${backup}`);
}

copyFileSync(from, to);
const n = readFileSync(to, 'utf8').split(/\r?\n/).filter((l) => /^\s*VITE_/.test(l)).length;
console.log(`\n✅ ${PUSH ? 'ส่งขึ้น devconfig' : 'ดึงลงโปรเจกต์'}แล้ว — ${n} ตัวแปร VITE_`);
console.log(`   ${from}  ->  ${to}`);
if (PUSH) console.log(`   อย่าลืม commit + push ใน repo devconfig`);
console.log('');
