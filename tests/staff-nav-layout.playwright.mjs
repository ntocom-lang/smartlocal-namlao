// หัวจอ + เมนูซ้ายของหน้าเจ้าหน้าที่ (/staff) — แผนปรับตามที่เทียบกับ Smart E-Office (2569-10-14)
//
// PC (1366×768 · 1440×900 · 800×700):
//   1. หัวจอปักติดบน และเมนูซ้ายปักใต้หัวพอดี ขณะที่เนื้อหาเลื่อนลงไปไกล — เมนูซ้ายสูงเท่าที่เหลือใต้หัว
//      (ไม่ล้นจอ) · รายการท้ายสุดของเมนูซ้ายยังเลื่อนถึง · ความกว้างเมนูซ้ายคงเดิม 240px (ตารางกล่องงานพึ่งความกว้างนี้)
//      · ที่ 800px หัวจอขึ้น 2 บรรทัดได้ เมนูซ้ายต้องไม่ซ้อนใต้หัว
//   2. กระดิ่งแจ้งเตือนบนหัวจอ PC (กดได้ ≥ 44px) พาไป /notifications
//   3. ปุ่มออกจากระบบไม่วางเด่นบนหัวจอ — อยู่ในเมนูบัญชี · เมนูบัญชีไม่ถูกหัวจอตัด (overflow) และไม่มีอะไรทับ
//      · แป้นพิมพ์: เปิดแล้วโฟกัสรายการแรก, ↓ ไปรายการถัดไป, Esc ปิดแล้วคืนโฟกัสปุ่ม, กดนอกกล่องปิด
//      ⚠️ ไม่กด "ออกจากระบบ" จริง — signOut ของระบบออกจากทุกอุปกรณ์ จะทำลาย session ของบัญชีทดสอบ
//   4. ไม่มีหัวกองที่ว่าง ("ยังไม่มีเมนูงานในกองนี้") ในเมนูซ้าย — ทุกหัวกองต้องมีปุ่มเมนูอย่างน้อย 1 ปุ่ม
// มือถือ (360 · 390px):
//   5. หน้าแรก: โลโก้ + ชื่อ อปท. เหมือนเดิม ไม่มีปุ่ม ← · เข้าโมดูลจากลิ้นชัก: ปุ่ม ← (≥ 44px) + ชื่อโมดูลแทนชื่อ อปท.
//      ทั้งชื่อยาวสุดก็ไม่ล้นขอบ/ไม่ถูกตัด · ← กลับแดชบอร์ด หัวจอกลับเป็นแบบหน้าแรก
// ช่าง (TEST-technician): มี Header ของ App ครอบเหนือตัวเลื่อน ตัวเลื่อนจึงเตี้ยกว่าจอ — เมนูซ้ายต้องไม่ยาวเกินตัวเลื่อน
//   (ถ้าบัญชีนี้ไม่ได้เข้าหน้า /staff จะรายงาน SKIP พร้อมเหตุผล ไม่ผ่านเงียบ)
// อ่านอย่างเดียว ไม่สร้าง/แก้ข้อมูล · ยิงได้เฉพาะ dev server ในเครื่องหรือสนามซ้อม
//   node tests/staff-nav-layout.playwright.mjs                      (localhost:5174)
//   SN_TEST_BASE_URL=https://demo.rk-networks.com node tests/staff-nav-layout.playwright.mjs
//   SN_PROFILE_ROOT=<โฟลเดอร์ .chrome-test-profiles> ใช้เมื่อรันจาก worktree ที่ไม่มีโฟลเดอร์นี้
//   SN_PROFILE=TEST-officer (ค่าเริ่มต้น) บัญชีหลักที่ใช้ตรวจ

import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.SN_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const DEFAULT_BASE_URL = 'http://localhost:5174'
// บัญชีหลักที่ใช้ตรวจ — ต้องเห็นเมนูหลายกอง (หัวหน้ากองเห็นเมนูครบพอ + มีกองที่ไม่มีเมนูให้ตรวจการซ่อน) เปลี่ยนได้ด้วย SN_PROFILE
const MAIN_PROFILE = process.env.SN_PROFILE || 'TEST-officer'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const PC_SIZES = [[1366, 768], [1440, 900], [800, 700]]
const MOBILE_WIDTHS = [360, 390]
const MIN_TAP = 44

