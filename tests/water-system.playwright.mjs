// E2E: "ก่อนถึงตำบล / ไหลต่อไปที่" ในแท็บ "ผังน้ำตำบล" + ป้ายความสัมพันธ์บนการ์ดอ่าง/ระดับน้ำในแท็บสถานการณ์ของหน้า /water-situation
// (src/components/water/WaterDiagramEdges.jsx + WaterDiagram.jsx) — ดีไซน์ docs/water-system.md
// เดิมเป็นส่วน "ระบบน้ำของตำบล" ท้ายแท็บสถานการณ์ (3 ขั้น) — เจ้าของระบบสั่งจัดระเบียบ 2569-10-24: รวมเข้าแท็บผังน้ำตำบล เหลือก่อนถึงตำบล/ไหลต่อไปที่ใต้ภาพ
//   ขั้น "ในตำบล" ตัดออก (ซ้ำกับภาพ) · คำกำกับ/อายุผัง/ที่มารวมกับของผังน้ำตำบลเหลือชุดเดียว · ลำดับแท็บสถานการณ์: ภาพรวมก่อนกราฟรายชั่วโมง
// demo เปิดผังของตำบลอื่นด้วย ?diagram=<id> (แท็บผังน้ำตำบล) · ?system=<id> เลือกระบบที่ใช้ติดป้ายความสัมพันธ์บนการ์ดของแท็บสถานการณ์ (ค่าเริ่มต้น = น้ำเลา)
//
// ตรวจ: คำกำกับบังคับชุดเดียว + อายุผัง · ก่อนถึงตำบล/ไหลต่อไปที่ · ไม่มีขั้น "ในตำบล"/กล่องที่มา/คำกำกับซ้ำในแท็บสถานการณ์
//   · ป้ายความสัมพันธ์ (305 ต้นน้ำ · 304 สายข้างเคียง · YOM003 ผังไม่ระบุ · Y.38 อยู่ในตำบล) · ค่าสดไม่มี = "ไม่มีค่าสดในระบบ" · ไม่มีช่องกรอก · เป้ากด ≥ 44px
//   · ไม่ล้นจอ 360/390/768/1280 · ไม่มีคำขอเขียน · ?system= แปลก = กลับค่าเริ่มต้น · แท็บสถานการณ์เรียงภาพรวม → กราฟรายชั่วโมง
//   · แถว "เกิดเหตุหรือต้องการความช่วยเหลือเรื่องน้ำ" ท้ายแท็บผังน้ำตำบล (WaterHelpRow.jsx · ข้อ 8): สายด่วนขึ้นเสมอ · ปุ่มหมวดขึ้นเฉพาะที่เปิดให้ผู้ใช้ยื่นได้จริง (จำลอง complaint_categories)
//   · ล็อกว่าการ์ดแนวโน้มอ่าง 30 วัน + กล่อง "ผังต้นฉบับมี แต่เราไม่ได้ใส่" ไม่กลับมา และหน้าไม่เรียก get_public_dam_history อีก (เจ้าของระบบสั่งตัด 2026-10-19)
//
// อ่านอย่างเดียว ไม่เขียนข้อมูลใด · RPC สถานี (get_public_water_situation) ถูกจำลองในเบราว์เซอร์ · get_public_dam_history ถูกดักไว้นับเท่านั้น (ต้องเป็น 0)
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
const y38 = extra => station('waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', {
  tambon_name: 'ตำหนักธรรม', amphoe_name: 'หนองม่วงไข่', river_name: 'น้ำแม่คำมี', distance_km: 0.7, recorded_at: hoursAgo(0.5),
  bank_diff_m: 5.1, waterlevel_msl: 150.1, storage_percent: 20, situation_text: 'น้ำน้อย', situation_color: '#eab308', ...extra,
})

const SCENES = {
  ready: { stations: [dam305({ dam_same_count: 4, dam_same_since: hoursAgo(72), dam_same_capped: false }), dam304(), yom003(), rain('STN0911', 'บ้านบุญแจ่ม', 3.5)] },
  nodam: { stations: [rain('STN0911', 'บ้านบุญแจ่ม', 0), yom003()] },
  // ตำหนักธรรม: Y.38 อยู่ในตำบล + YOM003 · ไม่มีอ่างกลาง (PR 5.1 ปิดแล้ว) · ทุ่งแค้ว: YOM003 + ฝน RES038 · ไม่มีอ่างกลาง
  tamnaktham: { stations: [y38(), yom003({ distance_km: 6.6 }), rain('YOM003', 'หนองม่วงไข่', 1.5)] },
  thungkaew: { stations: [yom003({ distance_km: 4.8 }), rain('RES038', 'อ่างห้วยยอย', 0)] },
}

