// เมนูซ้ายผู้พัฒนา (DevJournal + DevAdvisor + PortalDrawer tone="dev") แบบพรีเมียม — PR4 เจ้าของระบบอนุมัติ 2569-11-16
// ตรวจจากซอร์ส (ไม่วัดภาพ) + คำนวณ contrast จริง · node ล้วน ไม่ต่อเน็ต/ฐานข้อมูล
// รัน: node tests/dev-nav.test.mjs (npm run test:dev-nav) — อยู่ในรายชื่อเทสต์ของ CI แล้ว
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  contrastWithWhite, luminance, tileColor, colorFromName,
  DEV_ADVISOR_COLOR, DEV_MANAGER_COLOR, DEV_ALL_COLOR, DEV_TILE_PALETTE, DEV_NAV_BG, DEV_ACTIVE_CAPSULE,
} from '../src/lib/navTileColor.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const journal = read('src/pages/DevJournal.jsx')
const advisor = read('src/pages/DevAdvisor.jsx')
const button = read('src/components/dev/DevNavButton.jsx')
const drawer = read('src/components/common/PortalDrawer.jsx')
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
// ขาว 80% ทับพื้น → สีที่ตาเห็นจริง (ตัวหนังสือเมนูที่ไม่ active ใช้ text-white/80)
const white80On = (bg) => {
  const n = parseInt(bg.slice(1), 16)
  const mix = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(255 * 0.8 + v * 0.2))
  return '#' + mix.map(v => v.toString(16).padStart(2, '0')).join('')
}

let cases = 0
const test = (label, run) => { run(); cases++; console.log('PASS ' + label) }

