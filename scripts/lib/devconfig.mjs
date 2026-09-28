/**
 * devconfig.mjs — หา repo `smartlocal-devconfig` (private: .env.local + memory ของ Claude)
 *
 * ใช้ร่วมกันโดย handoff.mjs / resume.mjs / doctor.mjs — ห้ามเขียนสูตรหา path ซ้ำในแต่ละไฟล์
 * เพราะเคยพังมาแล้วจากการที่ resume มี fallback แต่ handoff ไม่มี (memory ค้าง 3 สัปดาห์)
 *
 * ⚠️ ค่าปริยายคือ "โฟลเดอร์ข้างๆ **ทรีหลัก**" ไม่ใช่ "ข้างๆ cwd"
 *    ต่างกันจริงเมื่อรันจาก git worktree: cwd อยู่ D:\tmp\wt-xxx แต่ทรีหลักอยู่คนละไดรฟ์
 *    resolve('../smartlocal-devconfig') จาก worktree จะได้ D:\tmp\smartlocal-devconfig
 *    ซึ่งไม่มีอยู่จริง ⇒ สคริปต์จะคิดว่า "ไม่มี devconfig" แล้วข้าม memory ไปเงียบๆ
 *    (AGENTS.md บังคับให้ agent ทำงานใน worktree เสมอ เคสนี้จึงเกิดบ่อยกว่าที่คิด)
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const tryGit = (args) => {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch {
    return null;
  }
};

/** path ของ repo devconfig — ตั้ง SMARTLOCAL_DEVCONFIG ทับได้ถ้าเก็บไว้ที่อื่น */
export function findDevconfig() {
  if (process.env.SMARTLOCAL_DEVCONFIG) return resolve(process.env.SMARTLOCAL_DEVCONFIG);

  // --git-common-dir ชี้ .git ของทรีหลักเสมอ แม้เรียกจาก worktree ลูก
  // --path-format=absolute ต้องใช้ git 2.31+ ถ้าไม่รองรับจะคืน null แล้วตกไปใช้แบบ relative
  const common = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir']) ?? tryGit(['rev-parse', '--git-common-dir']);
  const base = common ? dirname(resolve(common)) : process.cwd();
  return resolve(join(base, '..', 'smartlocal-devconfig'));
}

/** เป็น git repo จริงไหม (แค่โฟลเดอร์มีอยู่ยังไม่พอ) */
export const isDevconfigRepo = (dir) => existsSync(join(dir, '.git'));

/**
 * path ของ memory ของ Codex CLI — ตั้ง SMARTLOCAL_CODEX_MEMORY ทับได้
 *
 * ต่างจาก memory ของ Claude ตรงที่ Codex สร้างโฟลเดอร์นี้เป็น **git repo ของตัวเองอยู่แล้ว**
 * จึงใช้วิธีเดียวกับ Claude (ย้ายไฟล์เข้า devconfig แล้วทำ junction) ไม่ได้ — repo จะซ้อนกัน
 * ⇒ ใช้วิธีต่อ remote ให้ repo เดิมแทน แล้ว sync ในที่ตั้งเดิม ไม่แตะโครงสร้างที่ Codex ดูแลเอง
 *
 * เจอ 2026-09-26 ว่า repo นี้ไม่มี remote เลย มี commit เดียวชื่อ "Initialize Codex git baseline"
 * = ความรู้ 1,397 KB อยู่บนดิสก์ลูกเดียว ฮาร์ดดิสก์พังแล้วหายถาวร
 *
 * ⚠️ 2026-09-28 พบว่าวิธีต่อ remote นี้ **ใช้ระยะยาวไม่ได้**: Codex ล้าง `.git` ของตัวเองแล้วสร้างใหม่
 *    (baseline 09-24 บน GitHub · สร้างใหม่อีกรอบ 09-28 ในเครื่อง) remote ที่ต่อไว้หายไปทุกรอบ
 *    ไฟล์ไม่หาย — ระหว่างรอเปลี่ยนไปใช้ git ของเราเองที่แยกจาก .git ของ Codex จึงถือเป็นแค่คำเตือน
 */
export const findCodexMemory = () =>
  resolve(process.env.SMARTLOCAL_CODEX_MEMORY ?? join(homedir(), '.codex', 'memories'));

/**
 * รูปแบบ "ค่าคีย์จริง" ที่ห้ามหลุดขึ้น repo แม้จะเป็น private
 *
 * ⚠️ จับเฉพาะค่าที่มีโครงสร้างของคีย์จริง ไม่จับคำที่พูดถึงเฉยๆ
 *    memory มีบันทึกที่เขียนว่า "คีย์ sb_secret_ ใช้กับ Admin API ไม่ได้" อยู่แล้ว
 *    ถ้าจับแค่คำว่า sb_secret หรือ service_role จะบล็อก handoff ไปตลอดกาลโดยไม่มีคีย์จริงสักตัว
 *
 * ⚠️ ด่านนี้จับรูปแบบคีย์ได้ แต่ **จับข้อมูลส่วนบุคคลของประชาชน (PDPA) ไม่ได้**
 *    ยังต้องอาศัยกติกาว่า memory ห้ามจดข้อมูลประชาชนตั้งแต่ต้น
 */
export const SECRET_PATTERNS = [
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9]{20,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'GitLab token', re: /glpat-[A-Za-z0-9_-]{18,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** คืนรายการ { file, name } ของไฟล์ที่มีคีย์จริงปนอยู่ — ว่าง = สะอาด */
export function scanForSecrets(readText, files) {
  const hits = [];
  for (const f of files) {
    const text = readText(f);
    if (text == null) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) hits.push({ file: f, name });
    }
  }
  return hits;
}