// tab: 'route' (ค่าเริ่มต้น — ?diagram= ของ demo เปิดแท็บผังน้ำตำบลเอง) | 'situation'
async function openScene(browser, baseUrl, sceneName, { width = 1280, height = 900, diagram = 'namlao', system = diagram, tab = 'route', query = null, categories = [], categoriesStatus = 200 } = {}) {
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
  await page.route('**/api/small-reservoir*', route => route.fulfill({ status: 503, json: { error: 'RESERVOIR_UNAVAILABLE' } }))
  await page.route('**/api/hydro-hourly*', route => route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } }))
  // หมวดคำร้องของ อปท. (แถวแจ้งเหตุอ่านตารางนี้) — จำลองให้ผลคงที่ ไม่พึ่งข้อมูลจริงของ demo
  await page.route('**/rest/v1/complaint_categories*', route => (categoriesStatus === 200
    ? route.fulfill({ json: categories })
    : route.fulfill({ status: categoriesStatus, json: { message: 'error' } })))
  await page.route('**/rest/v1/rpc/get_public_dam_history', route => {
    historyCalls.push(route.request().postData())
    return route.fulfill({ json: { days: 30, radius_km: 10, dams: [] } })
  })
  await page.goto(`${baseUrl}/water-situation${query ?? `?diagram=${diagram}&system=${system}&tab=${tab}`}`, { waitUntil: 'domcontentloaded' })
  await page.locator(tab === 'route' ? '#water-diagram' : '#water-panel-situation').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(1500)
  return { context, page, problems, writes, historyCalls }
}

const diagramSection = page => page.locator('#water-diagram')
const edges = page => page.locator('[data-water-edges]')
// ถ่ายทั้งส่วนในภาพเดียว: หน้าเลื่อนในกรอบแอป (ส่วนหัว/แถบล่างลอยทับ) จึงขยายความสูงจอก่อนถ่าย
async function shootDiagram(page, file) {
  const width = page.viewportSize().width
  await page.setViewportSize({ width, height: 4200 })
  await page.waitForTimeout(600)
  await diagramSection(page).screenshot({ path: path.join(SHOT_DIR, file) })
}
const innerTab = (page, name) => diagramSection(page).getByRole('tab', { name })

