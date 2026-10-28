// E2E: ค่าที่เครื่องเก็บไว้ตอนระบบดึงค่าน้ำไม่สำเร็จ + ปุ่มเรดาร์ฝน (หน้า /water-situation)
// อ่านอย่างเดียว ไม่เขียนข้อมูลใด · RPC ค่าสถานี (get_public_water_situation) และ /api/hydro-hourly ถูกจำลองในเบราว์เซอร์
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม:
//   VITE_TENANT_SLUG=demo npx vite --port 5177
//   WC_TEST_BASE_URL=http://localhost:5177 node tests/water-cache.playwright.mjs
// WC_ONLY="คำ1|คำ2" รันเฉพาะข้อที่ชื่อมีคำใดคำหนึ่ง (ไว้ทำ red-check)
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const BASE = (process.env.WC_TEST_BASE_URL || 'http://localhost:5177').replace(/\/$/, '')
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
if (!ALLOWED_HOSTS.has(new URL(BASE).hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${new URL(BASE).hostname}`)
const SHOT_DIR = process.env.WC_SHOT_DIR || path.join(process.cwd(), 'screenshots', 'water-cache')
const HOUR = 3_600_000
const hoursAgo = hours => new Date(Date.now() - hours * HOUR).toISOString()
await mkdir(SHOT_DIR, { recursive: true })

const rainStation = (name, mm, extra = {}) => ({
  station_type: 'rain', station_code: `STN-${name}`, station_name: name, tambon_name: 'ทดสอบ', amphoe_name: 'ทดสอบ', province_name: 'แพร่',
  river_name: null, agency_name: 'สสน.', latitude: 18.25, longitude: 100.34, distance_km: 2.6, is_primary: false, note: null,
  recorded_at: hoursAgo(0.5), rain_24h_mm: mm, rain_1h_mm: 0, waterlevel_msl: null, bank_diff_m: null, storage_percent: null,
  situation_level: null, situation_text: null, situation_color: null, dam_storage_mcm: null, dam_capacity_mcm: null,
  dam_inflow_mcm: null, dam_released_mcm: null, prev_recorded_at: null, prev_waterlevel_msl: null, prev_dam_storage_mcm: null,
  dam_same_count: null, dam_same_since: null, dam_same_capped: null, ...extra,
})
const situation = (syncedHoursAgo, stations) => ({ synced_at: hoursAgo(syncedHoursAgo), stations, warnings: [] })
const hydroReport = () => ({
  station: 'Y.20', fetchedAt: hoursAgo(0.3), refreshFailed: false,
  points: Array.from({ length: 30 }, (_, i) => ({ at: Date.now() - (29 - i) * HOUR - 0.3 * HOUR, level: 1.2 + Math.sin(i / 4) * 0.2, discharge: 5 })),
})

async function open(browser, { width = 390, height = 900, init = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH' })
  const page = await context.newPage()
  const problems = []
  const writes = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`) })
  page.on('request', request => { if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`) })
  if (init) await page.addInitScript(init)
  await page.route('**/api/small-reservoir*', route => route.fulfill({ status: 503, json: { error: 'RESERVOIR_UNAVAILABLE' } }))
  await page.route('**/rest/v1/complaint_categories*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/rpc/get_public_dam_history', route => route.fulfill({ json: { days: 30, radius_km: 10, dams: [] } }))
  return { context, page, problems, writes }
}
const rpcOk = (page, body, delayMs = 0) => page.route('**/rest/v1/rpc/get_public_water_situation', async route => { if (delayMs) await new Promise(r => setTimeout(r, delayMs)); await route.fulfill({ json: body }) })
const rpcDown = page => page.route('**/rest/v1/rpc/get_public_water_situation', route => route.abort())
const unrouteRpc = page => page.unroute('**/rest/v1/rpc/get_public_water_situation')
const hydroDown = page => page.route('**/api/hydro-hourly*', route => route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } }))
const hydroOk = page => page.route('**/api/hydro-hourly*', route => route.fulfill({ json: hydroReport() }))
const goto = async (page, wait = '#water-panel-situation') => {
  await page.goto(`${BASE}/water-situation`, { waitUntil: 'domcontentloaded' })
  await page.locator(wait).waitFor({ state: 'attached', timeout: 30_000 })
}
const panelText = page => page.locator('#water-panel-situation').innerText()
const fromCacheBanner = page => page.locator('[data-water-from-cache]')

const results = []
const ONLY = (process.env.WC_ONLY ?? '').split('|').filter(Boolean)
async function check(name, run) {
  if (ONLY.length > 0 && !ONLY.some(part => name.includes(part))) return
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`)
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await check('1 ระบบตอบได้: ไม่มีป้ายแคช และเก็บค่าไว้ในเครื่อง', async () => {
    const { context, page, problems, writes } = await open(browser)
    try {
      await hydroDown(page)
      await rpcOk(page, situation(0.5, [rainStation('บ้านสด', 3)]))
      await goto(page)
      await page.getByText('บ้านสด').first().waitFor({ timeout: 20_000 })
      assert.equal(await fromCacheBanner(page).count(), 0)
      const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sl_water_situation_v1:')))
      assert.equal(stored.length, 1, 'ต้องเก็บแคชค่าสถานีไว้ 1 แถว')
      assert.deepEqual(problems, []); assert.deepEqual(writes, [])
    } finally { await context.close() }
  })

  await check('2 เคยได้ค่าแล้ว ระบบล่ม → แสดงค่าเดิมพร้อมป้ายบอกชัด ไม่ใช่หน้าว่าง', async () => {
    const { context, page, problems } = await open(browser)
    try {
      await hydroDown(page)
      await rpcOk(page, situation(0.5, [rainStation('บ้านสด', 3)]))
      await goto(page)
      await page.getByText('บ้านสด').first().waitFor({ timeout: 20_000 })
      await unrouteRpc(page)
      await rpcDown(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await fromCacheBanner(page).waitFor({ timeout: 30_000 })
      const banner = await fromCacheBanner(page).innerText()
      assert.match(banner, /ยังเชื่อมต่อระบบไม่ได้/)
      assert.match(banner, /ที่เครื่องนี้เก็บไว้/)
      assert.match(banner, /ข้อมูลเมื่อ/)
      assert.match(banner, /อาจต่างจากที่เห็น/)
      assert.match(await panelText(page), /บ้านสด/, 'ต้องเห็นสถานีจากแคช')
      assert.equal(await page.getByText('โหลดข้อมูลสถานการณ์น้ำไม่สำเร็จ').count(), 0)
      assert.deepEqual(problems, [])
      await page.screenshot({ path: path.join(SHOT_DIR, 'from-cache-390.png') })
    } finally { await context.close() }
  })

  await check('3 ยังไม่เคยได้ค่า ระบบล่ม → ข้อความเดิม ไม่มีป้ายแคช', async () => {
    const { context, page } = await open(browser)
    try {
      await hydroDown(page)
      await rpcDown(page)
      await goto(page)
      await page.getByText('โหลดข้อมูลสถานการณ์น้ำไม่สำเร็จ').waitFor({ timeout: 30_000 })
      assert.equal(await fromCacheBanner(page).count(), 0)
    } finally { await context.close() }
  })

  await check('4 แคชเก่ากว่า 24 ชม. (ตามเวลาข้อมูล) ไม่ถูกนำมาใช้', async () => {
    const old = situation(30, [rainStation('บ้านเก่า', 90)])
    const { context, page } = await open(browser)
    try {
      await hydroDown(page)
      // ยัดแคชเก่าไว้ก่อนโหลดหน้า: ต้องรู้ tenant id จริง — ใช้ตอนหน้าเรียก RPC (อ่าน _municipality_id จากคำขอ) แล้วค่อยวางแคช
      let tenantId = null
      await page.route('**/rest/v1/rpc/get_public_water_situation', async route => {
        tenantId = JSON.parse(route.request().postData() || '{}')._municipality_id
        await route.abort()
      })
      await goto(page)
      await page.getByText('โหลดข้อมูลสถานการณ์น้ำไม่สำเร็จ').waitFor({ timeout: 30_000 })
      assert.ok(tenantId, 'ต้องจับ tenant id จากคำขอได้')
      await page.evaluate(([id, data]) => localStorage.setItem(`sl_water_situation_v1:${id}`, JSON.stringify({ v: 1, id, savedAt: Date.now(), dataAt: Date.parse(data.synced_at), value: data })), [tenantId, old])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByText('โหลดข้อมูลสถานการณ์น้ำไม่สำเร็จ').waitFor({ timeout: 30_000 })
      assert.equal(await fromCacheBanner(page).count(), 0)
      assert.equal(await page.getByText('บ้านเก่า').count(), 0, 'ห้ามแสดงสถานีจากแคชที่หมดอายุ')
    } finally { await context.close() }
  })

  await check('5 ระหว่างรอระบบตอบ ไม่เอาค่าเก่าขึ้นจอ (ไม่วาบ) แล้วค่าจริงมาแทน ป้ายหาย', async () => {
    const { context, page, problems } = await open(browser)
    try {
      await hydroDown(page)
      await rpcOk(page, situation(0.5, [rainStation('บ้านเดิมในแคช', 1)]))
      await goto(page)
      await page.getByText('บ้านเดิมในแคช').first().waitFor({ timeout: 20_000 })
      await unrouteRpc(page)
      await rpcOk(page, situation(0.2, [rainStation('บ้านค่าจริงใหม่', 4)]), 3500)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('#water-panel-situation').waitFor({ state: 'attached', timeout: 30_000 })
      // ช่วงที่ระบบยังไม่ตอบ (หน่วง 3.5 วินาที): ห้ามมีชื่อสถานีเก่าหรือป้ายแคชโผล่เลยสักครั้ง
      const seen = []
      for (let i = 0; i < 8; i++) {
        seen.push(await panelText(page))
        if (/บ้านค่าจริงใหม่/.test(seen.at(-1))) break
        await page.waitForTimeout(300)
      }
      const beforeLive = seen.filter(text => !/บ้านค่าจริงใหม่/.test(text))
      assert.ok(beforeLive.length >= 2, 'ต้องมีช่วงรอที่ตรวจได้')
      for (const text of beforeLive) assert.ok(!/บ้านเดิมในแคช/.test(text), 'ระหว่างรอ ห้ามแสดงค่าจากแคช')
      assert.equal(await fromCacheBanner(page).count(), 0)
      await page.getByText('บ้านค่าจริงใหม่').first().waitFor({ timeout: 20_000 })
      assert.equal(await page.getByText('บ้านเดิมในแคช').count(), 0)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('6 ปุ่ม "ลองใหม่" บนป้ายแคช: ระบบกลับมา → ค่าจริงแทนที่ ป้ายหาย', async () => {
    const { context, page } = await open(browser)
    try {
      await hydroDown(page)
      await rpcOk(page, situation(0.5, [rainStation('บ้านเดิมในแคช', 1)]))
      await goto(page)
      await page.getByText('บ้านเดิมในแคช').first().waitFor({ timeout: 20_000 })
      await unrouteRpc(page); await rpcDown(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await fromCacheBanner(page).waitFor({ timeout: 30_000 })
      const retry = fromCacheBanner(page).getByRole('button', { name: /ลองใหม่/ })
      assert.ok((await retry.boundingBox()).height >= 44, 'ปุ่มลองใหม่ต้องสูงอย่างน้อย 44px')
      await unrouteRpc(page)
      await rpcOk(page, situation(0.1, [rainStation('บ้านกลับมาแล้ว', 5)]))
      await retry.click()
      await page.getByText('บ้านกลับมาแล้ว').first().waitFor({ timeout: 20_000 })
      assert.equal(await fromCacheBanner(page).count(), 0)
      assert.equal(await page.getByText('บ้านเดิมในแคช').count(), 0)
    } finally { await context.close() }
  })

  await check('7 รายงานรายชั่วโมงจากแคช: ขึ้นพร้อมคำเตือน "อาจไม่เป็นปัจจุบัน" ไม่เทียบชั่วโมงก่อน', async () => {
    const { context, page, problems } = await open(browser)
    try {
      await rpcOk(page, situation(0.5, [rainStation('บ้านสด', 3)]))
      await hydroOk(page)
      await goto(page)
      await page.locator('.hydro-panel').waitFor({ timeout: 30_000 })
      await page.waitForFunction(() => /ระดับน้ำล่าสุด/.test(document.querySelector('.hydro-panel')?.innerText ?? '') && !/กำลัง/.test(document.querySelector('.hydro-empty')?.innerText ?? ''), null, { timeout: 20_000 })
      assert.equal(await page.locator('.hydro-warning').count(), 0, 'ระบบตอบได้ ต้องไม่มีคำเตือน')
      const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sl_water_hydro_v1:')))
      assert.equal(stored.length, 1, 'ต้องเก็บแคชรายงานรายชั่วโมงไว้')
      await page.unroute('**/api/hydro-hourly*'); await hydroDown(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.hydro-warning').waitFor({ timeout: 30_000 })
      const panel = await page.locator('.hydro-panel').innerText()
      assert.match(panel, /ข้อมูลอาจไม่เป็นปัจจุบัน/)
      assert.match(panel, /ระดับน้ำล่าสุดที่ได้รับ/)
      assert.match(panel, /ข้อมูลไม่พอเปรียบเทียบ/, 'ค่าจากแคชต้องไม่เทียบกับชั่วโมงก่อนหน้าเป็นตัวเลข')
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('8 localStorage ใช้ไม่ได้ (บล็อก/โหมดส่วนตัว) หน้ายังทำงานปกติ ไม่ error', async () => {
    const { context, page, problems } = await open(browser, {
      init: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError') } })`,
    })
    try {
      await hydroOk(page)
      await rpcOk(page, situation(0.5, [rainStation('บ้านสด', 3)]))
      await goto(page)
      await page.getByText('บ้านสด').first().waitFor({ timeout: 20_000 })
      await page.waitForFunction(() => /ระดับน้ำล่าสุด/.test(document.querySelector('.hydro-panel')?.innerText ?? ''), null, { timeout: 20_000 })
      await page.waitForTimeout(1500)
      assert.equal(await fromCacheBanner(page).count(), 0)
      // เก็บแคชไม่ได้ ต้องไม่ถูกตีเป็น "ดึงข้อมูลล้มเหลว" (เคยเสี่ยง: โยน error ในจังหวะเก็บแคช → เข้า .catch → ขึ้นคำเตือนผิด)
      assert.equal(await page.getByText('รอบล่าสุดโหลดไม่สำเร็จ').count(), 0, 'ดึงสำเร็จแล้ว แต่เก็บแคชไม่ได้ ห้ามขึ้นว่าโหลดไม่สำเร็จ')
      assert.equal(await page.locator('.hydro-warning').count(), 0, 'รายงานรายชั่วโมงดึงสำเร็จ ห้ามขึ้นคำเตือนข้อมูลไม่เป็นปัจจุบัน')
      assert.deepEqual(problems.filter(p => !/localStorage|SecurityError|blocked/.test(p)), [])
    } finally { await context.close() }
  })

  await check('10 ได้ค่าสดแล้ว รอบรีเฟรชถัดไปล้ม → คงค่าสดเดิม ไม่ใช่ป้ายแคช (แคชไม่ทับค่าสด)', async () => {
    const { context, page } = await open(browser)
    try {
      await hydroDown(page)
      await rpcOk(page, situation(0.2, [rainStation('บ้านค่าสด', 2)]))
      await goto(page)
      await page.getByText('บ้านค่าสด').first().waitFor({ timeout: 20_000 })
      await unrouteRpc(page); await rpcDown(page)
      // useVisibleRefresh ยิงรอบใหม่เมื่อแท็บกลับมาแสดงผล
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await page.getByText('รอบล่าสุดโหลดไม่สำเร็จ แสดงข้อมูลเดิม').waitFor({ timeout: 20_000 })
      assert.equal(await fromCacheBanner(page).count(), 0, 'เคยได้ค่าสดแล้ว ห้ามขึ้นป้ายแคช')
      assert.match(await panelText(page), /บ้านค่าสด/)
    } finally { await context.close() }
  })

  for (const width of [360, 390, 768, 1280]) {
    await check(`9 ปุ่มเรดาร์ฝน ${width}px: ลิงก์ทางการ แท็บใหม่ แตะได้ ไม่ล้นจอ`, async () => {
      const { context, page, problems } = await open(browser, { width })
      try {
        await hydroDown(page)
        await rpcOk(page, situation(0.5, [rainStation('บ้านสด', 3)]))
        await goto(page)
        const section = page.locator('[data-water-radar]')
        await section.waitFor({ timeout: 20_000 })
        const links = await section.locator('[data-radar-link]').evaluateAll(els => els.map(a => ({ href: a.href, target: a.target, rel: a.rel, h: a.getBoundingClientRect().height })))
        assert.deepEqual(links.map(l => l.href), ['https://www.thaiwater.net/weather/radar', 'https://weather.tmd.go.th/'])
        for (const l of links) { assert.equal(l.target, '_blank'); assert.match(l.rel, /noopener/); assert.ok(l.h >= 44, `ปุ่มสูง ${l.h}px ต้องไม่ต่ำกว่า 44`) }
        assert.match(await section.innerText(), /ไม่ใช่ประกาศเตือนภัย/)
        assert.equal(await page.locator('iframe').count(), 0, 'ห้ามฝังตัวเล่นเรดาร์')
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        assert.ok(overflow <= 1, `ล้นแนวนอน ${overflow}px`)
        if (width === 390 || width === 1280) { await section.scrollIntoViewIfNeeded(); await section.screenshot({ path: path.join(SHOT_DIR, `radar-${width}.png`) }) }
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }
} finally {
  await browser.close()
}

if (results.length === 0) { console.log('FAIL  ไม่มีข้อทดสอบรันเลย (ตัวกรอง WC_ONLY ผิด?)'); process.exit(1) }
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`)
process.exit(failed.length ? 1 : 0)
