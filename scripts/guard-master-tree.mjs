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
//
// ไฟล์นอกทรีหลัก (~/.claude ความจำ/ตั้งค่า, scratchpad, D:\tmp\wt-*) ปล่อยผ่านเสมอ
// เพราะไม่มีวันกลายเป็นซากใน git status ของทรีหลัก
//
// ด่านที่ 2: คำสั่ง git ที่ทำงานค้างหาย (reset --hard, checkout/switch, restore, clean -f, stash)
// ในทรีหลักบน master — ใน worktree ยังใช้ได้ตามปกติ และบล็อกเฉพาะ agent ไม่ใช่คนพิมพ์เองใน terminal

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import os from 'os'
import path from 'path'

// สาขาเดียวที่หวง — สาขา feature ในทรีหลักถือว่าเจ้าของรู้ตัวว่าทำอะไรอยู่
const GUARDED_BRANCH = 'master'

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
 * หาทรีหลักจาก --git-common-dir (ชี้ .git ของทรีหลักเสมอ ไม่ว่า cwd จะอยู่ทรีหลักหรือ worktree)
 *
 * เดิมเช็คแค่ "cwd เป็นทรีหลักไหม" แล้วเลิกตรวจถ้าไม่ใช่ — session ที่เปิดใน worktree
 * แล้วเผลอ Write ด้วย absolute path เข้าทรีหลักจึงรอดด่านทั้งหมด ซึ่งคือเคสเผลอที่พบบ่อยที่สุด
 * คืนค่า null เมื่อเป็น repo แบบ bare หรือโครงสร้างที่ไม่รู้จัก — ไม่ใช่หน้าที่ด่านนี้จะไปขวาง
 */
function findMainRoot(cwd) {
  const commonDir = path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd))
  if (path.basename(commonDir) !== '.git') return null
  return path.dirname(commonDir)
}

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
  if (!/^[\w .\/\\@~:-]+$/.test(target)) return false
  return /[\/\\]/.test(target) || /\.[A-Za-z0-9]+$/.test(target)
}

