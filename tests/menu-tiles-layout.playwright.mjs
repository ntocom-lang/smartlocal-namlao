// เมนูแบบไอคอน (src/components/common/MenuTileGrid.jsx) — วัดเลย์เอาต์บนมือถือจริง
//
// ใช้ 3 ที่ ตรวจทั้งหมด:
//   ก) หน้า "เมนูทั้งหมด" ของประชาชน /more (ไม่ต้องล็อกอิน) — 3 คอลัมน์ ปุ่มใหญ่
//   ก2) เหมือน ก) แต่ธีม Kledkaew (หน้าเมนูแยกไฟล์ — ดักคำตอบ municipalities สลับ ui_style ในเบราว์เซอร์ทดสอบ)
//   ข) แท็บ "เมนู" ในแถบล่างของเจ้าหน้าที่ /staff (ล็อกอินบัญชีทดสอบ) — 4 คอลัมน์ที่จอ ≥ 380px
//
// ตรวจต่อขนาดจอ:
//   1. ไม่มีเลื่อนแนวนอน
//   2. ทุกปุ่มกดได้อย่างน้อย 44×44px (ชื่อเมนูไทยยาวบนจอแคบเคยทำให้ปุ่มบีบจนกดยาก)
//   3. ชื่อเมนูอยู่ในกรอบปุ่มและไม่เกิน 3 บรรทัด (ไม่ถูกตัด/ล้น)
//   4. เลข "N เมนู" ที่หัวกลุ่มเท่ากับจำนวนปุ่มที่เห็นจริง และไม่มีกลุ่มเปล่า
// เฉพาะเจ้าหน้าที่: แถบล่างมี ≤ 5 ปุ่มและ "เมนู" เป็นปุ่มสุดท้าย · ไฮไลต์ถูก · ตัวเลขบนปุ่มตรงกับตัวเลขบนแถบล่าง
//   · กดปุ่มในกริดแล้วเปิดโมดูลนั้น (ทั้งโมดูลที่มีปุ่มบนแถบและที่ไม่มี)
//
// ⚠️ ข้อ 3 ขึ้นกับความยาวชื่อเมนูในโค้ด — ถ้าตกเพราะมีคนตั้งชื่อเมนูใหม่ยาวมาก ให้ย่อชื่อ ไม่ใช่ปิดข้อนี้
// อ่านอย่างเดียว ไม่สร้าง/แก้ข้อมูล · ยิงได้เฉพาะ dev server ในเครื่องหรือสนามซ้อม
//   node tests/menu-tiles-layout.playwright.mjs                      (localhost:5174)
//   MT_TEST_BASE_URL=https://demo.rk-networks.com node tests/menu-tiles-layout.playwright.mjs
//   MT_PROFILE_ROOT=<โฟลเดอร์ .chrome-test-profiles> ใช้เมื่อรันจาก worktree ที่ไม่มีโฟลเดอร์นี้

import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.MT_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const SHOT_DIR = process.env.MT_SHOT_DIR || path.join(ROOT_DIR, 'screenshots', 'menu-tiles')
const DEFAULT_BASE_URL = 'http://localhost:5174'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const CITIZEN_WIDTHS = [360, 390, 1280]
const STAFF_WIDTHS = [360, 390]
const MIN_TAP = 44

