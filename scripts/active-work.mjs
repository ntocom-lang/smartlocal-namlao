#!/usr/bin/env node
/**
 * active-work.mjs — "ใครกำลังทำอะไรอยู่" + จองงานก่อนลงมือ กันหลาย session หยิบงานเดียวกัน
 *
 *   npm run work:active                         # แสดงงานที่มีความเคลื่อนไหวล่าสุด (worktree ในเครื่อง + สาขาบน GitHub)
 *   npm run work:claim -- <สาขา> "<งานอะไร>"     # จอง: สร้าง worktree จาก origin/master + commit ว่าง "claim: ..." + push ทันที
 *   npm run work:claim -- <สาขา> "<งานอะไร>" --checked   # ต้องใส่เมื่อมีงานอื่นเคลื่อนไหวอยู่ = ยืนยันว่าอ่านรายการแล้วไม่ซ้ำ
 *   node scripts/active-work.mjs --hook         # โหมด SessionStart hook (พิมพ์ JSON, exit 0 เสมอ)
 *
 * ที่มา (2026-11-19): สอง session หยิบข้อ 1A "สถานะใบอนุญาตก่อสร้าง + วันหมดอายุ" จากแผนเดียวกันไปทำพร้อมกัน
 * อีกตัว merge เป็น #771 ก่อน งานอีกชุดต้องทิ้งทั้งก้อน — มาเจอตอนเช็กฐานก่อนรัน SQL เพราะไม่มีที่ไหนบอกว่า "ข้อนี้มีคนจองแล้ว"
 *
 * ทำไมจองด้วย git ไม่ใช่ไฟล์จด: ไฟล์แผน/ความจำอยู่เครื่องเดียว แต่สาขาที่ push แล้วเห็นทั้ง PC และโน้ตบุค
 * commit ว่างทำให้วันที่ของสาขาเป็น "ตอนจอง" (ถ้า push สาขาเปล่าจะได้วันที่ของ master ซึ่งอาจเก่ากว่าหน้าต่างเวลา)
 * squash merge แล้ว commit ว่างหายไปเอง ไม่ต้องเก็บกวาด
 *
 * หน้าต่างเวลา: worktree ในเครื่อง 24 ชม. (รวมไฟล์ที่แก้ค้างยังไม่ commit) · สาขาบน GitHub 48 ชม.
 * สาขาที่ PR merge/ปิดแล้วไม่นับ · งานที่เงียบเกินหน้าต่างหายจากรายการเอง (ถือว่าเลิกจองโดยปริยาย)
 * ⚠️ งานที่ยังไม่ได้จองและยังไม่ได้สร้าง worktree ระบบมองไม่เห็น — กติกาจึงบังคับจองก่อนลงมือ (docs/ai/SAFETY.md)
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const LOCAL_HOURS = 24;
const REMOTE_HOURS = 48;
const UPSTREAM = 'origin/master';
const NET_TIMEOUT_MS = 10_000;
const MAX_STAT_FILES = 60;

const git = (args, opts = {}) =>
  execFileSync('git', ['--no-optional-locks', ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const gitIn = async (dir, args) =>
  (await execFileP('git', ['--no-optional-locks', '-C', dir, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();

const hoursAgo = (ms) => (Date.now() - ms) / 3_600_000;
const agoText = (ms) => {
  const h = hoursAgo(ms);
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} นาทีที่แล้ว` : `${Math.round(h)} ชม.ที่แล้ว`;
};

// PR ของแต่ละสาขา (gh ล้ม = ไม่รู้ ไม่กรอง ดีกว่าซ่อนงานจริง)
async function prByBranch() {
  try {
    const { stdout } = await execFileP('gh', ['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'number,headRefName,state'],
      { encoding: 'utf8', windowsHide: true, timeout: NET_TIMEOUT_MS });
    const map = new Map();
    for (const pr of JSON.parse(stdout)) {
      // สาขาเดียวอาจมีหลาย PR — เก็บ OPEN ไว้ก่อน ไม่งั้นเอาตัวล่าสุด (รายการเรียงใหม่ก่อน)
      const cur = map.get(pr.headRefName);
      if (!cur || (pr.state === 'OPEN' && cur.state !== 'OPEN')) map.set(pr.headRefName, pr);
    }
    return map;
  } catch {
    return null;
  }
}

function listWorktrees() {
  const blocks = git(['worktree', 'list', '--porcelain']).split(/\n\n+/);
  return blocks.map((b) => {
    const path = /^worktree (.+)$/m.exec(b)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? null;
    return { path, branch, bare: /^bare$/m.test(b) };
  }).filter((w) => w.path && !w.bare);
}

async function localItems(prs) {
  const all = listWorktrees();
  const mainPath = all[0]?.path;
  const results = await Promise.all(all.slice(1).map(async (w) => {
    if (!w.branch) return null;
    const pr = prs?.get(w.branch);
    if (pr && pr.state !== 'OPEN') return null;               // merge/ปิดแล้ว = งานจบ (worktree:sweep เก็บต่อ)
    if (!existsSync(w.path)) return null;
    try {
      const [tip, status, own] = await Promise.all([
        gitIn(w.path, ['log', '-1', '--format=%ct%x09%s']),
        gitIn(w.path, ['status', '--porcelain', '--untracked-files=normal']),
        gitIn(w.path, ['rev-list', '--count', `${UPSTREAM}..HEAD`]).catch(() => '1'),
      ]);
      const [ct, tipSubject] = tip.split('\t');
      // สาขาที่ยังไม่มี commit ของตัวเอง: ปลายสาขาคือ commit ของ master — ทั้งชื่อและเวลาไม่ใช่ของงานนี้
      // (ไม่งั้น worktree เก่าที่ตัดจาก master ล่าสุดจะโผล่เป็น "เพิ่งทำ" ทั้งที่ไม่มีใครแตะ) ⇒ นับเฉพาะไฟล์ที่แก้ค้าง
      const hasOwnCommits = Number(own) > 0;
      const subject = hasOwnCommits ? tipSubject : '(ยังไม่มี commit ของงานนี้ — ดูจากชื่อสาขา)';
      let last = hasOwnCommits ? Number(ct) * 1000 : 0;
      const dirty = status ? status.split('\n').filter(Boolean) : [];
      for (const line of dirty.slice(0, MAX_STAT_FILES)) {
        const file = line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
        try { last = Math.max(last, statSync(join(w.path, file)).mtimeMs); } catch { /* ไฟล์ถูกลบ */ }
      }
      if (hoursAgo(last) > LOCAL_HOURS) return null;
      return { branch: w.branch, subject, last, where: `เครื่องนี้ ${w.path}`, dirty: dirty.length, pr };
    } catch {
      return null;
    }
  }));
  return { mainPath, items: results.filter(Boolean) };
}

