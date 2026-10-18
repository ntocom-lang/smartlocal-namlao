// E2E: ส่วน "ระบบน้ำของตำบล" บนหน้า /water-situation (src/components/water/WaterSystem.jsx) — ดีไซน์ฉบับปิด docs/water-system.md
// demo ใช้ระบบของน้ำเลาเป็นค่าเริ่มต้น (ข้อมูลจริงของน้ำเลา ใช้สาธิต) · ?system=namlao เปิดชัดเจน
//
// ตรวจ: คำกำกับบังคับ · 3 ขั้น (ก่อนถึง/ในตำบล/ไหลต่อ) · ป้ายความสัมพันธ์บนการ์ดอ่าง/ระดับน้ำ (305 ต้นน้ำ · 304 สายข้างเคียง · YOM003 ผังไม่ระบุ)
//   · แนวโน้มอ่างทุกสถานะ (พร้อม/กำลังเก็บ/ไม่มีประวัติ/โหลดไม่สำเร็จ) · ค่าสดไม่มี = "ไม่มีค่าสดในระบบ" · ไม่มีช่องกรอก · เป้ากด ≥ 44px
//   · ไม่ล้นจอ 360/390/768/1280 · ไม่มีคำขอเขียน · เรียกประวัติอ่างครั้งเดียว · ?system= แปลก = กลับค่าเริ่มต้น
//
// อ่านอย่างเดียว ไม่เขียนข้อมูลใด · RPC สถานี (get_public_water_situation) และประวัติอ่าง (get_public_dam_history) ถูกจำลองในเบราว์เซอร์
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม:
//   VITE_TENANT_SLUG=demo npm run dev -- --port 5174
//   node tests/water-system.playwright.mjs            (http://localhost:5174)
//   WS_TEST_BASE_URL=http://127.0.0.1:5176 WS_SHOT_DIR=<โฟลเดอร์> node tests/water-system.playwright.mjs
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_BASE_URL = 'http://localhost:5174'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const SHOT_DIR = process.env.WS_SHOT_DIR || path.join(process.cwd(), 'screenshots', 'water-system')
const HOUR = 3_600_000
const DAY = 86_400_000
const MIN_TAP = 44