const unquote = (s) => s.replace(/^['"]|['"]$/g, '')

/**
 * ตัดเนื้อใน heredoc (bash `<<EOF`) และ here-string (PowerShell `@' ... '@`) ทิ้ง
 * เนื้อพวกนี้คือข้อความ (ข้อความ commit, โค้ดที่เขียนลงไฟล์) ไม่ใช่คำสั่ง
 * ถ้าปล่อยไว้ ข้อความอย่าง "a > b.js" หรือบรรทัดที่ขึ้นต้นด้วย cd ในเนื้อจะถูกอ่านเป็นคำสั่งจริง
 * บรรทัดที่เปิด heredoc ยังอยู่ครบ — `cat > file <<EOF` ยังจับ file ได้เหมือนเดิม
 */
export function stripHereDocs(command) {
  const out = []
  let isEnd = null
  for (const line of command.split(/\r?\n/)) {
    if (isEnd) {
      const rest = isEnd(line)
      if (rest !== null) {
        isEnd = null
        if (rest.trim()) out.push(rest) // เช่น `'@ | Out-File a.js` ต้องตรวจส่วนหลังต่อ
      }
      continue
    }
    out.push(line)
    // (?<!<) กัน `<<<` (here-string ของ bash ที่ไม่มีเนื้อหลายบรรทัด)
    // คำปิดต้องขึ้นต้นด้วยตัวอักษร — กัน `x << 2` ในโค้ดถูกนับเป็น heredoc
    const bash = line.match(/(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/)
    if (bash) {
      const word = bash[2]
      isEnd = (l) => (l.trim() === word ? '' : null)
      continue
    }
    const ps = line.match(/@(['"])\s*$/)
    if (ps) {
      const closer = `${ps[1]}@`
      isEnd = (l) => (l.startsWith(closer) ? l.slice(closer.length) : null)
    }
  }
  return out.join('\n')
}

/**
 * แยกคำสั่งเป็นช่วงตาม && || ; และขึ้นบรรทัดใหม่ โดยไม่ตัดกลางเครื่องหมายคำพูด
 * (`node -e "a; b"` ต้องเป็นช่วงเดียว) ไม่ตัดที่ `|` เดี่ยว เพราะ pipe ไม่ได้ย้าย cwd
 */
export function splitSegments(command) {
  const segments = []
  let current = ''
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    const next = command[i + 1]
    if (quote) {
      current += c
      // \" ใน bash และ `" ใน PowerShell คือเครื่องหมายคำพูดที่ไม่ได้ปิดสตริง
      if (quote === '"' && (c === '\\' || c === '`') && next !== undefined) {
        current += next
        i++
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
      continue
    }
    const isPair = (c === '&' && next === '&') || (c === '|' && next === '|')
    if (c === ';' || c === '\n' || isPair) {
      segments.push(current)
      current = ''
      if (isPair) i++
      continue
    }
    current += c
  }
  segments.push(current)
  return segments.map((s) => s.trim()).filter(Boolean)
}

const isAbsoluteLike = (p) => /^(?:[\/\\]|~|[A-Za-z]:|\$HOME\b|\$\{HOME\}|\$env:)/i.test(p)

function joinDir(dir, target) {
  if (!dir || isAbsoluteLike(target)) return target
  return `${dir.replace(/[\/\\]+$/, '')}/${target}`
}

/**
 * ช่วงคำสั่งที่เป็นการย้ายโฟลเดอร์ล้วนๆ — คืนโฟลเดอร์ใหม่ หรือ undefined ถ้าไม่ใช่ cd
 * ที่ต้องมี: เดิมไม่รู้จัก cd เลย `cd ~/.claude/.../memory && printf >> MEMORY.md`
 * ถูกอ่านเป็น MEMORY.md ที่รากทรีหลักแล้วโดนบล็อก (เกิดจริง 2026-09-14)
 * และ `cd /d/tmp/wt-x && echo > src/a.js` ซึ่งเป็นการทำงานใน worktree ตามกติกาก็โดนบล็อกด้วย
 */
function cdTarget(segment) {
  const m = segment.match(
    /^(?:cd|pushd|sl|Set-Location|Push-Location)(?:\s+-(?:LiteralPath|Path))?(?:\s+("[^"]*"|'[^']*'|[^\s"']+))?(?:\s+\d?>\s*\S+)*\s*$/i,
  )
  if (!m) return undefined
  return m[1] === undefined ? '~' : unquote(m[1])
}

/** ปลายทางที่เขียนแบบ bash: redirect, sed -i, tee, cp/mv, rm */
function bashSegmentTargets(segment) {
  const targets = []
  // redirect: > file, >> file
  // ข้าม >&2 และ 2>&1 (ตัวเลข/& นำหน้า) และข้าม => -> >= <> ที่เป็นสัญลักษณ์ในโค้ด ไม่ใช่ redirect
  for (const m of segment.matchAll(/(?:^|[^0-9&>=<!-])>>?\s*(?!&)("[^"]+"|'[^']+'|[^\s;|&)]+)/g)) {
    targets.push(unquote(m[1]))
  }
  // แก้ไฟล์ในที่: sed -i, tee, cp/mv (ปลายทางคือ argument สุดท้าย)
  for (const m of segment.matchAll(/\bsed\s+(?:-[a-zA-Z]*i[a-zA-Z]*\S*\s+)(?:-\S+\s+|'[^']*'\s+|"[^"]*"\s+)*(\S+)/g)) {
    targets.push(unquote(m[1]))
  }
  for (const m of segment.matchAll(/\btee\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&]+)/g)) {
    targets.push(unquote(m[1]))
  }
  for (const m of segment.matchAll(/\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+("[^"]+"|'[^']+'|[^\s;|&]+)/g)) {
    targets.push(unquote(m[1]))
  }
  for (const m of segment.matchAll(/\brm\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&]+)/g)) {
    targets.push(unquote(m[1]))
  }
  return targets
}

// cmdlet ที่เขียน/ลบไฟล์ — เดิมไม่มีเลย ทั้งที่ PowerShell เป็น shell หลักของเครื่องนี้
const PS_WRITE_CMDLETS = 'Set-Content|Add-Content|Clear-Content|Out-File|New-Item|Remove-Item|Rename-Item|Copy-Item|Move-Item'
// พารามิเตอร์แบบสวิตช์ (ไม่มีค่าตามหลัง) — ตัวอื่นที่ขึ้นต้นด้วย - ถือว่ากินค่าถัดไป
const PS_SWITCHES = new Set(['force', 'recurse', 'append', 'nonewline', 'noclobber', 'passthru', 'whatif', 'confirm'])

/** ปลายทางของ cmdlet PowerShell — ต้องอยู่ต้นคำสั่ง/หลัง pipe ไม่งั้น `grep Remove-Item src/a.js` จะโดนด้วย */
function powershellSegmentTargets(segment) {
  const targets = []
  const re = new RegExp(`(?:^|[|({=]\\s*)(${PS_WRITE_CMDLETS})\\b([^|]*)`, 'gi')
  for (const m of segment.matchAll(re)) {
    const cmdlet = m[1].toLowerCase()
    const wantsDestination = cmdlet === 'copy-item' || cmdlet === 'move-item'
    const tokens = m[2].match(/"[^"]*"|'[^']*'|\S+/g) || []
    const positional = []
    let named = null
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (!token.startsWith('-')) {
        positional.push(token)
        continue
      }
      const name = token.slice(1).toLowerCase()
      if (name.includes(':') || PS_SWITCHES.has(name)) continue
      const value = tokens[++i]
      if (value === undefined) break
      if (wantsDestination ? name === 'destination' : ['path', 'literalpath', 'filepath'].includes(name)) {
        named = value
      }
    }
    const target = named ?? positional[wantsDestination ? 1 : 0]
    if (target) targets.push(unquote(target))
  }
  return targets
}

/**
 * ไฟล์ปลายทางที่คำสั่งจะ "เขียน" — ครอบเฉพาะรูปแบบที่ agent ใช้จริงบ่อย
 * path ที่คืนถูกต่อกับโฟลเดอร์จาก cd ก่อนหน้าแล้ว แต่ยังไม่แปลง ~ หรือ /c/... (ดู normalizeShellPath)
 * ⚠️ ไม่ใช่ตัวแยกวิเคราะห์ shell ครบรูปแบบ คำสั่งที่ซับซ้อนกว่านี้ (xargs, eval,
 * [IO.File]::WriteAllText, สคริปต์ที่เขียนไฟล์เอง) รอดด่านนี้ได้ — ด่านนี้กันความเผลอ ไม่ได้กันคนตั้งใจเลี่ยง
 */
export function bashWriteTargets(command) {
  const targets = []
  walkSegments(command, (segment, dir) => {
    const raw = [...bashSegmentTargets(segment), ...powershellSegmentTargets(segment)]
    for (const target of raw.filter(looksLikeFilePath)) targets.push(joinDir(dir, target))
  })
  return targets
}

/** ไล่ทีละช่วงคำสั่ง พร้อมโฟลเดอร์ที่ช่วงนั้นรันอยู่ ('' = cwd ของ session) */
function walkSegments(command, visit) {
  let dir = ''
  for (const segment of splitSegments(stripHereDocs(command))) {
    const cd = cdTarget(segment)
    if (cd !== undefined) {
      // `cd -` ไม่รู้ว่ากลับไปไหน — ถอยไปใช้ cwd ของ session ซึ่งเข้มกว่า (บล็อกเกินดีกว่าหลุด)
      dir = cd === '-' ? '' : joinDir(dir, cd)
      continue
    }
    visit(segment, dir)
  }
}

/**
 * เหตุผลที่คำสั่ง git นี้ทำงานที่ยังไม่ commit หาย — null ถ้าปลอดภัย
 *
 * ด่านเขียนไฟล์ข้างบนมองไม่เห็นคำสั่งพวกนี้ เพราะไม่มี path ปลายทางให้จับ
 * แต่ผลหนักกว่า: งานที่ session อื่นแก้ค้างในทรีหลักหายทั้งก้อน และไม่อยู่ใน reflog ให้กู้
 * AGENTS.md ห้ามไว้แล้ว ("ห้าม checkout ทับ ห้าม stash ห้าม reset") แต่ไม่มีอะไรบังคับ
 */
function destructiveGitReason(sub, args) {
  const has = (...flags) => args.some((a) => flags.includes(a))
  const shortFlag = (letter) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter))
  switch (sub) {
    case 'reset':
      return has('--hard') ? 'ล้างงานที่แก้ค้างทั้งทรี กู้คืนไม่ได้' : null
    case 'checkout':
    case 'switch':
      if (!args.length) return null // `git checkout` เปล่าๆ แค่แสดงสถานะ
      return has('--', '.', '-f', '--force')
        ? 'ทับไฟล์ที่แก้ค้างด้วยของเดิม กู้คืนไม่ได้'
        : 'สลับสาขาในทรีหลัก (AGENTS.md: ไม่สลับสาขาในทรีหลัก)'
    case 'restore':
      // --staged อย่างเดียวแค่ถอนออกจาก index ไฟล์ในทรีไม่เปลี่ยน
      if (has('--staged', '-S') && !has('--worktree', '-W')) return null
      return 'ทับไฟล์ที่แก้ค้างด้วยของเดิม กู้คืนไม่ได้'
    case 'clean':
      if (has('--dry-run') || shortFlag('n')) return null
      return has('--force') || shortFlag('f') ? 'ลบไฟล์ใหม่ที่ยังไม่ได้ add กู้คืนไม่ได้' : null
    case 'stash':
      // list/show/create อ่านอย่างเดียว ที่เหลือ (push/save/pop/apply/drop/clear) ขยับงานค้างทั้งหมด
      return ['list', 'show', 'create'].includes(args[0])
        ? null
        : 'ย้ายงานค้าง (ที่อาจเป็นของ session อื่น) ไปซ่อนหรือทับ เจ้าของหาไม่เจอ'
    default:
      return null
  }
}

/**
 * คำสั่ง git ที่ทำงานค้างหาย พร้อมโฟลเดอร์ที่มันจะรัน (ต่อจาก cd และ git -C แล้ว)
 * ต้องเป็นต้นช่วงคำสั่ง — `git commit -m "อย่ารัน git reset --hard"` จึงไม่นับ
 */
export function destructiveGitCommands(command) {
  const found = []
  walkSegments(command, (segment, dir) => {
    const tokens = (segment.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(unquote)
    if (!/^git(?:\.exe)?$/i.test(tokens[0] || '')) return
    let gitDir = dir
    let i = 1
    // ตัวเลือกก่อนชื่อคำสั่งย่อย: -C <dir> ย้ายโฟลเดอร์, -c <key=value> กินค่าถัดไป, ที่เหลือเป็นสวิตช์
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C' && tokens[i + 1] !== undefined) gitDir = joinDir(gitDir, tokens[++i])
      else if (tokens[i] === '-c') i++
      i++
    }
    const sub = tokens[i]
    const args = tokens.slice(i + 1)
    const reason = destructiveGitReason(sub, args)
    if (reason) found.push({ dir: gitDir, command: ['git', sub, ...args].join(' '), reason })
  })
  return found
}

/**
 * แปลง path แบบ shell ให้ path.resolve ของ Node เข้าใจ
 * - ~ / $HOME / $env:USERPROFILE → โฟลเดอร์ home (เดิมกลายเป็นโฟลเดอร์ชื่อ "~" ในทรีหลักแล้วโดนบล็อก)
 * - /d/VS Code/... ของ Git Bash → D:/VS Code/... บน Windows
 *   (เดิมกลายเป็น D:\d\VS Code\... ซึ่งอยู่นอก repo — เขียนเข้าทรีหลักด้วย path แบบนี้รอดด่านมาตลอด)
 */
export function normalizeShellPath(p, { home = os.homedir(), platform = process.platform } = {}) {
  let s = p.replace(/^(?:~|\$HOME\b|\$\{HOME\}|\$env:USERPROFILE\b|\$env:HOME\b)(?=$|[\/\\])/i, () => home)
  if (platform === 'win32') {
    s = s.replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
  }
  return s
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

/** เทียบว่า abs อยู่ใต้ root ไหม — path.relative บน win32 ไม่สนตัวพิมพ์เล็ก/ใหญ่ของ drive (d: กับ D:) */
export function isInside(root, abs) {
  const rel = path.relative(root, abs)
  return !(rel === '' || rel.startsWith('..') || path.isAbsolute(rel))
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
    root = findMainRoot(cwd)
    if (!root) return
    if (git(['rev-parse', '--abbrev-ref', 'HEAD'], root) !== GUARDED_BRANCH) return
  } catch {
    return // ไม่ใช่ git repo หรือ git ใช้ไม่ได้ — ไม่ใช่หน้าที่ด่านนี้จะไปขวาง
  }

  const blocked = []
  for (const target of toolTargets(payload)) {
    const abs = path.resolve(cwd, normalizeShellPath(target))
    if (!isInside(root, abs)) continue // นอกทรีหลัก รวม worktree ที่ D:\tmp และ ~/.claude
    try {
      // รัน git จากทรีหลักเสมอ — รันจาก worktree แล้วถาม path ของทรีหลัก git จะตอบ exit 128
      // (นอก repo) ซึ่งตกไปฝั่ง "บล็อก" ทั้งที่ไฟล์นั้นอาจถูก ignore อยู่
      execFileSync('git', ['check-ignore', '-q', '--', abs], { cwd: root, stdio: 'ignore' })
      continue // git ไม่ track อยู่แล้ว (รวม .claude/worktrees/) ไม่มีวันค้างเป็นซาก
    } catch {
      // exit 1 = ไม่ถูก ignore → เป็นไฟล์ที่นับใน git status
    }
    blocked.push(path.relative(root, abs).split(path.sep).join('/'))
  }

  const blockedGit = toolGitCommands(payload).filter(({ dir }) => runsInMainTree(root, path.resolve(cwd, normalizeShellPath(dir || '.'))))

  if (!blocked.length && !blockedGit.length) return

  const lines = []
  if (blocked.length) {
    lines.push(
      `ห้ามแก้ไฟล์ในทรีหลักขณะอยู่บนสาขา ${GUARDED_BRANCH}: ${blocked.join(', ')}`,
      '',
      'กติกาใน AGENTS.md: ทำงานใน worktree แยกที่ตัดจาก origin/master เสมอ',
      'ทรีหลักสำหรับ pull/รัน dev/อ่านโค้ดเท่านั้น — แก้ตรงนี้แล้วงานจะค้างเป็นซาก',
      'หลัง squash merge จนทำให้ git pull --ff-only ไม่ผ่านอีกเลย',
      '',
    )
  }
  if (blockedGit.length) {
    lines.push(
      `ห้ามรันคำสั่ง git ที่ทำงานค้างหายในทรีหลักขณะอยู่บนสาขา ${GUARDED_BRANCH}:`,
      ...blockedGit.map((g) => `  ${g.command}  → ${g.reason}`),
      '',
      'งานที่ยังไม่ commit ในทรีหลักอาจเป็นของ session อื่น และไม่อยู่ใน reflog ให้กู้',
      '(AGENTS.md: ห้าม checkout ทับ ห้าม stash ห้าม reset)',
      'ถ้าต้องล้างทรีหลักจริง: หยุด อธิบายให้ผู้ใช้ฟังว่าจะหายอะไร แล้วให้ผู้ใช้สั่งเองใน terminal',
      '',
    )
  }
  lines.push(
    'ทำแทน:  git worktree add /d/tmp/wt-<ชื่องาน> -b <สาขา> origin/master',
    'ตั้งใจแก้ทรีหลักจริง: ขออนุญาตผู้ใช้ แล้วเปิด session ใหม่ด้วย ALLOW_MASTER_TREE_EDIT=1',
  )
  deny(lines.join('\n'))
}

export function toolGitCommands(payload) {
  const command = payload.tool_input?.command
  if (!command || !['Bash', 'PowerShell'].includes(payload.tool_name)) return []
  return destructiveGitCommands(command)
}

/**
 * คำสั่ง git ที่รันจาก dir จะไปโดนทรีหลักไหม — ถาม git ตรงๆ แทนการเทียบ path
 * เพราะ worktree ซ้อนใน .claude/worktrees/ อยู่ใต้โฟลเดอร์ทรีหลักแต่เป็นคนละทรี
 * โฟลเดอร์ที่ไม่มีอยู่จริง/ไม่ใช่ repo → คำสั่งนั้นพังเองอยู่แล้ว ปล่อยผ่าน
 */
function runsInMainTree(root, dir) {
  try {
    return path.relative(root, git(['rev-parse', '--show-toplevel'], dir)) === ''
  } catch {
    return false
  }
}

// รัน main() เฉพาะตอนถูกเรียกเป็น hook จริง — ไม่งั้น import ในเทสต์จะค้างรอ stdin
// (รูปแบบเดียวกับ check-behind.mjs)
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
