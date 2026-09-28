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
 * รันได้ทั้งจาก branch งาน (โค้ด + memory) และจากทรีหลักบน master (memory อย่างเดียว)
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
import { gitIn, integrateUpstream, memoryRepos, scanForPersonalData, scanForSecrets } from './lib/devconfig.mjs';

const run = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
const show = (args) => execFileSync('git', args, { stdio: 'inherit' });
const tryRun = (args) => {
  try {
    return run(args, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};
const lines = (s) => (s ?? '').split('\n').filter(Boolean);
const stamp = () => `${hostname()} @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

const die = (msg, hint) => {
  console.error(`\n❌ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  console.error('');
  process.exit(1);
};

const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);

// push เข้า master = .github/workflows/deploy.yml ยิงขึ้น production ทันที
// handoff เป็นการ "พักงานกลางคัน" ซึ่งไม่ควรเป็นสิ่งที่ deploy ออกไปหาประชาชน ⇒ บน master ห้ามส่งโค้ด
// แต่ memory ต้องเก็บเสมอไม่ว่าอยู่ branch ไหน (ดูเหตุผลที่ส่วนโค้ดบน master ข้างล่าง)
const onMaster = branch === 'master' || branch === 'HEAD';

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

/* ── ส่วนโค้ด ─────────────────────────────────────────────────────── */
let codeOk = true;

if (onMaster) {
  // เดิมตรงนี้หยุดทั้งคำสั่งด้วย die() ⇒ ไปไม่ถึงขั้นเก็บ memory ข้างล่าง
  // แต่ทรีหลักอยู่บน master เป็นปกติ (AGENTS.md ห้ามสลับสาขาในทรีหลัก) คนจึงพิมพ์ handoff จากตรงนี้
  // แล้วถูกปฏิเสธทุกครั้ง ขณะที่ doctor บอกให้รัน handoff = ทางตัน
  // ผลจริง: memory ค้างอยู่บน PC 10 ไฟล์ (2026-09-26 → 28) ต้องไป push เองด้วยมือ
  console.log(`\nอยู่บน ${branch === 'HEAD' ? 'detached HEAD' : 'master'} — ไม่ส่งโค้ด (push เข้า master = deploy ขึ้น production ทันที) เก็บเฉพาะ memory`);

  const changes = lines(run(['status', '--porcelain', '-uall']));
  const tracked = changes.filter((l) => !l.startsWith('??'));
  const untracked = changes.length - tracked.length;

  if (tracked.length) {
    codeOk = false;
    console.log(`\n❌ มีไฟล์แก้ค้างบน ${branch} ${tracked.length} ไฟล์ — handoff ไม่ commit ให้ ของพวกนี้จึงไม่ข้ามเครื่อง`);
    for (const l of tracked.slice(0, 10)) console.log(`     ${l}`);
    if (tracked.length > 10) console.log(`     ... อีก ${tracked.length - 10} ไฟล์`);
    console.log('   ย้ายงานไป branch ก่อน: git switch -c feat/<ชื่องาน> แล้วรัน npm run handoff อีกรอบ');
  }
  if (untracked) {
    // ไฟล์ untracked ในทรีหลักมักเป็นของที่ session อื่นทิ้งไว้ (เช่น ภาพหน้าจอ) ไม่ใช่งานที่ต้องส่งต่อ
    // ถ้านับเป็นความล้มเหลว handoff จะแดงทุกวันจนคนเลิกอ่านผล ⇒ แจ้งให้เห็นอย่างเดียว
    console.log(`\n⚠️  มีไฟล์ใหม่ที่ยังไม่อยู่ใน git ${untracked} ไฟล์ — ไม่ข้ามเครื่อง (ดูรายการด้วย git status)`);
  }

  const ahead = Number(tryRun(['rev-list', '--count', 'origin/master..HEAD']) ?? 0);
  if (ahead) {
    codeOk = false;
    console.log(`\n❌ ${branch} ในเครื่องมี ${ahead} commit ที่ไม่มีบน origin — handoff ไม่ push ให้เพราะจะ deploy ทันที`);
    console.log('   ย้ายไป branch แล้วเปิด PR: git switch -c feat/<ชื่องาน>');
  }
} else {
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
      const msg = `wip(handoff): ${stamp()}`;
      run(['commit', '-m', msg]);
      console.log(`\n✅ commit แล้ว: ${msg}`);
    }
  } else {
    console.log('\nไม่มีของค้าง — ข้ามขั้น commit');
  }

  const upstream = tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const ahead = upstream ? Number(run(['rev-list', '--count', `${upstream}..HEAD`])) : null;
  if (upstream && ahead === 0) {
    console.log(`✅ ${branch} ตรงกับ ${upstream} อยู่แล้ว ไม่ต้อง push`);
  } else {
    console.log(`\nกำลัง push ${branch} ขึ้น origin...`);
    // push โค้ดพลาด (เน็ตหลุด / branch แตกสาย) ต้องไม่ทำให้ขั้น memory ข้างล่างถูกข้ามไปด้วย
    // เดิม execFileSync โยน error ออกไปทั้งสคริปต์ ⇒ memory ไม่ถูกแตะเลยแม้จะส่งได้
    try {
      show(['push', '-u', 'origin', 'HEAD']);
    } catch {
      codeOk = false;
      console.log(`⚠️  push ${branch} ไม่สำเร็จ — โค้ดยังอยู่แค่เครื่องนี้ (จะลองเก็บ memory ต่อให้)`);
    }
  }
}

