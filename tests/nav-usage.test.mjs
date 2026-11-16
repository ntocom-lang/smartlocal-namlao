// เมนูซ้ายเจ้าหน้าที่: "ใช้บ่อย" (นับการกดต่อผู้ใช้ใน localStorage) + ค้นหาเมนู + จำสถานะพับกลุ่ม
// ตรรกะล้วน ไม่ต่อเน็ต/ฐานข้อมูล · รันด้วย node tests/nav-usage.test.mjs (npm run test:nav-usage)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NAV_COLLAPSED_EVENT, NAV_COLLAPSED_KEY, navUsageStorageKey, readCollapsedGroups, recordNavUse, searchNavItems, setGroupCollapsed, setGroupsCollapsed, topNavKeys,
} from '../src/lib/navUsage.js'
import {
  ADMIN_ACTIVE_CAPSULE, BADGE_BASE, BADGE_TONES, DEV_ACTIVE_CAPSULE, NAV_ACTIVE_CAPSULE, composite, contrastRatio, contrastWithWhite, hexToRgba, isHotBadge,
  softTileStyle, tileColor, tileGradient, tileTint,
} from '../src/lib/navTileColor.js'

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

await test('ปิด/เปิดทั้งหมด: หลายกลุ่มพร้อมกัน · ไม่แตะกลุ่มนอก labels · กรองเฉพาะ string · storage พังไม่โยน', () => {
  const s = memoryStorage()
  setGroupCollapsed('คู่มือ', true, s) // กลุ่มนอก labels ต้องคงเดิมทั้งตอนปิดและตอนเปิด
  setGroupsCollapsed(['กองช่าง', 'กองคลัง', 'สำนักปลัด', 42, null, { x: 1 }], true, s)
  assert.deepEqual([...readCollapsedGroups(s)].sort(), ['กองคลัง', 'กองช่าง', 'คู่มือ', 'สำนักปลัด'].sort())
  setGroupsCollapsed(['กองช่าง', 'กองคลัง', 'สำนักปลัด'], false, s)
  assert.deepEqual([...readCollapsedGroups(s)], ['คู่มือ'])
  setGroupsCollapsed(undefined, true, s) // labels ผิดรูป = ไม่เปลี่ยนอะไร ไม่โยน
  assert.deepEqual([...readCollapsedGroups(s)], ['คู่มือ'])
  setGroupsCollapsed(['ก'], true, brokenStorage) // ต้องไม่โยน
})