function resolveBaseUrl() {
  const raw = (process.env.SN_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new BlockedError(`ปฏิเสธการยิงไปที่ ${url.hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  }
  return url.origin
}

// localStorage แยกตาม origin — ย้าย session ของสนามซ้อมมาใส่ localhost ก่อน goto ครั้งแรก
async function transferDemoSession(page, baseUrl) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await safeEvaluate(page, () => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'), undefined, [])
  if (!entries.find(([key]) => key.endsWith('-auth-token'))) {
    throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  }
  await page.addInitScript(pairs => {
    for (const [key, value] of pairs) {
      try { localStorage.setItem(key, value) } catch { /* โควตาเต็ม/โหมดส่วนตัว */ }
    }
  }, entries)
}

// เปิดหน้าเจ้าหน้าที่ให้พร้อม: รอตัวชี้ "หน้าแรกพร้อม" + กด "ข้ามไปก่อน" ของหน้าต่างเพิ่มเบอร์มือถือ (บังคลิกถ้าไม่กด)
async function openStaff(page, baseUrl, auth, [width, height]) {
  await page.setViewportSize({ width, height })
  await page.goto(`${baseUrl}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== '/staff') return false
  await page.getByText('แดชบอร์ดสำหรับเจ้าหน้าที่').first().waitFor({ timeout: 40_000 })
  const skip = page.getByRole('button', { name: 'ข้ามไปก่อน' })
  if (await skip.count()) await skip.first().click()
  return true
}

// ── PC ──────────────────────────────────────────────────────────────────────

// ตัวเลื่อนจริงของหน้านี้คือ <main overflow-y-auto> ของ App (ไม่ใช่ window) — หาจากเมนูซ้ายขึ้นไป
const MEASURE_STICKY = async ({ scrollTo }) => {
  const aside = document.querySelector('[data-staff-aside]')
  const header = document.querySelector('[data-staff-header]')
  let scroller = null
  for (let p = aside.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') { scroller = p; break }
  }
  if (scrollTo > 0 && !document.querySelector('[data-test-spacer]')) {
    // เนื้อหาหน้าแรกสั้น ไม่มีอะไรให้เลื่อน — ต่อความสูงให้ยาวพอเพื่อวัดตอน "เลื่อนลงไกล"
    const spacer = document.createElement('div')
    spacer.setAttribute('data-test-spacer', '')
    spacer.style.height = '3000px'
    aside.parentElement.querySelector('main').appendChild(spacer)
  }
  scroller.scrollTop = scrollTo
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const h = header.getBoundingClientRect()
  const a = aside.getBoundingClientRect()
  const s = scroller.getBoundingClientRect()
  const nav = aside.querySelector('nav')
  // รายการท้ายสุดของเมนูซ้าย: เลื่อนเข้าในเมนูแล้วต้องอยู่ในกรอบเมนู
  const last = [...nav.querySelectorAll('button')].at(-1)
  last.scrollIntoView({ block: 'nearest' })
  const l = last.getBoundingClientRect()
  const n = nav.getBoundingClientRect()
  nav.scrollTop = 0
  return {
    scrolled: scroller.scrollTop,
    header: { top: h.top, bottom: h.bottom },
    aside: { top: a.top, bottom: a.bottom, width: a.width },
    scroller: { top: s.top, bottom: s.bottom },
    lastInNav: l.top >= n.top - 1 && l.bottom <= n.bottom + 1,
    groups: [...nav.querySelectorAll('p')].map(p => ({
      title: p.textContent.trim(),
      buttons: p.parentElement.querySelectorAll('button').length,
    })).filter(g => g.title),
    asideText: aside.textContent,
  }
}

async function checkPcSticky(page, where, expectScroller) {
  const top = await page.evaluate(MEASURE_STICKY, { scrollTo: 0 })
  const far = await page.evaluate(MEASURE_STICKY, { scrollTo: 1200 })
  assert.ok(far.scrolled > 400, `${where}: เลื่อนหน้าไม่ได้ (scrollTop=${far.scrolled}) — วัดการปักไม่ได้`)
  for (const [label, m] of [['ก่อนเลื่อน', top], ['เลื่อนลงไกล', far]]) {
    assert.ok(Math.abs(m.header.top - m.scroller.top) <= 1, `${where} ${label}: หัวจอไม่ติดบนสุดของตัวเลื่อน (top ${Math.round(m.header.top)} vs ${Math.round(m.scroller.top)})`)
    assert.ok(Math.abs(m.aside.top - m.header.bottom) <= 1, `${where} ${label}: เมนูซ้ายไม่ติดใต้หัวจอ (aside.top ${Math.round(m.aside.top)} vs header.bottom ${Math.round(m.header.bottom)})`)
    assert.ok(m.aside.bottom <= m.scroller.bottom + 1, `${where} ${label}: เมนูซ้ายยาวเกินตัวเลื่อน ${Math.round(m.aside.bottom - m.scroller.bottom)}px`)
    assert.ok(m.scroller.bottom - m.aside.bottom <= 2, `${where} ${label}: เมนูซ้ายสั้นกว่าที่เหลือใต้หัว ${Math.round(m.scroller.bottom - m.aside.bottom)}px`)
    assert.ok(Math.abs(m.aside.width - 240) <= 1, `${where} ${label}: เมนูซ้ายกว้าง ${Math.round(m.aside.width)}px (ต้อง 240)`)
    assert.ok(m.lastInNav, `${where} ${label}: รายการท้ายสุดของเมนูซ้ายเลื่อนไม่ถึง`)
  }
  // ช่าง: Header ของ App ครอบเหนือตัวเลื่อน ตัวเลื่อนจึงเริ่มต่ำกว่าขอบบนจอ — ถ้าได้เต็มจอแปลว่าเงื่อนไขของเคสนี้ไม่เป็นจริง ผลที่ผ่านจะไม่มีความหมาย
  if (expectScroller) assert.ok(far.scroller.top >= 40, `${where}: ตัวเลื่อนเริ่มที่ ${Math.round(far.scroller.top)}px — ต้องมี Header ของ App ครอบอยู่ข้างบน`)
  return far
}

async function checkPcChrome(page, where) {
  // 2) กระดิ่ง
  const bell = page.locator('[data-staff-header] [data-pc-bell]')
  await bell.waitFor({ state: 'visible', timeout: 10_000 })
  const bb = await bell.boundingBox()
  assert.ok(bb.width >= MIN_TAP && bb.height >= MIN_TAP, `${where}: กระดิ่งเล็กกว่า ${MIN_TAP}px (${Math.round(bb.width)}×${Math.round(bb.height)})`)

  // 3) ออกจากระบบไม่วางเด่น
  const loud = await page.locator('[data-staff-header] button:visible', { hasText: 'ออกจากระบบ' }).count()
  assert.equal(loud, 0, `${where}: ยังมีปุ่ม "ออกจากระบบ" วางเด่นบนหัวจอ (ต้องอยู่ในเมนูบัญชี)`)
  const acct = page.locator('[data-account-menu-button]')
  const ab = await acct.boundingBox()
  assert.ok(ab.height >= MIN_TAP - 0.5, `${where}: ปุ่มเมนูบัญชีเตี้ยกว่า ${MIN_TAP}px (${Math.round(ab.height)})`)
  assert.equal(await acct.getAttribute('aria-expanded'), 'false', `${where}: aria-expanded ตอนปิดต้องเป็น false`)
  assert.equal(await page.locator('[data-account-menu]').count(), 0, `${where}: เมนูบัญชีถูกวาดทั้งที่ยังไม่เปิด`)

  await acct.click()
  const menu = page.locator('[data-account-menu]')
  await menu.waitFor({ state: 'visible' })
  assert.equal(await acct.getAttribute('aria-expanded'), 'true', `${where}: aria-expanded ตอนเปิดต้องเป็น true`)
  const geo = await page.evaluate(() => {
    const m = document.querySelector('[data-account-menu]').getBoundingClientRect()
    const logout = document.querySelector('[data-account-logout]').getBoundingClientRect()
    const at = (x, y) => document.elementFromPoint(x, y)?.closest('[data-account-menu]') != null
    return {
      inside: m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight,
      menuCenterFree: at(m.left + m.width / 2, m.top + 8),
      logoutFree: at(logout.left + logout.width / 2, logout.top + logout.height / 2),
      logoutH: logout.height,
      focusOnFirst: document.activeElement?.hasAttribute('data-account-profile') ?? false,
      profileHref: document.querySelector('[data-account-profile]').getAttribute('href'),
    }
  })
  assert.ok(geo.inside, `${where}: เมนูบัญชีล้นขอบจอ`)
  assert.ok(geo.menuCenterFree && geo.logoutFree, `${where}: เมนูบัญชีถูกตัดหรือมีอะไรทับ (หัวจอ overflow-hidden ตัดเมนูทิ้ง?)`)
  assert.ok(geo.logoutH >= MIN_TAP - 0.5, `${where}: รายการ "ออกจากระบบ" เตี้ยกว่า ${MIN_TAP}px`)
  assert.ok(geo.focusOnFirst, `${where}: เปิดเมนูบัญชีแล้วโฟกัสไม่ได้ไปที่รายการแรก`)
  assert.equal(geo.profileHref, '/profile', `${where}: "โปรไฟล์ของฉัน" ต้องลิงก์ไป /profile`)

  await page.keyboard.press('ArrowDown')
  assert.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-account-signature')), `${where}: ↓ ไม่ย้ายโฟกัสไป "ลายเซ็นของฉัน"`)
  assert.equal(await page.locator('[data-account-signature]').getAttribute('href'), '/profile#signature', `${where}: "ลายเซ็นของฉัน" ต้องลิงก์ไป /profile#signature`)
  await page.keyboard.press('ArrowDown')
  assert.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-account-logout')), `${where}: ↓ ไม่ย้ายโฟกัสไป "ออกจากระบบ"`)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  assert.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-account-menu-button')), `${where}: ปิดด้วย Esc แล้วโฟกัสไม่กลับปุ่มบัญชี`)

  await acct.click()
  await menu.waitFor({ state: 'visible' })
  // จุดว่างในขอบขวาของเนื้อหา (ใต้หัวจอ ก่อนแถบเลื่อน) — กดตรงนี้ไม่ไปโดนปุ่มอะไร
  const outside = await page.evaluate(() => {
    const header = document.querySelector('[data-staff-header]').getBoundingClientRect()
    let s = document.querySelector('[data-staff-aside]').parentElement
    while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowY)) s = s.parentElement
    return { x: innerWidth - (s.offsetWidth - s.clientWidth) - 6, y: header.bottom + 10 }
  })
  await page.mouse.click(outside.x, outside.y)
  await menu.waitFor({ state: 'detached' })
}

