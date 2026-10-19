// E2E ฝั่งประชาชน: ประกาศน้ำ-ฝนของ อปท. ที่ผู้มีสิทธิ์ยืนยันแล้ว (เฟส 2 · PR 2.2) บนหน้าแรกและหน้า /water-situation
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม — RPC ทุกตัวที่เกี่ยวข้องถูกจำลองในเบราว์เซอร์ ไม่เขียนข้อมูลใด
//   VITE_TENANT_SLUG=demo npm run dev -- --port 5174
//   node tests/water-announcements-public.playwright.mjs            (http://localhost:5174)
//   WA_TEST_BASE_URL=http://127.0.0.1:5176 WA_SHOT_DIR=<โฟลเดอร์> node tests/water-announcements-public.playwright.mjs
//
// ตรวจ: ประกาศแทนแถบแจ้งเตือนดิบบนหน้าแรก (ไม่ซ้อนสองแถบ) · ไม่มีประกาศ = แถบดิบเหมือนเดิม · ครบอายุหายเองตามนาฬิกา
//   · เครื่องผู้ใช้ตั้งเวลาเพี้ยน (เร็ว 3 ชม./ช้า 3 ชม.) ก็แสดง/ซ่อนถูกเพราะใช้ server_now · RPC พัง = ไม่แสดง ไม่มีข้อความผิดพลาด
//   · หน้า /water-situation ขึ้นการ์ดบนสุดโดยแถบดิบของหน้ายังอยู่ · ไม่ล้นจอ 360/390/768/1280 · เป้ากด ≥ 44px · ไม่มีช่องกรอก/ปุ่มตัดสิน
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_BASE_URL = 'http://localhost:5174'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const SHOT_DIR = process.env.WA_SHOT_DIR || path.join(process.cwd(), 'screenshots', 'water-announcements')
const HOUR = 3_600_000
const MIN = 60_000
const MIN_TAP = 44
const WIDTHS = [360, 390, 768, 1280]

