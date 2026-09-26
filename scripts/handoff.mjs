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
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { findDevconfig, isDevconfigRepo, scanForSecrets } from './lib/devconfig.mjs';

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
// worktree อื่นไม่ถูก handoff พาไปด้วย ⇒ ย้ายเครื่องแล้วมองไม่เห็นงานในนั้น
//
// เดิมข้อนี้ list worktree "ทุกตัว" ทุกครั้ง — พอสะสมถึง 66 ตัวก็กลายเป็นกำแพงข้อความ
// ที่ไม่มีใครอ่าน และตัวที่มีงานค้างจริงก็จมหายไปในนั้น (ค้างจริง 8 ตัวโดยไม่มีใครรู้)
// ⇒ รายงานเฉพาะตัวที่ "มีของยังไม่ commit" หรือ "มี commit ยังไม่ push" เท่านั้น
//
// ไม่ commit ให้อัตโนมัติโดยตั้งใจ: worktree ที่ค้างอยู่อาจมี merge ที่ conflict ค้างกลางทาง
// (เจอจริง wt-patient-review-20260919) ซึ่ง commit ทับไปเฉยๆ จะกลายเป็นขยะที่กู้ยากกว่าเดิม
// เทียบกับ --show-toplevel ไม่ใช่ cwd เพราะถ้าเรียกจากโฟลเดอร์ย่อย cwd จะไม่ตรงกับราก
const norm = (p) => p.replace(/\\/g, '/').replace(/\/$/, '');
const here = norm(run(['rev-parse', '--show-toplevel']));
const otherTrees = run(['worktree', 'list', '--porcelain'])
  .split('\n')
  .filter((l) => l.startsWith('worktree '))
  .map((l) => l.slice('worktree '.length))
  .filter((w) => norm(w) !== here);