function resolveBaseUrl() {
  const raw = (process.env.WS_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${url.hostname}`)
  return raw
}

const hoursAgo = hours => new Date(Date.now() - hours * HOUR).toISOString()
// เที่ยงคืนไทยของ "n วันก่อน" (= 17:00 UTC ของวันก่อนหน้านั้น) — ตรงกับที่ thaiwater-sync เก็บค่าอ่างรายวัน
function bangkokMidnight(daysAgo) {
  const bkk = new Date(Date.now() + 7 * HOUR - daysAgo * DAY)
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate()) - 7 * HOUR).toISOString()
}

const station = (type, code, name, extra) => ({
  station_type: type, station_code: code, station_name: name, tambon_name: 'น้ำเลา', amphoe_name: 'ร้องกวาง', province_name: 'แพร่',
  river_name: null, agency_name: 'สสน.', latitude: 18.25, longitude: 100.34, distance_km: 3.6, is_primary: false, note: null,
  recorded_at: null, rain_24h_mm: null, rain_1h_mm: null, waterlevel_msl: null, bank_diff_m: null, storage_percent: null,
  situation_level: null, situation_text: null, situation_color: null, dam_storage_mcm: null, dam_capacity_mcm: null,
  dam_inflow_mcm: null, dam_released_mcm: null, prev_recorded_at: null, prev_waterlevel_msl: null, prev_dam_storage_mcm: null,
  dam_same_count: null, dam_same_since: null, dam_same_capped: null, ...extra,
})

const dam305 = extra => station('dam', '305', 'อ่างเก็บน้ำแม่คำปอง', {
  is_primary: true, recorded_at: bangkokMidnight(0), storage_percent: 100.6, dam_storage_mcm: 6.8, dam_capacity_mcm: 6.76,
  prev_recorded_at: bangkokMidnight(1), prev_dam_storage_mcm: 6.85, ...extra,
})
const dam304 = extra => station('dam', '304', 'อ่างเก็บน้ำแม่ถาง', {
  tambon_name: 'บ้านเวียง', distance_km: 4.3, recorded_at: bangkokMidnight(0), storage_percent: 52.9, dam_storage_mcm: 16.2, dam_capacity_mcm: 30.62,
  prev_recorded_at: bangkokMidnight(1), prev_dam_storage_mcm: 16.3, ...extra,
})
const yom003 = extra => station('waterlevel', 'YOM003', 'หนองม่วงไข่', {
  tambon_name: 'น้ำรัด', amphoe_name: 'หนองม่วงไข่', river_name: 'แม่น้ำยม', distance_km: 14.1, recorded_at: hoursAgo(0.5),
  bank_diff_m: 5.95, waterlevel_msl: 153.69, storage_percent: 16, situation_text: 'น้ำน้อย', situation_color: '#eab308', ...extra,
})
const rain = (code, name, mm) => station('rain', code, name, { distance_km: 2.6, recorded_at: hoursAgo(0.5), rain_24h_mm: mm })

// ประวัติอ่าง n วัน ต่อสถานี (เก่า→ใหม่) · ค่าลดลงทุกวัน (ไม่ซ้ำ ไม่ให้ติดป้ายตัวเลขซ้ำ)
const history = (n, base, mcmBase, cap) => Array.from({ length: n }, (_, i) => {
  const age = n - 1 - i
  const pct = Number((base - (n - 1 - age) * 0.9).toFixed(2))
  return { recorded_at: bangkokMidnight(age), storage_percent: pct, storage_mcm: Number((mcmBase - i * 0.05).toFixed(2)), capacity_mcm: cap }
})
const dams = n => [
  { station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, readings: history(n, 100.6, 6.8, 6.76) },
  { station_code: '304', station_name: 'อ่างเก็บน้ำแม่ถาง', distance_km: 4.3, readings: history(n, 56.5, 17.3, 30.62) },
]

const SCENES = {
  ready: { stations: [dam305(), dam304(), yom003(), rain('STN0911', 'บ้านบุญแจ่ม', 3.5)], history: { status: 200, body: { days: 30, radius_km: 10, dams: dams(12) } } },
  building: { stations: [dam305(), dam304(), yom003()], history: { status: 200, body: { days: 30, radius_km: 10, dams: dams(3) } } },
  none: { stations: [dam305(), dam304(), yom003()], history: { status: 200, body: { days: 30, radius_km: 10, dams: [] } } },
  error: { stations: [dam305(), dam304(), yom003()], history: { status: 500, body: { message: 'boom' } } },
  nodam: { stations: [rain('STN0911', 'บ้านบุญแจ่ม', 0), yom003()], history: { status: 200, body: { days: 30, radius_km: 10, dams: [] } } },
}

async function openScene(browser, baseUrl, sceneName, { width = 1280, height = 900, query = '?system=namlao' } = {}) {
  const scene = SCENES[sceneName]
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH' })
  const page = await context.newPage()
  const problems = []
  const writes = []
  const historyCalls = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('request', request => {
    if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`)
  })
  await page.route('**/rest/v1/rpc/get_public_water_situation', route =>
    route.fulfill({ json: { synced_at: hoursAgo(0.2), stations: scene.stations, warnings: [] } }))
  await page.route('**/rest/v1/rpc/get_public_dam_history', route => {
    historyCalls.push(route.request().postData())
    return route.fulfill({ status: scene.history.status, json: scene.history.body })
  })
  await page.goto(`${baseUrl}/water-situation${query}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#water-system').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1200)
  return { context, page, problems, writes, historyCalls }
}

const section = page => page.locator('#water-system')
// ถ่ายทั้งส่วนในภาพเดียว: หน้าเลื่อนในกรอบแอป (ส่วนหัว/แถบล่างลอยทับ) จึงขยายความสูงจอก่อนถ่าย
async function shootSection(page, file) {
  const width = page.viewportSize().width
  await page.setViewportSize({ width, height: 3800 })
  await page.waitForTimeout(600)
  await section(page).screenshot({ path: path.join(SHOT_DIR, file) })
}

const results = []
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`)
  }
}

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })

