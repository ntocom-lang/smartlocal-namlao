// กอง/หน่วยงาน ย้ายจากเมนู "ตั้งค่าระบบ" มาเป็นแท็บในหน้า "จัดการผู้ใช้และการแต่งตั้ง" — เจ้าของระบบอนุมัติ 2569-10-30
// npm run test:departments-tab
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const dashboard = await read('src/pages/AdminDashboard.jsx')
const settings = await read('src/components/admin/SystemSettingsAdmin.jsx')

await check('หน้าจัดการผู้ใช้: แท็บ เจ้าหน้าที่ → ประชาชน → กองและตำแหน่ง ใช้หน้าจัดการกองและตำแหน่งเดิม', async () => {
  const order = ["key: 'staff'", "key: 'citizen'", "key: 'structure'"]
    .map((needle) => dashboard.indexOf(`{ ${needle}`))
  assert.ok(order.every((index) => index > 0), `หาแท็บไม่ครบ: ${order}`)
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ลำดับแท็บต้องเป็น เจ้าหน้าที่ ประชาชน กองและตำแหน่ง')
  assert.doesNotMatch(dashboard, /\{ key: 'departments'|\{ key: 'positions'/, 'รวมเป็นแท็บเดียวแล้ว')
  assert.match(dashboard, /import DepartmentManager from '\.\.\/components\/admin\/DepartmentManager'/)
  assert.match(dashboard, /subTab === 'structure' && \(\s*<div data-user-manager-structure>/)
  assert.match(dashboard, /<div[^>]*data-user-manager-departments>\s*<DepartmentManager tenant=\{tenant\} \/>/)
  assert.match(dashboard, /<PositionCatalogAdmin tenant=\{tenant\} currentUserRole=\{currentUserRole\} \/>/)
})

await check('แท็บกองไม่ยิง RPC รายชื่อคน (ไม่ดึง PII มาทิ้ง) และซ่อนการ์ดสถิติรายชื่อ', async () => {
  assert.match(dashboard, /if \(subTab === 'structure'\) return/)
  assert.match(dashboard, /const isStructureTab = subTab === 'structure'/)
  assert.match(dashboard, /\{!isStructureTab && \(\s*<div className="relative mt-5 grid/)
  assert.match(dashboard, /\{!isStructureTab && \(<>/)
})

await check('แท็บเจ้าหน้าที่มีทางไปแท็บกอง: ปุ่ม "เพิ่มกองหรือตำแหน่ง" + กล่อง "ยังไม่มีกอง" หลังโหลดเสร็จเท่านั้น', async () => {
  assert.match(dashboard, /function switchSubTab\(key\)/)
  assert.match(dashboard, /onClick=\{\(\) => switchSubTab\('structure'\)\} data-open-structure/)
  assert.match(dashboard, /\{structureLoaded && depts\.length === 0 && \(/, 'ห้ามขึ้นกล่องยังไม่มีกองก่อนโหลดรายชื่อกองเสร็จ')
  assert.match(dashboard, /onClick=\{\(\) => switchSubTab\(key\)\}/, 'ปุ่มแท็บด้านบนต้องใช้ฟังก์ชันสลับแท็บตัวเดียวกัน')
})

await check('ทางเข้า departments เปิดหน้าจัดการผู้ใช้ตรงแท็บกอง และไฮไลต์เมนูจัดการผู้ใช้', async () => {
  assert.match(dashboard, /activePage === 'users' \|\| activePage === 'departments' \? \(/)
  assert.match(dashboard, /initialSubTab=\{activePage === 'departments' \? 'structure' : 'staff'\}/)
  assert.match(dashboard, /onOpenDepartments=\{\(\) => setActivePage\('departments'\)\}/)
  const aliases = dashboard.match(/const PAGE_MENU_ALIASES = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(aliases, /departments: 'users'/)
  assert.match(aliases, /signatories: 'signing'/)
  assert.match(aliases, /esign: 'signing'/)
  // บรรทัด menuKey ต้องจบในตัว — เคยแทรกกลางสาย getAdminMenuGroups(...).map(...) แล้วหน้าแอดมินพังทั้งหน้า
  assert.match(dashboard, /const menuKey = PAGE_MENU_ALIASES\[activePage\] \?\? activePage\r?\n(?!\s*\.)/)
  assert.match(dashboard, /const adminMenuGroups = getAdminMenuGroups\(currentUserRole, currentUserId\)\r?\n\s*\.map\(/)
  assert.doesNotMatch(dashboard, /const isActive = activePage === key/, 'เมนูต้องไฮไลต์ด้วย menuKey')
  assert.match(dashboard, /activeKey=\{menuKey\}/)
  assert.match(dashboard, /find\(m => m\.key === menuKey\)/)
})

await check('ตั้งค่าระบบ: ไม่มีแท็บกองแล้ว แต่มีกล่องชี้ทางพร้อมปุ่มไปแท็บกอง', async () => {
  const tabs = settings.match(/const SETTINGS_TABS = \[([\s\S]*?)\n\]/)?.[1] ?? ''
  assert.ok(tabs.includes("key: 'general'"), 'อ่าน SETTINGS_TABS ไม่ได้')
  assert.doesNotMatch(tabs, /^\s*\{ key: 'departments'/m)
  assert.doesNotMatch(settings, /DepartmentManager|function DepartmentsTab/)
  assert.match(settings, /export default function SystemSettingsAdmin\(\{ onOpenDepartments = null \}\)/)
  assert.match(settings, /data-departments-moved/)
  assert.match(settings, /onClick=\{onOpenDepartments\}/)
})

await check('ข้อความชี้ทางใน src + คู่มือ ไม่ส่งไปหากองที่ตั้งค่าระบบแล้ว', async () => {
  const stale = /ตั้งค่าระบบ["”]? (→|&gt;|>) ["“]?กอง/
  const sources = (await readdir(new URL('../src/', import.meta.url), { recursive: true }))
    .filter((name) => /\.(jsx?|mjs)$/.test(name)).map((name) => `src/${name.replace(/\\/g, '/')}`)
  assert.ok(sources.length > 100, `อ่านไฟล์ใน src ได้น้อยผิดปกติ (${sources.length})`)
  for (const path of [...sources, 'docs/ai/DOMAIN.md', 'public/manual-admin.html']) {
    assert.doesNotMatch(await read(path), stale, `${path} ยังชี้ไปตั้งค่าระบบ → กอง`)
  }
  const manual = await read('public/manual-admin.html')
  const usersSection = manual.slice(manual.indexOf('<div id="users"'), manual.indexOf('<div id="categories"'))
  assert.match(usersSection, /กอง\/หน่วยงาน และสีประจำกอง/, 'คู่มือ: หัวข้อกองต้องอยู่ในหัวข้อ 3')
})

console.log(`admin-departments-tab: ผ่าน ${passed} ชุด`)
