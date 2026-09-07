// ด่านกันรันโค้ดเก่า — เรียกจาก `predev` (ก่อน vite ขึ้น) และจาก vite.config.js (ระหว่างรัน)
//
// ที่ต้องมีเพราะ PR ถูก merge บน GitHub แล้ว CI deploy ให้เอง แต่ไม่มีอะไรบอก
// working tree ในเครื่องเลยว่า master ขยับไปแล้ว อาการที่ได้คือ "แก้แล้วแต่ที่เห็น
// ยังเหมือนเดิม" หรือหนักกว่านั้นคือเทียบ localhost กับแอปจริงแล้วสรุปผิด
// (เกิดจริง 2026-09-07: dev server เปิดค้างข้ามคืน ตามหลัง master 3 commit
//  ไล่หาสาเหตุอยู่นานเพราะนึกว่าเป็น cache ของเบราว์เซอร์)
//
// ข้ามด่านนี้ตอนที่ตั้งใจจริง: SKIP_SYNC_CHECK=1 npm run dev
// (PowerShell: $env:SKIP_SYNC_CHECK=1; npm run dev)

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const UPSTREAM = 'origin/master'

// สาขาเดียวที่ "ตามหลัง master" ถือเป็นความผิดปกติ
//
// worktree ใน D:\tmp\wt-* ทั้ง 16 ตัวใช้ package.json ไฟล์นี้ร่วมกัน และสาขา feature
// ที่ยังไม่ merge ย่อมตามหลัง master เป็นธรรมดา ถ้าบล็อกด้วยจะรัน dev ไม่ได้ทั้งกอง
// แล้วจบลงที่คนตั้ง SKIP_SYNC_CHECK ถาวร = ด่านนี้ตายไปเลย
const GUARDED_BRANCH = 'master'

// git fetch ต้องไม่ทำให้ dev server ขึ้นช้าหรือค้างตอนเน็ตล่ม/อยู่นอกออฟฟิศ
// ล้มเมื่อไรถือว่า "ตรวจไม่ได้" ไม่ใช่ "ตามหลัง" — ปล่อยผ่านเสมอ
const FETCH_TIMEOUT_MS = 10_000

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim()
}

/**
 * @param {{ fetch?: boolean }} options
 * @returns {{ ok: boolean, reason?: string, branch?: string, behind?: number,
 *             commits?: string[], migrations?: string[] }}
 *   ok:true = ไม่มีอะไรต้องเตือน (รวมถึงกรณีตรวจไม่ได้ ซึ่งจะมี reason กำกับ)
 */
export function checkBehind({ fetch = true } = {}) {
  let branch
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return { ok: true, reason: 'ไม่ใช่ git repo' }
  }

  if (branch !== GUARDED_BRANCH) {
    return { ok: true, reason: `อยู่บนสาขา ${branch} ไม่ใช่ ${GUARDED_BRANCH}`, branch }
  }

  if (fetch) {
    try {
      git(['fetch', '--quiet', 'origin', GUARDED_BRANCH], { timeout: FETCH_TIMEOUT_MS })
    } catch {
      // ต่อ origin ไม่ได้ — ยังเทียบกับ ref ที่ fetch ไว้ครั้งก่อนได้อยู่ ดีกว่าไม่ตรวจเลย
    }
  }

  let behind
  try {
    // left = commit ที่ upstream มีแต่เราไม่มี, right = ที่เรามีแต่ upstream ไม่มี
    const [left] = git(['rev-list', '--left-right', '--count', `${UPSTREAM}...HEAD`]).split(/\s+/)
    behind = Number(left)
  } catch {
    return { ok: true, reason: `ไม่มี ${UPSTREAM} ในเครื่อง`, branch }
  }

  if (!Number.isFinite(behind) || behind === 0) return { ok: true, branch, behind: 0 }

  const commits = git(['log', '--oneline', '--no-decorate', `HEAD..${UPSTREAM}`]).split('\n')

  // migration ที่มากับ commit ใหม่คือกับดักซ้อน: pull โค้ดมาแล้วฟีเจอร์ยังพัง
  // ถ้า DB ยังไม่ได้ apply (localhost ต่อ Supabase ตัวเดียวกับ production)
  const migrations = git([
    'diff', '--name-only', `HEAD..${UPSTREAM}`, '--', 'supabase/migrations',
  ]).split('\n').filter(Boolean)

  return { ok: false, branch, behind, commits, migrations }
}

