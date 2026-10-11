// ลิ้นชักเมนูซ้ายบนมือถือ (src/components/common/PortalDrawer.jsx) ของ 3 หน้า: เจ้าหน้าที่ (/staff) · แอดมิน (/admin)
// · ศูนย์รวมข้อมูลดิจิทัล (/data-center/staff — เมนูของหน้านี้เองไม่ใช่เมนูเจ้าหน้าที่ เทียบกับแถบล่างของหน้านั้น)
//
// ตรวจต่อพอร์ทัล ต่อขนาดจอ (360 / 390px):
//   1. แถบหัว: ปุ่ม ☰ กดได้ ≥ 44px · ไม่มีอะไรล้นขอบจอ · ชื่อ อปท. ไม่ถูกตัด (⚠️ ขึ้นกับความยาวชื่อบนสนามซ้อม)
//   2. ปิดอยู่ = มองไม่เห็นและโฟกัสไม่เข้า (ไม่งั้นคนใช้คีย์บอร์ดหลงเข้าเมนูที่มองไม่เห็น)
//   3. เปิดแล้ว: กว้าง ≤ min(86vw, 320px) · โฟกัสเข้าลิ้นชัก · ปุ่มทุกแถว ≥ 44px · ไม่เลื่อนแนวนอน · Tab วนอยู่ในลิ้นชัก
//      · ชิปผู้ใช้ท้ายลิ้นชักไม่ถูกอะไรทับ (แถบล่างของแอดมินเป็น z-50 เคยทับได้ถ้า z-index ลิ้นชักต่ำไป)
//   4. รายการเท่ากับหน้าเมนูอีกแบบของพอร์ทัลนั้น (เจ้าหน้าที่: กริดแท็บ "เมนู" · แอดมิน: การ์ดหน้าแรก) ลำดับเดียวกัน
//      — สองที่ต้องไม่เห็นเมนูต่างกัน · เจ้าหน้าที่: ตัวเลขแดงตรงกันด้วย
//   5. ปิดได้ด้วย Esc (โฟกัสคืนปุ่ม ☰) และแตะฉากหลัง · กดเมนูแล้วเปิดโมดูลและปิดลิ้นชัก · เมนูที่เปิดอยู่มี aria-current
// ไม่ได้ทดสอบการปัดซ้ายเพื่อปิด (Playwright จำลอง touch ลากไม่ได้) ดูด้วยตาบนเครื่องจริง
// อ่านอย่างเดียว ไม่สร้าง/แก้ข้อมูล · ยิงได้เฉพาะ dev server ในเครื่องหรือสนามซ้อม
//   node tests/portal-drawer-layout.playwright.mjs                      (localhost:5174)
//   PD_TEST_BASE_URL=https://demo.rk-networks.com node tests/portal-drawer-layout.playwright.mjs
//   PD_PROFILE_ROOT=<โฟลเดอร์ .chrome-test-profiles> ใช้เมื่อรันจาก worktree ที่ไม่มีโฟลเดอร์นี้

import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.PD_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const SHOT_DIR = process.env.PD_SHOT_DIR || path.join(ROOT_DIR, 'screenshots', 'portal-drawer')
const DEFAULT_BASE_URL = 'http://localhost:5174'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const WIDTHS = [360, 390]
const MIN_TAP = 44

