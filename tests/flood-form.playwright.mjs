// E2E: ฟอร์มแจ้งเรื่องหมวด "น้ำท่วม/ระบายน้ำ" (flood) ต้องมีข้อความเหตุฉุกเฉิน + ลิงก์สายด่วน (src/pages/CitizenForm.jsx · เจ้าของระบบสั่งเพิ่มหมวดมาตรฐาน 2569-10-24)
// อ่านอย่างเดียว: ไม่กดส่งฟอร์ม · ตารางหมวดคำร้องถูกจำลองในเบราว์เซอร์ (production ยังไม่มีหมวด flood จนกว่าจะ apply migration) ที่เหลืออ่านจาก dev server (tenant demo)
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม:
//   VITE_TENANT_SLUG=demo npm run dev -- --port 5174
//   node tests/flood-form.playwright.mjs            (http://localhost:5174)
import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'

const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const base = (process.env.FLOOD_TEST_BASE_URL || 'http://localhost:5174').replace(/\/$/, '')
if (!ALLOWED_HOSTS.has(new URL(base).hostname)) throw new Error('ยิงได้เฉพาะ localhost หรือสนามซ้อม')
const MIN_TAP = 44

const categories = (extra = []) => [
  { value: 'light', label: 'ไฟฟ้าสาธารณะ', emoji: '💡', color: '#FEF3C7', text_color: '#D97706', sort_order: 0, is_active: true, submit_audience: 'public', is_adhoc: false },
  { value: 'flood', label: 'น้ำท่วม/ระบายน้ำ', emoji: '🌊', color: '#E0F2FE', text_color: '#0369A1', sort_order: 1, is_active: true, submit_audience: 'public', is_adhoc: false },
  ...extra,
]

const results = []
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`)
  }
}

async function open(browser, query, { width = 390, rows = categories() } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'th-TH' })
  const page = await context.newPage()
  const problems = []
  const writes = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`) })
  page.on('request', request => { if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && !/\/rpc\/(get_|record_)|cdn-cgi|\/auth\//.test(request.url())) writes.push(`${request.method()} ${request.url().slice(0, 120)}`) })
  await page.route('**/rest/v1/complaint_categories*', route => route.fulfill({ json: rows }))
  await page.goto(`${base}/request${query}`, { waitUntil: 'domcontentloaded' })
  await page.locator('form').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(1200)
  return { context, page, problems, writes }
}

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })
try {
  await check('หมวด flood: ฟอร์มขึ้นข้อความ "ติดต่อสายด่วนก่อน" + ลิงก์ /emergency (ไม่ฝังเบอร์) · ไม่ใช่ช่องทางช่วยเหลือเร่งด่วน · เป้ากด ≥ 44px', async () => {
    const { context, page, problems, writes } = await open(browser, '?category=flood')
    try {
      const notice = page.locator('[data-flood-notice]')
      await notice.waitFor({ state: 'visible', timeout: 10_000 })
      const text = await notice.innerText()
      assert.ok(text.includes('ให้ติดต่อสายด่วนก่อน') && text.includes('ไม่ใช่ช่องทางช่วยเหลือเร่งด่วน'), `ข้อความไม่ครบ: ${text}`)
      assert.ok(!/\b(191|1669|1784|199|1196)\b|tel:/.test(text + await notice.innerHTML()), 'ห้ามฝังเบอร์โทร')
      const link = notice.locator('a[href="/emergency"]')
      assert.equal(await link.count(), 1); assert.ok((await link.innerText()).includes('สายด่วนฉุกเฉิน'))
      assert.ok((await link.boundingBox()).height >= MIN_TAP, 'ลิงก์ต้องกดได้ ≥ 44px')
      assert.deepEqual(writes, [], 'ห้ามมีคำขอเขียน (ไม่ได้กดส่งฟอร์ม)'); assert.deepEqual(problems, [])
      await page.setViewportSize({ width: 390, height: 2000 })
      await notice.screenshot({ path: 'screenshots/flood-form-notice-390.png' })
    } finally { await context.close() }
  })
  await check('หมวดอื่น (light · water_supply · ไม่ใส่หมวด): ไม่ขึ้นข้อความน้ำท่วม', async () => {
    for (const query of ['?category=light', '?category=water_supply', '']) {
      const { context, page, problems } = await open(browser, query)
      try {
        assert.equal(await page.locator('[data-flood-notice]').count(), 0, `query "${query}": ต้องไม่มีข้อความน้ำท่วม`)
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    }
  })
  for (const width of [360, 390, 768, 1280]) {
    await check(`หมวด flood ${width}px: ไม่ล้นจอ`, async () => {
      const { context, page, problems } = await open(browser, '?category=flood', { width })
      try {
        await page.locator('[data-flood-notice]').waitFor({ state: 'visible', timeout: 10_000 })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        assert.ok(overflow <= 1, `ล้นแนวนอน ${overflow}px`); assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }
} finally {
  await browser.close()
}
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`)
process.exit(failed.length ? 1 : 0)
