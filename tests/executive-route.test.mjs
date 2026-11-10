// หน้าเดี่ยว /executive (ห้องผู้บริหาร) — ตรวจว่าเดินสายครบจากซอร์ส (ไม่ต่อเน็ต/ฐานข้อมูล)
// ถ้าเพิ่มหน้าหลังบ้านใหม่ต้องมีรายการเหล่านี้ครบ ไม่งั้นหน้าจะมีหัว/แถบล่างของเว็บประชาชนโผล่ หรือยอดเข้าชมเว็บถูกนับเกิน
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

await test('App.jsx: route /executive หลัง RequireAuth staffOnly · ซ่อนหัวเว็บประชาชนและแถบล่าง', () => {
  const app = src('App.jsx')
  assert.match(app, /<Route path="\/executive" element=\{\s*<RequireAuth staffOnly>/)
  assert.match(app, /const isBackOffice = \[[^\]]*'\/executive'/)
  assert.match(app, /const hideBottomNav = \[[^\]]*'\/executive'/)
  assert.match(app, /lazyWithRetry\(\(\) => import\('\.\/pages\/ExecutiveRoom'\)\)/)
})

await test('ไม่มีแถบข้างประชาชน/ท้ายเว็บ และไม่นับเป็นยอดเข้าชมเว็บ', async () => {
  assert.match(src('components/layout/CitizenSidebar.jsx'), /HIDDEN_PATHS = \[[^\]]*'\/executive'/)
  assert.ok(src('components/layout/Footer.jsx').includes("startsWith('/executive')"))
  const { BACKOFFICE_PATHS } = await import('../src/lib/siteOpenStats.js')
  assert.ok(BACKOFFICE_PATHS.includes('/executive'))
})

await test('ทางเข้า: ชิปสลับมุมมอง (active เมื่ออยู่ /executive) · เมนู More ของ viewer', async () => {
  const { currentPortal } = await import('../src/lib/portalAccess.js')
  assert.equal(currentPortal('/executive'), 'executive')
  assert.equal(currentPortal('/staff'), 'staff')
  assert.equal(currentPortal('/admin'), 'admin')
  assert.equal(currentPortal('/'), 'citizen')
  assert.match(src('components/layout/PortalSwitcher.jsx'), /key: 'executive', to: '\/executive'/)
  assert.match(src('pages/MorePage.jsx'), /key: 'viewer-exec-room'[^\n]*to: '\/executive'/)
})

await test('หน้า ExecutiveRoom: รอผลตำแหน่งก่อนตัดสิน ห้ามเด้งก่อนรู้ผล · ไม่มีสิทธิ์ = กลับ /staff · ใช้ฟังก์ชันเมนูชุดเดียวกับ StaffDashboard', () => {
  const room = src('pages/ExecutiveRoom.jsx')
  assert.match(room, /!profile \|\| !positionReady/)
  assert.match(room, /canOpenExecutiveHome\(\{ role: profile\.role, positionCategory \}\)/)
  assert.match(room, /<Navigate to="\/staff" replace \/>/)
  assert.match(room, /staffMenuAccess\(\{ role: profile\.role, profile, tenant \}\)/)
  assert.match(room, /navigate\('\/staff'\)/, 'ปุ่มระบบเจ้าหน้าที่')
})

await test('หลังล็อกอินฝั่งเจ้าหน้าที่ (รหัสผ่าน + รหัสจากมือถือ) ถามปลายทางผ่าน executiveLandingPath', () => {
  assert.match(src('pages/AdminLogin.jsx'), /executiveLandingPath\(\{ client: supabase, from: location\.state\?\.from \}\)/)
  assert.match(src('components/auth/DeviceLoginPanel.jsx'), /executiveLandingPath\(\{ client: supabase \}\)/)
})

await test('ห้องผู้บริหาร: โซนรอลงนามขึ้นเมื่อ อปท. เปิดยานพาหนะ · คำใบ้ "ยานพาหนะ › การใช้รถ" เฉพาะบัญชีที่เปิดเมนูนั้นได้', () => {
  const home = src('components/staff/executive/ExecutiveHome.jsx')
  assert.match(home, /tenantModuleEnabled\('fleet'\)/)
  assert.match(home, /e\.key !== 'src:esign' \|\| hasEsign/)
  assert.match(home, /scopedKeys\.includes\('fleet'\)/)
  assert.match(home, /moreHint=\{canOpenFleet \?/)
})

await test('ล็อกอิน Google/LINE + รหัสผ่านหน้า /auth: ผู้บริหารลงห้องผู้บริหาร · ไม่ await ใน onAuthStateChange (ค้างล็อก)', () => {
  const app = src('App.jsx')
  assert.match(app, /const EXEC_DEFAULT_LANDINGS = Object\.freeze\(\['\/', '\/admin'\]\)/)
  // ต้องเลื่อนไปทำหลัง callback จบ — await auth.getSession() ใน callback = ค้างล็อกของ supabase-js
  assert.match(app, /setTimeout\(\(\) => \{\s*executiveLandingPath\(\{ client: supabase, fallback: returnTo \}\)/)
  assert.doesNotMatch(app, /await executiveLandingPath/)
  const auth = src('pages/AuthPage.jsx')
  assert.match(auth, /sessionStorage\.setItem\('oauth_from', from\)/)
  assert.doesNotMatch(auth, /sessionStorage\.removeItem\('oauth_from'\)/, "ต้องเก็บ '/' ด้วย ไม่งั้น App ไม่รู้ว่าเพิ่งล็อกอิน")
  assert.match(auth, /from === '\/' \? await executiveLandingPath\(\{ client: supabase, fallback: '\/' \}\) : from/)
})

await test('เมนูซ้าย PC + ลิ้นชักมือถือของ /staff มีทางลัด "ห้องผู้บริหาร" เฉพาะคนที่เปิดห้องได้', () => {
  const staff = src('pages/StaffDashboard.jsx')
  assert.match(staff, /externalUrl: '\/executive'/)
  assert.match(staff, /\{canOpenExecutive && \(\s*<button type="button" data-staff-exec-link/)
  assert.match(staff, /const drawerExtraItems = canOpenExecutive \? \[EXECUTIVE_MENU_ITEM\] : \[\]/)
  assert.match(staff, /extraItems=\{drawerExtraItems\}/)
})

console.log(`\nok — ${cases} cases`)