/**
 * repo ความจำของ AI ทุกตัวที่ต้องข้ามเครื่อง — handoff / resume / doctor วนรายการนี้ชุดเดียว
 *
 * เดิม handoff กับ doctor เขียนรายการนี้ซ้ำกันคนละไฟล์ ⇒ แก้ที่หนึ่งแล้วอีกที่ตามไม่ทัน
 * (บั๊กตระกูลเดียวกับที่ resume มี fallback แต่ handoff ไม่มี จน memory ค้าง 3 สัปดาห์)
 *
 * git      คำนำหน้าคำสั่ง git ทุกครั้ง — แยกออกมาเพราะ Codex จะเปลี่ยนไปใช้ --git-dir แทน -C
 * pathspec ขอบเขตที่ handoff แตะได้ (null = ทั้ง repo) — devconfig มี env/.env.local ปนอยู่
 * optional เครื่องที่ไม่ได้ลง AI ตัวนั้นต้องไม่ถูกนับว่าล้มเหลว
 */
export function memoryRepos() {
  const devconfig = findDevconfig();
  const codex = findCodexMemory();
  return [
    {
      label: 'memory ของ Claude',
      dir: devconfig,
      git: ['-C', devconfig],
      present: isDevconfigRepo(devconfig),
      pathspec: 'claude-memory',
      optional: false,
      missingHint: 'clone smartlocal-devconfig ไว้ข้างๆ โปรเจกต์ หรือตั้งตัวแปร SMARTLOCAL_DEVCONFIG',
    },
    {
      label: 'memory ของ Codex',
      dir: codex,
      git: ['-C', codex],
      present: isDevconfigRepo(codex),
      pathspec: null,
      optional: true,
      missingHint: 'ต่อ remote ให้ ~/.codex/memories หรือตั้งตัวแปร SMARTLOCAL_CODEX_MEMORY',
    },
  ];
}

/** รัน git ใน repo ความจำ — คืนผลของ spawnSync (ไม่ throw) */
export const gitIn = (repo, args, opts = {}) =>
  spawnSync('git', [...repo.git, ...args], { encoding: 'utf8', ...opts });

const lines = (s) => (s ?? '').split('\n').map((l) => l.trimEnd()).filter(Boolean);

/**
 * ดึงของที่อีกเครื่อง push ไว้มาต่อหน้าของเครื่องนี้ ก่อนจะ push
 *
 * เดิม handoff push ตรงๆ ⇒ ถ้าอีกเครื่อง push ไปก่อน push จะถูกปฏิเสธ แล้ว memory ก็ค้างเครื่องเดียวต่อ
 * เกิดจริง 2026-09-28: โน้ตบุค push 8d45a34 ระหว่างที่ PC ค้างอยู่ 10 ไฟล์
 *
 * ใช้ rebase ไม่ใช่ merge — memory commit เป็นของเล็กที่ไม่มีใครรีวิว ต่อกันเป็นเส้นตรงอ่านย้อนง่ายกว่า
 * MEMORY.md ที่ทั้ง 2 เครื่องต่อบรรทัดท้ายไฟล์ รวมกันได้ด้วย merge=union ใน .gitattributes ของ devconfig
 *
 * ⚠️ ชนเมื่อไร abort ทันที ห้ามทิ้ง repo ค้างกลาง rebase — junction ของ Claude ชี้มาที่โฟลเดอร์นี้
 *    session ถัดไปจะเปิดมาเจอ memory ที่มีเครื่องหมาย <<<<<<< ปนอยู่
 * ⚠️ ไม่ใช้ --autostash — ไฟล์นอก pathspec (env/.env.local) คือของที่คนตั้งใจค้างไว้
 *    ถ้า apply กลับแล้วชน จะได้ .env.local ที่มีเครื่องหมาย conflict ⇒ เว็บในเครื่องเปิดไม่ขึ้น
 *
 * คืน { ok, behind } หรือ { ok: false, reason: 'no-upstream' | 'fetch' | 'dirty' | 'conflict', files?, detail? }
 */
export function integrateUpstream(repo) {
  const g = (args) => gitIn(repo, args);

  if (g(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).status !== 0) {
    return { ok: false, reason: 'no-upstream' };
  }
  const fetched = g(['fetch', '--quiet', 'origin']);
  if (fetched.status !== 0) return { ok: false, reason: 'fetch', detail: lines(fetched.stderr).at(-1) ?? '' };

  const behind = Number(g(['rev-list', '--count', 'HEAD..@{u}']).stdout.trim()) || 0;
  if (!behind) return { ok: true, behind: 0 };

  // ไฟล์ที่ track แล้วยังแก้ค้าง = rebase เริ่มไม่ได้ ไฟล์ใหม่ที่ยังไม่ track ไม่ขวาง (git กันทับให้เองถ้า path ชน)
  const dirty = lines(g(['status', '--porcelain', '-uno']).stdout).map((l) => l.slice(3));
  if (dirty.length) return { ok: false, reason: 'dirty', behind, files: dirty };

  if (g(['rebase', '--quiet', '@{u}']).status !== 0) {
    const files = lines(g(['diff', '--name-only', '--diff-filter=U']).stdout);
    g(['rebase', '--abort']);
    return { ok: false, reason: 'conflict', behind, files };
  }
  return { ok: true, behind };
}
