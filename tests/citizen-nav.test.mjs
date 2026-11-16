// เมนูซ้ายประชาชน (CitizenSidebar) แบบพรีเมียม — PR3 เจ้าของระบบอนุมัติ 2569-11-16
// ตรวจจากซอร์ส (ไม่วัดภาพ) + คำนวณ contrast จริง · node ล้วน ไม่ต่อเน็ต/ฐานข้อมูล
// รัน: node tests/citizen-nav.test.mjs (npm run test:citizen-nav)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { composite, contrastRatio, contrastWithWhite, luminance, tileTint } from '../src/lib/navTileColor.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'src/components/layout/CitizenSidebar.jsx'), 'utf8')
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

let cases = 0
const test = (label, run) => { run(); cases++; console.log('PASS ' + label) }

// เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — กระเบื้องพื้นโปร่ง 18% + ไอคอนสีอ่อน (tileTint) · วัดบนพื้นแผงส่วนที่สว่างสุด #1e4f8f
test('ทุกเมนูมีสีประจำ และไอคอนสีอ่อน (tileTint) บนพื้นโปร่ง 18% บนพื้นแผงสว่างสุด ≥ 3:1', () => {
  const items = src.split(/\r?\n/).filter(l => /label:/.test(l) && /href:/.test(l) && /Icon:/.test(l))
  assert.ok(items.length >= 20, `ควรเจอเมนูอย่างน้อย 20 รายการ เจอ ${items.length}`)
  for (const l of items) {
    const m = /color: '(#[0-9a-fA-F]{6})'/.exec(l)
    assert.ok(m, `เมนูนี้ไม่มีสี: ${l.trim()}`)
    const v = contrastRatio(tileTint(m[1]), composite(m[1], 0.18, '#1e4f8f'))
    assert.ok(v >= 3, `${m[1]} → ${tileTint(m[1])} = ${v.toFixed(2)}`)
  }
})

test('อ่านง่าย: ตัวเมนู 15px · หัวกลุ่ม 12px ผ่าน AA · ไม่ตัดชื่อเมนูเป็น "…"', () => {
  assert.match(src, /text-\[15px\]/)
  assert.doesNotMatch(src, /text-\[9px\]/, 'หัวกลุ่ม 9px เดิมต้องหายไป')
  const label = /const LABEL\s*=\s*'(#[0-9a-fA-F]{6})'/.exec(src)?.[1]
  assert.ok(label, 'LABEL ต้องเป็นสีทึบ (ไม่ใช่ rgba จาง)')
  // ตรวจกับปลายเข้มและปลายสว่างของพื้นไล่สี
  for (const bg of ['#1e4f8f', '#163d70']) assert.ok(ratio(label, bg) >= 4.5, `หัวกลุ่ม ${label} บน ${bg} = ${ratio(label, bg).toFixed(2)}`)
  for (const bg of ['#1e4f8f', '#163d70']) assert.ok(contrastWithWhite(bg) >= 4.5, `ตัวขาวบน ${bg}`)
  // เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — แถว active เดิมพื้นขาวตัวน้ำเงิน #123a6b → พื้นขาวโปร่ง 14% ตัวขาว (ทั้งปลายสว่างและปลายเข้มของพื้นแผง)
  for (const bg of ['#1e4f8f', '#163d70']) {
    const c = contrastRatio('#ffffff', composite('#ffffff', 0.14, bg))
    assert.ok(c >= 4.5, `เมนูที่เปิดอยู่: ตัวขาวบนพื้นขาวโปร่ง 14% บน ${bg} = ${c.toFixed(2)}`)
  }
  assert.match(src, /bg-white\/\[0\.14\] font-semibold text-white ring-1 ring-inset ring-white\/25/, 'แถว active ต้องเป็นพื้นโปร่ง ไม่ใช่พื้นขาว')
  assert.doesNotMatch(src, /bg-white font-semibold|text-\[#123a6b\]/, 'พื้นขาวตัวน้ำเงินเดิมต้องหายไป')
  assert.ok(ratio('#2a1800', '#fbbf24') >= 4.5 && ratio('#2a1800', '#fde68a') >= 4.5, 'ปุ่มเข้าสู่ระบบ')
  assert.doesNotMatch(src, /'truncate'/, 'ชื่อเมนูต้องขึ้นบรรทัดใหม่ ไม่ตัดเป็น …')
})

test('แถว PC 40px · หน้าบัญชี 44px · w-56 คงเดิม · กล่องผู้ใช้/ปุ่มเข้าสู่ระบบปักล่าง (เมนูเลื่อนในกรอบ)', () => {
  assert.match(src, /accountPage \? 'min-h-11' : 'min-h-10'/)
  assert.match(src, /w-56/)
  assert.match(src, /<nav className="min-h-0 flex-1[^"]*overflow-y-auto/)
  assert.match(src, /data-citizen-user className="shrink-0/)
  assert.match(src, /flex-col w-56 shrink-0 overflow-hidden/, 'aside ต้องไม่เลื่อนทั้งก้อน (ไม่งั้นปุ่มเข้าสู่ระบบหลุดจอ)')
  assert.match(src, /'hidden lg:flex self-stretch'/, 'หน้าประชาชนต้องสูงเท่าแถวใต้หัวเว็บ ไม่ใช่ max-h-screen')
  assert.doesNotMatch(src, /'hidden lg:flex[^']*max-h-screen/, 'คลาสของ aside ต้องไม่กลับไปใช้ max-h-screen')
  assert.match(src, /<NavIconTile /)
  assert.match(src, /<NavBadge count=\{unreadCount\} \/>/)
})

console.log(`\nผ่านทั้งหมด ${cases} เคส`)
