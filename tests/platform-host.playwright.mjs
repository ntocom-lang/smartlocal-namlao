// โดเมนกลางของแอปจากสโตร์ (app.rk-networks.com) — ใช้ App/Router/contexts จริง แต่ Supabase เป็น fixture ทั้งหมด ไม่แตะ DB จริง
// รันด้วย: node tests/platform-host.playwright.mjs · PH_SHOTS=<โฟลเดอร์> เก็บภาพเต็มหน้าไว้ตรวจหน้าตา
//
// แอปตัดสินทุกอย่างจาก hostname (หน่วยงาน / โดเมนกลาง) จึงต้องเปิดด้วยชื่อโดเมนจริง: Chrome ถูกสั่งให้
// ชื่อ *.rk-networks.com วิ่งเข้าเครื่องนี้ (--host-resolver-rules) แล้วเปิดผ่าน http + พอร์ตของ vite
// ส่วนปลายทางที่แอปพาไป (https://<slug>.rk-networks.com/...) ถูกดักตอบเป็นหน้าเปล่า ไม่ออกเน็ตจริง
//
// ตรวจสิ่งที่เทสต์หน่วย (tests/platform.test.mjs) มองไม่เห็น: เลือกแล้วจำจริงในเบราว์เซอร์, เปิดครั้งต่อไปพาไปเอง,
// ?change=1 ไม่พาไป, ความจำที่ใช้ไม่ได้ถูกลืม, หน้ากลาง 3 หน้าวาดครบบนโดเมนกลาง (ไม่ใช่ "ไม่พบหน่วยงาน privacy"),
// www ทำงานแบบเดิม และเว็บ อปท. ที่เข้ามาทางแอปเห็นเมนูเปลี่ยนหน่วยงาน (ทั้งสองธีม) ส่วนคนเปิดเว็บปกติไม่เห็น
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { PLATFORM_APP_NAME } from '../src/lib/platform.js'

process.env.SKIP_SYNC_CHECK = '1'
const server = await createServer({
  root: process.cwd(), cacheDir: path.join(tmpdir(), 'smartlocal-platform-host-vite', path.basename(process.cwd())),
  // ไม่ปักหมุดหน่วยงาน — ทุกหน้าในเทสต์นี้ตัดสินจาก hostname เหมือนของจริง
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'), 'import.meta.env.VITE_TENANT_SLUG': JSON.stringify(''), 'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 0, hmr: false, allowedHosts: true },
})
await server.listen()
const port = server.httpServer.address().port
const APP = `http://app.rk-networks.com:${port}`
const WWW = `http://www.rk-networks.com:${port}`
const DEMO_SITE = `http://demo.rk-networks.com:${port}`
const LOCAL_ORIGINS = new Set([APP, WWW, DEMO_SITE])
// เมนู "ดาวน์โหลดแอป ท้องถิ่นของเรา" บนเว็บ อปท. → หน้า /download ของโดเมนกลาง (เห็นเฉพาะคนที่ยังไม่ได้ใช้ผ่านแอป)
const DOWNLOAD_LINK = 'a[href="https://app.rk-networks.com/download"]'
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--host-resolver-rules=MAP *.rk-networks.com 127.0.0.1'] })

const LIST = [
  { slug: 'thungkaew', name: 'TEST อบต.ข', org_type: 'อบต.', province: 'แพร่', district: 'หนองม่วงไข่', logo_url: null, phone: '054-000001', email: null, address: null },
  { slug: 'namlao', name: 'TEST เทศบาลตำบลก', org_type: 'เทศบาลตำบล', province: 'แพร่', district: 'ร้องกวาง', logo_url: null, phone: '054-000002, 054-000003', email: 'saraban@example.go.th', address: '1 หมู่ 1 ตำบลทดสอบ' },
  { slug: 'demo', name: 'TEST เทศบาลตำบลสาธิต', org_type: 'เทศบาลตำบล', province: 'แพร่', district: 'เมืองแพร่', logo_url: null, phone: '054-000000', email: 'demo@example.go.th', address: 'ที่อยู่สาธิต' },
]
const demoTenant = (uiStyle) => ({
  id: '00000000-0000-4000-8000-000000000002', slug: 'demo', name: 'TEST เทศบาลตำบลสาธิต', org_type: 'เทศบาลตำบล', ui_style: uiStyle,
  theme_color: '#0f766e', enabled_modules: null, logo_url: null, phone: '054-000000', email: 'demo@example.go.th', address: 'ที่อยู่สาธิต', system_name: 'TEST ระบบ',
})
let passed = 0