const results = []
// WS_ONLY="คำ1|คำ2" รันเฉพาะข้อที่ชื่อมีคำใดคำหนึ่ง (ไว้ใช้ตอนทำ red-check ทีละส่วน — รันปกติไม่ตั้งค่า = รันทุกข้อ)
const ONLY = (process.env.WS_ONLY ?? '').split('|').filter(Boolean)
async function check(name, run) {
  if (ONLY.length > 0 && !ONLY.some(part => name.includes(part))) return
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`)
  }
}

// คำกำกับบังคับ (ชุดเดียวในแท็บผังน้ำตำบล) + อายุผัง — ใช้กับทุกตำบล
async function assertDisclaimerAndAge(page, id) {
  const disclaimer = await diagramSection(page).locator('[data-diagram-disclaimer]').innerText()
  for (const phrase of ['ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'ไม่ได้รับรองว่าปลอดภัย', 'ไม่ใช่แผนที่']) {
    assert.ok(disclaimer.includes(phrase), `${id}: คำกำกับต้องมี "${phrase}"`)
  }
  assert.match(disclaimer, /ผังต้นฉบับอายุ \d+ ปี(?: \d+ เดือน)?|ผังต้นฉบับอายุ \d+ เดือน/, `${id}: ต้องบอกอายุผัง`)
  assert.equal((await diagramSection(page).innerText()).split('ไม่บอกเวลาน้ำถึง').length - 1, 1, `${id}: คำกำกับบังคับต้องมีชุดเดียว ไม่ซ้ำ`)
}

// ส่วนก่อนถึงตำบล/ไหลต่อไปที่ — ไม่มีขั้น "ในตำบล" ไม่มีกล่องที่มา/คำกำกับของตัวเอง
async function assertEdgesShape(page, id, { up, down }) {
  const section = edges(page)
  assert.equal(await section.count(), 1, `${id}: ต้องมีส่วนก่อนถึงตำบล/ไหลต่อไปที่ 1 ส่วน`)
  assert.equal(await section.getAttribute('data-water-edges'), id)
  assert.deepEqual(await section.locator('[data-edge]').evaluateAll(els => els.map(el => el.getAttribute('data-edge'))), ['upstream', 'downstream'])
  const text = await section.innerText()
  for (const title of ['ก่อนถึงตำบล', 'ไหลต่อไปที่', 'ต้นน้ำอยู่ไกลกว่านี้ ผังที่ใช้ไม่ครอบคลุม']) assert.ok(text.includes(title), `${id}: ต้องมี "${title}"`)
  assert.ok(!/ในตำบล/.test(await section.locator('h3').allInnerTexts().then(list => list.join(' '))), `${id}: ขั้น "ในตำบล" ตัดออกแล้ว (ซ้ำกับภาพ)`)
  assert.equal(await page.locator('#water-system, [data-water-system], [data-system-source], [data-step]').count(), 0, `${id}: ไม่มีส่วนระบบน้ำของตำบลเดิมเหลืออยู่ในหน้า`)
  assert.equal(await section.locator('input, textarea, select, form, [contenteditable]').count(), 0, 'ส่วนนี้อ่านอย่างเดียว')
  for (const [edge, count] of [['upstream', up], ['downstream', down]]) {
    const card = section.locator(`[data-edge="${edge}"]`)
    assert.equal(await card.locator('li').count(), Math.min(3, count), `${id}/${edge}: แสดง ${Math.min(3, count)} รายการก่อน`)
    const more = card.getByRole('button', { name: /ดูทั้งหมด \d+ รายการ/ })
    if (count > 3) {
      await more.click()
      assert.equal(await card.locator('li').count(), count, `${id}/${edge}: ขยายแล้วต้องครบ ${count} รายการ`)
      await card.getByRole('button', { name: 'ย่อรายการ' }).click()
      assert.equal(await card.locator('li').count(), 3)
    } else assert.equal(await more.count(), 0, `${id}/${edge}: มี ${count} รายการ ไม่ต้องมีปุ่มขยาย`)
  }
  for (const bad of ['เหลืออีก', 'จะหมด', 'พยากรณ์ว่า', 'คาดว่า', 'ปกติ']) assert.ok(!text.includes(bad), `${id}: ห้ามมี "${bad}"`)
}

// แท็บ "ที่มา": จำนวนที่ผังต้นฉบับวาด (ไม่นับแผนก่อสร้าง) + ที่มาของก่อนถึงตำบล/ไหลต่อไปที่ (ผังจังหวัดไม่ได้ลงวันที่ในภาพ)
async function assertSourceTab(page, id, countsText, shownStops) {
  await innerTab(page, /^ที่มา$/).click()
  const counts = await diagramSection(page).locator('[data-diagram-counts]').innerText()
  assert.ok(counts.includes(countsText), `${id}: บรรทัดจำนวนที่ผังวาดต้องเป็น "${countsText}" ได้ "${counts}"`)
  assert.ok(counts.includes(`ภาพนี้แสดงเฉพาะ ${shownStops} จุดสำคัญ`), `${id}: ต้องบอกว่าภาพแสดงกี่จุด`)
  assert.ok(!/แผนก่อสร้าง/.test(counts), `${id}: บรรทัดนี้ห้ามนับแผนก่อสร้าง (ตัวเลขแผนก่อสร้างอยู่บนแถบหัวภาพ ชุดเดียว)`)
  const source = await diagramSection(page).locator('[data-diagram-edges-source]').innerText()
  assert.ok(source.includes('ก่อนถึงตำบล') && source.includes('ไหลต่อไปที่') && source.includes('ผังน้ำจังหวัดแพร่') && source.includes('ไฟล์ลงวันที่') && source.includes('ภาพไม่ระบุวันที่'), `${id}: ที่มาของก่อนถึงตำบล/ไหลต่อไปที่ ต้องบอกผังจังหวัดและวันที่ไฟล์ ("${source}")`)
  assert.equal(await diagramSection(page).locator('[data-diagram-source]').count(), 1, `${id}: กล่องที่มามีชุดเดียว`)
  await innerTab(page, /^แผนภาพ/).click()
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('#water-diagram')
    return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, el: el.scrollWidth - el.clientWidth }
  })
  assert.ok(overflow.doc <= 1 && overflow.el <= 1, `${label}: ล้นแนวนอน ${JSON.stringify(overflow)}`)
}

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })

try {
  // ── 1) น้ำเลา: แท็บผังน้ำตำบล ──
  await check('น้ำเลา · แท็บผังน้ำตำบล: คำกำกับบังคับชุดเดียว + อายุผัง · ก่อนถึงตำบล 4 / ไหลต่อไปที่ 3 · ไม่มีขั้น "ในตำบล" · จำนวนที่ผังวาด + ที่มาอยู่แท็บที่มา · ไม่มีคำขอเขียน/ประวัติอ่าง', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'ready', { diagram: 'namlao' })
    try {
      await assertDisclaimerAndAge(page, 'namlao')
      await assertEdgesShape(page, 'namlao', { up: 4, down: 3 })
      await assertSourceTab(page, 'namlao', 'อ่าง 4 แห่ง · ฝายประมาณ 40 แห่ง · สระ 4 แห่ง · ห้วยสาขาประมาณ 25 สาย', 21)

      // ตัดออกแล้ว (เจ้าของระบบสั่ง 2026-10-19): การ์ดแนวโน้มอ่าง 30 วัน + กล่อง "ผังต้นฉบับมี แต่เราไม่ได้ใส่" (ซ้ำกับการ์ดอ่างเดิม/ภาษาเทคนิคเกินไป)
      assert.equal(await page.locator('[data-related-dam], [data-trend], [data-system-omitted]').count(), 0, 'ต้องไม่มีการ์ดแนวโน้มและกล่อง "ไม่ได้ใส่"')
      // ส่วนก่อนถึงตำบล/ไหลต่อไปที่ต้องไม่มีของที่ตัดออกแล้ว (คำว่า "พื้นที่ลายขีดแดง" ยังอยู่ในรายการ "ไม่ได้ใส่ในภาพนี้" ของผังน้ำเลาได้ จึงตรวจเฉพาะส่วนนี้)
      const pageText = await edges(page).innerText()
      for (const gone of ['ผังต้นฉบับมี แต่เราไม่ได้ใส่', 'แนวโน้มปริมาณน้ำในอ่าง', 'ดูตัวเลขล่าสุดของอ่างนี้', 'พื้นที่ลายขีดแดง', 'ไม่ใช่การพยากรณ์']) {
        assert.ok(!pageText.includes(gone), `แท็บผังน้ำตำบลห้ามมี "${gone}" (ตัดออกแล้ว)`)
      }
      await page.waitForTimeout(1500)
      assert.equal(historyCalls.length, 0, 'ห้ามเรียก get_public_dam_history')
      assert.deepEqual(writes, [], 'ห้ามมีคำขอเขียน')
      assert.deepEqual(problems, [])
      await shootDiagram(page, 'route-namlao-1280.png')
    } finally { await context.close() }
  })

  // ── 2) น้ำเลา: แท็บสถานการณ์ — ป้ายความสัมพันธ์ยังอยู่ที่การ์ดเดิม · ไม่มีส่วนระบบน้ำท้ายแท็บ ──
  await check('น้ำเลา · แท็บสถานการณ์: ป้ายความสัมพันธ์ 305 ต้นน้ำ · 304 สายข้างเคียง · YOM003 ผังไม่ระบุ อยู่ที่การ์ดเดิม · ไม่มีส่วนระบบน้ำของตำบล · ซ้ำเดิมอยู่ที่การ์ดอ่างที่เดียว', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'ready', { diagram: 'namlao', tab: 'situation' })
    try {
      assert.equal(await page.locator('#water-panel-situation').locator('#water-system, [data-water-system], [data-system-source], [data-edge], [data-water-edges]').count(), 0, 'แท็บสถานการณ์ไม่มีส่วนระบบน้ำของตำบลแล้ว')
      const damCard305 = page.locator('#water-dam-305')
      assert.equal(await damCard305.count(), 1, 'การ์ดอ่างเดิมต้องมีจุดยึด')
      assert.ok((await damCard305.innerText()).includes('ต้นน้ำของตำบล'))
      assert.ok((await damCard305.innerText()).includes('ซ้ำเดิม'), 'คำเตือนตัวเลขซ้ำเดิมอยู่ที่การ์ดอ่าง')
      const text304 = await page.locator('#water-dam-304').innerText()
      assert.ok(text304.includes('สายข้างเคียง') && text304.includes('น้ำแม่หล่าย'), 'แม่ถางต้องเป็นสายข้างเคียงพร้อมคำอธิบายที่การ์ดอ่างเดิม')
      const levels = page.locator('#water-levels')
      assert.ok((await levels.innerText()).includes('ผังไม่ระบุ'), 'YOM003 ต้องติดป้าย "ผังไม่ระบุ"')
      assert.ok(await levels.locator('[data-relation-note]').count() >= 1, 'ต้องมีคำอธิบายใต้ชื่อสถานี YOM003')
      assert.equal(historyCalls.length, 0, 'ห้ามเรียก get_public_dam_history'); assert.deepEqual(writes, []); assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  // ── 3) ไม่มีอ่างในระบบ ──
  await check('ไม่มีอ่างในระบบ: ก่อนถึงตำบล/ไหลต่อไปที่ยังขึ้น · ไม่เขียนว่าปกติ · ไม่มีการ์ดอ่าง', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nodam', { diagram: 'namlao' })
    try {
      assert.equal(await edges(page).count(), 1)
      assert.ok(!(await edges(page).innerText()).includes('ปกติ'))
      assert.equal(await page.locator('[data-related-dam]').count(), 0)
    } finally { await context.close() }
  })

  // ── 4) ตำหนักธรรม + ทุ่งแค้ว (ดูบน demo ผ่าน ?diagram= / ?system=) ──
  await check('ตำหนักธรรม · แท็บผังน้ำตำบล: คำกำกับ+อายุผัง · ก่อนถึงตำบล 5 / ไหลต่อไปที่ 3 · ที่ผังไม่ยืนยัน 3 เรื่องเป็นเส้นประ "ผังไม่ระบุ" · อ่างต้นสายตามผังจังหวัด "ไม่มีค่าสดในระบบ" · จำนวนที่ผังวาดไม่เขียน 0', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'tamnaktham', { diagram: 'tamnaktham' })
    try {
      await assertDisclaimerAndAge(page, 'tamnaktham')
      await assertEdgesShape(page, 'tamnaktham', { up: 5, down: 3 })
      const up = edges(page).locator('[data-edge="upstream"]')
      await up.getByRole('button', { name: /ดูทั้งหมด 5 รายการ/ }).click()
      for (const id of ['up-name-link', 'up-reservoir-province', 'up-canal-source']) {
        const node = up.locator(`[data-node="${id}"]`)
        assert.equal(await node.getAttribute('data-status'), 'unconfirmed', id)
        assert.ok((await node.innerText()).includes('ผังไม่ระบุ'), `${id}: ต้องติดป้ายผังไม่ระบุ`)
      }
      assert.ok((await up.locator('[data-node="up-reservoir-province"]').innerText()).includes('ไม่มีค่าสดในระบบ'), 'อ่างต้นสายตามผังจังหวัดต้องเขียน "ไม่มีค่าสดในระบบ"')
      await assertSourceTab(page, 'tamnaktham', 'ฝาย 6 แห่ง · ห้วยสาขา 4 สาย', 15)
      const counts = await diagramSection(page).locator('[data-diagram-counts]').innerText()
      assert.ok(!counts.includes('อ่าง 0 แห่ง') && !counts.includes('สระ 0') && !counts.includes(' 0 แห่ง'), 'ห้ามเขียนจำนวน 0')
      assert.equal(historyCalls.length, 0, 'ไม่มีอ่างกลาง ต้องไม่เรียกประวัติอ่าง'); assert.deepEqual(writes, []); assert.deepEqual(problems, [])
      await shootDiagram(page, 'route-tamnaktham-1280.png')
    } finally { await context.close() }
  })
  await check('ตำหนักธรรม · แท็บสถานการณ์: Y.38 = อยู่ในตำบล · YOM003 = ผังไม่ระบุ ที่การ์ดระดับน้ำเดิม · ไม่มีการ์ดอ่าง', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'tamnaktham', { diagram: 'tamnaktham', tab: 'situation' })
    try {
      const levels = page.locator('#water-levels')
      const levelText = await levels.innerText()
      assert.ok(levelText.includes('อยู่ในตำบล') && levelText.includes('ผังไม่ระบุ'), 'Y.38 = อยู่ในตำบล · YOM003 = ผังไม่ระบุ')
      assert.ok(await levels.locator('[data-relation-note]').count() >= 1)
      assert.equal(await page.locator('[data-related-dam], #water-dams').count(), 0, 'ตำหนักธรรมไม่มีอ่าง ห้ามมีการ์ดอ่าง')
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })
  await check('ทุ่งแค้ว · แท็บผังน้ำตำบล: ก่อนถึงตำบล 4 / ไหลต่อไปที่ 2 · ปลายคลองชลประทานเป็น "ผังไม่ระบุ" · จำนวนที่ผังวาด (อ่าง 3 · ฝายประมาณ 27 · หนอง 3 · ห้วยสาขาประมาณ 23) ไม่นับแผนก่อสร้าง ไม่ขัดกับแถบตัวเลขบนภาพ', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'thungkaew', { diagram: 'thungkaew' })
    try {
      await assertDisclaimerAndAge(page, 'thungkaew')
      await assertEdgesShape(page, 'thungkaew', { up: 4, down: 2 })
      const down = edges(page).locator('[data-edge="downstream"]')
      assert.equal(await down.locator('[data-node="down-canal-end"]').getAttribute('data-status'), 'unconfirmed')
      await assertSourceTab(page, 'thungkaew', 'อ่าง 3 แห่ง · ฝายประมาณ 27 แห่ง · หนอง 3 แห่ง · ห้วยสาขาประมาณ 23 สาย', 14)
      // ตัวเลขชุดเดียว: แถบหัวภาพบอก "แผนก่อสร้าง 2 · ชำรุดตามผัง 1" (เดิมส่วนระบบน้ำบอก "แผนก่อสร้าง 3 · รางชำรุด 2 จุด" นับคนละหน่วย) — ตอนนี้เหลือชุดเดียว
      const tiles = await page.locator('[data-poster-tile]').evaluateAll(els => els.map(el => [el.getAttribute('data-poster-tile'), el.querySelectorAll('text')[0].textContent]))
      assert.deepEqual(tiles.filter(([name]) => /แผนก่อสร้าง|ชำรุด/.test(name)), [['แผนก่อสร้าง', '2'], ['ชำรุดตามผัง', '1']])
      assert.ok(!/แผนก่อสร้าง 3 รายการ|ชำรุด 2 จุด/.test(await page.locator('#water-panel-route').innerText()), 'ห้ามมีตัวเลขแผนก่อสร้าง/ชำรุดอีกชุดที่ไม่ตรงกับแถบหัวภาพ')
      assert.equal(historyCalls.length, 0); assert.deepEqual(writes, []); assert.deepEqual(problems, [])
      await shootDiagram(page, 'route-thungkaew-1280.png')
    } finally { await context.close() }
  })
  await check('ทุ่งแค้ว · แท็บสถานการณ์: YOM003 ติดป้ายผังไม่ระบุ · ไม่มีการ์ดแนวโน้ม · ไม่มีส่วนระบบน้ำท้ายแท็บ', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'thungkaew', { diagram: 'thungkaew', tab: 'situation' })
    try {
      assert.ok((await page.locator('#water-levels').innerText()).includes('ผังไม่ระบุ'), 'YOM003 ต้องติดป้ายผังไม่ระบุ')
      assert.equal(await page.locator('#water-panel-situation').locator('#water-system, [data-edge], [data-water-edges], [data-related-dam]').count(), 0)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  // ── 5) ล็อกว่าไม่เพิ่มงานเจ้าหน้าที่ + เป้ากด + ไม่ล้นจอ (ทุกตำบล × 4 ความกว้าง) ──
  for (const [sceneName, id] of [['ready', 'namlao'], ['tamnaktham', 'tamnaktham'], ['thungkaew', 'thungkaew']]) {
    for (const width of [360, 390, 768, 1280]) {
      await check(`${id} ${width}px: ก่อนถึงตำบล/ไหลต่อไปที่ ไม่ล้นจอ · เป้ากด ≥ ${MIN_TAP}px · ไม่มีช่องกรอก (ขยายทุกรายการแล้วก็ไม่ล้น)`, async () => {
        const { context, page, problems } = await openScene(browser, baseUrl, sceneName, { width, diagram: id })
        try {
          assert.equal(await edges(page).locator('input, textarea, select, form, [contenteditable]').count(), 0, 'ส่วนนี้อ่านอย่างเดียว')
          await assertNoHorizontalOverflow(page, `${id} ${width}px`)
          const small = await edges(page).locator('button, a[href]').evaluateAll((nodes, min) => nodes
            .map(n => ({ text: (n.textContent || '').trim().slice(0, 30), h: Math.round(n.getBoundingClientRect().height) }))
            .filter(n => n.h > 0 && n.h < min), MIN_TAP)
          assert.deepEqual(small, [], `เป้ากดเล็กกว่า ${MIN_TAP}px`)
          // ปุ่มเปลี่ยนชื่อเป็น "ย่อรายการ" หลังกด จึงกดปุ่มแรกที่ยังเป็น "ดูทั้งหมด" ซ้ำจนไม่เหลือ
          const more = edges(page).getByRole('button', { name: /ดูทั้งหมด \d+ รายการ/ })
          while (await more.count() > 0) await more.first().click()
          await assertNoHorizontalOverflow(page, `${id} ${width}px ขยายทุกรายการ`)
          await shootDiagram(page, `route-${id}-${width}.png`)
          assert.deepEqual(problems, [])
        } finally { await context.close() }
      })
    }
  }

  // ── 6) การเลือกระบบสำหรับป้ายความสัมพันธ์ (แท็บสถานการณ์) ──
  await check('?system= บน demo: เลือกระบบของตำบลที่ขอได้ · ค่าแปลก/ไม่ใส่ = น้ำเลา (ค่าเริ่มต้น) ไม่พัง', async () => {
    // ตำหนักธรรม: Y.38 ติดป้าย "อยู่ในตำบล" ที่การ์ดระดับน้ำ · น้ำเลา: 305 ติดป้าย "ต้นน้ำของตำบล"
    for (const [query, mark, where] of [
      ['?system=tamnaktham&tab=situation', 'อยู่ในตำบล', '#water-levels'],
      ['?system=namlao&tab=situation', 'ต้นน้ำของตำบล', '#water-dam-305'],
      ['?tab=situation', 'ต้นน้ำของตำบล', '#water-dam-305'],
      ['?system=nope&tab=situation', 'ต้นน้ำของตำบล', '#water-dam-305'],
      ['?system=__proto__&tab=situation', 'ต้นน้ำของตำบล', '#water-dam-305'],
      ['?system=constructor&tab=situation', 'ต้นน้ำของตำบล', '#water-dam-305'],
      ['?system=TAMNAKTHAM&tab=situation', 'ต้นน้ำของตำบล', '#water-dam-305'],
    ]) {
      const { context, page, problems } = await openScene(browser, baseUrl, query.includes('tamnaktham&') ? 'tamnaktham' : 'ready', { query, tab: 'situation' })
      try {
        assert.ok((await page.locator(where).innerText()).includes(mark), `query "${query}": ต้องมี "${mark}" ที่ ${where}`)
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    }
  })

  // ── 7) ลำดับแท็บสถานการณ์: ภาพรวมก่อน กราฟรายชั่วโมง ──
  await check('แท็บสถานการณ์: อัปเดตล่าสุด → การ์ดสรุป → กราฟรายชั่วโมง → ปุ่มลัดหมวด → รายการฝน/อ่าง/ระดับน้ำ (กราฟสูงราว 1,200px ไม่ดันการ์ดสรุปลงไปสองจอ)', async () => {
    for (const width of [390, 1280]) {
      const { context, page, problems } = await openScene(browser, baseUrl, 'ready', { width, tab: 'situation' })
      try {
        const top = async locator => (await locator.first().boundingBox())?.y
        const sync = await top(page.getByText(/อัปเดตล่าสุด/))
        const hero = await top(page.getByText('ฝนสูงสุด 24 ชม.'))
        const hourly = await top(page.locator('section.hydro-panel'))
        const nav = await top(page.locator('.water-section-nav'))
        assert.ok(sync !== undefined && hero !== undefined && hourly !== undefined && nav !== undefined, `${width}px: ต้องเห็นครบทุกส่วน ${JSON.stringify({ sync, hero, hourly, nav })}`)
        assert.ok(sync < hero && hero < hourly && hourly < nav, `${width}px: ลำดับต้องเป็นอัปเดตล่าสุด < การ์ดสรุป < กราฟรายชั่วโมง < ปุ่มลัดหมวด ได้ ${JSON.stringify({ sync, hero, hourly, nav })}`)
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    }
  })
  // ── 8) แถวแจ้งเหตุ/ขอความช่วยเหลือเรื่องน้ำ ท้ายแท็บผังน้ำตำบล ──
  //   ข้อมูลจริง production 2569-10-24: ไม่มี อปท. ไหนมีหมวด flood · water_supply เปิดให้ประชาชนที่ตำหนักธรรม/ทุ่งแค้ว แต่ปิด+เฉพาะผู้มีตำแหน่งที่น้ำเลา
  const CAT = (value, extra = {}) => ({ value, label: value === 'flood' ? 'น้ำท่วม/ระบายน้ำ' : 'สนับสนุนน้ำอุปโภค', emoji: value === 'flood' ? '🌊' : '🚿', is_active: true, submit_audience: 'public', ...extra })
  const helpRow = page => page.locator('[data-water-help]')
  const helpButtons = page => helpRow(page).locator('[data-help-category]')
  const helpValues = page => helpButtons(page).evaluateAll(els => els.map(el => el.getAttribute('data-help-category')))

  async function assertHelpBasics(page, id) {
    await helpRow(page).waitFor({ state: 'visible', timeout: 10_000 })
    const emergency = helpRow(page).locator('[data-help-emergency]')
    assert.equal(await emergency.getAttribute('href'), '/emergency', `${id}: สายด่วนต้องพาไปหน้า /emergency`)
    assert.ok((await emergency.innerText()).includes('สายด่วนฉุกเฉิน'))
    const text = await helpRow(page).innerText()
    assert.ok(text.includes('เกิดเหตุหรือต้องการความช่วยเหลือเรื่องน้ำ') && text.includes('หากเกิดเหตุฉุกเฉิน ให้ติดต่อสายด่วนก่อน'), `${id}: ต้องมีหัวข้อและข้อความนำ`)
    assert.ok(!/\b(191|1669|1784|199|1196)\b|tel:/.test(text + (await helpRow(page).innerHTML())), `${id}: ห้ามฝังเบอร์โทรในแถว (เบอร์อยู่ในฐานข้อมูล หน้า /emergency แสดงให้)`)
    // อยู่ท้ายแท็บผังน้ำตำบล: ใต้ภาพ/ก่อนถึงตำบล/ไหลต่อไปที่ · อยู่ในแผงของแท็บนี้ ไม่อยู่ในแท็บสถานการณ์
    const [diagram, row] = await Promise.all([diagramSection(page).boundingBox(), helpRow(page).boundingBox()])
    assert.ok(row.y >= diagram.y + diagram.height - 1, `${id}: แถวต้องอยู่ใต้ผังทั้งส่วน (แถว y=${Math.round(row.y)} ผังจบ y=${Math.round(diagram.y + diagram.height)})`)
    assert.equal(await page.locator('#water-panel-route [data-water-help]').count(), 1)
    assert.equal(await page.locator('#water-panel-situation [data-water-help]').count(), 0, `${id}: ไม่อยู่ในแท็บสถานการณ์`)
    assert.equal(await helpRow(page).locator('input, textarea, select, form, [contenteditable]').count(), 0, 'แถวนี้อ่านอย่างเดียว')
  }

  await check('แถวแจ้งเหตุ · น้ำเลา (หมวดน้ำอุปโภคปิด/เฉพาะผู้มีตำแหน่ง): ประชาชนเห็นแต่สายด่วนฉุกเฉิน ไม่มีปุ่มที่พาไปฟอร์มที่ยื่นไม่ได้', async () => {
    const { context, page, problems, writes } = await openScene(browser, baseUrl, 'ready', { diagram: 'namlao', categories: [CAT('water_supply', { is_active: false, submit_audience: 'officials' })] })
    try {
      await assertHelpBasics(page, 'namlao')
      assert.deepEqual(await helpValues(page), [], 'หมวดปิด/เฉพาะผู้มีตำแหน่ง ต้องไม่ขึ้นปุ่มให้ประชาชน')
      assert.deepEqual(writes, []); assert.deepEqual(problems, [])
      await shootDiagram(page, 'help-namlao-1280.png')
    } finally { await context.close() }
  })
  await check('แถวแจ้งเหตุ · ตำหนักธรรม/ทุ่งแค้ว (หมวดน้ำอุปโภคเปิดให้ทุกคน): ขึ้นปุ่มพาไปฟอร์มรับเรื่องพร้อมเลือกหมวด · กดแล้วไปหน้าฟอร์มจริง', async () => {
    const { context, page, problems, writes } = await openScene(browser, baseUrl, 'tamnaktham', { diagram: 'tamnaktham', categories: [CAT('water_supply')] })
    try {
      await assertHelpBasics(page, 'tamnaktham')
      assert.deepEqual(await helpValues(page), ['water_supply'])
      const button = helpButtons(page).first()
      assert.equal(await button.getAttribute('href'), '/request?category=water_supply')
      assert.ok((await button.innerText()).includes('สนับสนุนน้ำอุปโภค'))
      await button.click()
      await page.waitForURL(/\/request\?category=water_supply/, { timeout: 15_000 })
      assert.deepEqual(writes, [])
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })
  await check('แถวแจ้งเหตุ · เมื่อ อปท. มีหมวดรหัส flood ปุ่มขึ้นเอง (flood ก่อน water_supply) · หมวดอื่น/ซ่อมประปาไม่ขึ้น', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'thungkaew', { diagram: 'thungkaew', categories: [CAT('water_supply'), CAT('road'), CAT('water_repair'), CAT('flood')] })
    try {
      await assertHelpBasics(page, 'thungkaew')
      assert.deepEqual(await helpValues(page), ['flood', 'water_supply'])
      assert.equal(await helpButtons(page).first().getAttribute('href'), '/request?category=flood')
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })
  await check('แถวแจ้งเหตุ · หมวดที่เปิดแต่เฉพาะผู้มีตำแหน่ง/ปิดอยู่/โหลดตารางไม่ได้: ไม่ขึ้นปุ่ม เหลือสายด่วนเสมอ ไม่พัง', async () => {
    for (const [name, options] of [
      ['เฉพาะผู้มีตำแหน่ง', { categories: [CAT('flood', { submit_audience: 'officials' }), CAT('water_supply', { submit_audience: 'officials' })] }],
      ['ปิดอยู่', { categories: [CAT('flood', { is_active: false }), CAT('water_supply', { is_active: false })] }],
      ['ไม่มีแถวเลย', { categories: [] }],
      ['ตารางตอบ 500', { categories: [], categoriesStatus: 500 }],
    ]) {
      const { context, page, problems } = await openScene(browser, baseUrl, 'ready', { diagram: 'namlao', ...options })
      try {
        await assertHelpBasics(page, name)
        assert.deepEqual(await helpValues(page), [], `${name}: ต้องไม่ขึ้นปุ่มหมวด`)
        assert.deepEqual(problems, [], `${name}: ต้องไม่มี JS error`)
      } finally { await context.close() }
    }
  })
  for (const width of [360, 390, 768, 1280]) {
    await check(`แถวแจ้งเหตุ ${width}px: ไม่ล้นจอ · เป้ากด ≥ ${MIN_TAP}px · ปุ่มไม่ซ้อนกัน`, async () => {
      const { context, page, problems } = await openScene(browser, baseUrl, 'thungkaew', { width, diagram: 'thungkaew', categories: [CAT('water_supply'), CAT('flood')] })
      try {
        await assertHelpBasics(page, `${width}px`)
        await assertNoHorizontalOverflow(page, `แถวแจ้งเหตุ ${width}px`)
        const boxes = await helpRow(page).locator('a[href]').evaluateAll((nodes, min) => nodes.map(n => {
          const r = n.getBoundingClientRect()
          return { text: (n.textContent || '').trim().slice(0, 24), h: Math.round(r.height), x: r.x, y: r.y, right: r.right, bottom: r.bottom, small: r.height < min }
        }), MIN_TAP)
        assert.equal(boxes.length, 3, 'สายด่วน + 2 หมวด')
        assert.deepEqual(boxes.filter(b => b.small).map(b => b.text), [], `เป้ากดเล็กกว่า ${MIN_TAP}px`)
        for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]; const b = boxes[j]
          assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, `ปุ่ม "${a.text}" ซ้อนกับ "${b.text}"`)
        }
        await helpRow(page).scrollIntoViewIfNeeded()
        await helpRow(page).screenshot({ path: path.join(SHOT_DIR, `help-row-${width}.png`) })
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`)
process.exit(failed.length ? 1 : 0)