function checkNoEmptyGroups(far, where) {
  assert.ok(!far.asideText.includes('ยังไม่มีเมนูงานในกองนี้'), `${where}: เมนูซ้ายยังมีข้อความ "ยังไม่มีเมนูงานในกองนี้"`)
  const empty = far.groups.filter(g => g.buttons === 0).map(g => g.title)
  assert.deepEqual(empty, [], `${where}: มีหัวกองที่ไม่มีปุ่มเมนูเลย`)
}

async function checkPc(page, baseUrl, auth, size, { expectScroller = false } = {}) {
  const where = `PC ${size[0]}×${size[1]}`
  const ok = await openStaff(page, baseUrl, auth, size)
  if (!ok) return `SKIP: บัญชีนี้ถูกพาออกจาก /staff (ไปที่ ${new URL(page.url()).pathname}) ไม่ได้ตรวจ`
  const far = await checkPcSticky(page, where, expectScroller)
  checkNoEmptyGroups(far, where)
  await page.evaluate(() => document.querySelector('[data-test-spacer]')?.remove())
  await checkPcChrome(page, where)
  return `หัว ${Math.round(far.header.bottom - far.header.top)}px · เมนูซ้ายสูง ${Math.round(far.aside.bottom - far.aside.top)}px · ${far.groups.length} กอง/หมวด`
}

