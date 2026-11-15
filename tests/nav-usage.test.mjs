// เมนูซ้ายเจ้าหน้าที่: "ใช้บ่อย" (นับการกดต่อผู้ใช้ใน localStorage) + ค้นหาเมนู + จำสถานะพับกลุ่ม
// ตรรกะล้วน ไม่ต่อเน็ต/ฐานข้อมูล · รันด้วย node tests/nav-usage.test.mjs (npm run test:nav-usage)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NAV_COLLAPSED_KEY, navUsageStorageKey, readCollapsedGroups, recordNavUse, searchNavItems, setGroupCollapsed, topNavKeys,
} from '../src/lib/navUsage.js'

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

const memoryStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, size: () => m.size }
}
// storage ที่โยน error ทุกการเรียก (private mode / ถูกบล็อก / โควตาเต็ม)
const brokenStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
const press = (storage, userId, key, times, t0 = 1000) => { for (let i = 0; i < times; i++) recordNavUse(userId, key, { storage, now: t0 + i }) }
const ALL = ['complaints', 'inbox', 'fleet', 'events', 'home', 'executive-room']

await test('นับการกด: key ต่อผู้ใช้ + เก็บ n/t', () => {
  const s = memoryStorage()
  recordNavUse('u1', 'fleet', { storage: s, now: 111 })
  recordNavUse('u1', 'fleet', { storage: s, now: 222 })
  assert.deepEqual(JSON.parse(s.getItem(navUsageStorageKey('u1'))), { fleet: { n: 2, t: 222 } })
  assert.equal(navUsageStorageKey('u1'), 'smartlocal:nav-usage:u1')
})

await test('จัดอันดับ: n มากก่อน · เท่ากันใช้กดล่าสุดก่อน · ตัดที่ limit', () => {
  const s = memoryStorage()
  press(s, 'u1', 'complaints', 5, 1000)
  press(s, 'u1', 'inbox', 3, 2000)
  press(s, 'u1', 'fleet', 3, 3000) // เท่า inbox แต่ล่าสุดกว่า
  press(s, 'u1', 'events', 4, 500)
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s }), ['complaints', 'events', 'fleet', 'inbox'])
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s, limit: 2 }), ['complaints', 'events'])
})

await test('minUses: กดไม่ถึงเกณฑ์ = ไม่ขึ้น · ไม่มีข้อมูลพอ = [] (ไม่แสดงหมวด)', () => {
  const s = memoryStorage()
  press(s, 'u1', 'fleet', 2)
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s }), [])
  press(s, 'u1', 'fleet', 1)
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s }), ['fleet'])
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s, minUses: 5 }), [])
  assert.deepEqual(topNavKeys('nobody', ALL, { storage: s }), [])
})

await test('ตัดคีย์ที่ไม่อยู่ใน availableKeys (สิทธิ์เปลี่ยน/โมดูลปิด)', () => {
  const s = memoryStorage()
  press(s, 'u1', 'fleet', 9)
  press(s, 'u1', 'inbox', 4)
  assert.deepEqual(topNavKeys('u1', ['inbox', 'events'], { storage: s }), ['inbox'])
})

await test('แยกผู้ใช้: เครื่องเดียวหลายคนไม่ปนกัน', () => {
  const s = memoryStorage()
  press(s, 'u1', 'fleet', 4)
  press(s, 'u2', 'inbox', 4)
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s }), ['fleet'])
  assert.deepEqual(topNavKeys('u2', ALL, { storage: s }), ['inbox'])
})

await test('ไม่บันทึก home / executive-room / ไม่มี userId / ไม่มีคีย์', () => {
  const s = memoryStorage()
  assert.equal(recordNavUse('u1', 'home', { storage: s }), false)
  assert.equal(recordNavUse('u1', 'executive-room', { storage: s }), false)
  assert.equal(recordNavUse(null, 'fleet', { storage: s }), false)
  assert.equal(recordNavUse('u1', '', { storage: s }), false)
  assert.equal(s.size(), 0)
  // แม้ข้อมูลเก่าในเครื่องมี home ค้างอยู่ ก็ไม่ขึ้นหมวดใช้บ่อย
  s.setItem(navUsageStorageKey('u1'), JSON.stringify({ home: { n: 99, t: 1 }, fleet: { n: 3, t: 1 } }))
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s }), ['fleet'])
})

