// ด่านกันเผลอ deploy — รันก่อน `npm run build && wrangler deploy` ใน cf:deploy
//
// ที่ต้องมีเพราะ cf:deploy ยิงตรงเข้า production (*.rk-networks.com) โดยไม่ผ่าน CI
// และ vite build อ่านจาก "working tree" ไม่ใช่ HEAD ของค้างที่ยังไม่ commit
// จึงขึ้น production ได้ทันทีจากการพิมพ์ผิดครั้งเดียว
// (เกิดจริงแล้ว 2026-08-28: โค้ดทดลองลบปุ่มลิงก์ปฏิทินขึ้นไปโดยไม่ตั้งใจ)
//
// ตรวจ 2 อย่าง แล้วหยุดถ้าไม่ผ่าน:
//   1. ไฟล์ที่มีผลต่อ bundle เปลี่ยนแต่ยังไม่ commit
//   2. commit ที่กำลังจะ deploy ยังไม่ถูก push ขึ้น origin
//      (production ต้องย้อนรอยกลับไปหา commit ใน remote ได้เสมอ — ไม่งั้นถ้าเครื่องพัง
//       จะไม่มีใครรู้ว่าของที่รันอยู่มาจากโค้ดชุดไหน)
//
// ข้ามด่านนี้ตอนที่ตั้งใจจริง: ALLOW_DIRTY_DEPLOY=1 npm run cf:deploy
// (PowerShell: $env:ALLOW_DIRTY_DEPLOY=1; npm run cf:deploy)

import { execFileSync } from 'child_process'
import { loadEnv } from 'vite'

// ตัวแปรที่ขาดแล้ว "หน้าเว็บขาวทั้งหน้า" — src/lib/supabase.js โยน Error ตอน import
// ซึ่งเกิดก่อน React จะ render อะไรได้ ผู้ใช้เห็น #root ว่างเปล่าอย่างเดียว
const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

// ขาดแล้วฟีเจอร์นั้นตายเงียบ ไม่มีอะไรฟ้อง แค่ไม่ทำงาน — เตือนแต่ไม่บล็อก
// VITE_VAPID_PUBLIC_KEY สำคัญเป็นพิเศษเพราะไม่ได้อยู่ใน .env.example ด้วยซ้ำ
// เครื่องใหม่หรือ worktree ใหม่จะไม่มีทางรู้ว่าต้องมี จนกว่าจะมีคนบ่นว่าไม่ได้รับแจ้งเตือน
const RECOMMENDED_ENV = ['VITE_VAPID_PUBLIC_KEY', 'VITE_GOOGLE_MAPS_API_KEY', 'VITE_LONGDO_KEY']

// ไฟล์นอกรายการนี้ (docs, supabase/.temp, สคริปต์ทดลอง) ไม่ถูกอ่านตอน vite build
// จึงไม่ควรบล็อกการ deploy — ด่านที่เตือนพร่ำเพรื่อคือด่านที่คนกด --force ทุกครั้ง
const BUILD_INPUTS = [
  'src/', 'public/', 'worker/', 'scripts/',
  'index.html', 'vite.config.js', 'package.json', 'package-lock.json', 'wrangler.jsonc',
]

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

// สำหรับ output ที่ "ช่องว่างนำหน้ามีความหมาย" — git status --porcelain ใช้ 2 ตัวอักษรแรก
// เป็นรหัสสถานะ (index, worktree) ไฟล์ที่แก้ในเครื่องแต่ยังไม่ add จะได้ " M" คือเว้นวรรคนำ
//
// git() ข้างบน .trim() ทั้งก้อน ซึ่งกินช่องว่างนำหน้าของ *บรรทัดแรก* ไปด้วย
// ทำให้ slice(3) ของบรรทัดนั้นตัดผิดไป 1 ตัวอักษร ('scripts/x.js' -> 'cripts/x.js')
// แล้ว match กับ BUILD_INPUTS ไม่ติด ผลคือไฟล์ค้างที่เรียงตามตัวอักษรมาเป็นอันแรก
// หลุดด่านนี้ไปได้เสมอโดยไม่มีอะไรฟ้อง — ตรงข้ามกับหน้าที่ของด่านนี้ทั้งหมด
function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).replace(/s+$/, '')
}

function fail(title, lines, hint) {
  console.error(`\n\u274c ${title}\n`)
  for (const l of lines) console.error(`   ${l}`)
  console.error(`\n   ${hint}`)
  console.error('   ตั้งใจจะ deploy ทั้งอย่างนี้: ALLOW_DIRTY_DEPLOY=1 npm run cf:deploy\n')
  process.exit(1)
}

// ไม่ใช้ fail() ตัวเดิมเพราะมันพ่วงคำใบ้ ALLOW_DIRTY_DEPLOY ท้ายข้อความเสมอ
// ซึ่งเป็นคำแนะนำที่ผิดสำหรับกรณีนี้ — env ขาดแล้ว deploy ต่อยังไงก็ได้หน้าขาว
function failEnv(lines, hint) {
  console.error(`\n\u274c ไม่พบตัวแปร environment ที่จำเป็น — bundle ที่ได้จะขึ้นหน้าขาวทั้งหน้า\n`)
  for (const l of lines) console.error(`   ${l}`)
  console.error(`\n   ${hint}\n`)
  process.exit(1)
}

