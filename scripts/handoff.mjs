#!/usr/bin/env node
/**
 * handoff.mjs — เก็บงานที่ค้างอยู่บนเครื่องนี้ขึ้น origin ก่อนย้ายไปอีกเครื่อง
 *
 *   npm run handoff
 *
 * ใช้คู่กับ `npm run resume` บนเครื่องปลายทาง
 * มีไว้เพราะตั้งแต่ 2026-09-05 ทำงานข้าม 2 เครื่อง (PC บ้าน / โน้ตบุคที่ทำงาน)
 * และไม่มีเครื่องไหนเปิดค้างให้รีโมทเข้า ⇒ git คือช่องทางเดียวที่งานข้ามเครื่องได้
 *
 * ⚠️ คำสั่งนี้ commit + push ให้อัตโนมัติ — ตาม [SAFETY] ใน AGENTS.md
 *    ผู้ใช้ต้องเป็นคนรันเอง ห้าม agent เรียกคำสั่งนี้แทน
 *
 * ปลอดภัยเรื่องข้อมูลหลุด: .gitignore เดิมกัน .env*, .chrome-test-profiles/, tmp/,
 * dist, node_modules, .claude/settings.local.json ไว้ครบแล้ว และ git ไม่กวาด
 * .claude/worktrees/ เพราะเป็น registered worktree (ยืนยันด้วย git add -A --dry-run แล้ว)
 */
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

const run = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
const show = (args) => execFileSync('git', args, { stdio: 'inherit' });

const die = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error('');
  process.exit(1);
};

const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);

/* ── กัน push เข้า master โดยไม่ตั้งใจ ─────────────────────────────── */
// push เข้า master = .github/workflows/deploy.yml ยิงขึ้น production ทันที
// handoff เป็นการ "พักงานกลางคัน" ซึ่งไม่ควรเป็นสิ่งที่ deploy ออกไปหาประชาชน
if (branch === 'master' || branch === 'HEAD') {
  die(
    `handoff จาก branch "${branch}" ไม่ได้`,
    'push เข้า master = deploy ขึ้น production ทันที — ย้ายงานไป branch ใหม่ก่อน: git switch -c feat/<ชื่องาน>',
  );
}

/* ── เตือนเรื่อง worktree ที่มีงานค้าง ───────────────────────────── */
// worktree ที่ยังไม่ merge จะไม่ถูก push ไปด้วย ⇒ ย้ายเครื่องแล้วมองไม่เห็นงานนั้น
const worktrees = run(['worktree', 'list'])
  .split('\n')
  .slice(1)
  .filter(Boolean);
if (worktrees.length) {
  console.log(`\n⚠️  มี worktree แยกอีก ${worktrees.length} ตัว — งานในนั้นไม่ถูก push ไปด้วย`);
  for (const w of worktrees) console.log(`     ${w}`);
  console.log('     ถ้ามีงานค้างในนั้น ให้ commit + push จากใน worktree เองก่อน');
}

/* ── commit ของค้างทั้งหมด ───────────────────────────────────────── */
const dirty = run(['status', '--porcelain', '-uall']);
if (dirty) {
  console.log(`\nไฟล์ที่จะเก็บขึ้นไป (${dirty.split('\n').length} รายการ):`);
  show(['status', '--short', '-uall']);

  run(['add', '-A']);

  // กันเคสที่ทุกอย่างที่เปลี่ยนถูก gitignore ⇒ add แล้วไม่มีอะไรใน index จริง
  const staged = run(['diff', '--cached', '--name-only']);
  if (!staged) {
    console.log('\n(ไฟล์ที่เปลี่ยนถูก gitignore ทั้งหมด — ไม่มีอะไรต้อง commit)');
  } else {
    const msg = `wip(handoff): ${hostname()} @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    run(['commit', '-m', msg]);
    console.log(`\n✅ commit แล้ว: ${msg}`);
  }
} else {
  console.log('\nไม่มีของค้าง — ข้ามขั้น commit');
}

/* ── push ─────────────────────────────────────────────────────────── */
const upstream = (() => {
  try {
    return run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch {
    return null;
  }
})();

const ahead = upstream ? Number(run(['rev-list', '--count', `${upstream}..HEAD`])) : null;
if (upstream && ahead === 0) {
  console.log(`✅ ${branch} ตรงกับ ${upstream} อยู่แล้ว ไม่ต้อง push`);
} else {
  console.log(`\nกำลัง push ${branch} ขึ้น origin...`);
  show(['push', '-u', 'origin', 'HEAD']);
}

/* ── ตรวจซ้ำว่าไม่มีอะไรตกค้าง ──────────────────────────────────── */
const left = run(['status', '--porcelain', '-uall']);
console.log('');
if (left) {
  console.log('⚠️  ยังมีของค้างอยู่ (ผิดปกติ — ตรวจดูก่อนปิดเครื่อง):');
  console.log(left);
} else {
  console.log(`✅ เรียบร้อย — ไปที่อีกเครื่องแล้วรัน:  npm run resume ${branch}`);
}
console.log('');