function remoteItems(prs, skip) {
  let out = '';
  try {
    out = git(['for-each-ref', 'refs/remotes/origin', '--format=%(refname:short)%09%(committerdate:unix)%09%(subject)']);
  } catch {
    return [];
  }
  return out.split('\n').filter(Boolean).map((line) => {
    const [ref, ct, subject] = line.split('\t');
    const branch = ref.replace(/^origin\//, '');
    return { branch, last: Number(ct) * 1000, subject, where: 'บน GitHub (push แล้ว)', pr: prs?.get(branch) };
  }).filter((r) => r.branch && !['HEAD', 'master', 'main', 'origin'].includes(r.branch) && !skip.has(r.branch)
    && hoursAgo(r.last) <= REMOTE_HOURS && !(r.pr && r.pr.state !== 'OPEN'));
}

export async function collectActiveWork({ fetch = true } = {}) {
  if (fetch) {
    try { git(['fetch', '--quiet', '--prune', 'origin'], { timeout: NET_TIMEOUT_MS }); } catch { /* ออฟไลน์ ใช้ ref เดิม */ }
  }
  const prs = await prByBranch();
  const { mainPath, items: local } = await localItems(prs);
  const remote = remoteItems(prs, new Set(local.map((i) => i.branch)));
  const items = [...local, ...remote].sort((a, b) => b.last - a.last);
  return { items, mainPath, prKnown: prs !== null };
}

export function formatItems(items) {
  return items.map((i) => {
    const bits = [i.where, `ล่าสุด ${agoText(i.last)}`];
    if (i.dirty) bits.push(`ไฟล์ค้างยังไม่ commit ${i.dirty} ไฟล์`);
    if (i.pr?.state === 'OPEN') bits.push(`PR #${i.pr.number} เปิดอยู่`);
    return `• ${i.branch} — ${i.subject}\n    ${bits.join(' · ')}`;
  }).join('\n');
}

const RULE = 'ก่อนเริ่มงานใหม่ (โดยเฉพาะ "ข้อถัดไป" ในแผน) ให้เทียบกับรายการนี้ ถ้าซ้ำหรือคาบเกี่ยว หยุดแล้วถามผู้ใช้ · '
  + 'จองก่อนลงมือด้วย npm run work:claim -- <สาขา> "<งานอะไร>" · ตรวจซ้ำด้วย npm run work:active ก่อนรัน SQL บนฐานจริงทุกครั้ง';

async function runHook() {
  try {
    const { items } = await collectActiveWork();
    if (!items.length) { process.stdout.write(JSON.stringify({ suppressOutput: true })); return; }
    process.stdout.write(JSON.stringify({
      systemMessage: `🔒 มีงานที่ session อื่นอาจกำลังทำอยู่ ${items.length} งาน — ดูก่อนเริ่มงานใหม่ (npm run work:active)`,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `งานที่มีความเคลื่อนไหวล่าสุด (worktree ${LOCAL_HOURS} ชม. / GitHub ${REMOTE_HOURS} ชม.) — อาจเป็นของ session อื่น:\n${formatItems(items)}\n${RULE}`,
      },
    }));
  } catch {
    process.stdout.write(JSON.stringify({ suppressOutput: true }));
  }
}