/* ── repo ความจำของ AI ที่ต้องเก็บขึ้น cloud ด้วย ──────────────────── */
// resume pull ให้อยู่แล้ว แต่เดิม handoff ไม่ push กลับ ⇒ ไม่สมมาตร ผลจริงที่วัดได้ 2026-09-26:
//   Claude — memory กองอยู่เครื่องเดียว 34 ไฟล์ 3 สัปดาห์ (2026-09-07 → 09-26)
//   Codex  — 1,397 KB ไม่เคยขึ้น cloud เลยตั้งแต่ติดตั้ง (repo ไม่มี remote)
// ไปนั่งอีกเครื่องแล้ว AI ไม่รู้เรื่องงานช่วงนั้น แล้วเสนอของที่เคยตัดทิ้งไปแล้วซ้ำ
const syncMemoryRepo = (repo) => {
  const { label, pathspec, optional } = repo;
  if (!repo.present) {
    // optional = เครื่องนี้อาจไม่ได้ใช้ AI ตัวนั้น ไม่ควรทำให้ handoff ทั้งคำสั่งถือว่าล้มเหลว
    if (optional) return true;
    console.log(`\n⚠️  ${repo.missingMsg}`);
    console.log(`    ${repo.missingHint}`);
    return false;
  }

  const g = (args, opts) => gitIn(repo, args, opts);

  // ไม่มี upstream = commit ไปก็ไม่มีที่ให้ push ⇒ ตรวจก่อนแตะอะไร
  if (g(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).status !== 0) {
    console.log(`\n⚠️  ${label} ไม่มี upstream — ${repo.missingHint}`);
    return optional;
  }

  const scope = pathspec ? ['--', pathspec] : [];
  const pending = lines(g(['status', '--porcelain', '-uall', ...scope]).stdout);
  if (pending.length) {
    // ls-files ให้ path ดิบ ไม่ต้องแกะคอลัมน์สถานะและไม่โดน core.quotepath หนีอักขระ
    const files = lines(g(['ls-files', '-mo', '--exclude-standard', ...scope]).stdout);
    const read = (f) => {
      try {
        return readFileSync(join(repo.dir, f), 'utf8');
      } catch {
        return null;
      }
    };

    // ด่านคีย์: handoff push ให้เองโดยคนไม่ได้อ่านก่อน จึงต้องมีตัวกันแทนสายตาคน
    const hits = scanForSecrets(read, files);
    if (hits.length) {
      console.error(`\n❌ เจอรูปแบบคีย์จริงในไฟล์ของ ${label}:`);
      for (const h of hits) console.error(`     ${h.file}  (${h.name})`);
      die(`หยุดก่อน ยังไม่ commit อะไรใน ${label}`, 'ลบค่าคีย์ออกจากไฟล์พวกนี้ก่อน แล้วรัน npm run handoff ใหม่');
    }

    // ด่านข้อมูลส่วนบุคคล (PDPA) — memory ของ Codex เป็นของทุกโปรเจกต์ในเครื่อง มีงานอื่นปนมาด้วย
    // หยุดเฉพาะ repo นี้ (ยังไม่ commit) ส่วน repo อื่นยังเก็บตามปกติ จึงไม่ต้องมีตัวเลือกให้ข้าม
    // พิมพ์แค่ชื่อไฟล์กับชนิด ไม่พิมพ์ค่าที่เจอ — จอเทอร์มินัลก็ถูกจับภาพ/ส่งต่อได้
    const pii = scanForPersonalData(read, files);
    const blocked = pii.filter((h) => h.level === 'block');
    if (blocked.length) {
      console.log(`\n⛔ ${label}: เจอสิ่งที่หน้าตาเป็นข้อมูลส่วนบุคคล — รอบนี้ไม่ส่ง ${label} ขึ้น (ยังไม่ commit อะไร)`);
      for (const h of blocked) console.log(`     ${h.file}  (${h.name} ${h.count} จุด)`);
      console.log('    เปิดไฟล์ดู ถ้าเป็นข้อมูลของคนจริงให้ลบออก แล้วรัน npm run handoff ใหม่');
      console.log('    ถ้าเป็นเลขตัวอย่างที่จับผิด ให้ Claude ช่วยดูแล้วปรับด่านใน scripts/lib/devconfig.mjs');
      return false;
    }
    const noted = {};
    for (const h of pii) if (h.level === 'warn') noted[h.name] = (noted[h.name] ?? 0) + h.count;
    if (Object.keys(noted).length) {
      const bits = Object.entries(noted).map(([n, c]) => `${n} ${c} จุด`).join(' · ');
      console.log(`\nℹ️  ${label}: ไฟล์ที่จะส่งมี ${bits} — ไม่หยุด เพราะรูปแบบนี้ปนกับข้อมูลทั่วไปเยอะ`);
    }

    console.log(`\nเก็บ ${label} ${pending.length} ไฟล์...`);
    g(['add', '--', pathspec ?? '.']);
    const msg = `memory: ${stamp()}`;
    if (g(['commit', '-q', '-m', msg]).status !== 0) {
      console.log(`⚠️  commit ${label} ไม่สำเร็จ`);
      return false;
    }
    console.log(`✅ commit แล้ว: ${msg}`);
  }

  // ของที่อีกเครื่อง push ไว้ต้องรวมเข้ามาก่อน ไม่งั้น push ถูกปฏิเสธแล้วความจำค้างเครื่องเดียวต่อ
  const up = integrateUpstream(repo);
  if (!up.ok) {
    if (up.reason === 'fetch') {
      console.log(`⚠️  ติดต่อ origin ของ ${label} ไม่ได้ — เน็ตหลุด? ความจำยังอยู่แค่เครื่องนี้`);
      if (up.detail) console.log(`    ${up.detail}`);
    } else if (up.reason === 'dirty') {
      console.log(`⚠️  ${label} มีไฟล์นอกขอบเขตที่ handoff แตะแก้ค้างอยู่ จึงรวมของจากอีกเครื่องไม่ได้:`);
      for (const f of up.files) console.log(`     ${f}`);
      console.log('    commit หรือคืนค่าไฟล์พวกนี้เองก่อน แล้วรัน npm run handoff ใหม่');
    } else if (up.reason === 'conflict') {
      console.log(`⚠️  ${label}: 2 เครื่องแก้ไฟล์เดียวกันคนละแบบ — ยกเลิกการรวมแล้ว ของเครื่องนี้ยังอยู่ครบ (commit ไว้ในเครื่องแล้ว)`);
      console.log(`    ไฟล์ที่ชน: ${up.files.length ? up.files.join(', ') : '(ดูด้วย git status)'}`);
      console.log('    ให้ Claude ช่วยรวม 2 ฝั่ง แล้วรัน npm run handoff ใหม่');
    }
    return false;
  }
  if (up.behind) console.log(`✅ รับ ${label} จากอีกเครื่อง ${up.behind} commit มารวมแล้ว`);

  // push แยกจาก commit เสมอ — รอบก่อนอาจ commit ไว้แล้วแต่ push ไม่ผ่าน
  const n = Number(g(['rev-list', '--count', '@{u}..HEAD']).stdout.trim()) || 0;
  if (n > 0) {
    console.log(`push ${label} (${n} commit)...`);
    if (g(['push'], { stdio: 'inherit' }).status !== 0) {
      // จุดที่เคยพังเงียบมาแล้ว ห้ามปล่อยผ่านเป็นความสำเร็จเด็ดขาด
      console.log(`⚠️  push ${label} ไม่สำเร็จ — ความจำยังอยู่แค่เครื่องนี้`);
      return false;
    }
    console.log(`✅ ${label} ขึ้น origin แล้ว`);
  } else if (!pending.length && !up.behind) {
    console.log(`\n✅ ${label} ตรงกับ origin อยู่แล้ว`);
  }
  return true;
};