// หน้าเมนูอีกแบบของแต่ละพอร์ทัล ไว้เทียบกับลิ้นชัก — คืน [{ label, badge }] ตามลำดับที่เห็น
const PORTALS = [
  {
    name: 'เจ้าหน้าที่', file: 'staff', path: '/staff', ready: 'เมนูใช้งานด่วน', homeKey: 'home',
    // กริดแท็บ "เมนู" (ปุ่มสุดท้ายของแถบล่าง) แล้วกลับแดชบอร์ด
    async otherMenu(page) {
      await page.locator('nav.fixed button').last().click()
      await page.waitForSelector('[data-menu-tile]', { timeout: 20_000 })
      const items = await page.evaluate(() => [...document.querySelectorAll('[data-menu-tile]')].map(t => ({
        label: t.querySelector('[data-menu-label]').textContent.trim(),
        badge: t.querySelector('[data-menu-badge]')?.textContent.trim() ?? null,
      })))
      await page.locator('nav.fixed button').first().click()
      await page.getByText('เมนูใช้งานด่วน').first().waitFor({ timeout: 20_000 })
      return items
    },
    pick: { key: 'complaints', heading: 'คำร้อง' },
  },
  {
    name: 'แอดมิน', file: 'admin', path: '/admin', ready: 'รายการทั้งหมด', homeKey: 'dashboard',
    // การ์ดในหน้าแรก (หัว "รายการทั้งหมด") — ไม่มีตัวเลขแดง
    async otherMenu(page) {
      return page.evaluate(() => {
        const title = [...document.querySelectorAll('p')].find(p => p.textContent.trim() === 'รายการทั้งหมด')
        return [...title.parentElement.querySelectorAll('section p.text-center')].map(p => ({ label: p.textContent.trim(), badge: null }))
      })
    },
    pick: { key: 'report', heading: 'รายงาน' },
  },
  {
    name: 'ศูนย์ข้อมูล', file: 'data-center', path: '/data-center/staff', homeKey: 'back-to-staff',
    // รายการแรกของลิ้นชักคือ "กลับแดชบอร์ดเจ้าหน้าที่" (ปุ่มนำทาง ไม่เคยเป็นหน้าปัจจุบัน) · ท้ายรายการมี "เลือกหมวดหมู่และประเภท" เพิ่ม
    homeActive: false, extraAt: 'end',
    // หัวหน้านี้ไม่ใช่ header.md:hidden เหมือนหน้าอื่น (ใช้หัวเดียวกันทุกขนาดจอ) — แถวที่มีโลโก้/กระดิ่ง และชื่อ อปท. ขึ้นบรรทัดใหม่ได้ปกติ
    headerRow: 'header .relative.z-10.flex', nameMayWrap: true,
    async waitReady(page) {
      await page.getByRole('heading', { name: 'ศูนย์รวมข้อมูลดิจิทัล', level: 1 }).waitFor({ timeout: 40_000 })
    },
    // โมดูลบนแถบล่างมือถือของหน้านี้ (aria-label ของ nav) — ชุดเดียวกับที่ลิ้นชักต้องมี
    async otherMenu(page) {
      return page.evaluate(() => [...document.querySelectorAll('nav[aria-label="เมนูศูนย์รวมข้อมูลดิจิทัลบนมือถือ"] button')]
        .map(b => ({ label: b.textContent.trim(), badge: null })))
    },
    // หน้านี้หัวเรื่องเหมือนเดิมทุกโมดูล ไม่มี heading ต่างกัน — ดูจากปุ่มบนแถบล่างที่ aria-current แทน
    pick: {
      key: 'map',
      async verify(page) {
        await page.locator('nav[aria-label="เมนูศูนย์รวมข้อมูลดิจิทัลบนมือถือ"] button[aria-current="page"]')
          .filter({ hasText: 'แผนที่ GIS' }).waitFor({ timeout: 20_000 })
      },
    },
    // ปุ่มพิเศษ 2 อัน ทดสอบท้ายสุด (อันหลังพาออกนอกหน้า): หมวดหมู่ → เปิดแผ่นเลือกหมวดที่ลิ้นชักปิดตัวลง · กลับแดชบอร์ดเจ้าหน้าที่ → ไป /staff
    async specialChecks(page, where, helpers) {
      await helpers.openDrawer()
      if (await page.locator('[data-drawer-item="category-sheet"]').count()) {
        await page.locator('[data-drawer-item="category-sheet"]').click()
        await page.getByText('เลือกหมวดหมู่ข้อมูล', { exact: true }).waitFor({ timeout: 10_000 })
        await page.waitForFunction(helpers.isHidden)
        // ปุ่ม ✕ ของแผ่นเลือกหมวด (ในหน้ามีปุ่มชื่อ "ปิด" อื่นอีก จึงจำกัดเฉพาะในแผ่น)
        await page.locator('div.fixed.inset-0', { hasText: 'เลือกหมวดหมู่ข้อมูล' }).getByRole('button', { name: 'ปิด', exact: true }).click()
        await helpers.openDrawer()
      }
      await page.locator('[data-drawer-item="back-to-staff"]').click()
      await page.waitForURL('**/staff', { timeout: 20_000 })
      assert.equal(new URL(page.url()).pathname, '/staff', `${where}: กด "กลับแดชบอร์ดเจ้าหน้าที่" แล้วไม่ได้ไปหน้า /staff`)
    },
  },
]