async function fixture({ uiStyle = 'eco_friendly', listFails = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true })
  const listCalls = { count: 0 }
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      let data = req.headers().accept?.includes('object+json') ? null : []
      if (url.pathname.includes('/rest/v1/municipalities')) {
        if (url.searchParams.get('slug')) data = demoTenant(uiStyle)
        else {
          listCalls.count++
          if (listFails) return route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ message: 'fixture down' }) })
          data = LIST
        }
      }
      return route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (LOCAL_ORIGINS.has(url.origin)) return route.continue()
    // ปลายทางที่แอปพาไป (เว็บ อปท. จริงเป็น https) — ตอบหน้าเปล่าแทน ไม่ออกเน็ต
    if (url.protocol === 'https:' && url.hostname.endsWith('.rk-networks.com')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>stub</title><body data-stub="${url.hostname}">stub</body>` })
    }
    return route.abort()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  return { context, page, errors, listCalls }
}

async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }
async function shot(page, name) {
  if (!process.env.PH_SHOTS) return
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(process.env.PH_SHOTS, `${name}.png`), fullPage: true })
}
async function noHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'ล้นแนวนอนที่ 390px')
}
const appStorage = async (context) => {
  const state = await context.storageState()
  return Object.fromEntries((state.origins.find(o => o.origin === APP)?.localStorage ?? []).map(i => [i.name, i.value]))
}

try {
  await check('โดเมนกลางเปิดครั้งแรก: รายชื่อจริง 2 แห่ง + สาธิตท้ายรายการพร้อมป้าย + ลิงก์หน้ากลาง ไม่ล้นจอ', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(APP + '/')
    await page.locator('[data-tenant-picker="app"] [data-tenant-option]').first().waitFor({ timeout: 30000 })
    const options = await page.locator('[data-tenant-option]').evaluateAll(els => els.map(a => [a.dataset.tenantOption, a.getAttribute('href')]))
    assert.deepEqual(options, [
      ['namlao', 'https://namlao.rk-networks.com/?via=app'],
      ['thungkaew', 'https://thungkaew.rk-networks.com/?via=app'],
      ['demo', 'https://demo.rk-networks.com/?via=app'],
    ], 'เรียงตามชื่อ สาธิตอยู่ท้ายสุดในกลุ่มแยก')
    assert.ok(await page.getByText('ทดลองใช้ — เรื่องที่แจ้งไม่ถึงหน่วยงานจริง').isVisible())
    for (const to of ['/download', '/privacy', '/account/delete', '/support']) {
      assert.equal(await page.locator(`nav[aria-label="ข้อมูลของแอป"] a[href="${to}"]`).count(), 1, to)
    }
    await noHorizontalOverflow(page)
    await shot(page, 'picker-app')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('เลือกแล้วจำไว้ · เปิดครั้งต่อไปพาเข้าหน่วยงานเอง · ?change=1 ไม่พาไป', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(APP + '/')
    await page.locator('[data-tenant-option="namlao"]').click()
    await page.waitForURL('https://namlao.rk-networks.com/?via=app')
    assert.equal((await appStorage(context)).sl_app_tenant, 'namlao')

    await page.goto(APP + '/')
    await page.waitForURL('https://namlao.rk-networks.com/?via=app', { timeout: 30000 })

    await page.goto(APP + '/?change=1')
    await page.locator('[data-tenant-option="thungkaew"]').waitFor({ timeout: 30000 })
    await page.waitForTimeout(500)
    assert.ok(page.url().startsWith(APP), 'ขอเลือกใหม่ต้องไม่ถูกพาไป')
    await page.locator('[data-tenant-option="thungkaew"]').click()
    await page.waitForURL('https://thungkaew.rk-networks.com/?via=app')
    assert.equal((await appStorage(context)).sl_app_tenant, 'thungkaew', 'จำอันใหม่แทน')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('หน่วยงานที่จำไว้ถูกปิดใช้แล้ว: ไม่พาไป แสดงรายชื่อ และลืมความจำนั้น', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(APP + '/support')
    await page.locator('[data-platform-page]').waitFor({ timeout: 30000 })
    await page.evaluate(() => localStorage.setItem('sl_app_tenant', 'closed-tenant'))
    await page.goto(APP + '/')
    await page.locator('[data-tenant-option="namlao"]').waitFor({ timeout: 30000 })
    assert.ok(page.url().startsWith(APP))
    assert.equal((await appStorage(context)).sl_app_tenant, undefined)
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('/privacy บนโดเมนกลาง = นโยบายฉบับรวม (ไม่ใช่ "ไม่พบหน่วยงานรหัส privacy") ลิงก์นโยบายของทุก อปท.', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(APP + '/privacy')
    await page.locator('[data-privacy-page] [data-org]').first().waitFor({ timeout: 30000 })
    assert.equal(await page.getByText('ไม่พบหน่วยงานรหัส').count(), 0)
    assert.equal(await page.locator('[data-privacy-section]').count(), 10)
    assert.ok((await page.locator('[data-privacy-page]').textContent()).includes(`แอป ${PLATFORM_APP_NAME} เป็นช่องทางบริการประชาชนออนไลน์`))
    const orgLinks = await page.locator('[data-privacy-section="controller"] [data-org-link]').evaluateAll(els => els.map(a => a.getAttribute('href')))
    assert.deepEqual(orgLinks.sort(), ['https://namlao.rk-networks.com/privacy', 'https://thungkaew.rk-networks.com/privacy'], 'ไม่มีสาธิต')
    assert.equal(await page.locator('a[href="tel:054000002"]').count(), 1, 'เบอร์แรกของหน่วยงานที่กรอกหลายเบอร์')
    assert.match(await page.locator('[data-privacy-version]').textContent(), /รุ่น 1\.0/)
    await noHorizontalOverflow(page)
    await shot(page, 'platform-privacy')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('/account/delete บนโดเมนกลาง: ขั้นตอน + ลิงก์หน้าลบของทุก อปท. + ลิงก์ระยะเก็บพาไป #retention', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(APP + '/account/delete')
    await page.locator('[data-platform-page] [data-org]').first().waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-platform-section="steps"] ol > li').count(), 3)
    const links = await page.locator('[data-platform-section="steps"] [data-org-link]').evaluateAll(els => els.map(a => a.getAttribute('href')))
    assert.deepEqual(links.sort(), ['https://namlao.rk-networks.com/account/delete', 'https://thungkaew.rk-networks.com/account/delete'])
    await noHorizontalOverflow(page)
    await shot(page, 'platform-account-delete')
    await page.locator('[data-platform-section="kept"] a[href="/privacy#retention"]').click()
    await page.waitForURL(APP + '/privacy#retention')
    await page.waitForFunction(() => {
      const r = document.getElementById('retention')?.getBoundingClientRect()
      return r && r.top >= -2 && r.top < innerHeight * 0.5
    }, null, { timeout: 15000 })
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('/support บนโดเมนกลาง: ช่องทางติดต่อทุก อปท. กดโทรได้ + ลิงก์หน้า /contact ของแต่ละแห่ง', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(APP + '/support')
    await page.locator('[data-platform-page] [data-org]').first().waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-platform-section="contacts"] a[href="tel:054000001"]').count(), 1)
    assert.equal(await page.locator('[data-platform-section="contacts"] a[href="mailto:saraban@example.go.th"]').count(), 1)
    const links = await page.locator('[data-org-link]').evaluateAll(els => els.map(a => a.getAttribute('href')))
    assert.deepEqual(links.sort(), ['https://namlao.rk-networks.com/contact', 'https://thungkaew.rk-networks.com/contact'])
    await noHorizontalOverflow(page)
    await shot(page, 'platform-support')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('/download บนโดเมนกลาง: ปุ่มโหลด APK + QR + วิธีของ iPhone · ไม่ยิงฐานข้อมูลรายชื่อหน่วยงาน · ไม่ล้นจอ', async () => {
    const { context, page, errors, listCalls } = await fixture()
    await page.goto(APP + '/download')
    await page.locator('[data-platform-page] [data-download-link]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-download-link]').getAttribute('href'), '/downloads/thongthin-khong-rao.apk')
    assert.equal(await page.locator('[data-download-link]').getAttribute('download'), '')
    assert.ok((await page.locator('[data-platform-section="android"]').textContent()).includes('เวอร์ชัน 1.0.0'))
    assert.equal(await page.locator('[data-download-qr] svg path').count(), 1)
    assert.ok(await page.locator('[data-platform-section="iphone"]').getByText('เพิ่มไปยังหน้าจอโฮม').count() > 0)
    assert.ok(/SHA-256: [0-9a-f]{64}/.test(await page.locator('[data-download-details]').textContent()))
    assert.equal(await page.title(), 'ติดตั้งแอป ท้องถิ่นของเรา — ท้องถิ่นของเรา')
    assert.equal(listCalls.count, 0, 'หน้านี้ไม่ต้องใช้รายชื่อหน่วยงาน')
    // กรอบ "ขั้นต่อไป" ขึ้นเฉพาะหลังกดโหลด ไม่ขึ้นตอนเปิดหน้า
    assert.equal(await page.locator('[data-download-next]').count(), 0)
    await Promise.all([page.waitForEvent('download'), page.locator('[data-download-link]').click()])
    await page.locator('[data-download-next]').waitFor({ timeout: 5000 })
    assert.equal(await page.locator('[data-download-next] li').count(), 4)
    assert.ok((await page.locator('[data-download-next]').textContent()).includes('ติดตั้ง'))
    await noHorizontalOverflow(page)
    await shot(page, 'platform-download')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('รายชื่อโหลดไม่สำเร็จ: หน้าเลือกและหน้ากลางขึ้นปุ่มลองใหม่ ไม่ค้างหน้าโหลด', async () => {
    const { context, page, listCalls } = await fixture({ listFails: true })
    await page.goto(APP + '/')
    await page.getByText('โหลดรายชื่อหน่วยงานไม่สำเร็จ').waitFor({ timeout: 30000 })
    const before = listCalls.count
    await page.getByRole('button', { name: 'ลองใหม่' }).click()
    for (let i = 0; i < 100 && listCalls.count <= before; i++) await page.waitForTimeout(100)
    assert.ok(listCalls.count > before, 'กดลองใหม่แล้วต้องยิงขอใหม่')
    await page.getByText('โหลดรายชื่อหน่วยงานไม่สำเร็จ').waitFor({ timeout: 30000 })
    await page.goto(APP + '/account/delete')
    await page.locator('[data-platform-section="steps"]').getByText('โหลดรายชื่อหน่วยงานไม่สำเร็จ').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-platform-section="steps"] ol > li').count(), 3, 'ขั้นตอนยังอ่านได้แม้ไม่มีรายชื่อ')
    await context.close()
  })

  await check('www ทำงานแบบเดิม: ไม่มีสาธิต ไม่มี ?via=app ไม่จำ ไม่มีลิงก์หน้ากลางใต้รายชื่อ', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(WWW + '/')
    await page.locator('[data-tenant-picker="web"] [data-tenant-option]').first().waitFor({ timeout: 30000 })
    const options = await page.locator('[data-tenant-option]').evaluateAll(els => els.map(a => [a.dataset.tenantOption, a.getAttribute('href')]))
    assert.deepEqual(options, [['namlao', 'https://namlao.rk-networks.com/'], ['thungkaew', 'https://thungkaew.rk-networks.com/']])
    assert.equal(await page.locator('nav[aria-label="ข้อมูลของแอป"]').count(), 0)
    await page.locator('[data-tenant-option="namlao"]').click()
    await page.waitForURL('https://namlao.rk-networks.com/')
    const state = await context.storageState()
    assert.equal(state.origins.find(o => o.origin === WWW)?.localStorage?.some(i => i.name === 'sl_app_tenant') ?? false, false)
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('เว็บ อปท. ที่เข้ามาทางแอป: ลบ ?via=app ออกจาก URL และเมนูเพิ่มเติมมี "เปลี่ยนหน่วยงาน" (เปิดหน้าเดิม)', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(DEMO_SITE + '/?via=app')
    await page.waitForFunction(() => !location.search.includes('via='), null, { timeout: 30000 })
    await page.goto(DEMO_SITE + '/more')
    const link = page.locator('a[href="https://app.rk-networks.com/?change=1"]')
    await link.waitFor({ timeout: 30000 })
    assert.match(await link.textContent(), /เปลี่ยนหน่วยงาน/)
    assert.equal(await link.getAttribute('target'), null, 'ต้องเปิดในหน้าเดิม ไม่ใช่แท็บใหม่')
    assert.equal(await page.locator(DOWNLOAD_LINK).count(), 0, 'ใช้ผ่านแอปอยู่แล้ว ไม่ต้องชวนดาวน์โหลดแอป')
    await shot(page, 'more-switch-tenant')
    await link.click()
    await page.waitForURL('https://app.rk-networks.com/?change=1')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('เปิดเว็บ อปท. ตรงๆ (ไม่ผ่านแอป): ไม่มีเมนูเปลี่ยนหน่วยงาน · มีเมนู "ดาวน์โหลดแอป" ไปหน้า /download ของโดเมนกลาง', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(DEMO_SITE + '/more')
    await page.locator('a[href="/privacy"]').first().waitFor({ timeout: 30000 })
    assert.equal(await page.locator('a[href="https://app.rk-networks.com/?change=1"]').count(), 0)
    const download = page.locator(DOWNLOAD_LINK)
    assert.equal(await download.count(), 1)
    assert.match(await download.textContent(), /ดาวน์โหลดแอป ท้องถิ่นของเรา/)
    assert.equal(await download.getAttribute('target'), null, 'เปิดในหน้าเดิม')
    assert.equal(await page.locator('a[href*="app.rk-networks.com"]').count(), 1, 'ลิงก์โดเมนกลางมีแค่ดาวน์โหลดแอป')
    await download.scrollIntoViewIfNeeded()
    await shot(page, 'more-download')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('ธีม kledkaew (ตำหนักธรรม): เมนูมีนโยบายความเป็นส่วนตัว + เปลี่ยนหน่วยงานเมื่อเข้ามาทางแอป', async () => {
    const { context, page, errors } = await fixture({ uiStyle: 'kledkaew' })
    await page.goto(DEMO_SITE + '/more')
    await page.locator('a[href="/privacy"]').first().waitFor({ timeout: 30000 })
    assert.equal(await page.locator('a[href="https://app.rk-networks.com/?change=1"]').count(), 0, 'ยังไม่ผ่านแอป')
    assert.equal(await page.locator(DOWNLOAD_LINK).count(), 1, 'ยังไม่ผ่านแอป ต้องเห็นเมนูดาวน์โหลดแอป')
    await page.goto(DEMO_SITE + '/?via=app')
    await page.waitForFunction(() => !location.search.includes('via='), null, { timeout: 30000 })
    await page.goto(DEMO_SITE + '/more')
    const link = page.locator('a[href="https://app.rk-networks.com/?change=1"]')
    await link.waitFor({ timeout: 30000 })
    assert.equal(await link.getAttribute('target'), null)
    assert.equal(await page.locator(DOWNLOAD_LINK).count(), 0, 'ผ่านแอปแล้ว ไม่ต้องชวนดาวน์โหลดแอป')
    assert.deepEqual(errors, [])
    await context.close()
  })
} finally {
  await browser.close()
  await server.close()
}

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