await test('ปิด/เปิดทั้งหมด: ยิงอีเวนต์ครั้งเดียวต่อการกด (ไม่ใช่ต่อกลุ่ม)', () => {
  const prev = globalThis.window
  let fired = 0
  globalThis.window = { dispatchEvent: (e) => { if (e.type === NAV_COLLAPSED_EVENT) fired++; return true } }
  try {
    const s = memoryStorage()
    setGroupsCollapsed(['ก', 'ข', 'ค'], true, s)
    assert.equal(fired, 1)
    setGroupsCollapsed(['ก', 'ข', 'ค'], false, s)
    assert.equal(fired, 2)
  } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
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

await test('ปุ่มปิด/เปิดทั้งหมด: StaffSideNav/PortalDrawer ส่ง collapseLabels · ปุ่มใช้คำ "ปิดทั้งหมด"/"เปิดทั้งหมด" ไม่ใช้ พับ/กาง · แอดมินไม่ส่ง = ไม่มีปุ่ม', () => {
  const side = src('components/staff/StaffSideNav.jsx')
  const drawer = src('components/common/PortalDrawer.jsx')
  const admin = src('components/admin/AdminSideNav.jsx')
  const quick = src('components/common/NavQuickFind.jsx')
  assert.match(side, /collapseLabels=\{groups\.map\(g => g\.group\)\}/)
  assert.match(drawer, /collapseLabels=\{groups\.filter\(g => g\.collapsible\)\.map\(g => g\.group\)\}/)
  assert.doesNotMatch(admin, /collapseLabels/)
  assert.match(quick, /collapseLabels = \[\]/)
  assert.match(quick, /'เปิดทั้งหมด' : 'ปิดทั้งหมด'/)
  assert.match(quick, /labels\.length > 0 && \(/)
  assert.match(quick, /setGroupsCollapsed\(labels, !allClosed\)/)
  const btn = quick.slice(quick.indexOf('data-nav-toggle-all'), quick.indexOf('</button>', quick.indexOf('data-nav-toggle-all')))
  assert.doesNotMatch(btn, /backdrop-blur/, 'ห้ามใส่ backdrop-blur บนปุ่ม')
  assert.doesNotMatch(btn, /พับ|กาง/, 'ปุ่มใช้คำ ปิด/เปิด ไม่ใช้ พับ/กาง')
})

await test('ทุกกลุ่มใน staffNavGroups มี Icon ระดับกลุ่ม (อ่านจากซอร์ส — ไฟล์ import ไม่มีนามสกุล node เปล่ารันไม่ได้)', () => {
  const lines = src('lib/staffNavGroups.js').split(/\r?\n/).filter(l => /^\s*(\{\s*)?group: '/.test(l))
  assert.ok(lines.length >= 9, 'ควรเจออย่างน้อย 9 กลุ่ม')
  for (const l of lines) assert.match(l, /Icon: [A-Z]\w+,/, `กลุ่มนี้ไม่มี Icon: ${l.trim()}`)
})

// ── แบบพรีเมียม (2569-11-16): กระเบื้องสีตามเมนูต้องให้ไอคอนขาวอ่านออก ≥ 3:1 ทุกสี ─────────
await test('tileColor: ทุกสีเมนู/กลุ่มใน staffNavGroups เข้มจนไอคอนขาว ≥ 3:1 · สีที่ผ่านอยู่แล้วไม่ถูกเปลี่ยน', () => {
  const colors = [...src('lib/staffNavGroups.js').matchAll(/(?:color|accent): '(#[0-9a-fA-F]{6})'/g)].map(m => m[1])
  assert.ok(colors.length >= 20, 'ควรเจอสีเมนู/กลุ่มอย่างน้อย 20 สี')
  for (const c of [...colors, '#f59e0b', '#fde68a', '#ffffff', '#10b981']) {
    assert.ok(contrastWithWhite(tileColor(c)) >= 3, `${c} → ${tileColor(c)} ยังไม่ถึง 3:1`)
  }
  assert.equal(tileColor('#1d4ed8'), '#1d4ed8', 'สีที่ผ่านแล้วต้องคงเดิม')
  assert.equal(tileColor('ไม่ใช่สี'), '#475569')
  assert.equal(tileColor(undefined), '#475569')
  assert.match(tileGradient('#f59e0b'), /^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/)
})

await test('ป้ายตัวเลข: แดงตั้งแต่ 10 เรื่อง (เจ้าของระบบเลือก) · ทุกกลุ่มมี accent · กระเบื้องผ่าน tileGradient', () => {
  assert.equal(isHotBadge(9), false)
  assert.equal(isHotBadge(10), true)
  assert.equal(isHotBadge('12'), true)
  const lines = src('lib/staffNavGroups.js').split(/\r?\n/).filter(l => /^\s*(\{\s*)?group: '/.test(l))
  for (const l of lines) assert.match(l, /accent: '#[0-9a-fA-F]{6}'/, `กลุ่มนี้ไม่มี accent: ${l.trim()}`)
  // เจ้าของระบบสั่ง 2569-11-16: โทนนุ่มสบายตา — กระเบื้องเลิกพื้นทึบ+ไอคอนขาว ใช้พื้นโปร่ง (softTileStyle) แทน tileGradient
  const tileSrc = src('components/common/CollapsibleNavGroup.jsx')
  assert.match(tileSrc, /\.\.\.softTileStyle\(color\)/, 'ห้ามใส่สีพื้นกระเบื้องตรงๆ')
  assert.doesNotMatch(tileSrc, /tileGradient|tileColor\(|TILE_SHADOW/, 'กระเบื้องต้องไม่กลับไปใช้พื้นทึบ/เงา')
  const tileFn = tileSrc.slice(tileSrc.indexOf('export function NavIconTile'), tileSrc.indexOf('export function NavGroupIcon'))
  assert.doesNotMatch(tileFn, /text-white/, 'ไอคอนกระเบื้องต้องเป็นสีอ่อนของสีเมนู ไม่ใช่ขาว')
  assert.match(tileFn, /0 0 0 1\.5px rgba\(255,255,255,0\.22\)/, 'active = วงบาง 0.22 (ลดแสงเมนูหลัก 2569-11-16)')
  assert.match(src('components/staff/StaffSideNav.jsx'), /<NavBadge count=/)
  assert.match(src('components/common/PortalDrawer.jsx'), /<NavBadge count=\{count\} data-drawer-badge/)
})

// ── PR2 เมนูแอดมิน (2569-11-16): โทนแยกจากเจ้าหน้าที่ + ป้ายโหมดตั้งค่า + ไม่มี "ใช้บ่อย" ─────────
await test('เมนูแอดมิน: แยกไฟล์ AdminSideNav · w-64 คงเดิม · ป้ายโหมดตั้งค่า · ค้นหาไม่มีใช้บ่อย · ลิ้นชักโทนเดียวกัน', () => {
  const side = src('components/admin/AdminSideNav.jsx')
  const page = src('pages/AdminDashboard.jsx')
  const drawer = src('components/common/PortalDrawer.jsx')
  assert.match(side, /w-64/)
  assert.match(side, /โหมดตั้งค่าระบบ/)
  assert.match(side, /<NavQuickFind [^>]*favorites=\{false\}/)
  assert.match(side, /<NavIconTile /)
  assert.match(side, /ADMIN_ACTIVE_CAPSULE/)
  assert.match(page, /<AdminSideNav /)
  assert.doesNotMatch(page, /<aside className="hidden md:flex flex-col w-64/, 'เมนูซ้ายเดิมต้องย้ายออกจาก AdminDashboard แล้ว')
  assert.match(page, /quickFind favorites=\{false\} tone="admin" notice=\{<AdminZoneNotice/)
  assert.match(drawer, /admin: \{ panel: ADMIN_NAV_BG, active: ADMIN_ACTIVE_CAPSULE \}/)
  assert.match(drawer, /if \(quickFind && favorites\) recordNavUse/, 'ปิดใช้บ่อยแล้วต้องไม่นับการกด')
  assert.match(src('components/common/NavQuickFind.jsx'), /if \(!favorites\) return \[\]/)
})

// ── โทนนุ่มสบายตา (เจ้าของระบบสั่ง 2569-11-16): วัด contrast จริงของกระเบื้องโปร่ง/ป้ายตัวเลข/แถบ active บนพื้นแผงที่สว่างที่สุด ─────────
// พื้นแผง "ส่วนที่สว่างที่สุด" ของแต่ละเมนู (พื้นแผงเป็นไล่เฉดบนสว่าง→ล่างเข้ม · ตัวที่สว่างสุดคือกรณีเลวร้ายสุดของตัวขาว/ไอคอนสีอ่อน)
const PANEL_BG = { staff: '#1d4166', admin: '#1e2433', dev: '#1b2a4a', citizen: '#1e4f8f' }
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('')
// ตัวขาวบนแคปซูล: ซ้อน backgroundColor (โปร่ง) แล้วทับด้วยจุดหยุดแต่ละจุดของ gradient บนพื้นแผง → คืน contrast ต่ำสุดของทุกจุดหยุด
// (ตัวขาวต่ำสุดตรงจุดที่แคปซูลสว่างสุด ไม่ใช่จุดเข้มสุด)
function capsuleStopColors(capsule, panel) {
  const rgba = (s) => [...s.matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/g)].map(m => ({ hex: rgbHex(m[1], m[2], m[3]), a: Number(m[4]) }))
  const [base] = rgba(capsule.backgroundColor)
  const under = composite(base.hex, base.a, panel)
  const stops = rgba(capsule.backgroundImage)
  assert.ok(stops.length >= 2, 'gradient ต้องมีอย่างน้อย 2 จุดหยุด')
  return stops.map(s => composite(s.hex, s.a, under))
}
const capsuleWhiteMin = (capsule, panel) => Math.min(...capsuleStopColors(capsule, panel).map(c => contrastRatio('#ffffff', c)))
const minTile = (colors, bg) => Math.min(...colors.map(c => contrastRatio(tileTint(c), composite(c, 0.18, bg))))

await test('กระเบื้องโปร่ง: tileTint สว่างพอ (luminance ≥ 0.5) · softTileStyle = พื้น 18% ขอบ 32% ไอคอนสีอ่อน · hex เสียได้เทาหินชนวน', () => {
  assert.equal(hexToRgba('#f59e0b', 0.18), 'rgba(245, 158, 11, 0.18)')
  assert.equal(hexToRgba('ไม่ใช่สี', 0.5), 'rgba(71, 85, 105, 0.5)')
  const s = softTileStyle('#1d4ed8')
  assert.equal(s.backgroundColor, 'rgba(29, 78, 216, 0.18)')
  assert.equal(s.borderColor, 'rgba(29, 78, 216, 0.32)')
  assert.match(s.color, /^#[0-9a-f]{6}$/)
  assert.notEqual(s.color, '#1d4ed8', 'สีเข้มต้องถูกผสมขาวให้อ่อนลง')
  assert.equal(tileTint('#fde68a'), '#fde68a', 'สีที่สว่างพออยู่แล้วต้องคงเดิม')
  for (const c of ['#1d4ed8', '#7c3aed', '#0e7490', '#475569', '#000000', 'ไม่ใช่สี']) {
    assert.ok(contrastRatio(tileTint(c), '#000000') >= 11, `${c} → ${tileTint(c)}`) // luminance ≥ 0.5 ⇒ ≥ 11:1 บนดำ
  }
})

await test('กระเบื้องโปร่ง: ทุกสีเมนู/กลุ่มเจ้าหน้าที่ + แอดมิน + ที่ปักบน ไอคอน (tileTint) บนพื้นโปร่ง 18% บนพื้นแผงสว่างสุด ≥ 3:1', () => {
  const staff = [...src('lib/staffNavGroups.js').matchAll(/(?:color|accent): '(#[0-9a-fA-F]{6})'/g)].map(m => m[1])
  assert.ok(staff.length >= 20, 'ควรเจอสีเมนู/กลุ่มอย่างน้อย 20 สี')
  const page = src('pages/AdminDashboard.jsx')
  const start = page.indexOf('function getAdminMenuGroups')
  const admin = [...page.slice(start, start + 8000).matchAll(/color: '(#[0-9a-fA-F]{6})'/g)].map(m => m[1])
  assert.ok(admin.length >= 10, 'ควรเจอสีเมนูแอดมินอย่างน้อย 10 สี')
  const extra = ['#475569', '#1a3a5c', '#f59e0b', '#fde68a', '#ffffff', '#10b981', '#000000']
  const results = { staff: minTile([...staff, ...extra], PANEL_BG.staff), admin: minTile([...admin, ...extra], PANEL_BG.admin) }
  for (const [name, v] of Object.entries(results)) assert.ok(v >= 3, `${name} ต่ำสุด ${v.toFixed(2)}`)
  console.log(`     contrast ไอคอนต่ำสุด: เจ้าหน้าที่ ${results.staff.toFixed(2)} · แอดมิน ${results.admin.toFixed(2)}`)
})

await test('ป้ายตัวเลข: สีอ่อนบนชั้นทึบ BADGE_BASE + สีโปร่งทับ ≥ 4.5:1 ทุกที่ (ชั้นทึบ → ไม่ขึ้นกับพื้นแผง/แถว active) · ไม่มีไล่เฉดทึบ/เงาดำ', () => {
  // ชั้นทึบใส่เพราะตอนเป็นโปร่งล้วน: บนแถว active เจ้าหน้าที่เหลือ 3.0:1 และแดงบนแผงประชาชน 3.8:1 (วัดจริง 2569-11-16)
  const r = {}
  for (const [name, t] of Object.entries(BADGE_TONES)) {
    r[name] = contrastRatio(t.text, composite(t.tintHex, t.alpha, BADGE_BASE))
    assert.ok(r[name] >= 4.5, `${name} = ${r[name].toFixed(2)}`)
    assert.equal(hexToRgba(t.tintHex, t.alpha).replace(/ /g, ''), t.tint, `${name}: tint กับ tintHex/alpha ต้องตรงกัน`)
  }
  console.log(`     contrast ป้ายตัวเลข: อำพัน ${r.normal.toFixed(2)} · แดง ${r.hot.toFixed(2)} (ทุกพื้น)`)
  assert.equal(BADGE_TONES.normal.text, '#fcd34d')
  assert.equal(BADGE_TONES.hot.text, '#fca5a5')
  const group = src('components/common/CollapsibleNavGroup.jsx')
  const badge = group.slice(group.indexOf('export function NavBadge'), group.indexOf('export function NavSubList'))
  assert.match(badge, /backgroundColor: BADGE_BASE/, 'ป้ายต้องมีชั้นทึบรอง')
  assert.match(badge, /BADGE_TONES\[hot \? 'hot' : 'normal'\]/)
  assert.doesNotMatch(badge, /bg-gradient|from-|rgba\(0,0,0/, 'ป้ายต้องไม่ไล่เฉดทึบ/เงาดำ')
  assert.match(badge, /data-nav-badge=\{hot \? 'hot' : 'normal'\}/)
  assert.match(badge, /sr-only/)
})

await test('แถบเมนูที่เปิดอยู่โทนนุ่ม: ตัวขาวบนแคปซูลทั้ง 3 (เจ้าหน้าที่/แอดมิน/ผู้พัฒนา) ≥ 4.5:1 ณ จุดที่สว่างสุด · ไม่มีแสงเรืองด้านนอก/เงา', () => {
  const r = {
    staff: capsuleWhiteMin(NAV_ACTIVE_CAPSULE, PANEL_BG.staff),
    admin: capsuleWhiteMin(ADMIN_ACTIVE_CAPSULE, PANEL_BG.admin),
    dev: capsuleWhiteMin(DEV_ACTIVE_CAPSULE, PANEL_BG.dev),
  }
  for (const [name, v] of Object.entries(r)) assert.ok(v >= 4.5, `ขาวบนแคปซูล ${name} = ${v.toFixed(2)}`)
  console.log(`     contrast ขาวบนแคปซูลต่ำสุด: เจ้าหน้าที่ ${r.staff.toFixed(2)} · แอดมิน ${r.admin.toFixed(2)} · ผู้พัฒนา ${r.dev.toFixed(2)}`)
  for (const cap of [NAV_ACTIVE_CAPSULE, ADMIN_ACTIVE_CAPSULE, DEV_ACTIVE_CAPSULE]) {
    assert.match(cap.boxShadow, /^inset 0 0 0 1px rgba\(/, 'เหลือแค่เส้นขอบใน 1px')
  }
})

await test('สีแอดมิน: ขาวบนแคปซูลโทนครามโปร่งตรงสเปก · ลิ้นชักธีมใช้ color-mix 38%→14% + ขาวโปร่งสำรอง', () => {
  assert.match(ADMIN_ACTIVE_CAPSULE.backgroundImage, /rgba\(129, 140, 248, 0\.12\) 0%, rgba\(99, 102, 241, 0\.05\) 100%/)
  assert.equal(ADMIN_ACTIVE_CAPSULE.boxShadow, 'inset 0 0 0 1px rgba(165, 180, 252, 0.15)')
  assert.match(NAV_ACTIVE_CAPSULE.backgroundImage, /rgba\(96, 165, 250, 0\.12\) 0%, rgba\(45, 212, 191, 0\.04\) 100%/)
  assert.equal(NAV_ACTIVE_CAPSULE.boxShadow, 'inset 0 0 0 1px rgba(147, 197, 253, 0.12)')
  const drawer = src('components/common/PortalDrawer.jsx')
  assert.match(drawer, /backgroundColor: 'rgba\(255, 255, 255, 0\.14\)'/)
  assert.match(drawer, /color-mix\(in srgb, var\(--color-primary\) 38%, transparent\) 0%, color-mix\(in srgb, var\(--color-primary\) 14%, transparent\) 100%/)
  assert.match(drawer, /boxShadow: 'inset 0 0 0 1px rgba\(255, 255, 255, 0\.16\)'/)
})

await test('ปุ่มปิด/เปิดทั้งหมด + ช่องค้นหา: ปุ่มบรรทัดเดียว ไม่ใช้กระเบื้อง · ไม่มี <kbd> · placeholder ไม่ถูกตัด (pr-2.5 ตอนว่าง) · ทางลัด "/" ยังอยู่ที่ title', () => {
  const quick = src('components/common/NavQuickFind.jsx')
  const btn = quick.slice(quick.indexOf('data-nav-toggle-all'), quick.indexOf('</button>', quick.indexOf('data-nav-toggle-all')))
  assert.doesNotMatch(btn, /NavIconTile|flex-col|backgroundImage|boxShadow/, 'ปุ่มต้องไม่ซ้อนแนวตั้ง/ไม่ใช้กระเบื้อง/ไม่ไล่เฉด-เงา')
  assert.match(btn, /flex-row/)
  assert.match(btn, /whitespace-nowrap/)
  assert.match(btn, /text-\[11px\] font-semibold/)
  assert.match(btn, /bg-white\/\[0\.06\]/)
  assert.match(btn, /border-white\/15/)
  assert.match(btn, /hover:bg-white\/\[0\.10\]/)
  assert.match(btn, /#7dd3fc/)
  assert.match(btn, /#fcd34d/)
  assert.match(btn, /isPc \? 'h-9' : 'h-11'/)
  assert.doesNotMatch(quick, /<kbd/, 'ป้าย "/" ในช่องค้นหาต้องหาย')
  assert.match(quick, /title=\{isPc \? 'ค้นหาเมนู \(กด \/ ได้ทุกที่\)' : undefined\}/)
  assert.match(quick, /\$\{query \? 'pr-9' : 'pr-2\.5'\}/)
  assert.match(quick, /if \(e\.key !== '\/'/, 'ทางลัด "/" ต้องยังทำงาน')
  assert.match(quick, /data-nav-search/)
  assert.doesNotMatch(quick, /import \{[^}]*NavIconTile/, 'NavQuickFind ไม่ใช้กระเบื้องแล้ว')
})

// ── หัวกลุ่มแสดงยอดรวม + ปิดแล้วซ่อนทั้งหมด (เจ้าของระบบสั่ง 2569-11-16 · ยกเลิกข้อตัดสิน #677) ─────────
await test('หัวกลุ่ม: ยอดรวมป้ายตัวเลขเมนูย่อย · พับแล้วซ่อนทุกแถว · หน้าที่เปิดอยู่ถูกพับ = หัวกลุ่มมีแถบบอก', () => {
  const group = src('components/common/CollapsibleNavGroup.jsx')
  assert.match(group, /<NavBadge count=\{groupTotal\}/, 'หัวกลุ่มต้องแสดงยอดรวม')
  assert.match(group, /hidden=\{collapsed\}/, 'พับแล้วต้องซ่อนเมนูย่อยทุกแถว (ไม่เหลือแถวที่มีเรื่องค้างโผล่)')
  assert.doesNotMatch(group, /data-nav-group-dot/, 'จุดอำพันเดิมซ้ำกับยอดรวม ต้องเอาออก')
  assert.match(group, /activeInside/, 'หน้าที่เปิดอยู่ถูกซ่อนตอนพับ → หัวกลุ่มต้องบอกแทน')
  assert.match(group, /ตรวจงานไม่ได้/, 'ข้อความตรวจงานไม่ได้ต้องอยู่ที่หัวกลุ่ม ไม่หายตอนพับ')
})

console.log(`\nผ่านทั้งหมด ${cases} เคส`)