try {
  // ── 1) พร้อมใช้งานเต็ม: คำกำกับ · 3 ขั้น · ป้ายความสัมพันธ์ · แนวโน้ม ──
  await check('ปกติ: คำกำกับครบ · 3 ขั้น · ป้ายความสัมพันธ์ 305/304/YOM003 · แนวโน้มต้นน้ำ · สายข้างเคียงไม่มีแนวโน้ม', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'ready')
    try {
      const text = await section(page).innerText()
      for (const phrase of ['ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้แสดงว่ามีน้ำไหลจริง', 'ไม่ได้รับรองว่าปลอดภัย', 'ต้นน้ำอยู่ไกลกว่านี้ ผังที่ใช้ไม่ครอบคลุม', 'ผังต้นฉบับมี แต่เราไม่ได้ใส่', 'ที่มาของข้อมูล']) {
        assert.ok(text.includes(phrase), `ต้องมี "${phrase}"`)
      }
      assert.match(text, /ผังตำบลอายุ \d+ ปี \d+ เดือน/, 'ต้องบอกอายุผัง')
      assert.equal(await section(page).locator('[data-step]').count(), 3, 'ต้องมี 3 ขั้น')
      for (const title of ['ก่อนถึงตำบล', 'ในตำบล', 'ไหลต่อไปที่']) assert.ok(text.includes(title), title)
      const noLive = text.includes('ไม่มีค่าสดในระบบ')
      assert.ok(noLive, 'อ่างที่ไม่ผูกสถานีต้องเขียน "ไม่มีค่าสดในระบบ"')

      // การ์ดแหล่งน้ำที่เกี่ยวข้อง
      const card305 = section(page).locator('[data-related-dam="305"]')
      const card304 = section(page).locator('[data-related-dam="304"]')
      assert.ok((await card305.innerText()).includes('ต้นน้ำของตำบล'))
      assert.ok((await card305.innerText()).includes('100.6%'))
      assert.equal(await card305.locator('[data-trend="ready"]').count(), 1, 'ต้นน้ำต้องมีแนวโน้ม')
      const trendText = await card305.locator('[data-trend="ready"]').innerText()
      assert.match(trendText, /วันที่ผ่านมา ปริมาณน้ำในอ่างลดลง/)
      assert.ok(trendText.includes('ไม่ใช่การพยากรณ์'))
      for (const bad of ['เหลืออีก', 'จะหมด', 'จะเต็ม', 'คาดว่า']) assert.ok(!trendText.includes(bad), `ห้ามมี "${bad}"`)
      assert.ok(await card305.locator('svg path').count() >= 1, 'ต้องมีเส้นกราฟ')
      const text304 = await card304.innerText()
      assert.ok(text304.includes('สายข้างเคียง') && text304.includes('น้ำแม่หล่าย'), 'แม่ถางต้องเป็นสายข้างเคียงพร้อมคำอธิบาย')
      assert.equal(await card304.locator('[data-trend]').count(), 0, 'สายข้างเคียงไม่แสดงแนวโน้มต้นน้ำ')
      assert.equal(await card305.locator('a[href="#water-dam-305"]').count(), 1, 'ต้องลิงก์ไปการ์ดอ่างเดิม')

      // ป้ายบนการ์ดเดิม
      const damCard305 = page.locator('#water-dam-305')
      assert.equal(await damCard305.count(), 1, 'การ์ดอ่างเดิมต้องมีจุดยึด')
      assert.ok((await damCard305.innerText()).includes('ต้นน้ำของตำบล'))
      assert.ok((await page.locator('#water-dam-304').innerText()).includes('สายข้างเคียง'))
      const levels = page.locator('#water-levels')
      assert.ok((await levels.innerText()).includes('ผังไม่ระบุ'), 'YOM003 ต้องติดป้าย "ผังไม่ระบุ"')
      assert.ok(await levels.locator('[data-relation-note]').count() >= 1, 'ต้องมีคำอธิบายใต้ชื่อสถานี YOM003')

      // ปุ่มย่อ/ขยาย: ขั้น "ในตำบล" มี 9 รายการ แสดง 3 ก่อน
      const step2 = section(page).locator('[data-step="2"]')
      assert.equal(await step2.locator('li').count(), 3)
      await step2.getByRole('button', { name: /ดูทั้งหมด 9 รายการ/ }).click()
      assert.equal(await step2.locator('li').count(), 9)
      await step2.getByRole('button', { name: 'ย่อรายการ' }).click()
      assert.equal(await step2.locator('li').count(), 3)

      // dev server ครอบ <StrictMode> (main.jsx) ซึ่งรัน effect ซ้ำ 2 รอบเป็นปกติ → ยอมรับ 1–2 ครั้ง · ที่ต้องไม่เกิดคือเรียกซ้ำเรื่อยๆ (ไม่มี polling)
      assert.ok(historyCalls.length >= 1 && historyCalls.length <= 2, `เรียกประวัติอ่าง ${historyCalls.length} ครั้ง`)
      const before = historyCalls.length
      await page.waitForTimeout(3000)
      assert.equal(historyCalls.length, before, 'ห้ามเรียกประวัติอ่างซ้ำเรื่อยๆ (อ่างส่งรายวัน)')
      assert.deepEqual(JSON.parse(historyCalls[0]), { _municipality_id: JSON.parse(historyCalls[0])._municipality_id, _days: 30 })
      assert.deepEqual(writes, [], 'ห้ามมีคำขอเขียน')
      assert.deepEqual(problems, [])
      await shootSection(page, 'section-ready-1280.png')
    } finally { await context.close() }
  })

  // ── 2) สถานะแนวโน้มอื่น ──
  await check('กำลังเก็บ (< 7 วัน): บอกวันที่เริ่ม + อีกกี่วัน ไม่วาดกราฟ', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'building')
    try {
      const panel = section(page).locator('[data-related-dam="305"] [data-trend="building"]')
      assert.equal(await panel.count(), 1)
      const text = await panel.innerText()
      assert.match(text, /เริ่มเก็บแนวโน้มเมื่อ \d+ .+ \d{4}/)
      assert.ok(text.includes('อีก 4 วัน'), `ต้องบอกว่าอีก 4 วัน ได้ "${text}"`)
      assert.equal(await section(page).locator('[data-related-dam="305"] svg').count(), 0, 'ยังไม่ครบ 7 วัน ห้ามวาดกราฟ')
      assert.deepEqual(problems, [])
      await page.setViewportSize({ width: 390, height: 900 })
      await section(page).locator('[data-related-dam="305"]').screenshot({ path: path.join(SHOT_DIR, 'card-building-390.png') })
    } finally { await context.close() }
  })
  await check('ไม่มีประวัติ: บอกตรงๆ ไม่เติมค่า', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'none')
    try {
      const text = await section(page).locator('[data-related-dam="305"] [data-trend="none"]').innerText()
      assert.ok(text.includes('ยังไม่มีประวัติค่าอ่างนี้ในระบบ'))
      await page.setViewportSize({ width: 390, height: 900 })
      await section(page).locator('[data-related-dam="305"]').screenshot({ path: path.join(SHOT_DIR, 'card-none-390.png') })
    } finally { await context.close() }
  })
  await check('โหลดประวัติไม่สำเร็จ (500): ซ่อนเฉพาะกราฟ ส่วนอื่นอยู่ครบ ไม่แสดง error ดิบ', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'error')
    try {
      assert.equal(await section(page).locator('[data-trend]').count(), 0)
      assert.equal(await section(page).locator('[data-step]').count(), 3)
      assert.equal(await section(page).locator('[data-related-dam]').count(), 2, 'การ์ดอ่างและค่าสดยังอยู่')
      const text = await section(page).innerText()
      for (const raw of ['boom', 'error', 'Error', 'ผิดพลาด', '500']) assert.ok(!text.includes(raw), `ห้ามแสดง "${raw}"`)
      assert.deepEqual(problems, [])
      await page.setViewportSize({ width: 390, height: 900 })
      await section(page).locator('[data-related-dam="305"]').screenshot({ path: path.join(SHOT_DIR, 'card-error-390.png') })
    } finally { await context.close() }
  })
  await check('ไม่มีอ่างในระบบ: ไม่มีการ์ดอ่าง · ขั้น "ในตำบล" บอก "ไม่มีค่าสดในระบบ" ไม่เขียนว่าปกติ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nodam')
    try {
      assert.equal(await section(page).locator('[data-related-dam]').count(), 0)
      const node = section(page).locator('[data-node="in-dam-305"]')
      assert.ok((await node.innerText()).includes('ไม่มีค่าสดในระบบ'))
      assert.ok(!(await section(page).innerText()).includes('ปกติ'))
    } finally { await context.close() }
  })

  // ── 3) ล็อกว่าไม่เพิ่มงานเจ้าหน้าที่ + เป้ากด + ไม่ล้นจอ ──
  for (const width of [360, 390, 768, 1280]) {
    await check(`${width}px: ไม่ล้นจอ · เป้ากด ≥ ${MIN_TAP}px · ไม่มีช่องกรอก`, async () => {
      const { context, page, problems } = await openScene(browser, baseUrl, 'ready', { width })
      try {
        assert.equal(await section(page).locator('input, textarea, select, form, [contenteditable]').count(), 0, 'ส่วนนี้อ่านอย่างเดียว')
        const overflow = await page.evaluate(() => {
          const el = document.querySelector('#water-system')
          return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, el: el.scrollWidth - el.clientWidth }
        })
        assert.ok(overflow.doc <= 1 && overflow.el <= 1, `ล้นแนวนอน ${JSON.stringify(overflow)}`)
        const small = await section(page).locator('button, a[href]').evaluateAll((nodes, min) => nodes
          .map(n => ({ text: (n.textContent || '').trim().slice(0, 30), h: Math.round(n.getBoundingClientRect().height) }))
          .filter(n => n.h > 0 && n.h < min), MIN_TAP)
        assert.deepEqual(small, [], `เป้ากดเล็กกว่า ${MIN_TAP}px`)
        await shootSection(page, `section-ready-${width}.png`)
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }

  // ── 4) การเลือกระบบ ──
  await check('?system= แปลก/ไม่ใส่: demo ยังได้ระบบน้ำเลา (ค่าเริ่มต้น) ไม่พัง', async () => {
    for (const query of ['', '?system=nope', '?system=__proto__', '?system=constructor']) {
      const { context, page, problems } = await openScene(browser, baseUrl, 'ready', { query })
      try {
        assert.equal(await section(page).getAttribute('data-water-system'), 'namlao', `query "${query}"`)
        assert.ok((await section(page).innerText()).includes('ข้อมูลจริงของน้ำเลา ใช้สาธิต'), 'demo ต้องบอกว่าเป็นข้อมูลจริงของน้ำเลา')
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    }
  })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`)
process.exit(failed.length ? 1 : 0)