async function runList() {
  const { items, prKnown } = await collectActiveWork();
  if (!prKnown) console.log('⚠️  เรียก gh ไม่ได้ — สาขาที่ merge แล้วอาจปนมาในรายการ');
  if (!items.length) { console.log('ไม่มีงานที่เคลื่อนไหวล่าสุด — เริ่มงานใหม่ได้ (อย่าลืมจองด้วย npm run work:claim)'); return 0; }
  console.log(`งานที่มีความเคลื่อนไหวล่าสุด ${items.length} งาน (worktree ${LOCAL_HOURS} ชม. / GitHub ${REMOTE_HOURS} ชม.):\n`);
  console.log(formatItems(items));
  console.log(`\n${RULE}`);
  return 0;
}

const BRANCH_RE = /^(feat|fix|chore|ci|docs|refactor|test|codex|claude)\/[a-z0-9][a-z0-9._-]{2,60}$/;

async function runClaim(args) {
  const checked = args.includes('--checked');
  const [branch, ...descParts] = args.filter((a) => a !== '--checked');
  const desc = descParts.join(' ').trim();
  if (!branch || !BRANCH_RE.test(branch) || desc.length < 4) {
    console.error('❌ ใช้: npm run work:claim -- <สาขา เช่น feat/permit-expiry-tab> "<งานอะไร ภาษาคน>" [--checked]');
    console.error('   ชื่อสาขาขึ้นต้น feat/ fix/ chore/ ci/ docs/ refactor/ test/ codex/ claude/ ตามด้วย a-z 0-9 . _ -');
    return 2;
  }
  const { items, mainPath } = await collectActiveWork();
  if (items.some((i) => i.branch === branch)) {
    console.error(`❌ สาขา ${branch} มีอยู่แล้วและยังเคลื่อนไหวอยู่ — งานนี้มีคนจองแล้ว`);
    console.error(formatItems(items.filter((i) => i.branch === branch)));
    return 1;
  }
  if (items.length && !checked) {
    console.log(`มีงานอื่นเคลื่อนไหวอยู่ ${items.length} งาน — อ่านแล้วยืนยันว่าไม่ซ้ำ จึงค่อยรันซ้ำพร้อม --checked\n`);
    console.log(formatItems(items));
    return 1;
  }
  try { git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); console.error(`❌ มีสาขา ${branch} ในเครื่องอยู่แล้ว`); return 1; } catch { /* ยังไม่มี = ดี */ }
  try { git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]); console.error(`❌ มีสาขา origin/${branch} อยู่แล้ว (อาจเป็นงานเก่าที่เงียบไป) — ตั้งชื่อใหม่หรือถามผู้ใช้`); return 1; } catch { /* ยังไม่มี = ดี */ }

  const base = existsSync('D:/tmp') ? 'D:/tmp' : 'C:/dev';
  const wt = `${base}/wt-${branch.split('/').slice(1).join('-')}`;
  if (existsSync(wt)) { console.error(`❌ มีโฟลเดอร์ ${wt} อยู่แล้ว`); return 1; }

  git(['worktree', 'add', wt, '-b', branch, UPSTREAM]);
  const envSrc = mainPath && join(mainPath, '.env.local');
  if (envSrc && existsSync(envSrc)) copyFileSync(envSrc, join(wt, '.env.local'));
  git(['-C', wt, 'commit', '--allow-empty', '-q', '-m', `claim: ${desc}`,
    '-m', 'จองงานไว้ก่อนลงมือ (npm run work:claim) — กัน session อื่นหยิบงานซ้ำ · squash merge แล้ว commit นี้หายไปเอง']);
  try {
    git(['-C', wt, 'push', '-q', '-u', 'origin', branch], { timeout: 60_000 });
  } catch (e) {
    console.error(`⚠️  สร้าง worktree แล้วแต่ push ไม่สำเร็จ — เครื่องอื่นยังมองไม่เห็นการจอง ลอง push เองใน ${wt}`);
    console.error(String(e.stderr || e.message).trim());
    return 1;
  }
  console.log(`✅ จองแล้ว: ${branch} — ${desc}\n   worktree: ${wt}${existsSync(join(wt, '.env.local')) ? ' (คัดลอก .env.local แล้ว)' : ''}`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.includes('--hook')) {
    await runHook();
  } else if (args[0] === 'claim') {
    process.exitCode = await runClaim(args.slice(1));
  } else {
    process.exitCode = await runList();
  }
}

