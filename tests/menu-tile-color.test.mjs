// Pure-logic test สำหรับ src/lib/menuTileColor.js — ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์
//
// ไอคอนในเมนูแบบไอคอน (MenuTileGrid.jsx) เป็นสีขาวบนพื้นสีประจำเมนู ต้องตัดกับพื้นอย่างน้อย 3:1
// (WCAG 2.1 ข้อ 1.4.11) — เทสต์นี้ดึงสีประจำเมนูที่ "เขียนอยู่ในโค้ดจริง" ของทั้งสองหน้า
// (StaffDashboard.jsx เมนูเจ้าหน้าที่ + MorePage.jsx เมนูประชาชน) มาตรวจทุกสี
// ถ้าวันหนึ่งมีคนเพิ่มเมนูใหม่ด้วยสีอ่อน แล้วลืมว่าไอคอนขาวจะจม เทสต์นี้จับได้ก่อนขึ้นจอ
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MIN_ICON_CONTRAST, contrastWithWhite, luminance, parseHex, tileIconStyle, tileShades,
} from '../src/lib/menuTileColor.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

test('parseHex อ่านได้ทั้ง #rgb และ #rrggbb และปฏิเสธค่าที่ไม่ใช่สี', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255])
  assert.deepEqual(parseHex('#1A3a5c'), [26, 58, 92])
  assert.equal(parseHex('red'), null)
  assert.equal(parseHex('#12345'), null)
  assert.equal(parseHex(undefined), null)
})

test('ความสว่างสัมพัทธ์ตรงตามค่าอ้างอิง WCAG (ขาว = 1, ดำ = 0)', () => {
  assert.equal(luminance([255, 255, 255]), 1)
  assert.equal(luminance([0, 0, 0]), 0)
  // ขาวกับดำตัดกัน 21:1 ตามนิยาม
  assert.ok(Math.abs(contrastWithWhite([0, 0, 0]) - 21) < 1e-9)
})

test('สีที่เข้มพออยู่แล้วคงเดิม ไม่ถูกย้อมให้หม่นลง', () => {
  assert.equal(tileShades('#1a3a5c').base, '#1a3a5c')
  assert.equal(tileShades('#4f46e5').base, '#4f46e5')
})

test('สีอ่อนถูกทำให้เข้มขึ้นจนไอคอนขาวตัดกันถึงเกณฑ์', () => {
  for (const light of ['#f59e0b', '#fbbf24', '#10b981', '#38bdf8', '#a3e635']) {
    assert.ok(contrastWithWhite(parseHex(light)) < MIN_ICON_CONTRAST, `${light} ต้องเป็นสีที่อ่อนเกินจริงๆ ถึงจะใช้เป็นตัวอย่างได้`)
    const { base, rgb } = tileShades(light)
    assert.notEqual(base, light, `${light} ควรถูกทำให้เข้มขึ้น`)
    assert.ok(contrastWithWhite(rgb) >= MIN_ICON_CONTRAST, `${light} → ${base} ยังตัดกับขาวไม่ถึง ${MIN_ICON_CONTRAST}:1`)
  }
})

test('ค่าที่ใช้สีไม่ได้ตกไปใช้สีสำรอง ไม่พังหรือคืนค่าว่าง', () => {
  const fallback = tileShades('#475569').base
  assert.equal(tileShades(undefined).base, fallback)
  assert.equal(tileShades('not-a-color').base, fallback)
})

test('style ของกล่องไอคอนมีไล่เฉดและเงา', () => {
  const style = tileIconStyle('#ef4444')
  assert.match(style.background, /^linear-gradient\(150deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/)
  assert.match(style.boxShadow, /^0 6px 14px -5px rgba\(\d+, \d+, \d+, 0\.55\)/)
})

// ── สีจริงในโค้ด ────────────────────────────────────────────────────────────
// ดึงเฉพาะ `color: '#xxxxxx'` (สีประจำเมนู) ไม่แตะ bg/สีพื้นหลังการ์ดอื่น
const SOURCES = ['src/pages/StaffDashboard.jsx', 'src/pages/MorePage.jsx', 'src/components/common/MenuTileGrid.jsx']
const palette = new Map()
for (const file of SOURCES) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  for (const match of text.matchAll(/\bcolor:\s*'(#[0-9a-fA-F]{6})'/g)) {
    if (!palette.has(match[1].toLowerCase())) palette.set(match[1].toLowerCase(), file)
  }
}
// ป้ายออกจากระบบสีแดงถูกกำหนดใน MenuTileGrid.jsx เป็น '#dc2626' (ไม่ได้อยู่ในรูป color: '...')
palette.set('#dc2626', 'src/components/common/MenuTileGrid.jsx')

test(`สีประจำเมนูทุกสีในโค้ดจริง (${palette.size} สี) ให้ไอคอนขาวตัดกันถึงเกณฑ์ทั้งปลายสว่างและปลายเข้ม`, () => {
  assert.ok(palette.size >= 15, `พบสีประจำเมนูแค่ ${palette.size} สี — regex อาจไม่ตรงกับโค้ดแล้ว`)
  for (const [hex, file] of palette) {
    const { rgb, bottom } = tileShades(hex)
    const light = contrastWithWhite(rgb)
    const dark = contrastWithWhite(parseHex(bottom))
    assert.ok(light >= MIN_ICON_CONTRAST, `${hex} (${file}) ปลายสว่าง ${light.toFixed(2)}:1 ต่ำกว่า ${MIN_ICON_CONTRAST}:1`)
    assert.ok(dark >= light, `${hex} ปลายเข้มต้องไม่อ่อนกว่าปลายสว่าง`)
  }
})

console.log(`\nสำเร็จ ${cases} กลุ่มเทสต์`)