const stale = [];
for (const w of otherTrees) {
  const st = spawnSync('git', ['-C', w, 'status', '--porcelain', '-uall'], { encoding: 'utf8' });
  if (st.status !== 0) continue; // โฟลเดอร์ถูกลบไปแล้วแต่ยังค้างทะเบียน — git worktree prune จัดการเอง
  const files = st.stdout.split('\n').filter(Boolean).length;

  // commit ที่ยังไม่ push: เทียบกับ upstream ถ้ามี ถ้าไม่มีให้เทียบกับ origin/master
  const head = spawnSync('git', ['-C', w, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const up = spawnSync('git', ['-C', w, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { encoding: 'utf8' });
  const ref = up.status === 0 ? up.stdout.trim() : 'origin/master';
  const cnt = spawnSync('git', ['-C', w, 'rev-list', '--count', `${ref}..HEAD`], { encoding: 'utf8' });
  const unpushed = cnt.status === 0 ? Number(cnt.stdout.trim()) : 0;

  if (files || unpushed) stale.push({ w, head, files, unpushed });
}

if (stale.length) {
  console.log(`\n⚠️  worktree ที่มีงานค้าง ${stale.length} ตัว (จากทั้งหมด ${otherTrees.length}) — handoff ไม่พาไปให้`);
  for (const s of stale) {
    const bits = [s.files ? `ยังไม่ commit ${s.files} ไฟล์` : null, s.unpushed ? `ยังไม่ push ${s.unpushed} commit` : null]
      .filter(Boolean)
      .join(' · ');
    console.log(`     ${s.w}  [${s.head}]  ${bits}`);
  }
  console.log('     ถ้าเป็นงานที่ต้องใช้ต่อที่อีกเครื่อง ให้ commit + push จากในนั้นเองก่อน');
} else if (otherTrees.length) {
  console.log(`\n✅ worktree อีก ${otherTrees.length} ตัว สะอาดและ push แล้วทั้งหมด`);
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

/* ── devconfig: memory ของ Claude + .env.local ───────────────────── */
// resume pull devconfig ให้อยู่แล้ว แต่เดิม handoff ไม่ push กลับ ⇒ ไม่สมมาตร
// ผลจริง: memory กองอยู่เครื่องเดียว 34 ไฟล์ 3 สัปดาห์ โดยไม่มีอะไรฟ้อง (2026-09-07 → 09-26)
// ไปนั่งอีกเครื่องแล้ว Claude ไม่รู้เรื่องงานช่วงนั้นเลย แล้วเสนอของที่เคยตัดทิ้งไปแล้วซ้ำ
const devconfig = findDevconfig();
let devconfigOk = true;

if (!isDevconfigRepo(devconfig)) {
  devconfigOk = false;
  console.log(`\n⚠️  ไม่พบ repo devconfig ที่ ${devconfig}`);
  console.log('    memory ของ Claude จะไม่ข้ามเครื่อง — เก็บไว้ที่อื่น? ตั้งตัวแปร SMARTLOCAL_DEVCONFIG');
} else {
  const dc = (args, opts = {}) => spawnSync('git', ['-C', devconfig, ...args], { encoding: 'utf8', ...opts });

  // แตะเฉพาะ claude-memory/ — env/.env.local ต้องผ่าน npm run env:push ที่มีด่านกัน key ฝั่ง server
  const pending = dc(['status', '--porcelain', '-uall', '--', 'claude-memory']).stdout.split('\n').filter(Boolean);

  if (pending.length) {
    // ls-files ให้ path ดิบ ไม่ต้องแกะคอลัมน์สถานะและไม่โดน core.quotepath หนีอักขระ
    const files = dc(['ls-files', '-mo', '--exclude-standard', '--', 'claude-memory']).stdout.split('\n').filter(Boolean);

    // ด่านคีย์: handoff push ให้เองโดยคนไม่ได้อ่านก่อน จึงต้องมีตัวกันแทนสายตาคน
    const hits = scanForSecrets((f) => {
      try {
        return readFileSync(join(devconfig, f), 'utf8');
      } catch {
        return null;
      }
    }, files);

    if (hits.length) {
      console.error('\n❌ เจอรูปแบบคีย์จริงในไฟล์ memory ที่กำลังจะขึ้น repo:');
      for (const h of hits) console.error(`     ${h.file}  (${h.name})`);
      die('หยุดก่อน ยังไม่ commit อะไรใน devconfig', 'ลบค่าคีย์ออกจากไฟล์พวกนี้ก่อน แล้วรัน npm run handoff ใหม่');
    }

    console.log(`\nเก็บ memory ${pending.length} ไฟล์ขึ้น devconfig...`);
    dc(['add', '--', 'claude-memory']);
    const msg = `memory: ${hostname()} @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const c = dc(['commit', '-m', msg], { stdio: 'inherit' });
    if (c.status !== 0) {
      devconfigOk = false;
      console.log('⚠️  commit devconfig ไม่สำเร็จ');
    } else {
      console.log(`✅ commit แล้ว: ${msg}`);
    }
  }

  // push แยกจาก commit เสมอ — รอบก่อนอาจ commit ไว้แล้วแต่ push ไม่ผ่าน
  const aheadDc = dc(['rev-list', '--count', '@{u}..HEAD']);
  const n = aheadDc.status === 0 ? Number(aheadDc.stdout.trim()) : null;
  if (n === null) {
    devconfigOk = false;
    console.log('⚠️  devconfig ไม่มี upstream — ตรวจว่า clone มาถูก remote');
  } else if (n > 0) {
    console.log(`push devconfig (${n} commit)...`);
    if (dc(['push'], { stdio: 'inherit' }).status !== 0) {
      devconfigOk = false;
      // จุดที่เคยพังเงียบมาแล้ว ห้ามปล่อยผ่านเป็นความสำเร็จเด็ดขาด
      console.log('⚠️  push devconfig ไม่สำเร็จ — memory ยังอยู่แค่เครื่องนี้');
    }
  }
}

/* ── ตรวจซ้ำว่าไม่มีอะไรตกค้าง ──────────────────────────────────── */
const left = run(['status', '--porcelain', '-uall']);
console.log('');
if (left) {
  console.log('⚠️  ยังมีของค้างอยู่ (ผิดปกติ — ตรวจดูก่อนปิดเครื่อง):');
  console.log(left);
} else if (!devconfigOk) {
  console.log('⚠️  โค้ดขึ้น origin แล้ว แต่ memory ยังไม่ครบ — แก้ให้จบก่อนไปอีกเครื่อง');
  console.log(`   ไม่งั้นที่นั่น Claude จะไม่รู้เรื่องที่คุยกันไว้`);
} else {
  console.log(`✅ เรียบร้อย — ไปที่อีกเครื่องแล้วรัน:  npm run resume ${branch}`);
}
console.log('');
process.exit(devconfigOk ? 0 : 1);
