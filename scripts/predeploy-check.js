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

// ไฟล์นอกรายการนี้ (docs, supabase/.temp, สคริปต์ทดลอง) ไม่ถูกอ่านตอน vite build
// จึงไม่ควรบล็อกการ deploy — ด่านที่เตือนพร่ำเพรื่อคือด่านที่คนกด --force ทุกครั้ง
const BUILD_INPUTS = [
  'src/', 'public/', 'worker/', 'scripts/',
  'index.html', 'vite.config.js', 'package.json', 'package-lock.json', 'wrangler.jsonc',
]

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function fail(title, lines, hint) {
  console.error(`\n\u274c ${title}\n`)
  for (const l of lines) console.error(`   ${l}`)
  console.error(`\n   ${hint}`)
  console.error('   ตั้งใจจะ deploy ทั้งอย่างนี้: ALLOW_DIRTY_DEPLOY=1 npm run cf:deploy\n')
  process.exit(1)
}

if (process.env.ALLOW_DIRTY_DEPLOY === '1') {
  console.log('\u26a0\ufe0f  ALLOW_DIRTY_DEPLOY=1 — ข้ามด่านตรวจก่อน deploy')
  process.exit(0)
}

// --porcelain ให้รูปแบบคงที่ข้ามเวอร์ชัน git ต่างจาก output ปกติที่เปลี่ยนตามภาษา/เวอร์ชัน
// -uall กาง untracked ในโฟลเดอร์ออกมาทีละไฟล์ ไม่งั้นจะเห็นแค่ชื่อโฟลเดอร์แล้ว match ไม่ตรง
const status = git(['status', '--porcelain', '-uall'])
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
