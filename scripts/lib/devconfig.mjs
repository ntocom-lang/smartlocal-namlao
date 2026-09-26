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
import { execFileSync } from 'node:child_process';

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