await test('storage โยน error / ข้อมูลเสีย = ไม่พัง แค่ไม่มีหมวด', () => {
  assert.equal(recordNavUse('u1', 'fleet', { storage: brokenStorage }), false)
  assert.deepEqual(topNavKeys('u1', ALL, { storage: brokenStorage }), [])
  assert.deepEqual(topNavKeys('u1', ALL, { storage: null }), [])
  assert.equal(recordNavUse('u1', 'fleet', { storage: null }), false)
  const s = memoryStorage()
  s.setItem(navUsageStorageKey('u1'), '{ไม่ใช่ json')
  assert.deepEqual(topNavKeys('u1', ALL, { storage: s }), [])
  assert.equal(recordNavUse('u1', 'fleet', { storage: s, now: 1 }), true) // เขียนทับของเสียได้
  s.setItem(navUsageStorageKey('u2'), '[1,2]')
  assert.deepEqual(topNavKeys('u2', ALL, { storage: s }), [])
})

// ── ค้นหาเมนู ─────────────────────────────────────────────────────────────────────────
const GROUPS = [
  { group: 'งานบริการประชาชน', items: [
    { key: 'complaints', label: 'คำร้อง', desc: 'รับเรื่อง ตรวจสอบ มอบหมาย และติดตามผล' },
    { key: 'inbox', label: 'คำขอบริการ/เอกสาร', desc: 'รับคำขอเอกสารจากประชาชน' },
  ] },
  { group: 'ประชาสัมพันธ์และท่องเที่ยว', items: [
    { key: 'tourism', label: 'เที่ยว กิน พัก ช้อป บริการ', desc: 'ที่เที่ยว ร้านอาหาร' },
    { key: 'posts', label: 'ข่าวสาร/ภาพกิจกรรม' }, // ไม่มี desc
  ] },
  { group: 'กองช่าง', items: [{ key: 'infra', label: 'บันทึกงานซ่อม', desc: 'ช่างปักหมุดหน้างาน' }] },
]
const keys = (q) => searchNavItems(GROUPS, q).map(r => r.item.key)

await test('ค้นหา: ภาษาไทยตาม label (รวมชื่อเมนูที่มีช่องว่าง)', () => {
  assert.deepEqual(keys('คำร้อง'), ['complaints'])
  assert.deepEqual(keys('กิน พัก'), ['tourism'])
  assert.deepEqual(keys('ซ่อม'), ['infra'])
})

await test('ค้นหา: ตามชื่อกลุ่ม (ได้ทุกเมนูในกลุ่ม) และตาม desc', () => {
  assert.deepEqual(keys('กองช่าง'), ['infra'])
  assert.deepEqual(keys('ประชาสัมพันธ์'), ['tourism', 'posts'])
  assert.deepEqual(keys('ปักหมุด'), ['infra'])
  assert.equal(searchNavItems(GROUPS, 'กองช่าง')[0].group, 'กองช่าง')
})

await test('ค้นหา: ตัดช่องว่างหัวท้าย · ไม่สนตัวพิมพ์ · หลายคำต้องเจอครบ · คำค้นว่าง = ไม่มีผล', () => {
  assert.deepEqual(keys('   คำร้อง  '), ['complaints'])
  const g = [{ group: 'Admin Tools', items: [{ key: 'x', label: 'Report Builder' }] }]
  assert.equal(searchNavItems(g, 'report').length, 1)
  assert.equal(searchNavItems(g, 'ADMIN builder').length, 1)
  assert.equal(searchNavItems(g, 'admin xyz').length, 0)
  assert.deepEqual(keys(''), [])
  assert.deepEqual(keys('   '), [])
  assert.deepEqual(keys('ไม่มีเมนูนี้แน่นอน'), [])
  assert.deepEqual(keys(undefined), [])
})