// วนให้ครบทุกตัวแม้ตัวแรกพัง ต้องยังพยายามเก็บตัวที่เหลือ
const memOk = memoryRepos()
  .map((r) => syncMemoryRepo(r))
  .every(Boolean);

/* ── สรุป ─────────────────────────────────────────────────────────── */
const left = onMaster ? '' : run(['status', '--porcelain', '-uall']);
console.log('');
if (left) {
  console.log('⚠️  ยังมีของค้างอยู่ (ผิดปกติ — ตรวจดูก่อนปิดเครื่อง):');
  console.log(left);
}
if (!codeOk) {
  console.log('❌ โค้ดยังไม่ขึ้น origin ครบ (ดูรายการข้างบน) — memory จัดการให้แล้วตามผลด้านบน');
}
if (!memOk) {
  console.log('⚠️  memory ยังไม่ครบ — แก้ให้จบก่อนไปอีกเครื่อง');
  console.log('   ไม่งั้นที่นั่น AI จะไม่รู้เรื่องที่คุยกันไว้');
}
if (codeOk && memOk && !left) {
  console.log(`✅ เรียบร้อย — ไปที่อีกเครื่องแล้วรัน:  npm run resume${onMaster ? '' : ` ${branch}`}`);
}
console.log('');
process.exit(codeOk && memOk ? 0 : 1);
