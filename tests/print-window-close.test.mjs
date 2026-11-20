// ด่านกันลืม: ทุกจุดที่เขียนใบพิมพ์ลงหน้าต่างใหม่ด้วย document.write ต้องห่อด้วย addMobileCloseButton()
// เหตุ: บนมือถือ window.open เป็นแท็บใหม่ที่ไม่มีแถบปิด/ย้อนกลับ — ใบที่ไม่มีปุ่มปิดจะค้างอยู่ที่หน้าเอกสาร (เจ้าของระบบแจ้ง 2569-10-25)
//       เคยแก้ทีละใบจนตกหล่นหลายสิบจุด ด่านนี้กันไม่ให้ใบใหม่ที่ลืมห่อหลุดขึ้นระบบ (รันเป็น prebuild ด้วย)
// รันด้วย: npm run test:print-close — node ล้วน ไม่ล็อกอิน ไม่แตะฐานข้อมูล
//
// วิธีแก้เมื่อล้ม: ห่อเป็น `win.document.write(addMobileCloseButton(html))` (import จาก lib/printWindowClose)
//   หรือถ้าใบนั้นมีปุ่มปิดของตัวเองอยู่แล้ว (ห้ามมีสองปุ่มในหน้าเดียว) ให้ใส่ ALLOWLIST ด้านล่างพร้อมเหตุผล
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRINT_WINDOW_CLOSE_CLASS, addMobileCloseButton } from '../src/lib/printWindowClose.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const WRAPPER = 'addMobileCloseButton('

// คีย์ = path จากรากรีโป (ทั้งไฟล์) หรือ `path::ข้อความที่อาร์กิวเมนต์ขึ้นต้น` (เฉพาะจุดนั้นในไฟล์)
// ทุกรายการต้องเขียนเหตุผลภาษาไทย และต้องยังมี document.write ที่ตรงกันอยู่จริง (ไม่งั้นด่านล้ม — กันรายการค้าง)
const ALLOWLIST = {
  'src/lib/printWindowClose.js':
    'ไฟล์ตัวช่วยเอง — ไม่มี document.write จริง ปรากฏในคอมเมนต์/สตริงตัวอย่างเท่านั้น',
  'src/lib/patientTransportPrint.js':
    'ทุกใบสร้างผ่าน page() ที่ฝังปุ่ม .print-window-close ของตัวเองไว้แล้ว (#375) — ห่อซ้ำจะได้สองปุ่มในหน้าเดียว',
  'src/pages/PatientTransportStaff.jsx':
    'เขียนหน้า "กำลังเตรียมเอกสาร" จาก buildPatientPrintLoadingHtml() ซึ่งมีปุ่มปิดของ patientTransportPrint อยู่แล้ว — ห่อซ้ำจะได้สองปุ่ม',
  'src/pages/PatientTransportWizard.jsx':
    'เขียนใบจาก buildPatientTransportFormHtml() ที่มีปุ่มปิดของ patientTransportPrint อยู่แล้ว — ห่อซ้ำจะได้สองปุ่ม',
  'src/pages/MyDocRequests.jsx::buildPatientTransportFormHtml(':
    'ใบคำขอรถรับ-ส่งผู้ป่วยจาก buildPatientTransportFormHtml() มีปุ่มปิดของ patientTransportPrint อยู่แล้ว — ห่อซ้ำจะได้สองปุ่ม (จุดอื่นในไฟล์นี้ต้องห่อ)',
  'src/components/admin/CivilProjectReport.jsx':
    'เมนูนี้ถอดออกจากระบบแล้ว (ไม่มีผู้ใช้เปิด) — ถ้านำเมนูกลับมาให้ห่อแล้วลบรายการนี้',
}

function listSources(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listSources(full))
    else if (/\.(js|jsx)$/.test(name)) out.push(full)
  }
  return out
}

// คืนทุกจุด `document.write(` ที่เป็นโค้ดจริง (ข้ามบรรทัดคอมเมนต์) พร้อมอาร์กิวเมนต์ตัวแรกที่ตัดช่องว่างหน้าออกแล้ว
function findWrites(text) {
  const hits = []
  const re = /document\.write\(/g
  let m
  while ((m = re.exec(text))) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1
    const lineHead = text.slice(lineStart, m.index).trimStart()
    if (lineHead.startsWith('//') || lineHead.startsWith('*') || lineHead.startsWith('/*')) continue
    const line = text.slice(0, m.index).split('\n').length
    const arg = text.slice(m.index + m[0].length).trimStart()
    hits.push({ line, arg })
  }
  return hits
}

const missing = []
const allowHit = new Set()
for (const file of listSources(SRC)) {
  const rel = relative(ROOT, file).split(sep).join('/')
  for (const hit of findWrites(readFileSync(file, 'utf8'))) {
    if (hit.arg.startsWith(WRAPPER)) continue
    const entry = Object.keys(ALLOWLIST).find(key => {
      const [path, prefix] = key.split('::')
      return path === rel && (prefix === undefined || hit.arg.startsWith(prefix))
    })
    if (entry) { allowHit.add(entry); continue }
    missing.push(`${rel}:${hit.line}`)
  }
}

