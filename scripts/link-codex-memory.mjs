#!/usr/bin/env node
/**
 * link-codex-memory.mjs — ตั้ง git ของเราเองให้ sync memory ของ Codex ข้ามเครื่อง (ครั้งเดียวต่อเครื่อง)
 *
 *   npm run codex:link
 *
 * ทำไมไม่ใช้ .git ที่ Codex สร้างไว้ใน ~/.codex/memories: Codex ล้างแล้วสร้างใหม่เองได้ทุกเมื่อ
 * (baseline 09-24 บน GitHub · สร้างใหม่อีกรอบ 09-28) remote ที่ต่อไว้หายทุกรอบ ประวัติไม่ต่อกันอีกเลย
 * ⇒ clone ไว้เป็น git dir แยก (ข้างทรีหลัก) แล้วชี้ core.worktree มาที่โฟลเดอร์ของ Codex
 *    git ไม่ track entry ที่ชื่อ .git ในทรีเด็ดขาด Codex จะทำอะไรกับ .git ของมันก็ไม่กระทบ
 *
 * ⚠️ ห้ามใช้ `git init --separate-git-dir` — มันเขียนไฟล์ชื่อ .git ทับโฟลเดอร์ .git ของ Codex
 *
 * ไม่ลบ ไม่เขียนทับไฟล์ของ Codex ที่มีอยู่ — หาว่าไฟล์ในเครื่องตรงกับ commit ไหนในประวัติมากที่สุด
 * แล้วตั้งเป็นจุดเริ่ม ⇒ ที่ต่างจากจุดนั้นคือ "ของใหม่ของเครื่องนี้" handoff จะรวมกับของอีกเครื่องให้แบบ 3 ทาง
 * ยกเว้นโฟลเดอร์ที่ยังไม่มีไฟล์ของ Codex สักไฟล์ (เครื่องใหม่) ดึงลงมาทั้งหมด เพราะไม่มีอะไรให้ทับ
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { CODEX_MEMORY_REMOTE, findCodexMemory, findCodexSync } from './lib/devconfig.mjs';

const work = findCodexMemory();
const sync = findCodexSync();
const remote = process.env.SMARTLOCAL_CODEX_REMOTE ?? CODEX_MEMORY_REMOTE;

const git = (args, opts = {}) =>
  spawnSync('git', ['-C', work, '--git-dir', sync, '--work-tree', work, ...args], { encoding: 'utf8', ...opts });
const out = (args) => {
  const r = git(args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}\n${r.stderr}`);
  return r.stdout.trim();
};
const lines = (s) => s.split('\n').filter(Boolean);
const die = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error('');
  process.exit(1);
};

console.log(`\nmemory ของ Codex : ${work}`);
console.log(`git ของเราเอง   : ${sync}`);

/* ── ตั้งไว้แล้ว = ตรวจแล้วจบ (รันซ้ำได้ ไม่ทำอะไรซ้ำ) ───────────────── */
if (existsSync(sync)) {
  if (!existsSync(`${sync}/HEAD`)) die(`มีโฟลเดอร์ ${sync} อยู่แล้วแต่ไม่ใช่ git`, 'ย้ายโฟลเดอร์นั้นออกไปก่อน แล้วรันใหม่ (ไม่ลบให้)');
  const wt = spawnSync('git', ['--git-dir', sync, 'config', 'core.worktree'], { encoding: 'utf8' }).stdout.trim();
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  if (norm(wt) !== norm(work)) die(`git ตัวนี้ชี้ไปที่ ${wt || '(ไม่ได้ตั้ง)'} ไม่ใช่ ${work}`, 'ตรวจตัวแปร SMARTLOCAL_CODEX_MEMORY / SMARTLOCAL_CODEX_SYNC');
  if (!existsSync(work)) mkdirSync(work, { recursive: true });
  // ซ่อมสายไป GitHub ถ้าหลุด (รันซ้ำได้ ไม่เปลี่ยนอะไรถ้าถูกอยู่แล้ว)
  spawnSync('git', ['--git-dir', sync, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  const branch = out(['symbolic-ref', '--short', 'HEAD']);
  if (git(['rev-parse', '--abbrev-ref', '@{u}']).status !== 0) {
    out(['fetch', '--quiet', 'origin']);
    out(['branch', `--set-upstream-to=origin/${branch}`, branch]);
    console.log('   ซ่อมสายไป GitHub ให้แล้ว (upstream หลุด)');
  }
  const pending = lines(out(['status', '--porcelain', '-uall'])).length;
  console.log(`\n✅ ตั้งไว้แล้ว — ของในเครื่องที่ยังไม่ได้ส่งขึ้น ${pending} ไฟล์ (npm run handoff จัดการให้)\n`);
  process.exit(0);
}

/* ── ตั้งครั้งแรก ─────────────────────────────────────────────────── */
console.log(`\nกำลังดึงประวัติจาก ${remote} ...`);
const cl = spawnSync('git', ['clone', '--bare', '--quiet', remote, sync], { encoding: 'utf8' });
if (cl.status !== 0) die('clone ไม่สำเร็จ', (cl.stderr.trim().split('\n').at(-1) ?? '') + ' — เน็ต/สิทธิ์เข้า repo? (gh auth status)');

// clone --bare ไม่ตั้ง refspec ของ remote-tracking ⇒ @{u} จะไม่มี handoff/resume ใช้ต่อไม่ได้
spawnSync('git', ['--git-dir', sync, 'config', 'core.bare', 'false']);
spawnSync('git', ['--git-dir', sync, 'config', 'core.worktree', work]);
spawnSync('git', ['--git-dir', sync, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
// clone --bare ปิด reflog ไว้ — เปิดคืน จะได้ย้อนกลับได้ถ้าวันหนึ่งมีอะไรเขียนทับ
spawnSync('git', ['--git-dir', sync, 'config', 'core.logAllRefUpdates', 'true']);
if (!existsSync(work)) mkdirSync(work, { recursive: true });
out(['fetch', '--quiet', 'origin']);
const branch = out(['symbolic-ref', '--short', 'HEAD']);
out(['branch', `--set-upstream-to=origin/${branch}`, branch]);

// หาจุดเริ่ม: commit ที่ไฟล์ในเครื่องต่างน้อยที่สุด (ใหม่สุดชนะเมื่อเท่ากัน)
// วัดด้วยการใส่ tree ของแต่ละ commit ลง index อย่างเดียว (read-tree ไม่แตะไฟล์ในเครื่อง)
// ดูย้อนหลังแค่ 200 commit — เครื่องที่ห่างไปนานกว่านั้นถือเป็น "ของใหม่ของเครื่องนี้" ทั้งก้อน ยังไม่หายอยู่ดี
const commits = lines(out(['rev-list', '--max-count=200', `origin/${branch}`]));
const tracked = (c) => lines(out(['ls-tree', '-r', '--name-only', c]));
const presentCount = tracked(commits[0]).filter((f) => existsSync(`${work}/${f}`)).length;

if (presentCount === 0) {
  // เครื่องใหม่: ยังไม่มีไฟล์ของ Codex สักไฟล์ที่ตรงกับบน GitHub ⇒ ดึงลงมาทั้งหมด ไม่มีอะไรให้ทับ
  out(['read-tree', commits[0]]);
  out(['checkout-index', '-a']);
  console.log(`\n✅ ดึง memory ของ Codex ลงมาแล้ว ${tracked(commits[0]).length} ไฟล์ (เครื่องนี้ยังไม่มีของเดิม)`);
} else {
  let best = null;
  for (const c of commits) {
    out(['read-tree', c]);
    const diff = lines(out(['diff', '--name-only'])).length + lines(out(['ls-files', '--others', '--exclude-standard'])).length;
    if (!best || diff < best.diff) best = { c, diff };
    if (diff === 0) break;
  }
  out(['update-ref', `refs/heads/${branch}`, best.c]);
  out(['read-tree', best.c]);
  const behind = Number(out(['rev-list', '--count', `${best.c}..origin/${branch}`]));
  console.log(`\n✅ ตั้งจุดเริ่มที่ ${best.c.slice(0, 7)} — ไฟล์ในเครื่องต่างจากจุดนั้น ${best.diff} ไฟล์ (ของใหม่ของเครื่องนี้ ไม่ถูกทับ)`);
  if (behind) console.log(`   บน GitHub มีของใหม่กว่าจุดนั้น ${behind} commit — รวมให้ตอน handoff / resume`);
}

console.log('\nต่อจากนี้ handoff / resume / doctor ดูแลให้เอง ไม่ต้องรันคำสั่งนี้อีก');
console.log('ถ้ามีของที่ยังไม่ได้ส่งขึ้น: npm run handoff\n');