test('ตัวขาวบนแคปซูล active (ทั้งต้นและปลายไล่เฉด) ≥ 4.5:1', () => {
  assert.equal(DEV_ACTIVE_CAPSULE.backgroundColor, '#0c3a5e')
  for (const bg of ['#0c3a5e', '#2e1065']) assert.ok(contrastWithWhite(bg) >= 4.5, `${bg} = ${contrastWithWhite(bg).toFixed(2)}`)
  assert.match(DEV_ACTIVE_CAPSULE.backgroundImage, /#0c3a5e/)
  assert.match(DEV_ACTIVE_CAPSULE.backgroundImage, /#2e1065/)
})

test('ตัวขาวบนพื้นเมนู (ทั้งสองปลาย) ≥ 4.5:1 และตัวขาว 80% (ไม่ active) บนปลายสว่าง ≥ 4.5:1', () => {
  assert.match(DEV_NAV_BG.backgroundImage, /#1b2a4a/)
  assert.match(DEV_NAV_BG.backgroundImage, /#0b1220/)
  for (const bg of ['#1b2a4a', '#0b1220']) assert.ok(contrastWithWhite(bg) >= 4.5, `${bg}`)
  const c = ratio(white80On('#1b2a4a'), '#1b2a4a')
  assert.ok(c >= 4.5, `ขาว 80% บน #1b2a4a = ${c.toFixed(2)}`)
})

test('ชิปตัวเลข text-sky-200 บนพื้นขาวจาง (≈ #2a3856 บนปลายสว่าง) ≥ 4.5:1', () => {
  assert.ok(ratio('#bae6fd', '#2a3856') >= 4.5)
})

test('colorFromName: ชื่อเดิมได้สีเดิมทุกครั้ง', () => {
  for (const n of ['โครงสร้าง', 'ข้อมูลระบบ', 'x', 'ส่วนที่ตั้งชื่อยาวมากมายก่อนจะตกบรรทัดในเมนูซ้าย']) {
    assert.equal(colorFromName(n), colorFromName(n))
    assert.ok(DEV_TILE_PALETTE.includes(colorFromName(n)))
  }
})

test('colorFromName: ชื่อจริง 2 ส่วน + ชื่อสมมติ 8 ชื่อ กระจายอย่างน้อย 4 สี', () => {
  const names = ['โครงสร้าง', 'ข้อมูลระบบ', 'การเงิน', 'พัสดุ', 'คำร้อง', 'ยานพาหนะ', 'แผนที่', 'ท่องเที่ยว', 'น้ำ-ฝน', 'ลงนามเอกสาร']
  const colors = new Set(names.map(n => colorFromName(n)))
  assert.ok(colors.size >= 4, `ได้แค่ ${colors.size} สี`)
})

test('colorFromName ไม่คืนสีที่ล็อกไว้ (ที่ปรึกษา AI/จัดการโมดูล/ทั้งหมด) และ palette ไม่มีสีซ้ำกับ 3 สีนั้น', () => {
  const locked = [DEV_ADVISOR_COLOR, DEV_MANAGER_COLOR, DEV_ALL_COLOR].map(c => c.toLowerCase())
  assert.equal(new Set(locked).size, 3)
  for (const c of DEV_TILE_PALETTE) assert.ok(!locked.includes(c.toLowerCase()), `palette มี ${c}`)
  assert.equal(new Set(DEV_TILE_PALETTE).size, DEV_TILE_PALETTE.length, 'palette ต้องไม่มีสีซ้ำกันเอง')
  for (let i = 0; i < 500; i++) assert.ok(!locked.includes(colorFromName('ส่วน' + i).toLowerCase()))
})

test('colorFromName: ว่าง/null/ไม่ใช่สตริง ไม่ throw และคืนสีแรกของ palette', () => {
  for (const v of ['', null, undefined, 42, {}]) assert.equal(colorFromName(v), DEV_TILE_PALETTE[0])
})

test('ทุกสีใน palette + 3 สีล็อก → tileColor() แล้วไอคอนขาว ≥ 3:1', () => {
  for (const c of [...DEV_TILE_PALETTE, DEV_ADVISOR_COLOR, DEV_MANAGER_COLOR, DEV_ALL_COLOR, '#475569']) {
    assert.ok(contrastWithWhite(tileColor(c)) >= 3, `${c} → ${tileColor(c)}`)
  }
})

test('DevJournal/DevAdvisor: เลิกใช้พื้น #1a3a5c · ใช้ DevNavButton + DEV_NAV_BG + tone="dev"', () => {
  for (const [name, src] of [['DevJournal', journal], ['DevAdvisor', advisor]]) {
    assert.doesNotMatch(src, /#1a3a5c/i, `${name} ยังมี #1a3a5c`)
    assert.match(src, /import DevNavButton from '..\/components\/dev\/DevNavButton'/, name)
    assert.match(src, /\.\.\.DEV_NAV_BG/, name)
    assert.match(src, /tone="dev"/, name)
    assert.match(src, /<DevNavButton /, name)
  }
  assert.match(journal, /colorFromName\(label\)/)
  assert.match(journal, /key === 'all' \? DEV_ALL_COLOR/)
})

test('DevNavButton: ตัวเลข font-mono · ห้ามตัดชื่อเป็น … (ไม่มี truncate) · ปุ่ม 44px · active มี aria-current', () => {
  assert.match(button, /font-mono/)
  assert.doesNotMatch(button, /truncate/)
  assert.match(button, /min-h-11/)
  assert.match(button, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(button, /<NavIconTile /)
  assert.match(button, /DEV_ACTIVE_CAPSULE/)
})

test('PortalDrawer: TONES มี dev: · กระเบื้องสีเปิดเมื่อ tone dev', () => {
  assert.match(drawer, /\bdev:\s*\{\s*panel:\s*DEV_NAV_BG,\s*active:\s*DEV_ACTIVE_CAPSULE\s*\}/)
  assert.match(drawer, /tone === 'dev'/)
  assert.match(drawer, /admin:\s*\{\s*panel:\s*ADMIN_NAV_BG/, 'tone admin ต้องไม่ถูกแตะ')
})

console.log(`\nผ่านทั้งหมด ${cases} เคส`)
