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

/** path ของโฟลเดอร์ชื่อ `name` ที่วางข้างๆ **ทรีหลัก** (ไม่ใช่ข้างๆ cwd — ดูเหตุผลที่หัวไฟล์) */
function besideMainTree(name) {
  // --git-common-dir ชี้ .git ของทรีหลักเสมอ แม้เรียกจาก worktree ลูก
  // --path-format=absolute ต้องใช้ git 2.31+ ถ้าไม่รองรับจะคืน null แล้วตกไปใช้แบบ relative
  const common = tryGit(['rev-parse', '--path-format=absolute', '--git-common-dir']) ?? tryGit(['rev-parse', '--git-common-dir']);
  const base = common ? dirname(resolve(common)) : process.cwd();
  return resolve(join(base, '..', name));
}

/** path ของ repo devconfig — ตั้ง SMARTLOCAL_DEVCONFIG ทับได้ถ้าเก็บไว้ที่อื่น */
export function findDevconfig() {
  if (process.env.SMARTLOCAL_DEVCONFIG) return resolve(process.env.SMARTLOCAL_DEVCONFIG);
  return besideMainTree('smartlocal-devconfig');
}

/** เป็น git repo จริงไหม (แค่โฟลเดอร์มีอยู่ยังไม่พอ) */
export const isDevconfigRepo = (dir) => existsSync(join(dir, '.git'));

/**
 * path ของ memory ของ Codex CLI (โฟลเดอร์ไฟล์ที่ Codex อ่าน/เขียน) — ตั้ง SMARTLOCAL_CODEX_MEMORY ทับได้
 *
 * Codex สร้างโฟลเดอร์นี้เป็น **git repo ของตัวเอง** จึงใช้วิธีเดียวกับ Claude (ย้ายไฟล์เข้า devconfig
 * แล้วทำ junction) ไม่ได้ — repo จะซ้อนกัน · เจอ 2026-09-26 ว่าไม่มี remote เลย 1,397 KB อยู่บนดิสก์ลูกเดียว
 *
 * รอบแรก (#310) ต่อ remote ให้ .git ของ Codex ตรงๆ ⇒ **ใช้ไม่ได้**: Codex ล้าง .git แล้วสร้างใหม่เอง
 * (baseline 09-24 บน GitHub · สร้างใหม่อีกรอบ 09-28) remote หายทุกรอบ และประวัติไม่ต่อกันอีกเลย
 * ⇒ เปลี่ยนเป็น git ของเราเองที่เก็บไว้คนละที่ (findCodexSync) แล้วชี้ core.worktree มาที่โฟลเดอร์นี้
 */
export const findCodexMemory = () =>
  resolve(process.env.SMARTLOCAL_CODEX_MEMORY ?? join(homedir(), '.codex', 'memories'));

/**
 * git dir ของเราเองสำหรับ sync memory ของ Codex — ตั้ง SMARTLOCAL_CODEX_SYNC ทับได้
 *
 * แยกจาก `.git` ของ Codex โดยสิ้นเชิง: git ไม่ track entry ที่ชื่อ `.git` ในทรีเด็ดขาด
 * ⇒ Codex จะล้าง/สร้าง .git ของมันกี่รอบก็ไม่กระทบ git ตัวนี้
 * วางข้างทรีหลักเหมือน devconfig ไม่วางใน ~/.codex เพราะเป็นบ้านของ Codex ที่มันจัดการเองได้ทุกเมื่อ
 * ตั้งครั้งแรกด้วย `npm run codex:link`
 */
export function findCodexSync() {
  if (process.env.SMARTLOCAL_CODEX_SYNC) return resolve(process.env.SMARTLOCAL_CODEX_SYNC);
  return besideMainTree('smartlocal-codex-memory.git');
}

export const CODEX_MEMORY_REMOTE = 'https://github.com/ntocom-lang/smartlocal-codex-memory.git';

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