function resolveBaseUrl() {
  const raw = (process.env.PD_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
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

// สถานะลิ้นชักตอนนี้ — มองเห็น = visibility visible และอยู่ในจอ
const drawerState = () => document.getElementById('portal-drawer') && (() => {
  const panel = document.getElementById('portal-drawer')
  const box = panel.getBoundingClientRect()
  const toggle = document.querySelector('button[aria-label="เปิดเมนู"]')
  const chip = panel.querySelector('[data-drawer-user]')?.getBoundingClientRect()
  const atChip = chip ? document.elementFromPoint(chip.left + chip.width / 2, chip.top + chip.height / 2) : null
  return {
    visible: getComputedStyle(panel).visibility === 'visible' && box.right > 0,
    width: box.width, left: box.left,
    expanded: toggle?.getAttribute('aria-expanded'),
    focusInside: Boolean(document.activeElement?.closest('#portal-drawer')),
    focusOnToggle: document.activeElement === toggle,
    chipUncovered: Boolean(atChip?.closest('#portal-drawer')),
    navOverflow: (() => { const n = panel.querySelector('nav'); return n.scrollWidth - n.clientWidth })(),
    items: [...panel.querySelectorAll('[data-drawer-item]')].map(i => ({
      key: i.getAttribute('data-drawer-item'),
      label: i.querySelector('[data-drawer-label]').textContent.trim(),
      height: i.getBoundingClientRect().height,
      current: i.getAttribute('aria-current'),
      badge: i.querySelector('[data-drawer-badge]')?.firstChild?.textContent.trim() ?? null,
    })),
  }
})()

const isShown = () => getComputedStyle(document.getElementById('portal-drawer')).visibility === 'visible'
const isHidden = () => getComputedStyle(document.getElementById('portal-drawer')).visibility === 'hidden'

async function checkPortal(page, baseUrl, auth, portal, width) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`${baseUrl}${portal.path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (portal.waitReady) await portal.waitReady(page)
  else await page.getByText(portal.ready).first().waitFor({ timeout: 30_000 })
  const where = `${portal.name} ${width}px`
  const toggle = page.locator('button[aria-label="เปิดเมนู"]')
  const openDrawer = async () => {
    await toggle.click()
    await page.waitForFunction(isShown)
    await page.waitForTimeout(350)
  }

  // 1) แถบหัว (หน้าเจ้าหน้าที่/แอดมินใช้ header.md:hidden · หน้าศูนย์ข้อมูลส่ง headerRow มาเอง)
  const head = await page.evaluate(rowSelector => {
    const row = rowSelector ? document.querySelector(rowSelector) : document.querySelector('header.md\\:hidden').firstElementChild
    const btn = document.querySelector('button[aria-label="เปิดเมนู"]').getBoundingClientRect()
    const name = row.querySelector('p.truncate')
    const shown = [...row.children].filter(k => k.getBoundingClientRect().width > 0)
    return {
      btn: [btn.width, btn.height],
      overflowX: document.documentElement.scrollWidth - innerWidth,
      rowOverflow: row.scrollWidth - row.clientWidth,
      kidsOutside: shown.filter(k => k.getBoundingClientRect().right > innerWidth).length,
      // กระดิ่ง/ปุ่มท้ายแถวห้ามหล่นลงบรรทัดใหม่ (แถวของหน้าศูนย์ข้อมูลเป็น flex-wrap)
      wrapped: Math.abs(shown[0].getBoundingClientRect().top - shown.at(-1).getBoundingClientRect().top) > 20,
      nameTruncated: name ? name.scrollWidth > name.clientWidth + 1 : false,
    }
  }, portal.headerRow ?? null)
  assert.ok(head.btn[0] >= MIN_TAP && head.btn[1] >= MIN_TAP, `${where}: ปุ่ม ☰ เล็กกว่า ${MIN_TAP}px (${head.btn.map(Math.round).join('×')})`)
  assert.ok(head.overflowX <= 1 && head.rowOverflow <= 1 && head.kidsOutside === 0, `${where}: แถบหัวล้นขอบจอ`)
  assert.equal(head.wrapped, false, `${where}: แถบหัวแน่นจนปุ่มท้ายแถวหล่นลงบรรทัดใหม่`)
  if (!portal.nameMayWrap) assert.equal(head.nameTruncated, false, `${where}: ชื่อ อปท. บนแถบหัวถูกตัด — แถบหัวแน่นเกินไป`)

  // 2) ปิดอยู่
  let s = await page.evaluate(drawerState)
  assert.equal(s.visible, false, `${where}: ลิ้นชักมองเห็นทั้งที่ยังไม่ได้เปิด`)
  assert.equal(s.expanded, 'false', `${where}: aria-expanded ของปุ่ม ☰ ตอนปิดต้องเป็น false`)
  await page.keyboard.press('Tab')
  assert.equal((await page.evaluate(drawerState)).focusInside, false, `${where}: โฟกัสเข้าไปในลิ้นชักที่ปิดอยู่`)

  // 3) เปิด
  await openDrawer()
  s = await page.evaluate(drawerState)
  assert.ok(s.visible && s.left >= -1 && s.left <= 1, `${where}: ลิ้นชักไม่เลื่อนเข้ามาชิดขอบซ้าย (left=${Math.round(s.left)})`)
  assert.ok(s.width <= Math.min(width * 0.86, 320) + 1, `${where}: ลิ้นชักกว้าง ${Math.round(s.width)}px เกิน min(86vw, 320px)`)
  assert.equal(s.expanded, 'true', `${where}: aria-expanded ตอนเปิดต้องเป็น true`)
  assert.ok(s.focusInside, `${where}: โฟกัสไม่ได้ย้ายเข้าลิ้นชักตอนเปิด`)
  assert.ok(s.chipUncovered, `${where}: ชิปผู้ใช้ท้ายลิ้นชักถูกองค์ประกอบอื่นทับ (ตรวจ z-index เทียบแถบล่าง)`)
  assert.ok(s.navOverflow <= 1, `${where}: รายการในลิ้นชักเลื่อนแนวนอน ${s.navOverflow}px`)
  const small = s.items.filter(i => i.height < MIN_TAP)
  assert.deepEqual(small.map(i => `${i.key} ${Math.round(i.height)}px`), [], `${where}: ปุ่มในลิ้นชักเล็กกว่า ${MIN_TAP}px`)
  assert.equal(s.items[0]?.key, portal.homeKey, `${where}: รายการแรกต้องเป็นหน้าหลักของพอร์ทัล (${portal.homeKey})`)
  assert.equal(s.items[0]?.current ?? null, portal.homeActive === false ? null : 'page', `${where}: aria-current ของรายการแรกไม่ถูกต้อง (ตอนอยู่หน้าหลัก)`)
  assert.ok(await page.locator('a[data-drawer-user][href="/profile"]').count(), `${where}: ไม่มีชิปผู้ใช้ที่ลิงก์ไปหน้าโปรไฟล์`)
  // ภาพหน้าจอ: ปิดชื่อผู้ใช้ไว้ (เป็นบัญชีทดสอบ แต่กติกาคือไม่เก็บชื่อลงภาพ)
  await page.evaluate(() => document.querySelectorAll('[data-drawer-user] span.truncate').forEach(e => { e.style.color = 'transparent' }))
  await page.screenshot({ path: path.join(SHOT_DIR, `${portal.file}-${width}.png`) })
  await page.evaluate(() => document.querySelectorAll('[data-drawer-user] span.truncate').forEach(e => { e.style.color = '' }))

  // Tab วนอยู่ในลิ้นชัก (ไม่หลุดไปปุ่มหลังฉาก) — กดเกินจำนวนปุ่มทั้งหมด
  for (let i = 0; i < s.items.length + 6; i += 1) {
    await page.keyboard.press('Tab')
    assert.ok((await page.evaluate(drawerState)).focusInside, `${where}: Tab ครั้งที่ ${i + 1} โฟกัสหลุดออกนอกลิ้นชัก`)
  }
  await page.keyboard.press('Shift+Tab')
  assert.ok((await page.evaluate(drawerState)).focusInside, `${where}: Shift+Tab โฟกัสหลุดออกนอกลิ้นชัก`)

  // 5a) Esc ปิด + โฟกัสคืนปุ่ม ☰
  await page.keyboard.press('Escape')
  await page.waitForFunction(isHidden)
  s = await page.evaluate(drawerState)
  assert.ok(s.focusOnToggle, `${where}: ปิดด้วย Esc แล้วโฟกัสไม่กลับไปที่ปุ่ม ☰`)
  assert.equal(s.expanded, 'false', `${where}: ปิดแล้ว aria-expanded ต้องกลับเป็น false`)

  // 4) เทียบกับหน้าเมนูอีกแบบของพอร์ทัล (ไม่นับรายการหน้าหลักและทางลัดเพิ่มเติมที่ไม่ใช่เมนูโมดูล)
  await toggle.click()
  await page.waitForFunction(isShown)
  const moduleItems = (await page.evaluate(drawerState)).items.slice(1)
  await page.keyboard.press('Escape')
  await page.waitForFunction(isHidden)
  const other = await portal.otherMenu(page)
  const extra = moduleItems.length - other.length
  assert.ok(extra >= 0 && extra <= 1, `${where}: จำนวนรายการลิ้นชัก (${moduleItems.length}) ต่างจากหน้าเมนูอีกแบบ (${other.length}) เกินทางลัดเพิ่ม 1 รายการ`)
  // ทางลัดเพิ่ม (ถ้ามี): ปกติอยู่ใต้หน้าหลักก่อนกลุ่มโมดูล (แอดมิน → แดชบอร์ดเจ้าหน้าที่) · extraAt 'end' = ต่อท้ายสุด (ศูนย์ข้อมูล → เลือกหมวดหมู่)
  const drawerModules = portal.extraAt === 'end' ? moduleItems.slice(0, other.length) : moduleItems.slice(extra)
  assert.deepEqual(drawerModules.map(i => i.label), other.map(i => i.label), `${where}: ลำดับ/ชื่อเมนูในลิ้นชักไม่ตรงกับหน้าเมนูอีกแบบ`)
  drawerModules.forEach((d, i) => assert.equal(d.badge, other[i].badge, `${where}: ตัวเลขของ "${d.label}" ลิ้นชัก (${d.badge}) ไม่ตรงอีกแบบ (${other[i].badge})`))

  // 5b) แตะฉากหลังปิด
  await toggle.click()
  await page.waitForFunction(isShown)
  await page.mouse.click(width - 6, 420)
  await page.waitForFunction(isHidden)

  // 5c) กดเมนูแล้วเปิดโมดูลและปิดลิ้นชัก + เมนูที่เปิดอยู่ถูกไฮไลต์
  assert.ok(moduleItems.some(i => i.key === portal.pick.key), `${where}: ไม่มีเมนู ${portal.pick.key} ให้ทดสอบกด`)
  await toggle.click()
  await page.waitForFunction(isShown)
  await page.locator(`[data-drawer-item="${portal.pick.key}"]`).click()
  await page.waitForFunction(isHidden)
  // เปิดโมดูลถูกตัว: หน้าส่วนใหญ่ดูจาก heading ของโมดูล · หน้าที่ไม่มี heading ต่างกันส่ง verify มาเอง
  if (portal.pick.verify) await portal.pick.verify(page)
  else await page.getByRole('heading', { name: portal.pick.heading, exact: true }).first().waitFor({ timeout: 20_000 })
  await toggle.click()
  await page.waitForFunction(isShown)
  s = await page.evaluate(drawerState)
  assert.equal(s.items.find(i => i.key === portal.pick.key)?.current, 'page', `${where}: อยู่ในโมดูล ${portal.pick.key} รายการนั้นต้องมี aria-current`)
  assert.equal(s.items.find(i => i.key === portal.homeKey)?.current ?? null, null, `${where}: อยู่ในโมดูล ${portal.pick.key} รายการหน้าหลักต้องไม่ไฮไลต์`)
  await page.keyboard.press('Escape')
  // ปิดแล้วต้องซ่อนจริงภายใน 3 วิ (ซ่อนหลังเลื่อนออกสุด 200ms — ตรวจทันทีจะเห็นว่ายังเปิดอยู่)
  await page.waitForFunction(isHidden, null, { timeout: 3_000 })
    .catch(() => { throw new Error(`${where}: ลิ้นชักไม่ซ่อนหลังปิด`) })
  // ปุ่มพิเศษเฉพาะหน้า (ทดสอบท้ายสุดเพราะบางอันพาออกนอกหน้า)
  if (portal.specialChecks) await portal.specialChecks(page, where, { openDrawer, isHidden })
  return `${s.items.length} รายการ · กว้าง ${Math.round(s.width)}px · ปุ่มเล็กสุด ${Math.round(Math.min(...s.items.map(i => i.height)))}px`
}

async function main() {
  const baseUrl = resolveBaseUrl()
  await mkdir(SHOT_DIR, { recursive: true })
  const profileDir = path.join(PROFILE_ROOT, 'TEST-admin')
  try { await access(profileDir) } catch { throw new BlockedError('ไม่พบโปรไฟล์ TEST-admin') }

  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: !process.argv.includes('--headed'), viewport: { width: 390, height: 844 },
    })
  } catch {
    throw new BlockedError('เปิด TEST-admin ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ')
  }
  const page = context.pages()[0] || await context.newPage()
  const auth = trackProfileResolution(page)
  let failed = 0
  let total = 0
  try {
    await transferDemoSession(page, baseUrl)
    for (const portal of PORTALS) {
      for (const width of WIDTHS) {
        total += 1
        try {
          console.log(`PASS  ${portal.name} ${width}px — ${await checkPortal(page, baseUrl, auth, portal, width)}`)
        } catch (error) {
          failed += 1
          console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${portal.name} ${width}px — ${error.message.split('\n')[0]}`)
        }
      }
    }
  } finally {
    await context.close().catch(() => {})
  }
  console.log(`\n${total - failed}/${total} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${error.message.split('\n')[0]}`)
  process.exit(2)
})