function resolveBaseUrl() {
  const raw = (process.env.WA_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${url.hostname}`)
  return raw
}

const BODY = [
  'ประกาศจาก เทศบาลตำบลสาธิต',
  'ข้อมูลสถานการณ์น้ำ-ฝน ณ 20 ต.ค. 2569 เวลา 10:00 น.',
  'ระบบเฝ้าระวังเปิดเหตุการณ์เมื่อ 20 ต.ค. 2569 เวลา 08:20 น. จากค่าที่วัดได้ใกล้พื้นที่ ค่าล่าสุดมีดังนี้',
  '• สถานีฝน บ้านบุญแจ่ม วัดฝนสะสม 24 ชั่วโมงได้ 95.5 มม. (วัดเมื่อ 20 ต.ค. 2569 เวลา 09:40 น.)',
  '• สถานีระดับน้ำ Y.38 ระดับน้ำต่ำกว่าตลิ่ง 40 ซม. (วัดเมื่อ 20 ต.ค. 2569 เวลา 09:50 น.)',
  'ค่าข้างต้นเป็นค่าที่สถานีวัดได้ ไม่ใช่การพยากรณ์ ขอให้ติดตามประกาศจาก เทศบาลตำบลสาธิต ต่อไป',
].join('\n')

const station = (type, code, name, extra) => ({
  station_type: type, station_code: code, station_name: name, tambon_name: 'สาธิต', amphoe_name: 'สาธิต', province_name: 'แพร่',
  river_name: null, agency_name: 'สสน.', latitude: 18.25, longitude: 100.34, distance_km: 2.6, is_primary: false, note: null,
  recorded_at: null, rain_24h_mm: null, rain_1h_mm: null, waterlevel_msl: null, bank_diff_m: null, storage_percent: null,
  situation_level: null, situation_text: null, situation_color: null, dam_storage_mcm: null, dam_capacity_mcm: null,
  dam_inflow_mcm: null, dam_released_mcm: null, prev_recorded_at: null, prev_waterlevel_msl: null, prev_dam_storage_mcm: null,
  dam_same_count: null, dam_same_since: null, dam_same_capped: null, ...extra,
})
// ฝนหนักมาก (≥ 90.1 มม.) ทำให้แถบแจ้งเตือนดิบขึ้น — ใช้พิสูจน์ว่าประกาศชนะ และหายแล้วแถบดิบกลับมา
const heavyRain = () => station('rain', 'STN0911', 'บ้านบุญแจ่ม', { recorded_at: new Date(Date.now() - 20 * MIN).toISOString(), rain_24h_mm: 95.5 })

const RAW_ALERT = 'แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่'
const announcement = (serverNow, expiresInMs, overrides = {}) => ({
  id: '00000000-0000-4000-8000-0000000000a1', body: BODY, issuer: 'เทศบาลตำบลสาธิต',
  published_at: new Date(serverNow - 2 * HOUR).toISOString(), expires_at: new Date(serverNow + expiresInMs).toISOString(),
  server_now: new Date(serverNow).toISOString(), ...overrides,
})

async function open(browser, baseUrl, { route, width = 390, height = 900, annResponse, clockTime = null }) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH' })
  const page = await context.newPage()
  const problems = []
  const writes = []
  const annCalls = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('request', request => {
    if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`)
  })
  if (clockTime !== null) await page.clock.install({ time: clockTime })
  await page.route('**/rest/v1/rpc/get_public_water_situation', r =>
    r.fulfill({ json: { synced_at: new Date(Date.now() - 12 * MIN).toISOString(), stations: [heavyRain()], warnings: [] } }))
  await page.route('**/rest/v1/rpc/get_public_dam_history', r => r.fulfill({ json: { days: 30, radius_km: 10, dams: [] } }))
  await page.route('**/api/small-reservoir*', r => r.fulfill({ status: 503, json: { error: 'RESERVOIR_UNAVAILABLE' } }))
  // บันทึกสถิติเข้าชม (เขียนฐานข้อมูลจริง) — ไม่ให้ทดสอบทำตัวเลขผู้เข้าชมเพี้ยน
  await page.route(/\/rest\/v1\/rpc\/(record_|log_|track_|get_site_open_summary)/, r => r.fulfill({ json: null }))
  await page.route('**/rest/v1/rpc/get_public_water_announcement', r => {
    annCalls.push(r.request().postData())
    const res = typeof annResponse === 'function' ? annResponse() : annResponse
    return res?.status ? r.fulfill({ status: res.status, json: res.body ?? {} }) : r.fulfill({ json: res ?? null })
  })
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
  return { context, page, problems, writes, annCalls }
}

async function audit(page, where) {
  const a = await page.evaluate(({ minTap }) => {
    const card = document.querySelector('[data-water-announcement]')
    const scope = card ?? document.body
    const fields = card ? card.querySelectorAll('input, textarea, select, form, [contenteditable]').length : 0
    const buttons = card ? card.querySelectorAll('button').length : 0
    const links = card ? [...card.querySelectorAll('a[href]')].map(l => ({ href: l.getAttribute('href'), h: Math.round(l.getBoundingClientRect().height) })) : []
    const r = scope.getBoundingClientRect()
    return { fields, buttons, links, cardRight: Math.round(r.right), cardLeft: Math.round(r.left), vw: innerWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, minTap }
  }, { minTap: MIN_TAP })
  assert.equal(a.fields, 0, `${where}: การ์ดประกาศห้ามมีช่องกรอก`)
  assert.equal(a.buttons, 0, `${where}: การ์ดประกาศห้ามมีปุ่มตัดสิน`)
  assert.ok(a.pageOverflow <= 1, `${where}: หน้าล้นจอ ${a.pageOverflow}px`)
  assert.ok(a.cardLeft >= -0.5 && a.cardRight <= a.vw + 0.5, `${where}: การ์ดล้นกรอบจอ ${a.cardLeft}..${a.cardRight} (จอ ${a.vw})`)
  for (const l of a.links) assert.ok(l.h >= MIN_TAP, `${where}: ลิงก์เตี้ย ${l.h}px (ต้อง ≥ ${MIN_TAP})`)
  return a
}

const raw = page => page.getByText(RAW_ALERT, { exact: false })
const card = page => page.locator('[data-water-announcement]')

