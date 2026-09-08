// ด่านกันแก้ไฟล์ในทรีหลักขณะอยู่บน master — เรียกจาก PreToolUse ของ Claude Code
//
// ที่ต้องมีเพราะกติกา "ทำงานใน git worktree แยกเสมอ" ใน AGENTS.md เป็นแค่ข้อความ
// ไม่มีอะไรบังคับ พอ agent เผลอแก้ไฟล์ในทรีหลักบน master แล้วเอางานไป PR จาก worktree
// อื่น พอ squash merge เสร็จ สำเนาในทรีหลักจะค้างเป็นซากที่ไม่มีใครเป็นเจ้าของ
// อาการปลายทางคือ `git pull --ff-only` ไม่ผ่านตลอดไป แล้วคนไปกด SKIP_SYNC_CHECK=1
// แทนการล้าง — ด่าน check-behind.mjs ก็ตายไปด้วย
// (เกิดจริง 2026-09-08: ทรีหลักตามหลัง 4 commit โดยมีซากของ PR #96–#99 ค้างอยู่
//  ทั้งไฟล์ tracked 9 ไฟล์และ untracked 5 ไฟล์ ต้องไล่เทียบทีละไฟล์ก่อน pull ได้)
//
// ตั้งใจแก้ทรีหลักจริงๆ: ตั้ง env ALLOW_MASTER_TREE_EDIT=1 ก่อนเปิด session
// (PowerShell: $env:ALLOW_MASTER_TREE_EDIT=1)

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

// สาขาเดียวที่หวง — สาขา feature ในทรีหลักถือว่าเจ้าของรู้ตัวว่าทำอะไรอยู่
const GUARDED_BRANCH = 'master'

// ไฟล์ที่ git ไม่ track อยู่แล้ว (node_modules, .env, scratchpad ฯลฯ) ปล่อยผ่าน
// เพราะมันไม่มีวันกลายเป็นซากที่ค้างใน git status ตั้งแต่แรก

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** อ่าน payload ของ hook จาก stdin — พังเมื่อไรถือว่า "ตรวจไม่ได้" ปล่อยผ่านเสมอ */
async function readPayload() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * แยกทรีหลักออกจาก worktree ด้วย --git-dir เทียบ --git-common-dir
 * ทรีหลักได้ ".git" เท่ากันทั้งคู่ / worktree ได้ ".git/worktrees/<ชื่อ>" ต่างกัน
 * (เช็คจาก path ของโฟลเดอร์ตรงๆ เชื่อถือได้กว่าเดาจากชื่อสาขา)
 */
function isMainTree(cwd) {
  const gitDir = path.resolve(cwd, git(['rev-parse', '--git-dir'], cwd))
  const commonDir = path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd))
  return gitDir === commonDir
}

/**
 * ไฟล์ปลายทางที่คำสั่งจะ "เขียน" — ครอบเฉพาะรูปแบบที่ agent ใช้จริงบ่อย
 * ⚠️ ไม่ใช่ตัวแยกวิเคราะห์ shell ครบรูปแบบ คำสั่งที่ซับซ้อนกว่านี้ (xargs, eval,
 * สคริปต์ที่เขียนไฟล์เอง) รอดด่านนี้ได้ — ด่านนี้กันความเผลอ ไม่ได้กันคนตั้งใจเลี่ยง
 */
/**
 * กรอง "ปลายทาง" ที่ไม่ใช่ชื่อไฟล์ — กัน false positive จากสัญลักษณ์ในโค้ดที่หลุด regex มา
 * เกิดจริงชั่วโมงแรกที่เปิดใช้: `node -e "...on('end',()=>{const j=...})"` โดน regex redirect
 * จับ `=>` แล้วได้ปลายทางเป็น `s+=d` กับ `{const` — บล็อกคำสั่งที่แค่อ่านอย่างเดียวจนงานเดินต่อไม่ได้
 *
 * 2 ชั้น: (1) มีแต่อักขระที่ขึ้นชื่อไฟล์ได้ (2) มี / หรือนามสกุล
 * ชั้นที่ 2 จำเป็นเพราะตัวแปรชื่อสั้นในโค้ด เช่น `if (a > b)` หน้าตาเหมือนชื่อไฟล์ทุกประการ
 *
 * ⚠️ แลกมาด้วย: ไฟล์ใหม่ที่รากโปรเจกต์และไม่มีนามสกุล (เช่น `Makefile`) จะรอดด่านนี้
 * ยอมรับได้ เพราะ Edit/Write ยังกันครบ 100% — ตรงนี้เป็นชั้นเสริมสำหรับ Bash เท่านั้น
 */