// ช่าง (technician) มี Header ของ App ครอบเหนือตัวเลื่อน → ตัวเลื่อนเตี้ยกว่าจอ ถ้าเมนูซ้ายสูงตาม 100dvh จะยาวเกินตัวเลื่อนและรายการท้ายกดไม่ถึง
// บัญชีช่างบนสนามซ้อมไม่ได้ขึ้น Header นั้นบน /staff จึงจำลองด้วยการดันตัวเลื่อนลง 80px (ผลทางเรขาคณิตเหมือนกันทุกประการ) ใช้ได้กับทุกบัญชี
async function checkPcShrunk(page, baseUrl, auth) {
  const where = 'PC 1366×768 (จำลอง Header ครอบ)'
  const ok = await openStaff(page, baseUrl, auth, [1366, 768])
  if (!ok) return `SKIP: บัญชีนี้ถูกพาออกจาก /staff (ไปที่ ${new URL(page.url()).pathname}) ไม่ได้ตรวจ`
  await page.evaluate(() => { document.querySelector('.h-dvh').style.paddingTop = '80px' })
  await page.waitForTimeout(400) // ให้ ResizeObserver วัดความสูงใหม่
  const far = await checkPcSticky(page, where, true)
  return `ตัวเลื่อนเริ่มที่ ${Math.round(far.scroller.top)}px · เมนูซ้ายสูง ${Math.round(far.aside.bottom - far.aside.top)}px`
}

