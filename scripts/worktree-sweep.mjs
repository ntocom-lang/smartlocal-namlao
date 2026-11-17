#!/usr/bin/env node
/**
 * worktree-sweep.mjs — เก็บกวาด git worktree + สาขาที่ merge แล้ว ทีเดียวทุกตัว
 *
 *   npm run worktree:sweep                  # dry-run: แสดงรายการ ไม่ลบอะไร
 *   npm run worktree:sweep -- --apply       # ลบจริง
 *   npm run worktree:sweep -- --apply --keep-remote   # ลบในเครื่อง แต่ไม่ลบสาขาบน GitHub
 *   npm run worktree:sweep -- --verbose     # แสดงรายการที่ถูกข้ามทุกตัว (ปกติแสดงแค่จำนวนต่อเหตุผล)
 *   npm run worktree:sweep -- --min-age-min=60   # กันทรีที่เพิ่งมีคนใช้ (ค่าเริ่มต้น 30 นาที)
 *
 * ทำไมไม่ใช้ `git branch --merged`: repo นี้ merge แบบ squash สาขาที่ merge แล้วจึงไม่ใช่
 * ancestor ของ master ตลอดไป ต้องถาม GitHub ว่า PR ของสาขานั้น MERGED จริงไหม
 *
 * ลบเฉพาะ worktree ที่ผ่าน "ทุกข้อ" — ข้อไหนไม่ผ่านจะถูกข้ามและบอกเหตุผล (งานของ session อื่นจึงไม่ถูกแตะ):
 *   1. มี PR ที่ MERGED เข้า master/main และ commit ปลายสาขาในเครื่อง = commit ปลายของ PR นั้นเป๊ะ
 *      (ถ้ามี commit เพิ่มหลัง merge ที่ไม่ได้ push → ข้าม ไม่ใช่ลบทิ้ง)
 *   2. ทรีสะอาด: ไม่มีไฟล์แก้/ไฟล์ใหม่ที่ git เห็น และไม่ค้าง merge/rebase/cherry-pick
 *   3. ไม่ใช่ทรีหลัก ไม่ใช่ทรีที่รันคำสั่งนี้อยู่ ไม่ถูก lock
 *   4. ไม่มีการใช้ git ในทรีนั้นภายใน --min-age-min นาที (กัน session อื่นที่ยังทำงานอยู่)
 *
 * ⚠️ ไฟล์ที่ .gitignore กันไว้ (เช่น .env.local ที่คัดลอกมา, ภาพถ่ายหน้าจอ) git ไม่เห็นและจะหายพร้อมโฟลเดอร์
 *    dry-run จึงแสดงรายการไฟล์ ignored ของแต่ละตัว (ยกเว้น node_modules/dist ที่สร้างใหม่ได้)
 * ⚠️ worktree ไม่ข้ามเครื่อง คำสั่งนี้ลบได้เฉพาะเครื่องที่รัน — โน้ตบุคต้องรันแยก
 * ⚠️ ต้องมี gh (GitHub CLI) ที่ล็อกอินแล้ว
 *
 * ไม่ใช้ --force กับ `git worktree remove` โดยตั้งใจ: ถ้าระหว่างรันมีไฟล์ใหม่โผล่ git จะปฏิเสธเอง
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, lstatSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const KEEP_REMOTE = args.includes('--keep-remote');
const VERBOSE = args.includes('--verbose');
const ageArg = args.find((a) => a.startsWith('--min-age-min='));
const MIN_AGE_MIN = ageArg ? Number(ageArg.split('=')[1]) : 30;
if (!Number.isFinite(MIN_AGE_MIN) || MIN_AGE_MIN < 0) {
  console.error('❌ --min-age-min ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
  process.exit(2);
}
const unknown = args.filter((a) => !['--apply', '--keep-remote', '--verbose'].includes(a) && !a.startsWith('--min-age-min='));
if (unknown.length) {
  console.error(`❌ ไม่รู้จักตัวเลือก: ${unknown.join(' ')}`);
  process.exit(2);
}

const git = (a, opts = {}) =>
  execFileSync('git', ['--no-optional-locks', ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const execFileP = promisify(execFile);
// ตรวจหลายทรีพร้อมกัน (178 ตัวทีละตัวบน Windows ใช้เกิน 5 นาที)
const gitIn = async (dir, a) =>
  (await execFileP('git', ['--no-optional-locks', '-C', dir, ...a], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/* ── 1) ทะเบียน worktree ───────────────────────────────────────── */
function listWorktrees() {
  const blocks = git(['worktree', 'list', '--porcelain']).split(/\n\n+/);
  return blocks.map((b) => {
    const t = { path: '', head: '', branch: null, detached: false, locked: false, prunable: false };
    for (const line of b.split('\n')) {
      if (line.startsWith('worktree ')) t.path = line.slice(9);
      else if (line.startsWith('HEAD ')) t.head = line.slice(5);
      else if (line.startsWith('branch ')) t.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'detached') t.detached = true;
      else if (line.startsWith('locked')) t.locked = true;
      else if (line.startsWith('prunable')) t.prunable = true;
    }
    return t;
  }).filter((t) => t.path);
}