if (missing.length) {
  console.error('ใบพิมพ์ที่เขียนด้วย document.write แต่ยังไม่ห่อ addMobileCloseButton() — บนมือถือจะปิดหน้าต่างไม่ได้:')
  for (const where of missing) console.error(`  ${where}`)
  console.error('\nวิธีแก้: ห่อเป็น `win.document.write(addMobileCloseButton(html))` (import จาก lib/printWindowClose)')
  console.error('หรือถ้าใบนั้นมีปุ่มปิดของตัวเองแล้ว ให้ใส่ ALLOWLIST ใน tests/print-window-close.test.mjs พร้อมเหตุผล')
  process.exit(1)
}

// รายการยกเว้นต้องยังมีจริง ไม่งั้นเป็นรายการค้างที่บังตาด่าน
// (printWindowClose.js เป็นข้อยกเว้นเดียวที่ไม่ต้องมี document.write — เป็นตัวช่วยเอง)
const stale = Object.keys(ALLOWLIST).filter(key => {
  if (key === 'src/lib/printWindowClose.js') return false
  return !allowHit.has(key)
})
assert.deepEqual(stale, [], `ALLOWLIST มีรายการที่ไม่มีไฟล์/ไม่มี document.write ตรงกันแล้ว ให้ลบออก: ${stale.join(', ')}`)
for (const key of Object.keys(ALLOWLIST)) {
  const [path] = key.split('::')
  assert.ok(statSync(join(ROOT, path), { throwIfNoEntry: false }), `ALLOWLIST ชี้ไฟล์ที่ไม่มีอยู่: ${path}`)
  assert.ok(ALLOWLIST[key].trim().length > 0, `ALLOWLIST ต้องมีเหตุผล: ${key}`)
}

// ── ตัวห่อเอง: ปุ่มเดียวแม้เรียกซ้ำ · ใช้ได้ทั้งเอกสารเต็มและชิ้นส่วน ──────────────────────────
const count = (text, needle) => text.split(needle).length - 1
const BUTTON_MARK = `class="${PRINT_WINDOW_CLOSE_CLASS}"`

const fullDoc = '<!DOCTYPE html><html><head><title>x</title></head><body><p>ใบ</p></body></html>'
const wrapped = addMobileCloseButton(fullDoc)
assert.equal(count(wrapped, BUTTON_MARK), 1, 'เอกสารเต็มต้องได้ปุ่มหนึ่งปุ่ม')
assert.ok(wrapped.indexOf(BUTTON_MARK) < wrapped.toLowerCase().lastIndexOf('</body>'), 'ปุ่มต้องอยู่ก่อน </body>')
assert.ok(wrapped.indexOf('<style data-print-window-close>') < wrapped.toLowerCase().indexOf('</head>'), 'CSS ต้องอยู่ใน <head>')
assert.equal(addMobileCloseButton(wrapped), wrapped, 'เรียกซ้ำต้องไม่เพิ่มปุ่ม')
assert.equal(count(addMobileCloseButton(addMobileCloseButton(wrapped)), BUTTON_MARK), 1)

const noHead = '<!doctype html><meta charset="utf-8"><title>กำลังเตรียมใบพิมพ์</title><body>รอสักครู่</body>'
assert.equal(count(addMobileCloseButton(noHead), BUTTON_MARK), 1, 'ไม่มี <head> ต้องได้ปุ่มหนึ่งปุ่ม')
assert.ok(addMobileCloseButton(noHead).startsWith('<!doctype html>'), 'doctype ต้องอยู่หน้าสุด (ไม่ให้เข้า quirks mode)')

const fragment = '<p>กำลังเตรียมเอกสาร...</p>'
const fragWrapped = addMobileCloseButton(fragment)
assert.equal(count(fragWrapped, BUTTON_MARK), 1, 'ชิ้นส่วนที่ไม่มี <head>/<body> ต้องได้ปุ่มหนึ่งปุ่ม')
assert.ok(fragWrapped.includes(fragment), 'เนื้อหาเดิมต้องอยู่ครบ')

const noBody = '<html><head><title>x</title></head><p>ไม่มี body</p></html>'
assert.equal(count(addMobileCloseButton(noBody), BUTTON_MARK), 1, 'มี <head> ไม่มี <body> ต้องได้ปุ่มหนึ่งปุ่ม')
assert.equal(count(addMobileCloseButton(undefined), BUTTON_MARK), 1, 'ค่าว่างต้องไม่พัง')

console.log('print-window-close: ผ่าน — ทุก document.write ห่อปุ่มปิดหรือมีเหตุผลยกเว้น')