function resolveBaseUrl() {
  const raw = (process.env.MT_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
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

// วัดกริดเมนูที่แสดงอยู่ในหน้า — คืนข้อมูลดิบ ให้ assertGrid ตัดสินแยก
function measureGrid() {
  const tiles = [...document.querySelectorAll('[data-menu-tile]')].map(tile => {
    const box = tile.getBoundingClientRect()
    const label = tile.querySelector('[data-menu-label]')
    const labelBox = label.getBoundingClientRect()
    return {
      key: tile.getAttribute('data-menu-tile'),
      width: box.width, height: box.height,
      lines: Math.round(labelBox.height / parseFloat(getComputedStyle(label).lineHeight)),
      labelInside: labelBox.left >= box.left - 0.5 && labelBox.right <= box.right + 0.5,
      badge: tile.querySelector('[data-menu-badge]')?.textContent.trim() ?? null,
    }
  })
  const groups = [...document.querySelectorAll('[data-menu-group]')].map(group => ({
    title: group.querySelector('h2')?.textContent.trim(),
    declared: Number(/(\d+)\s*เมนู/.exec(group.querySelector('[data-menu-count]')?.textContent ?? '')?.[1] ?? NaN),
    tiles: group.querySelectorAll('[data-menu-tile]').length,
  }))
  // จำนวนคอลัมน์ = จำนวนตำแหน่งซ้ายที่ไม่ซ้ำกันของปุ่มในกลุ่มหนึ่ง — เอากลุ่มที่มากที่สุด
  // เพราะกลุ่มที่มีปุ่มน้อยกว่าจำนวนคอลัมน์จะนับขาด (เช่น 3 ปุ่มในกริด 4 คอลัมน์)
  const columns = Math.max(0, ...[...document.querySelectorAll('[data-menu-group]')].map(group =>
    new Set([...group.querySelectorAll('[data-menu-tile]')].map(t => Math.round(t.getBoundingClientRect().left))).size))
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tiles, groups, columns,
  }
}

function assertGrid(m, where) {
  assert.ok(m.tiles.length > 0, `${where}: ไม่เจอปุ่มเมนูเลย`)
  assert.ok(m.overflowX <= 1, `${where}: มีเลื่อนแนวนอน ${m.overflowX}px`)
  const small = m.tiles.filter(t => t.width < MIN_TAP || t.height < MIN_TAP)
  assert.deepEqual(small.map(t => `${t.key} ${Math.round(t.width)}×${Math.round(t.height)}`), [],
    `${where}: ปุ่มเล็กกว่า ${MIN_TAP}px`)
  const clipped = m.tiles.filter(t => !t.labelInside)
  assert.deepEqual(clipped.map(t => t.key), [], `${where}: ชื่อเมนูล้นกรอบปุ่ม`)
  const tall = m.tiles.filter(t => t.lines > 3)
  assert.deepEqual(tall.map(t => `${t.key} ${t.lines} บรรทัด`), [], `${where}: ชื่อเมนูเกิน 3 บรรทัด — ย่อชื่อ`)
  for (const g of m.groups) {
    assert.ok(g.tiles > 0, `${where}: กลุ่ม "${g.title}" ไม่มีปุ่มเลย (หัวกลุ่มเปล่า)`)
    assert.equal(g.declared, g.tiles, `${where}: กลุ่ม "${g.title}" ประกาศ ${g.declared} เมนู แต่มีปุ่มจริง ${g.tiles}`)
  }
}

// kledkaew = ธีมหน้าตาเฉพาะ (src/components/citizen/templates/Kledkaew/More.jsx) — สนามซ้อมไม่ได้ใช้ธีมนี้
// จึงดักคำตอบ GET municipalities แล้วสลับ ui_style ในเบราว์เซอร์ทดสอบเท่านั้น (อ่านอย่างเดียว ไม่แตะฐานข้อมูล)
async function checkCitizen(browser, baseUrl, { kledkaew = false } = {}) {
  const tag = kledkaew ? 'ประชาชน(Kledkaew)' : 'ประชาชน'
  // คีย์ของปุ่ม: ธีมปกติใช้ชื่อที่ตั้งเอง ธีม Kledkaew ใช้เส้นทางปลายทาง (ไม่มีเส้นทาง = ใช้ชื่อเมนู)
  const loginKey = kledkaew ? '/auth' : 'login'
  const forbiddenKeys = kledkaew ? ['ออกจากระบบ', '/staff', '/admin', '/technician'] : ['logout', 'staff-system', 'admin-panel', 'events-manage']
  let failed = 0
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  if (kledkaew) {
    await page.route('**/rest/v1/municipalities*', async route => {
      const response = await route.fetch()
      let body
      try { body = await response.json() } catch { return route.fulfill({ response }) }
      const patch = row => (row && typeof row === 'object' && 'ui_style' in row ? { ...row, ui_style: 'kledkaew' } : row)
      await route.fulfill({ response, json: Array.isArray(body) ? body.map(patch) : patch(body) })
    })
  }
  for (const width of CITIZEN_WIDTHS) {
    try {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`${baseUrl}/more`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForSelector('[data-menu-group]', { timeout: 30_000 })
      await page.waitForTimeout(800)
      const m = await page.evaluate(measureGrid)
      await page.screenshot({ path: path.join(SHOT_DIR, `citizen${kledkaew ? '-kledkaew' : ''}-${width}.png`) })
      assertGrid(m, `${tag} ${width}px`)
      if (kledkaew) {
        // ต้องเป็นหน้าธีม Kledkaew จริง (ไม่ใช่ตกไปหน้าเมนูธีมปกติเพราะดักไม่โดน) และคงการ์ดเอกลักษณ์ของธีมไว้
        assert.ok(await page.getByText('ติดต่อ / แจ้งเหตุ').first().isVisible(), `${tag} ${width}px: ไม่เห็นการ์ด "ติดต่อ / แจ้งเหตุ" ของธีม Kledkaew`)
      }
      // ผู้เยี่ยมชมที่ยังไม่ล็อกอิน: ต้องมีทางเข้าสู่ระบบ และต้องไม่เห็นเมนูของเจ้าหน้าที่/ออกจากระบบ
      const keys = m.tiles.map(t => t.key)
      assert.ok(keys.includes(loginKey), `${tag} ${width}px: ไม่มีปุ่ม "เข้าสู่ระบบ" สำหรับผู้ที่ยังไม่ล็อกอิน`)
      for (const forbidden of forbiddenKeys) {
        assert.ok(!keys.includes(forbidden), `${tag} ${width}px: ผู้เยี่ยมชมเห็นเมนู ${forbidden}`)
      }
      if (width < 768) assert.ok(m.columns <= 4, `${tag} ${width}px: เห็น ${m.columns} คอลัมน์ในกลุ่มแรก`)
      console.log(`PASS  ${tag} ${width}px — ${m.groups.length} กลุ่ม ${m.tiles.length} ปุ่ม · เล็กสุด ${Math.round(Math.min(...m.tiles.map(t => t.width)))}×${Math.round(Math.min(...m.tiles.map(t => t.height)))}px`)
    } catch (error) {
      failed += 1
      console.log(`FAIL  ${tag} ${width}px — ${error.message.split('\n')[0]}`)
    }
  }
  await context.close()
  return failed
}

async function checkStaff(baseUrl) {
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
  const tabBadge = async (label) => (await page.locator('nav.fixed button').filter({ hasText: label })
    .locator('span.bg-amber-400').first().textContent({ timeout: 2_000 }).catch(() => null))?.trim() ?? null
  // ปุ่มบนแถบล่างที่ไฮไลต์ = พื้นหลังกล่องไอคอนเป็นขาวโปร่ง 20% (ดู bottomTabs ใน StaffDashboard.jsx)
  const activeTabs = () => page.evaluate(() => [...document.querySelectorAll('nav.fixed button')]
    .filter(b => b.querySelector('div')?.style.backgroundColor.replace(/\s/g, '') === 'rgba(255,255,255,0.2)')
    .map(b => b.textContent.trim().replace(/\d+\+?/g, '')))

  try {
    await transferDemoSession(page, baseUrl)
    for (const width of STAFF_WIDTHS) {
      try {
        await page.setViewportSize({ width, height: 844 })
        await page.goto(`${baseUrl}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await waitForSettled(page, auth)
        await page.getByText('แดชบอร์ดสำหรับเจ้าหน้าที่').first().waitFor({ timeout: 30_000 })

        // แถบล่าง: ≤ 5 ปุ่ม และ "เมนู" เป็นปุ่มสุดท้าย
        const bar = await page.locator('nav.fixed button').evaluateAll(els => els.map(b => ({
          label: b.getAttribute('aria-label') ?? b.textContent.trim(),
        })))
        assert.ok(bar.length <= 5, `เจ้าหน้าที่ ${width}px: แถบล่างมี ${bar.length} ปุ่ม (ต้องไม่เกิน 5 ไม่งั้นปุ่มแคบเกิน)`)
        assert.ok(/^เมนู/.test(bar.at(-1)?.label ?? ''), `เจ้าหน้าที่ ${width}px: ปุ่มสุดท้ายของแถบล่างต้องเป็น "เมนู" (เจอ "${bar.at(-1)?.label}")`)
        assert.ok(!bar.some(b => /^รายงาน/.test(b.label)), `เจ้าหน้าที่ ${width}px: ปุ่ม "รายงาน" ควรย้ายเข้ากริดเมนูแล้ว`)

        await page.locator('nav.fixed button').last().click()
        await page.waitForSelector('[data-menu-group]', { timeout: 20_000 })
        await page.waitForTimeout(600)
        const m = await page.evaluate(measureGrid)
        await page.screenshot({ path: path.join(SHOT_DIR, `staff-${width}.png`) })
        assertGrid(m, `เจ้าหน้าที่ ${width}px`)
        if (width >= 380) assert.equal(m.columns, 4, `เจ้าหน้าที่ ${width}px: ควรเป็น 4 คอลัมน์ (เจอ ${m.columns})`)
        else assert.equal(m.columns, 3, `เจ้าหน้าที่ ${width}px: ควรเป็น 3 คอลัมน์ (เจอ ${m.columns})`)
        assert.deepEqual(await activeTabs(), ['เมนู'], `เจ้าหน้าที่ ${width}px: ตอนอยู่หน้าเมนู แถบล่างต้องไฮไลต์ "เมนู" ปุ่มเดียว`)

        // ตัวเลขบนปุ่มในกริดต้องตรงกับตัวเลขบนแถบล่าง (เทียบเฉพาะ < 10 เพราะแถบล่างย่อเป็น 9+)
        for (const [key, label] of [['complaints', 'คำร้อง'], ['inbox', 'คำขอบริการ']]) {
          const tile = m.tiles.find(t => t.key === key)
          const bottom = await tabBadge(label)
          if (tile && bottom && Number(tile.badge) < 10) assert.equal(tile.badge, bottom, `เจ้าหน้าที่ ${width}px: ตัวเลข ${key} ในกริด (${tile.badge}) ไม่ตรงแถบล่าง (${bottom})`)
        }

        // กดปุ่มในกริดแล้วเปิดโมดูล: โมดูลที่มีปุ่มบนแถบล่าง → ปุ่มนั้นไฮไลต์ · โมดูลที่ไม่มี (รายงาน) → "เมนู" ไฮไลต์
        const complaints = page.locator('[data-menu-tile="complaints"]')
        if (await complaints.count()) {
          await complaints.click()
          await page.getByRole('heading', { name: 'คำร้อง', exact: true }).first().waitFor({ timeout: 20_000 })
          assert.deepEqual(await activeTabs(), ['คำร้อง'], `เจ้าหน้าที่ ${width}px: เปิดคำร้องแล้วแถบล่างต้องไฮไลต์ "คำร้อง"`)
          await page.locator('nav.fixed button').last().click()
          await page.waitForSelector('[data-menu-group]', { timeout: 20_000 })
        }
        const report = page.locator('[data-menu-tile="report"]')
        if (await report.count()) {
          await report.click()
          await page.getByRole('heading', { name: 'รายงาน', exact: true }).first().waitFor({ timeout: 20_000 })
          assert.deepEqual(await activeTabs(), ['เมนู'], `เจ้าหน้าที่ ${width}px: เปิดรายงานแล้วแถบล่างต้องไฮไลต์ "เมนู" (รายงานไม่มีปุ่มของตัวเองบนแถบ)`)
        }
        console.log(`PASS  เจ้าหน้าที่ ${width}px — ${m.groups.length} กลุ่ม ${m.tiles.length} ปุ่ม · ${m.columns} คอลัมน์ · แถบล่าง ${bar.length} ปุ่ม`)
      } catch (error) {
        failed += 1
        console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  เจ้าหน้าที่ ${width}px — ${error.message.split('\n')[0]}`)
      }
    }
  } finally {
    await context.close().catch(() => {})
  }
  return failed
}

async function main() {
  const baseUrl = resolveBaseUrl()
  await mkdir(SHOT_DIR, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })
  let failed = 0
  try {
    failed += await checkCitizen(browser, baseUrl)
    failed += await checkCitizen(browser, baseUrl, { kledkaew: true })
  } finally {
    await browser.close().catch(() => {})
  }
  failed += await checkStaff(baseUrl)
  const total = CITIZEN_WIDTHS.length * 2 + STAFF_WIDTHS.length
  console.log(`\n${total - failed}/${total} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${error.message.split('\n')[0]}`)
  process.exit(2)
})