/** เลขบัตรประชาชน 13 หลักที่หลักสุดท้ายตรงตามสูตรตรวจสอบ (ถ่วงน้ำหนัก 13..2 แล้ว mod 11) */
export function isThaiIdChecksumValid(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/**
 * เลขตัวอย่างที่ไม่ใช่ของใคร: เรียงต่อกัน (2345678) หรือใช้เลขไม่เกิน 2 ตัว (1111111, 0000000)
 * วัดจาก memory จริง 2026-09-29: เบอร์มือถือ 5 จุดที่ด่านจับได้เป็นเบอร์เดียวกันทั้งหมด
 * = placeholder เลขเรียงที่อยู่ในโค้ดของ repo หลัก (public) อยู่แล้ว ไม่ตัดออก handoff จะหยุดทุกวัน
 */
const looksLikePlaceholder = (s) =>
  '01234567890123456789'.includes(s) || '98765432109876543210'.includes(s) || new Set(s).size <= 2;

/**
 * รูปแบบข้อมูลส่วนบุคคลที่ห้ามหลุดขึ้น GitHub แม้ repo จะเป็น private (PDPA)
 *
 * เพิ่ม 2026-09-29 เพราะเจ้าของระบบเลือกให้ sync memory ของ Codex ทั้งโฟลเดอร์ ซึ่งมีงานโปรเจกต์อื่นปน
 * (Codex เก็บ memory ของทุกโปรเจกต์ในเครื่องรวมกัน) และ handoff push ให้เองโดยไม่มีคนอ่านก่อน
 *
 * block = ไม่ส่ง repo นั้นในรอบนี้ — เลือกเฉพาะรูปแบบที่แม่นพอจะไม่หยุดผิดๆ ทุกวันจนคนเลิกเชื่อ
 *         เลขบัตรประชาชนต้องผ่านสูตรตรวจสอบหลักสุดท้ายด้วย ตัดเลข 13 หลักทั่วไป (เช่น timestamp) ได้ราว 90%
 * warn  = แจ้งให้เห็นแต่ไม่หยุด — รูปแบบที่ปนกับข้อมูลทั่วไปเยอะ ถ้าหยุดจะหยุดทุกวัน
 *
 * ⚠️ จับได้เฉพาะข้อมูลที่มีรูปแบบ — ชื่อ ที่อยู่ หรือเรื่องราวของคนในประโยคทั่วไป จับไม่ได้
 */
const PII_PATTERNS = [
  {
    name: 'เลขบัตรประชาชน',
    level: 'block',
    re: /(?<![\d-])(\d)[- ]?(\d{4})[- ]?(\d{5})[- ]?(\d{2})[- ]?(\d)(?![\d-])/g,
    valid: (m) => {
      const d = m.slice(1, 6).join('');
      return isThaiIdChecksumValid(d) && !looksLikePlaceholder(d.slice(1, 12));
    },
  },
  {
    name: 'เบอร์มือถือ',
    level: 'block',
    re: /(?<![\d+])(?:0|\+66[- ]?)[689]\d[- ]?\d{3}[- ]?\d{4}(?!\d)/g,
    // 7 หลักหลังรหัส 0Xx คือส่วนที่บอกว่าเป็นเบอร์ของใคร
    valid: (m) => !looksLikePlaceholder(m[0].replace(/\D/g, '').replace(/^66/, '0').slice(3)),
  },
  { name: 'อีเมล', level: 'warn', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, valid: (m) => !isTeamEmail(m[0]) },
  {
    // (?!ก) กัน "นายกเทศมนตรี" · ต้องขึ้นต้นบรรทัดหรือหลังช่องว่าง กัน "นาง" ใน "พัฒนางาน" (เคยจับผิดทั้ง 2 แบบ)
    name: 'ชื่อที่มีคำนำหน้า',
    level: 'warn',
    re: /(?:^|[\s(])(?:นาย(?!ก)|นางสาว|นาง(?!าน)|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s?[ก-๙]{2,}\s+[ก-๙]{2,}/gm,
  },
  { name: 'IP address', level: 'warn', re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g },
];

// อีเมลของทีมเอง / ของตัวอย่าง ไม่ใช่ข้อมูลของคนนอก — อ่านอีเมลของเครื่องจาก git config ไม่เขียนลงไฟล์ (repo นี้ public)
const TEAM_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'users.noreply.github.com', 'anthropic.com'];
let ownEmail;
function isTeamEmail(addr) {
  if (ownEmail === undefined) ownEmail = (tryGit(['config', 'user.email']) ?? '').toLowerCase();
  const a = addr.toLowerCase();
  const domain = a.split('@')[1] ?? '';
  return a === ownEmail || domain.endsWith('.invalid') || TEAM_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** คืน [{ file, name, level, count }] — ไม่คืนค่าที่เจอโดยตั้งใจ ผู้เรียกจะได้พิมพ์ออกจอไม่ได้ */
export function scanForPersonalData(readText, files) {
  const hits = [];
  for (const f of files) {
    const text = readText(f);
    if (text == null) continue;
    for (const { name, level, re, valid } of PII_PATTERNS) {
      let count = 0;
      for (const m of text.matchAll(re)) if (!valid || valid(m)) count++;
      if (count) hits.push({ file: f, name, level, count });
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
  const codexSync = findCodexSync();
  return [
    {
      key: 'claude',
      label: 'memory ของ Claude',
      dir: devconfig,
      git: ['-C', devconfig],
      present: isDevconfigRepo(devconfig),
      pathspec: 'claude-memory',
      optional: false,
      missingMsg: `ไม่พบ repo devconfig ที่ ${devconfig}`,
      missingHint: 'clone smartlocal-devconfig ไว้ข้างๆ โปรเจกต์ หรือตั้งตัวแปร SMARTLOCAL_DEVCONFIG',
    },
    {
      key: 'codex',
      label: 'memory ของ Codex',
      dir: codex,
      // git ของเราเอง ชี้ไฟล์ของ Codex — ไม่แตะ .git ที่ Codex เป็นเจ้าของ (ดู findCodexSync)
      // -C ให้ pathspec อย่าง `git add .` ตีความจากรากโฟลเดอร์ของ Codex ตรงๆ
      // (ไม่ใส่ก็ใช้ได้ เพราะ git ย้ายไปรากของ work tree เองเมื่อ cwd อยู่นอกนั้น — แต่ไม่พึ่งกติกาแฝงนี้)
      git: ['-C', codex, '--git-dir', codexSync, '--work-tree', codex],
      present: existsSync(join(codexSync, 'HEAD')),
      pathspec: null,
      // ไม่มีโฟลเดอร์ของ Codex = เครื่องนี้ไม่ได้ลง Codex ⇒ ข้ามเงียบๆ
      // มีโฟลเดอร์แต่ยังไม่ได้ตั้ง sync ⇒ ต้องฟ้อง ไม่งั้นความจำค้างเครื่องเดียวเงียบๆ ซ้ำรอยเดิม
      optional: !existsSync(codex),
      missingMsg: 'memory ของ Codex ยังไม่ได้ตั้งให้ข้ามเครื่อง',
      missingHint: 'รัน npm run codex:link ครั้งเดียวบนเครื่องนี้',
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
