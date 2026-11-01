// หน้านโยบายความเป็นส่วนตัว /privacy — ใช้ App/Router/contexts จริง แต่ Supabase เป็น fixture ทั้งหมด ไม่แตะ DB จริง
// รันด้วย: node tests/privacy-policy.playwright.mjs (แพทเทิร์นเดียวกับ tests/account-delete.playwright.mjs)
// PP_SHOTS=<โฟลเดอร์> เก็บภาพเต็มหน้าไว้ตรวจหน้าตา
//
// ตรวจสิ่งที่เทสต์เนื้อหา (tests/privacy-policy.test.mjs) มองไม่เห็น: หน้าวาดครบทุกหัวข้อด้วยข้อมูลหน่วยงานจริง,
// ลิงก์โทร/อีเมลกดได้, ลิงก์ /privacy#retention เลื่อนถึงหัวข้อแม้หน้าโหลดแบบ lazy, สารบัญเลื่อนได้,
// และทุกทางเข้าที่สโตร์ต้องการ (เมนูเพิ่มเติม, หน้าสมัคร, หน้าลบบัญชี) ลิงก์มาที่หน้านี้จริง
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const server = await createServer({
  root: process.cwd(), cacheDir: path.join(tmpdir(), 'smartlocal-privacy-policy-vite', path.basename(process.cwd())),
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'), 'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'), 'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const mid = '00000000-0000-4000-8000-000000000002'
const TENANT = {
  id: mid, slug: 'demo', name: 'TEST เทศบาลตำบลทดสอบ', org_type: 'เทศบาลตำบล', ui_style: 'eco_friendly', theme_color: '#0f766e',
  enabled_modules: null, logo_url: null, phone: '053-000000, 053-111111', email: 'saraban@example.go.th',
  address: '99 หมู่ 1 ตำบลทดสอบ อำเภอทดสอบ จังหวัดแพร่ 54000', developer_name: 'TEST ผู้พัฒนาระบบ', system_name: 'TEST ระบบบริการประชาชน',
}
let passed = 0

async function fixture() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      let data = []
      if (url.pathname.includes('/rest/v1/municipalities')) data = TENANT
      else if (req.headers().accept?.includes('object+json')) data = null
      return route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  return { context, page, errors }
}

async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }
async function shot(page, name) {
  if (!process.env.PP_SHOTS) return
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(process.env.PP_SHOTS, `${name}.png`), fullPage: true })
}
// หัวข้อต้องเลื่อนมาอยู่ช่วงบนของจอ (ไม่จมใต้หัวเว็บและไม่ค้างอยู่ด้านล่าง)
async function sectionInView(page, id) {
  await page.waitForFunction((sid) => {
    const r = document.getElementById(sid)?.getBoundingClientRect()
    return r && r.top >= -2 && r.top < innerHeight * 0.5
  }, id, { timeout: 10000 })
}

try {
  await check('/privacy วาดครบ 10 หัวข้อด้วยข้อมูลหน่วยงาน ลิงก์โทร/อีเมลกดได้ ไม่ล้นจอ 390px', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(base + '/privacy')
    await page.locator('[data-privacy-page]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-privacy-section]').count(), 10)
    assert.ok(await page.getByText('TEST เทศบาลตำบลทดสอบ เป็นผู้ควบคุมข้อมูลส่วนบุคคล').isVisible())
    assert.match(await page.locator('[data-privacy-version]').textContent(), /รุ่น 1\.0 · มีผลตั้งแต่วันที่/)
    assert.equal(await page.locator('a[href="tel:053000000"]').count(), 2, 'เบอร์แรกในหัวข้อผู้ควบคุมและช่องทางติดต่อ')
    assert.equal(await page.locator('a[href="mailto:saraban@example.go.th"]').count(), 2)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'ล้นแนวนอนที่ 390px')
    await shot(page, 'privacy')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('ลิงก์ตรงหัวข้อ /privacy#retention เลื่อนถึงหัวข้อแม้หน้าโหลดแบบ lazy', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(base + '/privacy#retention')
    await page.locator('[data-privacy-section="retention"]').waitFor({ timeout: 30000 })
    await sectionInView(page, 'retention')
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('สารบัญกดแล้วเลื่อนไปหัวข้อ และปุ่มในหัวข้อสิทธิพาไปหน้าลบบัญชี', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(base + '/privacy')
    await page.locator('[data-privacy-page]').waitFor({ timeout: 30000 })
    await page.locator('nav[aria-label="หัวข้อในนโยบาย"] a[href="#rights"]').click()
    await sectionInView(page, 'rights')
    await page.locator('[data-privacy-section="rights"] a[href="/account/delete"]').click()
    await page.waitForURL(/\/account\/delete$/)
    await page.locator('[data-account-delete-state="signed-out"]').waitFor({ timeout: 30000 })
    assert.deepEqual(errors, [])
    await context.close()
  })

  await check('ทุกทางเข้าลิงก์มาที่นโยบาย: เมนูเพิ่มเติม / หน้าสมัคร (แท็บใหม่) / หน้าลบบัญชี → #retention', async () => {
    const { context, page, errors } = await fixture()
    await page.goto(base + '/more')
    await page.locator('a[href="/privacy"]').first().waitFor({ timeout: 30000 })

    await page.goto(base + '/auth?mode=register')
    const authLink = page.locator('[data-auth-privacy-link] a[href="/privacy"]')
    await authLink.waitFor({ timeout: 30000 })
    assert.equal(await authLink.getAttribute('target'), '_blank', 'ต้องเปิดแท็บใหม่ ฟอร์มที่กรอกค้างจะได้ไม่หาย')
    await page.goto(base + '/auth')
    await page.locator('form').first().waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-auth-privacy-link]').count(), 0, 'หน้าเข้าสู่ระบบไม่ต้องแสดง')

    await page.goto(base + '/account/delete')
    const deleteLink = page.locator('[data-account-delete-privacy-link]').first()
    await deleteLink.waitFor({ timeout: 30000 })
    await deleteLink.click()
    await page.waitForURL(/\/privacy#retention$/)
    await sectionInView(page, 'retention')
    assert.deepEqual(errors, [])
    await context.close()
  })
} finally {
  await browser.close()
  await server.close()
}

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