/* ── 2) PR ที่ merge แล้ว (เรียก gh ครั้งเดียว) ─────────────────── */
function loadMergedPrs() {
  let out;
  try {
    out = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'merged', '--limit', '3000', '--json', 'number,headRefName,headRefOid,baseRefName'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    console.error('❌ เรียก gh ไม่ได้ (ติดตั้งหรือล็อกอินหรือยัง? ลอง `gh auth status`)');
    console.error(String(e.stderr || e.message).trim());
    process.exit(2);
  }
  const map = new Map(); // branch -> [{ number, oid }]
  for (const pr of JSON.parse(out)) {
    if (!['master', 'main'].includes(pr.baseRefName)) continue; // merge เข้าสาขาอื่น ≠ ขึ้น master
    if (!map.has(pr.headRefName)) map.set(pr.headRefName, []);
    map.get(pr.headRefName).push({ number: pr.number, oid: pr.headRefOid });
  }
  return map;
}

/* ── 3) ตรวจทีละทรี ────────────────────────────────────────────── */
// ของที่ build/CLI สร้างใหม่ได้เสมอ ไม่ต้องเตือน (api/_template.html = postbuild, supabase/.temp = แคช CLI)
const IGNORED_NOISE = /^(node_modules|dist|\.vite|\.wrangler|coverage|supabase\/\.temp|api\/_template\.html)\/?$/;

async function inspect(t, ctx) {
  // code = กลุ่มเหตุผล (ใช้สรุปจำนวน) · reason = ข้อความเต็มของทรีนั้น
  const skip = (code, reason = code) => ({ t, ok: false, code, reason });
  if (norm(t.path) === ctx.main) return skip('ทรีหลัก');
  if (norm(t.path) === ctx.self) return skip('ทรีที่รันคำสั่งนี้อยู่');
  if (t.locked) return skip('ถูก lock');
  if (t.prunable) return skip('โฟลเดอร์หายไปแล้ว (prune จัดการ)');
  if (!t.branch) return skip('detached HEAD (ไม่มีสาขาให้ตรวจ PR)');
  if (['master', 'main'].includes(t.branch)) return skip('สาขา master/main');

  const prs = ctx.merged.get(t.branch);
  if (!prs?.length) return skip('ไม่มี PR ที่ merge เข้า master (ยังทำอยู่/ปิดทิ้ง/ไม่เคยเปิด PR)');
  const pr = prs.find((p) => p.oid === t.head);
  if (!pr) return skip('มี commit ในเครื่องที่ไม่อยู่ใน PR ที่ merge (อาจยังไม่ push)', `มี commit ในเครื่องที่ไม่อยู่ใน PR #${prs.map((p) => p.number).join('/#')} ที่ merge (อาจยังไม่ push)`);

  let gitDir;
  try {
    gitDir = await gitIn(t.path, ['rev-parse', '--absolute-git-dir']);
  } catch {
    return skip('อ่านสถานะทรีไม่ได้');
  }
  for (const marker of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    try {
      statSync(join(gitDir, marker));
      return skip('ค้าง merge/rebase/cherry-pick', `ค้างกลางทาง (${marker})`);
    } catch { /* ไม่มี = ดี */ }
  }

  let status;
  try {
    status = await gitIn(t.path, ['status', '--porcelain', '--ignored']);
  } catch {
    return skip('อ่านสถานะทรีไม่ได้');
  }
  const dirty = [];
  const ignored = [];
  for (const line of status.split('\n').filter(Boolean)) {
    if (line.startsWith('!! ')) {
      const name = line.slice(3);
      if (!IGNORED_NOISE.test(name)) ignored.push(name);
    } else dirty.push(line);
  }
  if (dirty.length) return skip('มีไฟล์ค้างที่ git เห็น (งานที่ยังไม่ commit)', `มีไฟล์ค้างที่ git เห็น ${dirty.length} รายการ (เช่น ${dirty[0]})`);

  try {
    const ageMin = (Date.now() - statSync(join(gitDir, 'index')).mtimeMs) / 60000;
    if (ageMin < MIN_AGE_MIN) return skip(`เพิ่งมีการใช้ git ภายใน ${MIN_AGE_MIN} นาที`, `เพิ่งมีการใช้ git ${Math.round(ageMin)} นาทีก่อน (< ${MIN_AGE_MIN})`);
  } catch { /* ไม่มี index = ไม่เคย checkout ครบ ถือว่าไม่มีคนใช้ */ }

  return { t, ok: true, pr: pr.number, ignored };
}