await test('ค้นหา: ค้นเฉพาะรายการที่ส่งเข้ามา (ไม่สร้างเมนูเอง) · คีย์ซ้ำนับครั้งเดียว · groups ผิดรูปไม่พัง', () => {
  assert.deepEqual(searchNavItems([{ group: 'กองช่าง', items: [] }], 'คำร้อง'), [])
  const dup = [{ group: 'ก', items: [{ key: 'a', label: 'เมนู' }] }, { group: 'ข', items: [{ key: 'a', label: 'เมนู' }] }]
  assert.equal(searchNavItems(dup, 'เมนู').length, 1)
  assert.deepEqual(searchNavItems(null, 'x'), [])
  assert.deepEqual(searchNavItems([{ group: 'ก' }], 'ก'), [])
})

// ── จำสถานะพับกลุ่ม ───────────────────────────────────────────────────────────────────
await test('สถานะพับกลุ่ม: เขียน/อ่าน/กางคืน และไม่พังเมื่อ storage ใช้ไม่ได้', () => {
  const s = memoryStorage()
  assert.equal(readCollapsedGroups(s).size, 0)
  setGroupCollapsed('กองช่าง', true, s)
  setGroupCollapsed('คู่มือ', true, s)
  assert.deepEqual([...readCollapsedGroups(s)].sort(), ['กองช่าง', 'คู่มือ'].sort())
  setGroupCollapsed('กองช่าง', false, s)
  assert.deepEqual([...readCollapsedGroups(s)], ['คู่มือ'])
  assert.ok(s.getItem(NAV_COLLAPSED_KEY))
  assert.equal(readCollapsedGroups(brokenStorage).size, 0)
  setGroupCollapsed('คู่มือ', true, brokenStorage) // ต้องไม่โยน
  s.setItem(NAV_COLLAPSED_KEY, '{"ไม่ใช่อาร์เรย์":1}')
  assert.equal(readCollapsedGroups(s).size, 0)
})

// ── โครงของคอมโพเนนต์ (ตรึงข้อกำหนดที่เจ้าของระบบสั่ง ไม่ใช่การวัดภาพ — วัดจริงต้องใช้ Playwright) ─────────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => fs.readFileSync(path.join(root, 'src', p), 'utf8')

await test('โครงคอมโพเนนต์: ใช้ NavQuickFind ร่วม · ลิ้นชัก opt-in · w-60/#1a3a5c คงเดิม', () => {
  const side = src('components/staff/StaffSideNav.jsx')
  const drawer = src('components/common/PortalDrawer.jsx')
  assert.match(side, /<NavQuickFind /)
  assert.match(drawer, /quickFind = false/)
  assert.match(src('pages/StaffDashboard.jsx'), /onSelect=\{openFromDrawer\} quickFind \/>/)
  assert.match(side, /w-60/)
  assert.match(side, /#1a3a5c/)
  assert.doesNotMatch(side, /searchNavItems|topNavKeys/, 'ตรรกะค้นหา/ใช้บ่อยต้องอยู่ที่ NavQuickFind/lib ที่เดียว')
  assert.doesNotMatch(drawer, /searchNavItems|topNavKeys/)
  const group = src('components/common/CollapsibleNavGroup.jsx')
  for (const attr of ['aria-expanded', 'aria-controls', 'data-nav-group', 'data-department-nav', 'data-nav-item']) assert.ok(group.includes(attr), attr)
})

await test('ทุกกลุ่มใน staffNavGroups มี Icon ระดับกลุ่ม (อ่านจากซอร์ส — ไฟล์ import ไม่มีนามสกุล node เปล่ารันไม่ได้)', () => {
  const lines = src('lib/staffNavGroups.js').split(/\r?\n/).filter(l => /^\s*(\{\s*)?group: '/.test(l))
  assert.ok(lines.length >= 9, 'ควรเจออย่างน้อย 9 กลุ่ม')
  for (const l of lines) assert.match(l, /Icon: [A-Z]\w+,/, `กลุ่มนี้ไม่มี Icon: ${l.trim()}`)
})

console.log(`\nผ่านทั้งหมด ${cases} เคส`)
