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
  // อ่านตำแหน่งพลาด (เน็ตสะดุด) = ปุ่มลองใหม่ ห้ามตีความว่าไม่ใช่ผู้บริหารแล้วเด้ง /staff (รีวิวรอบ 2)
  assert.match(room, /if \(failed \|\| positionError\) \{/)
  assert.ok(room.indexOf('failed || positionError') < room.indexOf('<Navigate to="/staff"'), 'ต้องเช็ก error ก่อนตัดสินเด้ง')
  assert.match(src('hooks/useMyPositionCategory.js'), /ready: !fetched\.error, error: fetched\.error/)
  assert.match(room, /canOpenExecutiveHome\(\{ role: profile\.role, positionCategory \}\)/)
  assert.match(room, /<Navigate to="\/staff" replace \/>/)
  assert.match(room, /staffMenuAccess\(\{ role: profile\.role, profile, tenant \}\)/)
  assert.match(room, /navigate\('\/staff'\)/, 'ปุ่มระบบเจ้าหน้าที่')
})

await test('หลังล็อกอินฝั่งเจ้าหน้าที่ (รหัสผ่าน + รหัสจากมือถือ) ถามปลายทางผ่าน executiveLandingPath', () => {
  assert.match(src('pages/AdminLogin.jsx'), /bouncedFrom && bouncedFrom !== '\/admin' \? '\/admin' : await executiveLandingPath\(\{ client: supabase \}\)/)
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
  // oauth_from พฤติกรรมเดิม: พาไปทันที ไม่หน่วงใคร
  assert.match(app, /sessionStorage\.removeItem\('oauth_from'\)\s*navigateRef\.current\(returnTo, \{ replace: true \}\)/)
  // ต้องเลื่อนไปทำหลัง callback จบ — await auth.getSession() ใน callback = ค้างล็อกของ supabase-js
  assert.match(app, /setTimeout\(\(\) => \{\s*executiveLandingPath\(\{ client: supabase, fallback: landing \}\)/)
  assert.doesNotMatch(app, /await executiveLandingPath/)
  // พาเฉพาะผู้บริหาร (ปลายทางต่าง) และเฉพาะเมื่อยังอยู่หน้าปลายทางเริ่มต้น — ไม่ดึงคนที่กดไปหน้าอื่นแล้วกลับ
  assert.match(app, /if \(target !== landing && currentAppPath\(\) === landing\) navigateRef\.current\(target, \{ replace: true \}\)/)
  // คีย์ของ /auth แยกจาก oauth_from และต้องยังไม่หมดอายุ (SIGNED_IN ยิงซ้ำตอนกลับมาที่แท็บ)
  assert.match(app, /sessionStorage\.removeItem\(EXEC_OAUTH_CHECK_KEY\)/)
  assert.match(app, /!returnTo && isFreshExecOauthCheck\(execCheckAt\) \? '\/'/)
  const auth = src('pages/AuthPage.jsx')
  assert.match(auth, /if \(from !== '\/'\) \{\s*sessionStorage\.setItem\('oauth_from', from\)/)
  assert.match(auth, /sessionStorage\.removeItem\('oauth_from'\)\s*\/\/[^\n]*\n\s*sessionStorage\.setItem\(EXEC_OAUTH_CHECK_KEY, String\(Date\.now\(\)\)\)/)
  assert.match(auth, /from === '\/' \? await executiveLandingPath\(\{ client: supabase, fallback: '\/' \}\) : from/)
})

await test('เมนูซ้าย PC + ลิ้นชักมือถือของ /staff มีทางลัด "ห้องผู้บริหาร" เฉพาะคนที่เปิดห้องได้', () => {
  const staff = src('pages/StaffDashboard.jsx')
  assert.match(src('lib/staffNavGroups.js'), /externalUrl: '\/executive'/)
  assert.match(staff, /onExecutive=\{canOpenExecutive \? \(\) => navigate\(EXECUTIVE_MENU_ITEM\.externalUrl\) : undefined\}/)
  assert.match(src('components/staff/StaffSideNav.jsx'), /\{onExecutive && \(\s*<button type="button" data-staff-exec-link/)
  assert.match(staff, /const drawerExtraItems = canOpenExecutive \? \[EXECUTIVE_MENU_ITEM\] : \[\]/)
  assert.match(staff, /extraItems=\{drawerExtraItems\}/)
})

await test('ห้องผู้บริหารมีเมนูซ้าย (PC) + แถบล่าง (มือถือ) ชุดเดียวกับ /staff · กดแล้วไป /staff พร้อม state.module', () => {
  const room = src('pages/ExecutiveRoom.jsx')
  const staff = src('pages/StaffDashboard.jsx')
  // สองหน้าใช้คอมโพเนนต์/ฮุกกลางตัวเดียวกัน — ห้องเขียนเมนูซ้ำ (ไม่งั้นเมนูสองหน้าเพี้ยนกัน)
  for (const [name, source] of [['ExecutiveRoom', room], ['StaffDashboard', staff]]) {
    assert.match(source, /<StaffSideNav /, name + ' ใช้ StaffSideNav')
    assert.match(source, /<StaffBottomNav /, name + ' ใช้ StaffBottomNav')
    assert.match(source, /useStaffNavGroups\(/, name + ' ใช้ useStaffNavGroups')
  }
  assert.match(room, /navigate\('\/staff', \{ state: \{ module: key \} \}\)/)
  assert.match(room, /onMenu=\{\(\) => goModule\('menu'\)\}/)
  assert.match(room, /staffBottomTabs\(visibleModules, EXECUTIVE_TAB\)/)
  // เมนู/แถบล่างโผล่เฉพาะตอนผ่านด่านสิทธิ์แล้ว (ไม่โชว์เมนูระหว่างโหลด/โหลดพลาด)
  assert.ok(room.indexOf('showNav = true') > room.indexOf('canOpenExecutiveHome({'), 'showNav ต้องตั้งหลังผ่านด่านสิทธิ์')
  // ไม่ส่ง badge เข้าห้อง (ไม่เพิ่ม query) และไม่มีปุ่มกระเป๋าเอกสารซ้ำกับแถบล่าง
  assert.doesNotMatch(room, /badges=/)
  assert.doesNotMatch(room, /data-exec-to-staff|Briefcase/)
  // StaffDashboard ส่งตัวเปิดโมดูลเหมือนเดิม (ไฟล์ static แท็บใหม่ · หน้าแยก navigate · นอกนั้นสลับโมดูล)
  assert.match(staff, /onSelect=\{\(\{ key, newTab, externalUrl \}\) => \(newTab \? window\.open/)
})

await test('แถบล่างกลาง: ช่องแรกต่างกัน (แดชบอร์ด ↔ ห้องผู้บริหาร) ที่เหลือกรองด้วยเมนูที่เห็นจริง', () => {
  const lib = src('lib/staffNavGroups.js')
  assert.match(lib, /export function staffBottomTabs\(visibleModules, firstTab = STAFF_HOME_TAB\)/)
  assert.match(lib, /visibleModules\.some\(\(m\) => m\.key === key\)/)
  assert.match(src('hooks/useStaffNavGroups.js'), /items: g\.items\.filter\(\(m\) => scopedKeys\.includes\(m\.key\)\)/)
})

console.log(`\nok — ${cases} cases`)