// ── มือถือ ───────────────────────────────────────────────────────────────────

async function mobileHeader(page) {
  return page.evaluate(() => {
    const head = document.querySelector('header.md\\:hidden')
    const row = head.firstElementChild
    const title = head.querySelector('[data-staff-title]')
    const back = head.querySelector('[data-staff-back]')?.getBoundingClientRect() ?? null
    const menu = head.querySelector('button[aria-label="เปิดเมนู"]').getBoundingClientRect()
    return {
      title: title.textContent.trim(),
      titleClipped: title.scrollWidth - title.clientWidth > 1,
      chip: head.textContent.includes('ระบบเจ้าหน้าที่'),
      back: back && { w: back.width, h: back.height, left: back.left },
      menuLeft: menu.left,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      rowOverflow: row.scrollWidth - row.clientWidth,
      kidsOutside: [...row.children].filter(k => k.getBoundingClientRect().width > 0 && k.getBoundingClientRect().right > innerWidth).length,
      headH: head.getBoundingClientRect().height,
    }
  })
}

async function checkMobile(page, baseUrl, auth, width) {
  const where = `มือถือ ${width}px`
  await openStaff(page, baseUrl, auth, [width, 844])
  const home = await mobileHeader(page)
  assert.equal(home.back, null, `${where}: หน้าแรกต้องไม่มีปุ่ม ←`)
  assert.ok(home.chip, `${where}: ไม่มีป้าย "ระบบเจ้าหน้าที่"`)
  assert.ok(home.overflowX <= 1 && home.rowOverflow <= 1 && home.kidsOutside === 0, `${where}: หัวหน้าแรกล้นขอบจอ`)
  const tenantTitle = home.title

  // เข้าโมดูลจากลิ้นชัก — เลือกชื่อยาวสุด (ยกเว้นเมนูที่พาออกนอกหน้า/เปิดแท็บใหม่)
  const toggle = page.locator('button[aria-label="เปิดเมนู"]')
  await toggle.click()
  await page.waitForFunction(() => getComputedStyle(document.getElementById('portal-drawer')).visibility === 'visible')
  const items = await page.evaluate(() => [...document.querySelectorAll('#portal-drawer [data-drawer-item]')]
    .map(i => ({ key: i.getAttribute('data-drawer-item'), label: i.querySelector('[data-drawer-label]').textContent.trim() })))
  const usable = items.filter(i => !['home', 'manual-staff', 'data-center'].includes(i.key))
  assert.ok(usable.length > 0, `${where}: ไม่มีเมนูให้ทดสอบเข้าโมดูล`)
  const longest = usable.reduce((a, b) => (b.label.length > a.label.length ? b : a))
  await page.locator(`[data-drawer-item="${longest.key}"]`).click()
  await page.waitForFunction(() => getComputedStyle(document.getElementById('portal-drawer')).visibility === 'hidden')
  await page.locator('[data-staff-back]').waitFor({ state: 'visible', timeout: 15_000 })

  const mod = await mobileHeader(page)
  assert.equal(mod.title, longest.label, `${where}: ชื่อบนหัวจอ ("${mod.title}") ไม่ตรงชื่อเมนูที่เปิด ("${longest.label}")`)
  assert.ok(mod.back.w >= MIN_TAP && mod.back.h >= MIN_TAP, `${where}: ปุ่ม ← เล็กกว่า ${MIN_TAP}px (${Math.round(mod.back.w)}×${Math.round(mod.back.h)})`)
  assert.ok(mod.menuLeft < mod.back.left, `${where}: ปุ่ม ☰ ต้องอยู่ซ้ายของปุ่ม ←`)
  assert.ok(mod.chip, `${where}: ในโมดูลหายป้าย "ระบบเจ้าหน้าที่"`)
  assert.equal(mod.titleClipped, false, `${where}: ชื่อโมดูล "${mod.title}" ถูกตัด`)
  assert.ok(mod.overflowX <= 1 && mod.rowOverflow <= 1 && mod.kidsOutside === 0, `${where}: หัวในโมดูลล้นขอบจอ`)
  assert.ok(mod.headH <= 120, `${where}: หัวในโมดูลสูง ${Math.round(mod.headH)}px (ชื่อยาวกินที่เกินไป)`)

  await page.locator('[data-staff-back]').click()
  await page.getByText('แดชบอร์ดสำหรับเจ้าหน้าที่').first().waitFor({ timeout: 20_000 })
  const back = await mobileHeader(page)
  assert.equal(back.back, null, `${where}: กลับแดชบอร์ดแล้วปุ่ม ← ต้องหาย`)
  assert.equal(back.title, tenantTitle, `${where}: กลับแดชบอร์ดแล้วหัวต้องกลับเป็นชื่อ อปท.`)
  return `"${longest.label}" หัวสูง ${Math.round(mod.headH)}px`
}