// ตรวจ env ด้วย loadEnv ของ vite เอง ไม่ใช่ readFile('.env.local') ตรงๆ
// เพราะ vite resolve จาก mode + envDir + process.env ตามลำดับของมันเอง
// อ่านไฟล์เองจะได้คนละคำตอบกับที่ build จริงได้ ซึ่งคือด่านที่หลอกตัวเอง
//
// ด่านนี้อยู่เหนือ ALLOW_DIRTY_DEPLOY โดยตั้งใจ — ทางลัดนั้นมีไว้ข้าม "ของค้างที่ยัง
// ไม่ commit" ซึ่งเป็นการตัดสินใจที่คนกดรู้ผลของมัน ส่วน env ขาดไม่มีใครตั้งใจ
// และข้ามไปแล้วไม่ได้อะไรเลยนอกจากหน้าขาว
//
// ที่ต้องมี: 2026-08-31 deploy จาก clean worktree ที่ไม่มี .env.local (ไฟล์ถูก
// git ignore ไว้ จึงไม่ติดมากับ worktree) bundle ที่ได้ตายทันทีตอนโหลดด้วย
// "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local"
// build ผ่าน deploy ผ่าน แล้วไปพังบนหน้าเว็บของประชาชน
//
// ห้าม log ค่า env เด็ดขาด — รายงานแค่ชื่อคีย์ที่ขาด
const env = loadEnv('production', process.cwd(), '')
const missing = REQUIRED_ENV.filter((k) => !env[k])

if (missing.length) {
  failEnv(
    missing.map((k) => `ขาด  ${k}`),
    'ตรวจว่ารันจาก directory ที่มี .env.local (ไฟล์นี้ถูก git ignore จึงไม่ติดมากับ worktree ใหม่)',
  )
}

const missingOptional = RECOMMENDED_ENV.filter((k) => !env[k])
if (missingOptional.length) {
  console.warn(`\u26a0\ufe0f  ไม่พบ ${missingOptional.join(', ')} — ฟีเจอร์ที่ใช้ค่าเหล่านี้จะไม่ทำงานแบบไม่มีข้อความแจ้ง`)
}

if (process.env.ALLOW_DIRTY_DEPLOY === '1') {
  console.log('\u26a0\ufe0f  ALLOW_DIRTY_DEPLOY=1 — ข้ามด่านตรวจก่อน deploy')
  process.exit(0)
}

// --porcelain ให้รูปแบบคงที่ข้ามเวอร์ชัน git ต่างจาก output ปกติที่เปลี่ยนตามภาษา/เวอร์ชัน
// -uall กาง untracked ในโฟลเดอร์ออกมาทีละไฟล์ ไม่งั้นจะเห็นแค่ชื่อโฟลเดอร์แล้ว match ไม่ตรง
const status = gitLines(['status', '--porcelain', '-uall'])
  .split('\n')
  .filter(Boolean)
  // คอลัมน์ 0-1 คือสถานะ ชื่อไฟล์เริ่มที่ 3 — ตัดด้วย slice ไม่ใช่ split(' ')
  // เพราะชื่อไฟล์ที่มีช่องว่างจะขาดกลาง
  .map((line) => ({ state: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '') }))
  // rename มาเป็น "เดิม -> ใหม่" เอาปลายทางพอ
  .map((e) => ({ ...e, path: e.path.includes(' -> ') ? e.path.split(' -> ')[1] : e.path }))
  .filter((e) => BUILD_INPUTS.some((p) => (p.endsWith('/') ? e.path.startsWith(p) : e.path === p)))

if (status.length) {
  fail(
    'มีไฟล์ที่มีผลต่อ bundle ยังไม่ commit — ของค้างเหล่านี้จะขึ้น production ด้วย',
    status.map((e) => `${e.state}  ${e.path}`),
    'commit ให้เรียบร้อยก่อน หรือ `git stash` เก็บไว้แล้วค่อย deploy',
  )
}

// HEAD ต้องมีอยู่บน remote — เทียบกับทุก branch ของ origin ไม่ใช่แค่ upstream ของ branch ปัจจุบัน
// เพราะ deploy จาก feature branch ที่ push แล้วถือว่าปลอดภัยเท่ากัน
const head = git(['rev-parse', 'HEAD'])
let onRemote = false
try {
  onRemote = git(['branch', '-r', '--contains', head]).length > 0
} catch {
  // repo ที่ไม่มี remote (เครื่อง dev ล้วน) — เตือนแล้วปล่อยผ่าน ไม่ใช่หน้าที่ของด่านนี้
  console.warn('\u26a0\ufe0f  ตรวจ remote ไม่ได้ ข้ามการตรวจข้อ 2')
  onRemote = true
}

if (!onRemote) {
  fail(
    'commit ที่กำลังจะ deploy ยังไม่ได้ push ขึ้น origin',
    [`HEAD = ${head.slice(0, 7)}  (${git(['log', '-1', '--format=%s'])})`],
    'push ขึ้น origin ก่อน เพื่อให้ production ย้อนกลับไปหาโค้ดต้นทางได้เสมอ',
  )
}

console.log(`\u2705 ผ่านด่านตรวจ — deploy จาก ${head.slice(0, 7)} (${git(['log', '-1', '--format=%s'])})`)
