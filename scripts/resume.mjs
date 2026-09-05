#!/usr/bin/env node
/**
 * resume.mjs — รับงานต่อจากอีกเครื่อง (คู่กับ `npm run handoff`)
 *
 *   npm run resume                 ทำงานต่อบน branch ปัจจุบัน
 *   npm run resume <branch>        สลับไป branch นั้นแล้วดึงงานล่าสุด
 *   npm run resume <branch> --restore   คืน working tree ให้เหมือนตอน handoff เป๊ะ
 *
 * โหมดปกติ **ไม่** ถอน commit wip ทิ้ง — ทำงานต่อทับแล้วค่อย squash ตอนเปิด PR
 * เหตุผล: ถ้าถอนทุกครั้ง branch จะถอยหลังจาก origin ⇒ push ครั้งถัดไปต้องใช้
 * --force-with-lease ตลอด ซึ่งพังทันทีถ้า branch นั้นมี PR เปิดอยู่หรือ CI แตะ
 * --restore จึงมีไว้ให้เลือกเอง และปฏิเสธถ้าตรวจพบ PR ที่ยังเปิด
 */
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const RESTORE = args.includes('--restore');
const target = args.find((a) => !a.startsWith('--')) ?? null;

const run = (cmdArgs) => execFileSync('git', cmdArgs, { encoding: 'utf8' }).trim();
const show = (cmdArgs) => execFileSync('git', cmdArgs, { stdio: 'inherit' });
const tryRun = (cmdArgs, fallback = null) => {
  try {
    return run(cmdArgs);
  } catch {
    return fallback;
  }
};

const die = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error('');
  process.exit(1);
};

/* ── ห้ามทับของค้างในเครื่องนี้ ──────────────────────────────────── */
// ถ้าเครื่องนี้มีงานที่ยังไม่ได้เก็บ การดึงงานจากอีกเครื่องมาทับคือทางที่งานหาย
const dirty = run(['status', '--porcelain', '-uall']);
if (dirty) {
  console.error('\nของค้างในเครื่องนี้:');
  console.error(dirty);
  die('เครื่องนี้มีงานที่ยังไม่ได้เก็บ', 'รัน npm run handoff บนเครื่องนี้ก่อน หรือ git stash ถ้าตั้งใจจะทิ้ง');
}

console.log('\nกำลังดึงข้อมูลล่าสุดจาก origin...');
show(['fetch', '--prune', 'origin']);

/* ── สลับ branch ถ้าระบุมา ───────────────────────────────────────── */
if (target) {
  const exists = tryRun(['rev-parse', '--verify', `refs/heads/${target}`]);
  if (exists) show(['switch', target]);
  else {
    const remote = tryRun(['rev-parse', '--verify', `refs/remotes/origin/${target}`]);
    if (!remote) die(`ไม่พบ branch "${target}" ทั้งในเครื่องและบน origin`, 'ตรวจชื่ออีกที: git branch -a');
    show(['switch', '-c', target, '--track', `origin/${target}`]);
  }
}

const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
const upstream = tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);

/* ── ดึงงานล่าสุดแบบ fast-forward เท่านั้น ──────────────────────── */
// --ff-only โดยตั้งใจ: ถ้า merge ตรงๆ ไม่ได้ แปลว่าสองเครื่องแตกกัน
// ซึ่งต้องให้คนตัดสินใจ ไม่ใช่ให้สคริปต์สร้าง merge commit มั่วๆ
if (!upstream) {
  console.log(`\n⚠️  ${branch} ยังไม่มี upstream บน origin — ข้ามการดึงงาน`);
} else {
  const behind = Number(run(['rev-list', '--count', `HEAD..${upstream}`]));
  if (behind === 0) {
    console.log(`\n✅ ${branch} ใหม่ล่าสุดอยู่แล้ว`);
  } else {
    console.log(`\nดึง ${behind} commit จาก ${upstream}...`);
    try {
      show(['merge', '--ff-only', upstream]);
    } catch {
      die(
        `${branch} กับ ${upstream} แตกสายกัน (fast-forward ไม่ได้)`,
        'แปลว่าสองเครื่องแก้คนละทาง — ต้องตัดสินใจเอง: git log --oneline --graph HEAD...' + upstream,
      );
    }
  }
}

/* ── --restore: คืน working tree ให้เหมือนตอน handoff ───────────── */
if (RESTORE) {
  const subject = run(['log', '-1', '--format=%s']);
  if (!subject.startsWith('wip(handoff):')) {
    die(`commit ล่าสุดไม่ใช่ handoff (${subject})`, 'ไม่มีอะไรให้คืนสภาพ — ใช้โหมดปกติได้เลย');
  }
  // ถอน commit แล้ว branch จะถอยหลังจาก origin ⇒ push ครั้งถัดไปต้อง force
  // ถ้า branch นี้มี PR เปิดอยู่ การ force จะทับ commit ที่คนอื่นรีวิวไปแล้ว
  const pr = spawnSync('gh', ['pr', 'view', branch, '--json', 'state,number'], { encoding: 'utf8' });
  if (pr.status === 0) {
    die(`branch ${branch} มี PR เปิดอยู่ (${pr.stdout.trim()})`, 'ห้ามใช้ --restore กับ branch ที่มี PR — จะต้อง force push ทับของที่รีวิวไปแล้ว');
  }
  run(['reset', '--mixed', 'HEAD~1']);
  console.log(`\n✅ คืนสภาพแล้ว — ไฟล์กลับมาเป็น "แก้แล้วยังไม่ commit" เหมือนตอนออกจากอีกเครื่อง`);
  console.log('   ⚠️ branch นี้ถอยหลังจาก origin 1 commit แล้ว — handoff ครั้งหน้าจะต้อง push แบบ force');
}

/* ── ดึง memory/env จาก repo devconfig ถ้ามี ─────────────────────── */
// devconfig เป็น private repo แยก เก็บ .env.local + memory ของ Claude
// ต้อง pull ก่อนเริ่มงาน ไม่งั้นสองเครื่องแก้ memory คนละทางแล้ว conflict
const devconfig = process.env.SMARTLOCAL_DEVCONFIG ?? null;
if (devconfig) {
  console.log(`\nดึง devconfig ล่าสุด (${devconfig})...`);
  const r = spawnSync('git', ['-C', devconfig, 'pull', '--ff-only'], { stdio: 'inherit' });
  if (r.status !== 0) console.log('⚠️  pull devconfig ไม่สำเร็จ — ตรวจเองอีกที');
}

/* ── ตรวจความพร้อมของเครื่องนี้ต่อ ──────────────────────────────── */
console.log('\n─── ตรวจความพร้อมเครื่อง (npm run doctor) ───');
const doctor = spawnSync(process.execPath, ['scripts/doctor.mjs'], { stdio: 'inherit' });
process.exit(doctor.status ?? 0);