function looksLikeFilePath(target) {
  if (!/^[\w .\/\\@~-]+$/.test(target)) return false
  return /[\/\\]/.test(target) || /\.[A-Za-z0-9]+$/.test(target)
}

export function bashWriteTargets(command) {
  const targets = []
  const unquote = (s) => s.replace(/^['"]|['"]$/g, '')

  // redirect: > file, >> file
  // ข้าม >&2 และ 2>&1 (ตัวเลข/& นำหน้า) และข้าม => -> >= <> ที่เป็นสัญลักษณ์ในโค้ด ไม่ใช่ redirect
  for (const m of command.matchAll(/(?:^|[^0-9&>=<!-])>>?\s*(?!&)("[^"]+"|'[^']+'|[^\s;|&)]+)/g)) {
    targets.push(unquote(m[1]))
  }
  // แก้ไฟล์ในที่: sed -i, tee, cp/mv (ปลายทางคือ argument สุดท้าย)
  for (const m of command.matchAll(/\bsed\s+(?:-[a-zA-Z]*i[a-zA-Z]*\S*\s+)(?:-\S+\s+|'[^']*'\s+|"[^"]*"\s+)*(\S+)/g)) {
    targets.push(unquote(m[1]))
  }
  for (const m of command.matchAll(/\btee\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&]+)/g)) {
    targets.push(unquote(m[1]))
  }
  for (const m of command.matchAll(/\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+("[^"]+"|'[^']+'|[^\s;|&]+)/g)) {
    targets.push(unquote(m[1]))
  }
  for (const m of command.matchAll(/\brm\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&]+)/g)) {
    targets.push(unquote(m[1]))
  }
  return targets.filter(looksLikeFilePath)
}

export function toolTargets(payload) {
  const input = payload.tool_input || {}
  switch (payload.tool_name) {
    case 'Edit':
    case 'Write':
      return input.file_path ? [input.file_path] : []
    case 'NotebookEdit':
      return input.notebook_path ? [input.notebook_path] : []
    case 'Bash':
    case 'PowerShell':
      return input.command ? bashWriteTargets(input.command) : []
    default:
      return []
  }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }))
}

async function main() {
  if (process.env.ALLOW_MASTER_TREE_EDIT === '1') return

  let payload
  try {
    payload = await readPayload()
  } catch {
    return
  }

  const cwd = payload.cwd || process.cwd()
  let root
  try {
    if (!isMainTree(cwd)) return
    if (git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) !== GUARDED_BRANCH) return
    root = git(['rev-parse', '--show-toplevel'], cwd)
  } catch {
    return // ไม่ใช่ git repo หรือ git ใช้ไม่ได้ — ไม่ใช่หน้าที่ด่านนี้จะไปขวาง
  }

  const blocked = []
  for (const target of toolTargets(payload)) {
    const abs = path.resolve(cwd, target)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue // นอก repo
    try {
      execFileSync('git', ['check-ignore', '-q', '--', abs], { cwd, stdio: 'ignore' })
      continue // git ไม่ track อยู่แล้ว ไม่มีวันค้างเป็นซาก
    } catch {
      // exit 1 = ไม่ถูก ignore → เป็นไฟล์ที่นับใน git status
    }
    blocked.push(rel.split(path.sep).join('/'))
  }

  if (!blocked.length) return

  deny([
    `ห้ามแก้ไฟล์ในทรีหลักขณะอยู่บนสาขา ${GUARDED_BRANCH}: ${blocked.join(', ')}`,
    '',
    'กติกาใน AGENTS.md: ทำงานใน worktree แยกที่ตัดจาก origin/master เสมอ',
    'ทรีหลักสำหรับ pull/รัน dev/อ่านโค้ดเท่านั้น — แก้ตรงนี้แล้วงานจะค้างเป็นซาก',
    'หลัง squash merge จนทำให้ git pull --ff-only ไม่ผ่านอีกเลย',
    '',
    'ทำแทน:  git worktree add /d/tmp/wt-<ชื่องาน> -b <สาขา> origin/master',
    'ตั้งใจแก้ทรีหลักจริง: ขออนุญาตผู้ใช้ แล้วเปิด session ใหม่ด้วย ALLOW_MASTER_TREE_EDIT=1',
  ].join('\n'))
}

// รัน main() เฉพาะตอนถูกเรียกเป็น hook จริง — ไม่งั้น import ในเทสต์จะค้างรอ stdin
// (รูปแบบเดียวกับ check-behind.mjs)
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