/* ── main ──────────────────────────────────────────────────────── */
const all = listWorktrees();
const ctx = {
  main: norm(all[0].path),
  self: norm(git(['rev-parse', '--show-toplevel'])),
  merged: loadMergedPrs(),
};
const results = new Array(all.length);
let next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < all.length) {
    const i = next++;
    results[i] = await inspect(all[i], ctx);
  }
}));
const removable = results.filter((r) => r.ok);
const skipped = results.filter((r) => !r.ok);

console.log(`worktree ทั้งหมด ${all.length} · ลบได้ ${removable.length} · ข้าม ${skipped.length}${APPLY ? '' : '  (dry-run — ยังไม่ลบอะไร)'}\n`);

if (removable.length) {
  console.log('── ลบได้ (PR merged + ทรีสะอาด + commit ตรงกับ PR) ──');
  for (const r of removable) {
    console.log(`  #${r.pr}  ${r.t.branch}   ${r.t.path}`);
    if (r.ignored.length) console.log(`        ⚠️ ไฟล์ ignored ที่จะหายด้วย: ${r.ignored.slice(0, 6).join(', ')}${r.ignored.length > 6 ? ` …(+${r.ignored.length - 6})` : ''}`);
  }
  console.log('');
}

const byReason = new Map();
for (const r of skipped) {
  const key = r.code;
  if (!byReason.has(key)) byReason.set(key, []);
  byReason.get(key).push(r);
}
if (skipped.length) {
  console.log('── ข้าม (ไม่แตะ) ──');
  for (const [key, rs] of byReason) {
    console.log(`  ${rs.length} ตัว: ${key}`);
    if (VERBOSE) for (const r of rs) console.log(`      ${r.t.branch ?? '(detached)'}   ${r.t.path} — ${r.reason}`);
  }
  console.log('');
}

if (!APPLY) {
  if (removable.length) console.log('ลบจริงด้วย: npm run worktree:sweep -- --apply');
  process.exit(0);
}

/* ── ลบจริง ─────────────────────────────────────────────────────── */
let done = 0;
const failed = [];
for (const r of removable) {
  const { path, branch } = r.t;
  try {
    git(['worktree', 'remove', path]); // ไม่ใส่ --force: มีไฟล์โผล่ใหม่ระหว่างรัน git ปฏิเสธเอง
    removeShell(path);
    // -D ต้องใช้เพราะ squash merge ทำให้ git มองว่าสาขายังไม่ merge — เราตรวจกับ PR แล้ว (commit ปลายตรงเป๊ะ)
    git(['branch', '-D', branch]);
    if (!KEEP_REMOTE) {
      const remote = git(['ls-remote', '--heads', 'origin', branch]);
      if (remote) git(['push', 'origin', '--delete', branch]);
    }
    done++;
    console.log(`🗑️  ลบแล้ว #${r.pr} ${branch}`);
  } catch (e) {
    failed.push({ branch, why: String(e.stderr || e.message).trim().split('\n')[0] });
    console.log(`⚠️  ลบไม่สำเร็จ ${branch}: ${failed.at(-1).why}`);
  }
}
try {
  git(['worktree', 'prune']); // เก็บทะเบียนของโฟลเดอร์ที่หายไปแล้ว (ไม่ลบไฟล์ใดๆ)
} catch { /* ไม่ร้ายแรง */ }

console.log(`\nเสร็จ: ลบ ${done}/${removable.length}${failed.length ? ` · ไม่สำเร็จ ${failed.length} (ดูข้างบน)` : ''}`);
const leftovers = removable.filter((r) => existsSync(r.t.path));
if (leftovers.length) console.log(`⚠️ โฟลเดอร์ที่ยังค้างหลังลบ ${leftovers.length} ตัว (มีของอื่นนอกจากลิงก์ node_modules — ดูเองก่อนลบ): ${leftovers.slice(0, 5).map((r) => r.t.path).join(', ')}`);
process.exit(failed.length ? 1 : 0);

/**
 * git worktree remove ทิ้งเปลือกโฟลเดอร์ไว้เมื่อในนั้นมี node_modules เป็น junction ชี้ไปทรีหลัก
 * (พบจริง 2569-11-18: 127 จาก 150 ตัว) — ลบเฉพาะ "ตัวลิงก์" แล้วลบโฟลเดอร์แบบไม่ recursive
 * ⚠️ ห้ามใช้ rmSync({ recursive }) / rm -rf ตรงนี้: ตามลิงก์เข้าไปลบ node_modules ของทรีหลักได้
 * โฟลเดอร์ที่ยังมีของอื่นจะลบไม่สำเร็จ (ENOTEMPTY) และถูกรายงานเป็น leftovers แทน
 */
function removeShell(dir) {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir);
    if (entries.length === 1 && entries[0] === 'node_modules') {
      const nm = join(dir, 'node_modules');
      if (lstatSync(nm).isSymbolicLink()) unlinkSync(nm); // Node บน Windows เห็น junction เป็น symlink
    }
    rmdirSync(dir); // ไม่ recursive — ไม่ว่าง = error ไม่ลบอะไร
  } catch { /* ปล่อยให้ไปโผล่ใน leftovers */ }
}