/** ข้อความเตือนแบบใช้ร่วมกันทั้ง predev และ vite plugin */
export function formatWarning(result) {
  const lines = [
    '',
    `\x1b[31m\x1b[1m  โค้ดในเครื่องตามหลัง ${UPSTREAM} อยู่ ${result.behind} commit\x1b[0m`,
    '',
    ...result.commits.map((c) => `    ${c}`),
  ]

  if (result.migrations.length) {
    lines.push(
      '',
      `\x1b[33m  มี migration ใหม่ ${result.migrations.length} ไฟล์ — pull โค้ดอย่างเดียวไม่พอ ต้องดูว่า apply ขึ้น DB แล้วหรือยัง\x1b[0m`,
      ...result.migrations.map((m) => `    ${m}`),
    )
  }

  lines.push(
    '',
    '\x1b[1m  แก้: git pull --ff-only origin master  แล้วรัน dev ใหม่\x1b[0m',
    '',
  )
  return lines.join('\n')
}

// โหมด hook (--hook) — ใช้กับ SessionStart ของ Claude Code
//
// ต้อง exit 0 เสมอและพิมพ์ JSON เท่านั้น: agent ที่เริ่มทำงานบนโค้ดเก่าจะอ่านไฟล์
// ที่ไม่มีฟีเจอร์ล่าสุดแล้ววิเคราะห์ผิด ซึ่งอันตรายกว่าตาเรามองไม่เห็นเสียอีก
function runHookMode() {
  let result
  try {
    result = checkBehind()
  } catch {
    process.stdout.write(JSON.stringify({ suppressOutput: true }))
    return
  }

  if (result.ok) {
    process.stdout.write(JSON.stringify({ suppressOutput: true }))
    return
  }

  const summary = [
    `โค้ดในเครื่องตามหลัง ${UPSTREAM} อยู่ ${result.behind} commit — ห้ามสรุปว่าโค้ดในเครื่องคือของล่าสุด`,
    ...result.commits.map((c) => `  ${c}`),
  ]
  if (result.migrations.length) {
    summary.push(`มี migration ใหม่ ${result.migrations.length} ไฟล์ที่ยังไม่ได้ pull:`)
    summary.push(...result.migrations.map((m) => `  ${m}`))
  }
  summary.push('แก้ด้วย: git pull --ff-only origin master (ถามผู้ใช้ก่อนถ้ามีงานค้างในทรี)')

  process.stdout.write(JSON.stringify({
    systemMessage: `⚠️  โค้ดในเครื่องตามหลัง ${UPSTREAM} ${result.behind} commit — git pull --ff-only origin master`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: summary.join('\n'),
    },
  }))
}

// โหมด CLI — ใช้เป็น predev, exit 1 เพื่อไม่ให้ dev server ขึ้นมาหลอกตา
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  if (process.argv.includes('--hook')) {
    runHookMode()
    process.exit(0)
  }

  if (process.env.SKIP_SYNC_CHECK === '1') {
    console.log('  ข้ามด่านตรวจ sync (SKIP_SYNC_CHECK=1)')
    process.exit(0)
  }

  const result = checkBehind()
  if (result.ok) process.exit(0)

  console.error(formatWarning(result))
  console.error('  (ตั้งใจรันของเก่า: SKIP_SYNC_CHECK=1 npm run dev)\n')
  process.exit(1)
}