const results = []
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false, error }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`)
  }
}

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  // ── 1) มีประกาศ: หน้าแรก ──
  for (const width of WIDTHS) {
    await check(`หน้าแรก ${width}px: ประกาศแทนแถบแจ้งเตือนดิบ · ข้อความครบ · เวลาใช้ได้ถึง · ลิงก์ไปหน้าสถานการณ์ · ไม่ล้นจอ`, async () => {
      const now = Date.now()
      const { context, page, problems, writes, annCalls } = await open(browser, baseUrl, { route: '/', width, annResponse: announcement(now, 20 * HOUR) })
      try {
        await card(page).waitFor({ timeout: 30_000 })
        await page.waitForTimeout(800)
        const text = await card(page).innerText()
        for (const line of BODY.split('\n')) assert.ok(text.includes(line.slice(0, 40)), `ข้อความหาย: ${line.slice(0, 40)}`)
        assert.match(text, /ประกาศสถานการณ์น้ำ-ฝน/); assert.match(text, /เผยแพร่ .* · ใช้ได้ถึง .* \(เหลืออีก (20 ชม\.|19 ชม\. \d+ นาที)\)/)
        assert.match(text, /ผ่านการยืนยันจากเจ้าหน้าที่ที่เทศบาลตำบลสาธิตกำหนดแล้ว/)
        assert.equal(await raw(page).count(), 0, 'แถบแจ้งเตือนดิบต้องไม่ซ้อนกับประกาศ')
        assert.equal(await card(page).count(), 1, 'การ์ดประกาศต้องมีใบเดียว')
        const a = await audit(page, `หน้าแรก ${width}px`)
        assert.deepEqual(a.links.map(l => l.href), ['/water-situation'])
        assert.equal(annCalls.length, 1, `เรียก RPC ประกาศครั้งเดียวตอนเปิดหน้า (พบ ${annCalls.length})`)
        assert.match(annCalls[0], /_municipality_id/)
        assert.deepEqual(writes, []); assert.deepEqual(problems, [])
        // ถ่ายภาพการ์ดเดี่ยว
        await card(page).screenshot({ path: path.join(SHOT_DIR, `home-card-${width}.png`) })
        if (width === 390) await page.screenshot({ path: path.join(SHOT_DIR, 'home-390-page.png') })
      } finally { await context.close() }
    })
  }

  // ── 2) ไม่มีประกาศ: แถบดิบเหมือนเดิม ──
  await check('หน้าแรก: ไม่มีประกาศ (null) → แถบแจ้งเตือนดิบเหมือนเดิม ไม่มีการ์ดประกาศ', async () => {
    const { context, page, problems } = await open(browser, baseUrl, { route: '/', annResponse: null })
    try {
      await raw(page).first().waitFor({ timeout: 30_000 })
      assert.equal(await card(page).count(), 0)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })
  await check('หน้าแรก: RPC ประกาศพัง (500) → ไม่มีการ์ด ไม่มีข้อความผิดพลาด แถบดิบยังอยู่', async () => {
    const { context, page, problems } = await open(browser, baseUrl, { route: '/', annResponse: { status: 500, body: { message: 'boom' } } })
    try {
      await raw(page).first().waitFor({ timeout: 30_000 })
      assert.equal(await card(page).count(), 0)
      assert.equal(await page.getByText(/boom|error|ผิดพลาด/i).count(), 0, 'ห้ามโผล่ข้อความผิดพลาดบนหน้าแรก')
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  // ── 3) ครบอายุหายเอง (ไม่ต้องรอ RPC รอบถัดไป) ──
  await check('ครบอายุ: การ์ดหายเองตามนาฬิกา แล้วแถบดิบกลับมา', async () => {
    const t0 = Date.now()
    const { context, page } = await open(browser, baseUrl, { route: '/', clockTime: t0, annResponse: announcement(t0, 100_000) })
    try {
      await card(page).waitFor({ timeout: 30_000 })
      assert.equal(await raw(page).count(), 0)
      await page.clock.fastForward(150_000)
      await page.waitForTimeout(500)
      assert.equal(await card(page).count(), 0, 'ครบอายุแล้วต้องหาย')
      await raw(page).first().waitFor({ timeout: 10_000 })
    } finally { await context.close() }
  })

  // ── 4) นาฬิกาเครื่องเพี้ยน ──
  await check('เครื่องผู้ใช้นาฬิกาเร็วกว่าจริง 3 ชม. → ประกาศที่ยังใช้ได้ต้องไม่หาย (ใช้ server_now)', async () => {
    const real = Date.now()
    const { context, page } = await open(browser, baseUrl, { route: '/', clockTime: real + 3 * HOUR, annResponse: announcement(real, 1 * HOUR) })
    try {
      await card(page).waitFor({ timeout: 30_000 })
      assert.match(await card(page).innerText(), /เหลืออีก (59 นาที|1 ชม\.)/)
    } finally { await context.close() }
  })
  await check('เครื่องผู้ใช้นาฬิกาช้ากว่าจริง 3 ชม. → ประกาศที่ค้างจากแคช/หมดอายุ ณ เวลาจริงต้องไม่โผล่ (ใช้ server_now)', async () => {
    const real = Date.now()
    // ฐานข้อมูลบอกเวลาจริง = real แต่ส่งฉบับที่หมดอายุไปแล้ว 10 นาที (กรณีแคชขอบ/ความผิดพลาด) — เครื่องช้า 3 ชม. จะเห็นว่ายังเหลือ 2 ชม. 50 นาทีถ้าใช้นาฬิกาเครื่อง
    const { context, page } = await open(browser, baseUrl, { route: '/', clockTime: real - 3 * HOUR, annResponse: announcement(real, -10 * MIN) })
    try {
      await raw(page).first().waitFor({ timeout: 30_000 })
      await page.waitForTimeout(800)
      assert.equal(await card(page).count(), 0)
    } finally { await context.close() }
  })

  // ── 5) หน้า /water-situation ──
  for (const width of WIDTHS) {
    await check(`/water-situation ${width}px: การ์ดอยู่บนสุดของเนื้อหา · แถบดิบของหน้ายังอยู่ · ไม่มีลิงก์ซ้ำ · ไม่ล้นจอ`, async () => {
      const { context, page, problems, writes } = await open(browser, baseUrl, { route: '/water-situation', width, annResponse: announcement(Date.now(), 6 * HOUR + 30 * MIN) })
      try {
        await card(page).waitFor({ timeout: 30_000 })
        await page.getByText(RAW_ALERT).first().waitFor({ timeout: 30_000 })
        const order = await page.evaluate(() => {
          const c = document.querySelector('[data-water-announcement]')
          const alertEl = [...document.querySelectorAll('[role="alert"]')].find(e => e.textContent.includes('แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่'))
          return { cardTop: c.getBoundingClientRect().top + scrollY, alertTop: alertEl ? alertEl.getBoundingClientRect().top + scrollY : null }
        })
        assert.ok(order.alertTop !== null && order.cardTop < order.alertTop, 'การ์ดประกาศต้องอยู่เหนือแถบแจ้งเตือนดิบของหน้า')
        const a = await audit(page, `/water-situation ${width}px`)
        assert.deepEqual(a.links, [], 'บนหน้านี้เองไม่ต้องมีลิงก์ไปหน้าตัวเอง')
        assert.match(await card(page).innerText(), /เหลืออีก 6 ชม\./)
        assert.deepEqual(writes, []); assert.deepEqual(problems, [])
        if (width === 390 || width === 1280) await page.screenshot({ path: path.join(SHOT_DIR, `situation-${width}-page.png`) })
      } finally { await context.close() }
    })
  }
  await check('/water-situation: ไม่มีประกาศ → หน้าเหมือนเดิม (ไม่มีการ์ด)', async () => {
    const { context, page, problems } = await open(browser, baseUrl, { route: '/water-situation', annResponse: null })
    try {
      await page.getByText(RAW_ALERT).first().waitFor({ timeout: 30_000 })
      assert.equal(await card(page).count(), 0); assert.deepEqual(problems, [])
    } finally { await context.close() }
  })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} ${results.length - failed.length}/${results.length} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
process.exit(failed.length ? 1 : 0)