// ── main ────────────────────────────────────────────────────────────────────

async function withProfile(name, baseUrl, fn) {
  const profileDir = path.join(PROFILE_ROOT, name)
  try { await access(profileDir) } catch { throw new BlockedError(`ไม่พบโปรไฟล์ ${name}`) }
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: !process.argv.includes('--headed'), viewport: { width: 1366, height: 768 },
    })
  } catch {
    throw new BlockedError(`เปิด ${name} ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`)
  }
  try {
    const page = context.pages()[0] || await context.newPage()
    const auth = trackProfileResolution(page)
    await transferDemoSession(page, baseUrl)
    return await fn(page, auth)
  } finally {
    await context.close().catch(() => {})
  }
}

async function main() {
  const baseUrl = resolveBaseUrl()
  let failed = 0
  let total = 0
  const run = async (label, fn) => {
    total += 1
    try {
      const note = await fn()
      console.log(note?.startsWith('SKIP:') ? `SKIP  ${label} — ${note.slice(5).trim()}` : `PASS  ${label}${note ? ` — ${note}` : ''}`)
    } catch (error) {
      failed += 1
      console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${label} — ${error.message.split('\n')[0]}`)
    }
  }

  await withProfile(MAIN_PROFILE, baseUrl, async (page, auth) => {
    for (const size of PC_SIZES) await run(`${MAIN_PROFILE} PC ${size[0]}×${size[1]}`, () => checkPc(page, baseUrl, auth, size))
    for (const width of MOBILE_WIDTHS) await run(`${MAIN_PROFILE} มือถือ ${width}px`, () => checkMobile(page, baseUrl, auth, width))
    await run(`${MAIN_PROFILE} PC 1366×768 · จำลองมี Header ครอบเหนือตัวเลื่อน (แบบช่าง)`, () => checkPcShrunk(page, baseUrl, auth))
  })

  console.log(`\n${total - failed}/${total} ผ่าน (SKIP นับว่าไม่ล้ม แต่ไม่ได้ตรวจ)`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${error.message.split('\n')[0]}`)
  process.exit(2)
})
