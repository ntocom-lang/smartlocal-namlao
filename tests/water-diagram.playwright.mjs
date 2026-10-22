// E2E: ผังน้ำตำบล (src/components/water/WaterDiagram.jsx) — ทุ่งแค้ว · ตำหนักธรรม · น้ำเลา ใช้แผนภาพเส้นทางน้ำ (WaterRouteArt) ทั้งหมด
// เดิม: ทุ่งแค้ว + ตำหนักธรรม + น้ำเลา บนหน้า /water-situation
// ผังทุ่งแค้วเป็นค่าเริ่มต้นของ demo · ผังอื่นเปิดบน demo ด้วย ?diagram=tamnaktham | namlao
//
// ตรวจ: ค่าสดบนผัง (อ่างเล็ก/ฝน/ระดับน้ำ) ทั้งแบบปกติ ค้าง และไม่มีค่า · 2 โหมด · เลย์เอาต์ 360/390/768/1280 · ปุ่ม ≥ 44px
//   · เส้นวิ่งเฉพาะโครงสร้างที่มีตามผัง (ชำรุด/แผนก่อสร้างไม่วิ่ง) · กดหยุด · ลดการเคลื่อนไหว · คำกำกับและที่มาอยู่ครบ
//   · ชื่อห้วย 4 เส้นที่ยังไม่ยืนยันกับ อบต. ต้องไม่โผล่บนหน้า
//
// อ่านอย่างเดียว ไม่เขียนข้อมูลใด · คำตอบ Worker (/api/small-reservoir) และ RPC สถานีถูกจำลองในเบราว์เซอร์ทั้งหมด
// (vite dev ไม่รัน Worker และ demo ไม่มีสถานี RES038/YOM003 ของทุ่งแค้ว) จึงไม่ยิงต้นทางจริงและไม่ต้องล็อกอิน
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม:
//   VITE_TENANT_SLUG=demo npm run dev -- --port 5174
//   node tests/water-diagram.playwright.mjs            (http://localhost:5174)
//   WD_TEST_BASE_URL=http://127.0.0.1:5176 node tests/water-diagram.playwright.mjs

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { THUNGKAEW_DIAGRAM } from '../src/lib/waterDiagram/thungkaew.js'
import { DIAGRAMS } from '../src/lib/waterDiagram/diagrams.js'
import { CHIP_TONES } from '../src/lib/waterDiagram/model.js'

const DEFAULT_BASE_URL = 'http://localhost:5174'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const SHOT_DIR = path.join(process.cwd(), 'screenshots', 'water-diagram')
const DAY = 86_400_000

function resolveBaseUrl() {
  const raw = (process.env.WD_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${url.hostname}`)
  return raw
}

// วันที่ไทยของ "n วันก่อน" รูปแบบ YYYY-MM-DD — ต้องตรงกับที่หน้าเว็บใช้คำนวณอายุรายงาน
const bangkokDay = daysAgo => new Date(Date.now() + 7 * 3_600_000 - daysAgo * DAY).toISOString().slice(0, 10)
const hoursAgo = hours => new Date(Date.now() - hours * 3_600_000).toISOString()

function reservoirJson(id, name, capacity, pctNow, ageDays) {
  // ค่าต่างกันทุกรายงาน (ไม่ให้ติดป้าย "ตัวเลขซ้ำเดิม") · เรียงใหม่ → เก่า ห่างกันรายสัปดาห์
  const rows = Array.from({ length: 12 }, (_, i) => {
    const pct = Number((pctNow - i * 1.7).toFixed(2))
    return { d: bangkokDay(ageDays + i * 7), pct, vol: Number((capacity * pct / 100).toFixed(2)) }
  })
  return { id: String(id), name, capacity, rows, fetchedAt: new Date().toISOString(), refreshFailed: false }
}

const station = (type, code, name, extra) => ({
  station_type: type, station_code: code, station_name: name, tambon_name: 'ทุ่งแค้ว', amphoe_name: 'หนองม่วงไข่', province_name: 'แพร่',
  river_name: null, agency_name: 'สสน.', latitude: 18.3, longitude: 100.13, distance_km: 1.8, is_primary: false, note: null,
  recorded_at: null, rain_24h_mm: null, rain_1h_mm: null, waterlevel_msl: null, bank_diff_m: null, storage_percent: null,
  situation_level: null, situation_text: null, situation_color: null, dam_storage_mcm: null, dam_capacity_mcm: null,
  dam_inflow_mcm: null, dam_released_mcm: null, prev_recorded_at: null, prev_waterlevel_msl: null, prev_dam_storage_mcm: null,
  dam_same_count: null, dam_same_since: null, dam_same_capped: null, ...extra,
})

const tkStation = extra => station('waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', {
  tambon_name: 'ตำหนักธรรม', river_name: 'น้ำแม่คำมี', distance_km: 0.7, recorded_at: hoursAgo(0.5), bank_diff_m: 2.35, waterlevel_msl: 190.2, ...extra,
})

const nlDam = extra => station('dam', '305', 'อ่างเก็บน้ำแม่คำปอง', {
  tambon_name: 'น้ำเลา', amphoe_name: 'ร้องกวาง', distance_km: 3.6, recorded_at: hoursAgo(2), storage_percent: 84.5,
  dam_storage_mcm: 5.71, dam_capacity_mcm: 6.76, ...extra,
})
const nlRain = (code, name, mm, km, age = 0.5) => station('rain', code, name, {
  tambon_name: 'น้ำเลา', amphoe_name: 'ร้องกวาง', distance_km: km, recorded_at: hoursAgo(age), rain_24h_mm: mm,
})

// ฉากจำลอง — ปกติ = สถานีฝน/ระดับน้ำสด + รายงานอ่างใหม่ · ค้าง = ทุกอย่างเก่า · ว่าง = ไม่มี RES038/YOM003
const SCENES = {
  normal: {
    dams: { 50: reservoirJson(50, 'อ่างเก็บน้ำห้วยยอย', 0.3, 73.2, 2), 30: reservoirJson(30, 'อ่างเก็บน้ำห้วยปุย', 0.28, 76.79, 2) },
    stations: [
      station('rain', 'RES038', 'อ่างเก็บน้ำห้วยยอย', { recorded_at: hoursAgo(0.5), rain_24h_mm: 12.5, distance_km: 1.8 }),
      station('waterlevel', 'YOM003', 'หนองม่วงไข่', { recorded_at: hoursAgo(0.5), bank_diff_m: 4.55, waterlevel_msl: 143.1, distance_km: 4.8, river_name: 'แม่น้ำยม' }),
    ],
  },
  stale: {
    dams: { 50: reservoirJson(50, 'อ่างเก็บน้ำห้วยยอย', 0.3, 73.2, 30), 30: reservoirJson(30, 'อ่างเก็บน้ำห้วยปุย', 0.28, 76.79, 30) },
    stations: [
      station('rain', 'RES038', 'อ่างเก็บน้ำห้วยยอย', { recorded_at: hoursAgo(5), rain_24h_mm: 12.5 }),
      station('waterlevel', 'YOM003', 'หนองม่วงไข่', { recorded_at: hoursAgo(5), bank_diff_m: 4.55, distance_km: 4.8 }),
    ],
  },
  empty: {
    dams: null, // Worker ล่ม
    stations: [station('rain', 'OTHER', 'สถานีอื่น', { recorded_at: hoursAgo(0.5), rain_24h_mm: 0 })],
  },
  // ตำหนักธรรม (?diagram=tamnaktham): ผังไม่มีอ่างเล็ก มีแต่ระดับน้ำ Y.38 ที่ห่างสำนักงาน 0.7 กม.
  tkNormal: { dams: null, stations: [tkStation({})] },
  tkStale: { dams: null, stations: [tkStation({ recorded_at: hoursAgo(5) })] },
  tkNull: { dams: null, stations: [tkStation({ bank_diff_m: null })] },
  tkEmpty: { dams: null, stations: [station('rain', 'OTHER', 'สถานีอื่น', { recorded_at: hoursAgo(0.5), rain_24h_mm: 0 })] },
  // น้ำเลา (?diagram=namlao): ไม่มีอ่างเล็ก · อ่างแม่คำปอง (dam 305) + ฝนบ้านบุญแจ่ม + ฝน RES040
  nlNormal: { dams: null, stations: [nlDam({}), nlRain('STN0911', 'บ้านบุญแจ่ม', 12.5, 2.6), nlRain('RES040', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 0, 2.9)] },
  nlOver: { dams: null, stations: [nlDam({ storage_percent: 100.4 }), nlRain('STN0911', 'บ้านบุญแจ่ม', 1, 2.6), nlRain('RES040', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 1, 2.9)] },
  nlSame: { dams: null, stations: [nlDam({ dam_same_count: 5, dam_same_since: hoursAgo(120) }), nlRain('STN0911', 'บ้านบุญแจ่ม', 1, 2.6), nlRain('RES040', 'x', 1, 2.9)] },
  nlStale: { dams: null, stations: [nlDam({ recorded_at: hoursAgo(60) }), nlRain('STN0911', 'บ้านบุญแจ่ม', 12.5, 2.6, 5), nlRain('RES040', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 3, 2.9, 5)] },
  nlNull: { dams: null, stations: [nlDam({ storage_percent: null }), nlRain('STN0911', 'บ้านบุญแจ่ม', null, 2.6), nlRain('RES040', 'x', null, 2.9)] },
  nlEmpty: { dams: null, stations: [station('rain', 'OTHER', 'สถานีอื่น', { recorded_at: hoursAgo(0.5), rain_24h_mm: 0 })] },
  // ค่าว่างจากต้นทางต้องไม่กลายเป็น 0 / "ปกติ"
  nullvalues: {
    dams: { 50: reservoirJson(50, 'อ่างเก็บน้ำห้วยยอย', 0.3, 73.2, 2), 30: reservoirJson(30, 'อ่างเก็บน้ำห้วยปุย', 0.28, 76.79, 2) },
    stations: [
      station('rain', 'RES038', 'อ่างเก็บน้ำห้วยยอย', { recorded_at: hoursAgo(0.5), rain_24h_mm: null }),
      station('waterlevel', 'YOM003', 'หนองม่วงไข่', { recorded_at: hoursAgo(0.5), bank_diff_m: null, distance_km: 4.8 }),
    ],
  },
}

// ฝนหนักมาก (≥ 90.1 มม.) ทำให้แถบแจ้งเตือนสถานการณ์ของหน้าขึ้น
SCENES.heavyRain = { ...SCENES.normal, stations: [station('rain', 'RES038', 'อ่างเก็บน้ำห้วยยอย', { recorded_at: hoursAgo(0.5), rain_24h_mm: 95.5, distance_km: 1.8 })] }

async function openScene(browser, baseUrl, sceneName, { width = 1280, height = 900, reducedMotion = 'no-preference', diagram = null, tab = 'route', announcement = null } = {}) {
  const scene = SCENES[sceneName]
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH', reducedMotion })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  const reservoirRequests = []
  await page.route('**/api/small-reservoir*', route => {
    const id = new URL(route.request().url()).searchParams.get('id')
    reservoirRequests.push(id)
    if (!scene.dams?.[id]) return route.fulfill({ status: 503, json: { error: 'down' } })
    return route.fulfill({ json: scene.dams[id] })
  })
  await page.route('**/rest/v1/rpc/get_public_water_situation', route =>
    route.fulfill({ json: { synced_at: hoursAgo(0.2), stations: scene.stations, warnings: [] } }))
  await page.route('**/rest/v1/rpc/get_public_water_announcement', route => route.fulfill({ json: announcement }))
  // tab: 'route' (ค่าเริ่มต้นของเทสต์แผนภาพ) | 'situation' | null = ไม่ใส่พารามิเตอร์ ให้หน้าเลือกเอง (ใส่ ?diagram= = เส้นทางน้ำ ไม่ใส่ = สถานการณ์)
  const query = new URLSearchParams()
  if (diagram) query.set('diagram', diagram)
  if (tab) query.set('tab', tab)
  await page.goto(`${baseUrl}/water-situation${query.size ? `?${query}` : ''}`, { waitUntil: 'domcontentloaded' })
  const landing = tab ?? (diagram ? 'route' : 'situation')
  await (landing === 'route' ? page.locator('#water-diagram') : page.locator('#water-rain')).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1200)
  return { context, page, problems, reservoirRequests }
}

const section = page => page.locator('#water-diagram')

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
  // ═══ ทุ่งแค้ว = แผนภาพเส้นทางน้ำ (ข้อ 1–6 + แท็บ) · ตำหนักธรรม/น้ำเลา = แผนภาพเส้นทางน้ำเหมือนกัน (ข้อ 7–8 + เลย์เอาต์ในข้อ 4) ═══
  const route = THUNGKAEW_DIAGRAM.route
  const routeSvg = page => section(page).locator('svg[data-route-art]')
  const routeText = page => routeSvg(page).textContent()
  const pill = (page, text) => routeSvg(page).locator('g[data-pill] text', { hasText: text })
  const routeList = page => section(page).locator('[data-route-list]')
  const tabButton = (page, name) => section(page).getByRole('tab', { name })
  // หน้าตาจริงของกรอบป้าย (สี + ขอบประ) แยกตามโทน — กันกรณีโทนในข้อมูลถูกต้องแต่วาดออกมาเหมือนกันหมด
  const pillLook = (page, tone) => routeSvg(page).locator(`g[data-pill="${tone}"] > rect`).evaluateAll(rects =>
    rects.map(r => ({ stroke: r.getAttribute('stroke'), dashed: r.hasAttribute('stroke-dasharray') })))

  // ป้ายที่โทนไม่อยู่ในตาราง CHIP_TONES (เช่น undefined จากช่องที่ไม่มี) — ต้องไม่มีเลย
  const unknownPillTones = page => routeSvg(page).locator('g[data-pill]').evaluateAll(
    (els, known) => els.map(el => el.getAttribute('data-pill')).filter(tone => !known.includes(tone)),
    Object.keys(CHIP_TONES))

  // ── 1) ค่าสดปกติ: ป้ายบนภาพ + รายการจุด ──
  await check('ค่าสดปกติ: ป้ายบนภาพ (อ่าง 2 แห่ง · ฝน · ระดับน้ำพร้อมระยะ) และรายการจุดมีหมายเลขตรงกัน', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'normal')
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      await pill(page, '76.8%').waitFor()
      await pill(page, 'ฝน 12.5 มม.').waitFor()
      await pill(page, 'ต่ำกว่าตลิ่ง 4.55 ม.').waitFor()
      assert.equal(await routeSvg(page).locator('g[data-pill="ok"]').count(), 4, 'ป้ายค่าสดสด 4 ช่อง (โทนฟ้า)')
      assert.deepEqual(await pillLook(page, 'ok'), Array(4).fill({ stroke: CHIP_TONES.ok.stroke, dashed: false }), 'ป้ายที่มีค่าสดต้องเป็นขอบทึบสีฟ้า')
      assert.equal(await routeSvg(page).locator('[data-pin]').count(), 14)
      assert.equal(await routeList(page).locator('li').count(), 14, 'รายการจุดต้องครบ 14 จุด (13 เกาะ + แม่น้ำ)')
      const list = await routeList(page).innerText()
      for (const expected of ['73.2% · รายงาน', '76.8% · รายงาน', 'ฝนสะสม 24 ชม. 12.5 มม.', 'หนองม่วงไข่ ห่าง 4.8 กม. · ต่ำกว่าตลิ่ง 4.55 ม.']) {
        assert.ok(list.includes(expected), `รายการจุดต้องมี "${expected}"`)
      }
      assert.match(await section(page).locator('h2').innerText(), /เส้นทางน้ำ\s*ตำบลทุ่งแค้ว/)
      // หัวโปสเตอร์ต้องอยู่บนสุด (เจ้าของระบบสั่ง 2569-10-22) ก่อนปุ่มหยุด → คำกำกับบังคับ → แท็บ → ภาพ
      const top = async locator => (await locator.boundingBox()).y
      const order = [
        await top(section(page).locator('[data-route-banner]')),
        await top(section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' })),
        await top(section(page).locator('[data-diagram-disclaimer]')),
        await top(section(page).getByRole('tablist')),
        await top(routeSvg(page)),
      ]
      assert.deepEqual(order, [...order].sort((x, y) => x - y), `ลำดับบนลงล่างต้องเป็น หัวโปสเตอร์ → ปุ่มหยุด → คำกำกับ → แท็บ → ภาพ: ${order}`)
      assert.equal(await section(page).locator('h2').count(), 1, 'ส่วนนี้มี h2 เดียว (หัวโปสเตอร์)')
      assert.ok(Math.abs(order[0] - (await top(section(page)))) < 2, 'หัวโปสเตอร์ชิดบนสุดของส่วน')
      assert.match(await section(page).innerText(), /ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต/)
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'route-normal-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  // ── 2) ค้าง: ไม่ใช่ "ปกติ" ──
  await check('ค่าค้าง: ป้ายขอบประเทา + หมายเหตุ "ไม่มีรายงานใหม่/ไม่มีค่าใหม่" · ค่าฝน/ระดับน้ำที่ค้างไม่โชว์เป็นตัวเลข · ไม่วาดลูกศรบอกระยะ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'stale')
    try {
      await pill(page, 'ไม่มีรายงานใหม่').first().waitFor({ timeout: 8000 })
      assert.equal(await routeSvg(page).locator('g[data-pill="stale"]').count(), 4, 'อ่าง 2 + ฝน + ระดับน้ำ ค้างทั้งหมด')
      assert.deepEqual(await pillLook(page, 'stale'), Array(4).fill({ stroke: CHIP_TONES.stale.stroke, dashed: true }), 'ป้ายที่ค้างต้องเป็นขอบประสีเทา ไม่ใช่ขอบทึบสีฟ้าแบบมีค่าสด')
      assert.equal(await pill(page, 'ไม่มีรายงานใหม่').count(), 2, 'อ่างทั้งสองต้องบอกว่าไม่มีรายงานใหม่')
      assert.equal(await pill(page, 'ไม่มีค่าใหม่').count(), 2, 'ฝนและระดับน้ำต้องบอกว่าไม่มีค่าใหม่')
      const text = await routeText(page)
      assert.ok(!/12\.5|4\.55|ต่ำกว่าตลิ่ง/.test(text), 'ค่าฝน/ระดับน้ำที่ค้างต้องไม่โชว์เป็นค่าปัจจุบัน')
      assert.equal(await routeSvg(page).locator('[data-river] g[aria-hidden="true"]').count(), 0, 'ไม่มีค่าสด = ไม่วาดลูกศรบอกระยะต่ำกว่าตลิ่ง')
      const list = await routeList(page).innerText()
      assert.ok(list.includes('ไม่มีรายงานใหม่ตั้งแต่') && list.includes('ไม่มีค่าใหม่ (วัดล่าสุด'))
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'route-stale-1280.png') })
    } finally { await context.close() }
  })

  // ── 3) ไม่มีสถานี/Worker ล่ม: บอกว่าไม่มี ไม่กลายเป็น 0 ──
  await check('ไม่มีสถานี + Worker ล่ม: ป้าย "ไม่มีค่า" + "โหลดไม่ได้" ไม่มีเลข 0 หรือคำว่าปกติ · ไม่เกิด JS error', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'empty')
    try {
      await pill(page, 'โหลดไม่ได้').first().waitFor({ timeout: 8000 })
      assert.equal(await pill(page, 'โหลดไม่ได้').count(), 2, 'อ่าง 2 แห่งโหลดไม่ได้')
      assert.equal(await routeSvg(page).locator('g[data-pill="na"] text', { hasText: /^ไม่มีค่า$/ }).count(), 4, 'อ่าง 2 + ฝน + ระดับน้ำ = ไม่มีค่า')
      assert.ok((await pillLook(page, 'na')).every(l => l.dashed && l.stroke === CHIP_TONES.na.stroke), 'ป้ายไม่มีค่าต้องเป็นขอบประสีเทา')
      const text = await routeText(page)
      assert.ok(!/ปกติ|0 มม\.|0%/.test(text), 'ห้ามมี "ปกติ" หรือ 0 เมื่อไม่มีค่า')
      const list = await routeList(page).innerText()
      assert.ok(list.includes('ยังโหลดรายงานอ่างนี้ไม่ได้ในตอนนี้') && list.includes('ไม่มีค่าในระบบ'))
      assert.deepEqual(problems, [], 'Worker ล่มต้องไม่ทำให้เกิด JS error')
    } finally { await context.close() }
  })

  await check('ค่าว่างจากต้นทาง (rain/bank เป็น null) ไม่กลายเป็น 0 หรือ "ต่ำกว่าตลิ่ง 0"', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nullvalues')
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      assert.equal(await routeSvg(page).locator('g[data-pill="na"] text', { hasText: /^ไม่มีค่า$/ }).count(), 2, 'ฝนและระดับน้ำว่าง = ไม่มีค่า')
      const text = await routeText(page)
      assert.ok(!/ตลิ่ง|0 มม/.test(text))
    } finally { await context.close() }
  })

  // ── 4) เลย์เอาต์ ──
  // ทุกผัง (แผนภาพเส้นทางน้ำ): ไม่มีปุ่มสลับโหมด/ซูม · มือถือเริ่มที่แผนภาพ · จอใหญ่รายการซ้ายภาพขวา · ทุกแท็บไม่ล้นจอ
  for (const [id, scene, waitText, shotName] of [['thungkaew', 'normal', '73.2%', 'route'], ['tamnaktham', 'tkNormal', 'ต่ำกว่าตลิ่ง 2.35 ม.', 'tk-route'], ['namlao', 'nlNormal', '84.5%', 'nl-route']]) for (const width of [360, 390, 768, 1280]) {
    await check(`เลย์เอาต์ ${id} ${width}px: ไม่เลื่อนแนวนอน · ไม่ล้นขอบจอ · ปุ่ม/ลิงก์ ≥ 44px · ตัวหนังสือบนภาพไม่เล็กเกินไป · ภาพ/รายการ/ที่มาตามแท็บ`, async () => {
      const { context, page } = await openScene(browser, baseUrl, scene, { width, diagram: id === 'thungkaew' ? null : id })
      try {
        await pill(page, waitText).waitFor({ timeout: 8000 })
        assert.equal(await section(page).getByRole('group', { name: 'โหมดแสดงผัง' }).count(), 0, 'มุมมองใหม่ไม่มีปุ่มสลับโหมด')
        assert.equal(await section(page).getByRole('button', { name: 'ย่อผัง' }).count() + await section(page).getByRole('button', { name: 'ขยายผัง' }).count(), 0, 'ภาพพอดีจอ ไม่มีปุ่มซูม')
        // ตรวจเลย์เอาต์ของแท็บที่เปิดอยู่ตอนนี้ (เรียกซ้ำทุกแท็บ)
        const layoutIssues = async label => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${label}: หน้าเลื่อนแนวนอน`)
          const clipped = await section(page).evaluate((root, limit) => [...root.querySelectorAll('*')]
            // ชิ้นส่วนภายใน SVG ข้าม (คลื่นแม่น้ำกว้างเกินกรอบโดยตั้งใจและถูกตัดด้วย clipPath) — ตรวจตัว svg เองพอ
            .filter(el => (el.offsetParent !== null || el instanceof SVGElement) && !el.parentElement?.closest('svg'))
            .map(el => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.right > limit + 1)
            .map(({ el, r }) => `${el.tagName}.${String(el.className?.baseVal ?? el.className).slice(0, 20)} right=${Math.round(r.right)}`), width)
          assert.deepEqual(clipped, [], `${label}: องค์ประกอบล้นขอบจอ ${width}px`)
          const small = await section(page).evaluate(root => [...root.querySelectorAll('button, a[href]')]
            .filter(el => el.offsetParent !== null)
            .map(el => ({ t: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height) }))
            .filter(item => item.h < 44))
          assert.deepEqual(small, [], `${label}: ปุ่ม/ลิงก์เล็กกว่า 44px: ${JSON.stringify(small)}`)
        }
        await layoutIssues('แท็บแผนภาพ')
        // ขนาดตัวหนังสือจริงบนจอ = font-size × สัดส่วนที่ภาพถูกย่อ (ภาพเป็น viewBox 480 หน่วย)
        const minPx = await routeSvg(page).evaluate(svg => {
          const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
          return Math.min(...[...svg.querySelectorAll('g[data-pill] text, [data-pin] text')].map(t => parseFloat(getComputedStyle(t).fontSize) * scale))
        })
        assert.ok(minPx >= (width <= 360 ? 8.5 : 9.5), `ตัวหนังสือบนภาพเล็กเกินไป ${minPx.toFixed(1)}px ที่ ${width}px`)
        const art = await routeSvg(page).boundingBox()
        if (width < 1024) {
          assert.equal(await routeList(page).isVisible(), false, 'มือถือ/แท็บเล็ต: เริ่มที่แท็บแผนภาพ ยังไม่เห็นรายการ')
          await tabButton(page, /^รายการจุด/).click()
          assert.equal(await routeList(page).isVisible(), true)
          assert.equal(await routeSvg(page).isVisible(), false, 'แท็บรายการจุดต้องซ่อนภาพ')
          await layoutIssues('แท็บรายการจุด')
        } else {
          const list = await routeList(page).boundingBox()
          assert.ok(list && list.x < art.x, 'จอใหญ่: รายการซ้าย ภาพขวา')
          assert.equal(await section(page).getByRole('tab', { name: /^รายการจุด/ }).count(), 0, 'จอกว้างรายการอยู่ข้างภาพแล้ว ไม่มีแท็บรายการ')
        }
        await tabButton(page, /^ที่มา$/).click()
        assert.equal(await section(page).locator('[data-diagram-source]').isVisible(), true)
        assert.equal(await routeSvg(page).isVisible(), false, 'แท็บที่มาต้องซ่อนภาพ')
        await layoutIssues('แท็บที่มา')
        await tabButton(page, /^แผนภาพ/).click()
        await section(page).screenshot({ path: path.join(SHOT_DIR, `${shotName}-${width}.png`) })
      } finally { await context.close() }
    })
  }

  // ── 5) เส้นวิ่ง / หยุด / ลดการเคลื่อนไหว ──
  const flowIds = route.streams.filter(s => s.flow).map(s => s.id).sort()
  await check(`เส้นวิ่ง: เฉพาะลำน้ำที่ผังวาดลูกศร (${flowIds.length} เส้น) พร้อมหัวลูกศร · ลำน้ำอื่นนิ่งและไม่มีหัวลูกศร · แผนก่อสร้าง/ชำรุดไม่มีแอนิเมชัน`, async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      const flowing = await routeSvg(page).locator('g[data-flow="true"]').evaluateAll(els => els.map(el => el.getAttribute('data-stream')).sort())
      assert.deepEqual(flowing, flowIds)
      const names = await routeSvg(page).locator('path.wr-flow').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.equal(names.length, flowIds.length)
      assert.ok(names.every(name => name === 'wr-dash'), 'เส้นวิ่งทุกเส้นต้องมีแอนิเมชัน')
      const still = await routeSvg(page).locator('path.wr-hl').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.equal(still.length, route.streams.length - flowIds.length)
      assert.ok(still.every(name => name === 'none'), 'ลำน้ำที่ผังไม่วาดลูกศรต้องไม่วิ่ง')
      assert.equal(await routeSvg(page).locator('g[data-flow="true"] > path[marker-end]').count(), flowIds.length, 'เส้นวิ่งมีหัวลูกศรปลายทาง')
      assert.equal(await routeSvg(page).locator('g[data-flow="false"] path[marker-end]').count(), 0, 'ลำน้ำที่ไม่วิ่งไม่มีหัวลูกศร (ไม่เดาทิศ)')
      // จุดแผนก่อสร้าง/ชำรุดทั้งกลุ่มต้องไม่มีแอนิเมชันเลย
      const animatedInside = await routeSvg(page).evaluate(svg => [...svg.querySelectorAll('[data-status="planned"] *, [data-status="repair"] *')]
        .filter(el => getComputedStyle(el).animationName !== 'none').length)
      assert.equal(animatedInside, 0)
      const waves = await routeSvg(page).locator('.wr-wave').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.ok(waves.length === 2 && waves.every(name => name === 'wr-wave'), 'แม่น้ำมีคลื่น 2 ชั้น')
    } finally { await context.close() }
  })

  await check('ปุ่ม "หยุดเคลื่อนไหว": หยุดแอนิเมชันจริง (เส้นวิ่ง + คลื่น) · กดอีกครั้งเล่นต่อ', async () => {
    // เริ่มที่แท็บสถานการณ์ → แผนภาพยังถูกซ่อนอยู่ (เมาท์ไว้แต่ไม่เห็น)
    const { context, page } = await openScene(browser, baseUrl, 'normal', { tab: 'situation' })
    try {
      await pill(page, '73.2%').waitFor({ state: 'attached', timeout: 8000 })
      const state = sel => routeSvg(page).locator(sel).first().evaluate(el => getComputedStyle(el).animationPlayState)
      // ภาพที่ยังอยู่นอกจอ (ตัวเฝ้าดู IntersectionObserver ตั้ง data-offscreen) ถูกหยุดโดยตั้งใจ — เลื่อนเข้าจอก่อนตรวจ
      assert.equal(await section(page).getAttribute('data-offscreen'), 'true', 'แท็บเส้นทางน้ำยังไม่ถูกเปิด (ซ่อนอยู่) = หยุดอยู่ (ไม่กินแบต)')
      await page.getByRole('tab', { name: 'เส้นทางน้ำ' }).click()
      await page.waitForFunction(() => !document.querySelector('#water-diagram')?.hasAttribute('data-offscreen'), null, { timeout: 5000 })
      assert.equal(await state('path.wr-flow'), 'running')
      assert.equal(await state('.wr-wave'), 'running')
      await section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' }).click()
      assert.equal(await state('path.wr-flow'), 'paused')
      assert.equal(await state('.wr-wave'), 'paused')
      assert.equal(await section(page).getByRole('button', { name: 'เล่นเคลื่อนไหว' }).getAttribute('aria-pressed'), 'true')
      await section(page).getByRole('button', { name: 'เล่นเคลื่อนไหว' }).click()
      assert.equal(await state('path.wr-flow'), 'running')
    } finally { await context.close() }
  })

  await check('ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว": เส้นและคลื่นไม่วิ่งเลย · มีข้อความบอก · หัวลูกศรยังบอกทิศ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal', { reducedMotion: 'reduce' })
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      for (const sel of ['path.wr-flow', '.wr-wave', '.wr-fall']) {
        const names = await routeSvg(page).locator(sel).evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
        assert.ok(names.length > 0 && names.every(name => name === 'none'), `${sel}: animationName ต้องเป็น none: ${[...new Set(names)]}`)
      }
      assert.equal(await routeSvg(page).locator('g[data-flow="true"] > path[marker-end]').count(), flowIds.length, 'ดูทิศจากหัวลูกศรได้แม้ไม่วิ่ง')
      assert.match(await section(page).innerText(), /ตั้งค่าให้ลดการเคลื่อนไหว/)
    } finally { await context.close() }
  })

  // ── 6) ข้อความบังคับ + ชื่อที่ยังไม่ยืนยัน + ครบทุกจุด ──
  await check('คำกำกับ "ไม่ได้แสดงว่ามีน้ำไหลจริง" + "ไม่ใช่แผนที่" + "ไม่มีเข็มทิศ" + คำอธิบายสัญลักษณ์ + ที่มา + ลิงก์ต้นฉบับ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      const artText = await section(page).innerText()
      await tabButton(page, /^ที่มา$/).click()
      const text = artText + '\n' + await section(page).innerText()
      await tabButton(page, /^แผนภาพ/).click()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ไม่ใช่แผนที่', 'ไม่มีเข็มทิศ', 'ไม่ได้หมายถึงสิ่งก่อสร้างหรือพื้นที่จริง']) {
        assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      }
      const legend = await section(page).locator('[data-route-legend]').innerText()
      for (const needed of ['อ่างเก็บน้ำ', 'ฝาย', 'หนอง', 'ประตูระบายน้ำ', 'กล่องแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', 'ลายขีดแดง = ชำรุดตามผัง ไม่เคลื่อนไหว', 'เส้นวิ่ง + หัวลูกศร', 'ขอบประ = ไม่มีค่า']) {
        assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      }
      assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 1)
      assert.ok(!/แล้ง|ท่วม/.test(await routeText(page)), 'ภาพห้ามเขียนว่าแล้ง/ท่วม')
    } finally { await context.close() }
  })

  await check('กล่องที่มาของทุ่งแค้ว: บอกอายุผังต้นฉบับ + ของที่ไม่ใส่/ไม่ตรงจริง (ชื่อห้วยอ่านไม่ชัด · ตำแหน่งฝาย · โครงสร้างอื่นในผัง)', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await tabButton(page, /^ที่มา$/).click()
      const text = await section(page).innerText()
      for (const needed of ['ไฟล์ลงวันที่ 9 พ.ค. 2567', 'ที่ผังต้นฉบับมีแต่เราวาดต่างไป หรือไม่ได้วาด', 'ไม่ขอเดาชื่อ', 'ตำแหน่งฝายและลำห้วยแต่ละแห่งบนแผนที่', 'ประปาหมู่ 1 และหมู่ 4']) assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), THUNGKAEW_DIAGRAM.omitted.length)
    } finally { await context.close() }
  })

  await check('ไม่มีชื่อห้วยแนวตั้ง 4 เส้นที่ยังไม่ยืนยัน (ห้วยจำค่า/ห้วยย่าเฟย) บนหน้า · รายการจุดครบทุกจุดของข้อมูล · แผนก่อสร้าง/ชำรุดมีแท็กในรายการ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      const text = await section(page).innerText()
      assert.ok(!/ห้วยจำค่า|ห้วยย่าเฟย/.test(text) && !/ห้วยจำค่า|ห้วยย่าเฟย/.test(await routeText(page)))
      const svgText = await routeText(page)
      for (const item of [...route.stops, route.river]) {
        const li = routeList(page).locator(`li[data-stop="${item.n}"]`)
        assert.ok((await li.innerText()).includes(item.name), `รายการขาดจุด ${item.n} ${item.name}`)
        if (item.label) assert.ok(svgText.includes(item.label), `ภาพขาดชื่อจุด ${item.n} ${item.label}`)
        if (item.status === 'planned') assert.ok((await li.innerText()).includes('แผนก่อสร้าง · ไม่เคลื่อนไหว'), `${item.name}: ต้องบอกว่าแผนก่อสร้าง`)
        if (item.status === 'repair') assert.ok((await li.innerText()).includes('ชำรุด ตามผัง · ไม่เคลื่อนไหว'), `${item.name}: ต้องบอกว่าชำรุด`)
      }
      assert.equal(await routeList(page).locator('li[data-status="planned"]').count(), 2)
      assert.equal(await routeList(page).locator('li[data-status="repair"]').count(), 1)
    } finally { await context.close() }
  })

  // ── แท็บ: แผนภาพ · รายการจุด · ที่มา (หน้ามือถือเคยยาวเกือบ 3,000px — เจ้าของระบบสั่งแบ่งแท็บ 2569-10-21) ──
  await check('แท็บ มือถือ 390px: เริ่มที่แผนภาพ · สลับรายการจุด/ที่มาได้ · แผงที่ไม่ได้เลือกถูกซ่อนจริง · ลูกศร/Home/End สลับแท็บ · ภาพเลิกวิ่งเมื่อซ่อน · หน้าสั้นลงมาก', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 390 })
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      const tabs = section(page).getByRole('tab')
      assert.deepEqual(await tabs.allInnerTexts(), ['แผนภาพ', 'รายการจุด (14)', 'ที่มา'])
      const selected = () => tabs.evaluateAll(els => els.filter(el => el.getAttribute('aria-selected') === 'true').map(el => el.innerText))
      const height = () => section(page).evaluate(el => Math.round(el.getBoundingClientRect().height))
      assert.deepEqual(await selected(), ['แผนภาพ'])
      assert.equal(await routeList(page).isVisible(), false)
      assert.equal(await section(page).locator('[data-diagram-source]').isVisible(), false)
      const art = await height()

      await tabButton(page, /^รายการจุด/).click()
      assert.deepEqual(await selected(), ['รายการจุด (14)'])
      assert.equal(await routeList(page).isVisible(), true)
      assert.equal(await routeSvg(page).isVisible(), false)
      assert.equal(await section(page).locator('[data-route-legend]').isVisible(), false)
      const list = await height()
      assert.equal(await routeList(page).locator('li').count(), 14)

      await tabButton(page, /^ที่มา$/).click()
      assert.equal(await section(page).locator('[data-diagram-source]').isVisible(), true)
      assert.equal(await section(page).locator('[data-route-view]').isVisible(), false)
      const source = await height()
      assert.match(await section(page).locator('[data-diagram-source]').innerText(), /ไม่ใช่ประกาศเตือนภัย/)

      // เดิมทั้งหมดอยู่หน้าเดียวสูง ~2,930px ที่ 390px (วัดจริง) — แต่ละแท็บต้องไม่เกินครึ่งหนึ่งเศษ (ตอนนี้ ~1,480 / ~1,450 / ~760)
      assert.ok(art < 1700 && list < 1700 && source < 900, `ความสูงแต่ละแท็บ: แผนภาพ ${art} · รายการ ${list} · ที่มา ${source}`)

      // คีย์บอร์ด: ลูกศร/Home/End สลับแท็บ (เลื่อนโฟกัสไปด้วย)
      await tabs.first().focus()
      await page.keyboard.press('ArrowRight')
      assert.deepEqual(await selected(), ['รายการจุด (14)'])
      await page.keyboard.press('End')
      assert.deepEqual(await selected(), ['ที่มา'])
      await page.keyboard.press('ArrowRight')
      assert.deepEqual(await selected(), ['แผนภาพ'], 'ลูกศรขวาที่แท็บสุดท้ายวนกลับแท็บแรก')
      await page.keyboard.press('ArrowLeft')
      assert.deepEqual(await selected(), ['ที่มา'])
      await page.keyboard.press('Home')
      assert.deepEqual(await selected(), ['แผนภาพ'])

      // กลับมาแท็บแผนภาพ ค่าสดยังอยู่ครบ
      await pill(page, '73.2%').waitFor()
      assert.equal(await routeSvg(page).locator('g[data-pill="ok"]').count(), 4)
    } finally { await context.close() }
  })

  await check('แท็บ จอกว้าง 1280px: ไม่มีแท็บรายการ (รายการอยู่ข้างภาพ) · แท็บที่มาใช้ได้ · ย่อจอจากกว้างเป็นมือถือแล้วกลับมา/ขยายจอตอนอยู่แท็บรายการ = กลับแท็บแผนภาพ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 1280 })
    try {
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
      const tabs = section(page).getByRole('tab')
      assert.deepEqual(await tabs.allInnerTexts(), ['แผนภาพและรายการ', 'ที่มา'])
      assert.equal(await routeList(page).isVisible(), true)
      assert.equal(await routeSvg(page).isVisible(), true)
      // ย่อเป็นมือถือ → ไปแท็บรายการ → ขยายกลับ: รายการขึ้นข้างภาพ และแท็บที่เลือกเป็นแผนภาพ
      await page.setViewportSize({ width: 390, height: 900 })
      await tabButton(page, /^รายการจุด/).click()
      assert.equal(await routeSvg(page).isVisible(), false)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.waitForFunction(() => document.querySelector('#water-diagram [role="tab"][aria-selected="true"]')?.innerText === 'แผนภาพและรายการ', null, { timeout: 5000 })
      assert.equal(await routeList(page).isVisible(), true)
      assert.equal(await routeSvg(page).isVisible(), true)
    } finally { await context.close() }
  })

  // ── แท็บบนสุดของหน้า (สถานการณ์ | เส้นทางน้ำ) — เจ้าของระบบสั่ง 2569-10-22 "ทำเส้นทางน้ำเป็นอีกแท็บด้านบน จะได้ไม่ต้องเลื่อนลงมาก" ──
  const pageTabs = page => page.getByRole('tablist', { name: /มุมมองของหน้า/ })
  const pageTab = (page, name) => pageTabs(page).getByRole('tab', { name })
  const visible = (page, selector) => page.locator(selector).first().isVisible()
  for (const width of [390, 1280]) {
    await check(`แท็บบนสุดของหน้า ${width}px: เริ่มที่สถานการณ์ · แท็บอยู่ใต้หัวหน้าทันที · กดเส้นทางน้ำเห็นแผนภาพในจอเดียวไม่ต้องเลื่อน · สลับกลับได้ · URL จำแท็บ`, async () => {
      const { context, page, problems } = await openScene(browser, baseUrl, 'normal', { width, tab: null })
      try {
        const tabs = pageTabs(page)
        const tabTexts = await tabs.getByRole('tab').allInnerTexts()
        assert.deepEqual(tabTexts.map(t => t.split('\n')[0].trim()), ['สถานการณ์', 'เส้นทางน้ำ'])
        assert.match(tabTexts[1], /ภาพประกอบ/, 'คำอธิบายใต้ชื่อแท็บ บอกคนมาใหม่ว่าแท็บนี้คือภาพประกอบ')
        assert.equal(await pageTab(page, 'สถานการณ์').getAttribute('aria-selected'), 'true', 'เริ่มที่แท็บสถานการณ์ (เหมือนหน้าเดิม)')
        assert.equal(await visible(page, '#water-rain'), true, 'แท็บสถานการณ์เห็นส่วนฝน')
        assert.equal(await visible(page, '#water-diagram'), false, 'แผนภาพซ่อนอยู่จนกว่าจะกดแท็บ')
        const boxes = await tabs.getByRole('tab').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top } }))
        assert.ok(boxes.every(b => b.h >= 60 && b.w >= 140), `แท็บต้องเป็นปุ่มใหญ่ (สูง ≥ 60px กว้าง ≥ 140px): ${JSON.stringify(boxes)}`)
        // เห็นชัดว่ากดได้: ตัวที่เลือกอยู่ทึบ (ไล่สี) ตัวที่ไม่ได้เลือกเป็นปุ่มขาวมีกรอบหนา — ไม่ใช่ตัวหนังสือลอยๆ
        const looks = await tabs.getByRole('tab').evaluateAll(els => els.map(el => { const c = getComputedStyle(el); return { filled: c.backgroundImage !== 'none', border: parseFloat(c.borderTopWidth), color: c.borderTopColor, radius: parseFloat(c.borderTopLeftRadius) } }))
        assert.deepEqual(looks.map(l => l.filled), [true, false], 'ตัวที่เลือกอยู่ทึบ ตัวที่ไม่ได้เลือกเป็นปุ่มขาว')
        assert.ok(looks.every(l => l.border >= 2 && l.radius >= 12), 'ทั้งสองปุ่มมีกรอบหนาและมุมมน (ดูเป็นปุ่ม)')
        assert.notEqual(looks[1].color, 'rgba(0, 0, 0, 0)', 'ปุ่มที่ไม่ได้เลือกมีกรอบสีให้เห็น ไม่ใช่กรอบโปร่งใส')
        assert.ok(boxes[0].top < 420, 'แท็บอยู่ต้นหน้า (ใต้หัวหน้า) ไม่ต้องเลื่อนหา')
        assert.ok(boxes[0].top < await page.locator('#water-rain').evaluate(el => el.getBoundingClientRect().top), 'แท็บอยู่เหนือเนื้อหาของหน้า')
        await pageTab(page, 'เส้นทางน้ำ').click()
        await section(page).waitFor({ state: 'visible', timeout: 5000 })
        assert.equal(await pageTab(page, 'เส้นทางน้ำ').getAttribute('aria-selected'), 'true')
        assert.equal(await pageTab(page, 'สถานการณ์').getAttribute('aria-selected'), 'false', 'แท็บที่ไม่ได้เลือกต้องเป็น aria-selected=false')
        assert.equal(await visible(page, '#water-rain'), false, 'แท็บเส้นทางน้ำไม่แสดงส่วนฝน')
        const banner = await section(page).locator('[data-route-banner]').evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, vh: window.innerHeight }))
        assert.ok(banner.top >= 0 && banner.bottom <= banner.vh, `หัวโปสเตอร์เห็นครบในจอแรกโดยไม่เลื่อน (top ${Math.round(banner.top)} · bottom ${Math.round(banner.bottom)} · จอสูง ${banner.vh})`)
        assert.equal(new URL(page.url()).searchParams.get('tab'), 'route', 'URL จำแท็บ')
        await page.screenshot({ path: path.join(SHOT_DIR, `page-tab-route-${width}.png`) })
        await pageTab(page, 'สถานการณ์').click()
        assert.equal(await visible(page, '#water-rain'), true, 'สลับกลับแล้วเห็นส่วนฝนอีก')
        assert.equal(await visible(page, '#water-diagram'), false)
        assert.equal(new URL(page.url()).searchParams.get('tab'), 'situation')
        await page.screenshot({ path: path.join(SHOT_DIR, `page-tab-situation-${width}.png`) })
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }

  await check('แท็บบนสุดของหน้า: ?tab=route เปิดเส้นทางน้ำตรงๆ · ?diagram= (demo) เปิดเส้นทางน้ำเอง · ค่าแท็บแปลกๆ = สถานการณ์ · ไม่แตะเมาส์ก็ใช้ลูกศร/Home/End สลับได้', async () => {
    for (const [name, opts, expected] of [
      ['?tab=route', { tab: 'route' }, 'เส้นทางน้ำ'],
      ['?diagram=namlao', { tab: null, diagram: 'namlao' }, 'เส้นทางน้ำ'],
      ['?tab=situation&diagram=namlao', { tab: 'situation', diagram: 'namlao' }, 'สถานการณ์'],
    ]) {
      const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 390, ...opts })
      try { assert.equal(await pageTab(page, expected).getAttribute('aria-selected'), 'true', `${name} ต้องเปิดแท็บ ${expected}`) } finally { await context.close() }
    }
    {
      const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 390, tab: 'bogus' })
      try {
        await pageTabs(page).waitFor({ timeout: 10_000 })
        assert.equal(await pageTab(page, 'สถานการณ์').getAttribute('aria-selected'), 'true', 'ค่า tab ที่ไม่รู้จัก = สถานการณ์')
      } finally { await context.close() }
    }
    const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 1280, tab: null })
    try {
      await pageTab(page, 'สถานการณ์').focus()
      assert.deepEqual(await pageTabs(page).getByRole('tab').evaluateAll(els => els.map(el => el.tabIndex)), [0, -1], 'tab stop เดียว (ตัวที่เลือก)')
      await page.keyboard.press('ArrowRight')
      assert.equal(await pageTab(page, 'เส้นทางน้ำ').getAttribute('aria-selected'), 'true')
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'water-tab-route', 'โฟกัสย้ายตามแท็บ')
      await section(page).waitFor({ state: 'visible', timeout: 5000 })
      await page.keyboard.press('ArrowRight')
      assert.equal(await pageTab(page, 'สถานการณ์').getAttribute('aria-selected'), 'true', 'ลูกศรขวาที่แท็บสุดท้ายวนกลับตัวแรก')
      await page.keyboard.press('End')
      assert.equal(await pageTab(page, 'เส้นทางน้ำ').getAttribute('aria-selected'), 'true')
      await page.keyboard.press('Home')
      assert.equal(await pageTab(page, 'สถานการณ์').getAttribute('aria-selected'), 'true')
    } finally { await context.close() }
  })

  await check('แท็บเส้นทางน้ำ: แถบแจ้งเตือนฝนหนักและประกาศของ อปท. ยังเห็น (ไม่หายตอนสลับแท็บ) · แผนภาพใช้ค่าสดเหมือนเดิม', async () => {
    const ANN = {
      id: '00000000-0000-4000-8000-0000000000a1', body: 'ประกาศจาก เทศบาลตำบลสาธิต\nทดสอบการแสดงบนแท็บเส้นทางน้ำ', issuer: 'เทศบาลตำบลสาธิต',
      published_at: hoursAgo(2), expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(), server_now: new Date().toISOString(),
    }
    const { context, page } = await openScene(browser, baseUrl, 'heavyRain', { width: 390, tab: 'situation', announcement: ANN })
    try {
      const alertText = /แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่/
      const visibleAlerts = () => page.locator('[role="alert"]', { hasText: alertText }).evaluateAll(els => els.filter(el => el.getClientRects().length > 0).length)
      assert.equal(await visibleAlerts(), 1, 'แท็บสถานการณ์เห็นแถบแจ้งเตือน 1 แถบ')
      assert.equal(await visible(page, '[data-water-announcement]'), true, 'แท็บสถานการณ์เห็นประกาศ')
      await pageTab(page, 'เส้นทางน้ำ').click()
      await section(page).waitFor({ state: 'visible', timeout: 5000 })
      assert.equal(await visibleAlerts(), 1, 'แท็บเส้นทางน้ำเห็นแถบแจ้งเตือน 1 แถบ (ไม่หาย ไม่ซ้ำ)')
      assert.equal(await visible(page, '[data-water-announcement]'), true, 'แท็บเส้นทางน้ำเห็นประกาศ')
      await pill(page, '73.2%').waitFor({ timeout: 8000 })
    } finally { await context.close() }
  })

  // ═══ ตัวช่วยร่วมของตำหนักธรรม/น้ำเลา ═══
  // เส้นวิ่ง: เฉพาะลำที่ผังวาดลูกศร + หัวลูกศร · ลำอื่นนิ่ง · แผนก่อสร้างไม่มีแอนิเมชัน · ปุ่มหยุดทำงาน
  const checkFlows = async (diagramId, sceneName, flowIds, plannedStops, pumpCount) => {
    const diagram = DIAGRAMS[diagramId]
    const { context, page } = await openScene(browser, baseUrl, sceneName, { diagram: diagramId })
    try {
      await routeSvg(page).locator('g[data-pill]').first().waitFor({ timeout: 8000 })
      const flowing = await routeSvg(page).locator('g[data-flow="true"]').evaluateAll(els => els.map(el => el.getAttribute('data-stream')).sort())
      assert.deepEqual(flowing, flowIds)
      const names = await routeSvg(page).locator('path.wr-flow').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.deepEqual(names, flowIds.map(() => 'wr-dash'), 'เส้นวิ่งทุกเส้นต้องมีแอนิเมชัน')
      const still = await routeSvg(page).locator('path.wr-hl').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.equal(still.length, diagram.route.streams.length - flowIds.length)
      assert.ok(still.every(name => name === 'none'), 'ลำที่ผังวาดลูกศรนิ่งต้องไม่วิ่ง')
      assert.equal(await routeSvg(page).locator('g[data-flow="true"] > path[marker-end]').count(), flowIds.length, 'เส้นวิ่งมีหัวลูกศรปลายทาง')
      assert.equal(await routeSvg(page).locator('g[data-flow="false"] path[marker-end]').count(), 0, 'ลำที่ไม่วิ่งไม่มีหัวลูกศร (ไม่เดาทิศ)')
      assert.deepEqual(await routeSvg(page).locator('g[data-status="planned"]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-stop')))), plannedStops, 'จุดแผนก่อสร้างบนภาพ')
      const animatedInside = await routeSvg(page).evaluate(svg => [...svg.querySelectorAll('[data-status="planned"] *')].filter(el => getComputedStyle(el).animationName !== 'none').length)
      assert.equal(animatedInside, 0, 'แผนก่อสร้างห้ามมีแอนิเมชัน')
      assert.equal(await routeSvg(page).locator('g[data-status="planned"] text', { hasText: /^P$/ }).count(), pumpCount, 'สถานีสูบน้ำแผนก่อสร้าง')
      const waves = await routeSvg(page).locator('.wr-wave').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.ok(waves.length === 2 && waves.every(name => name === 'wr-wave'), 'แม่น้ำมีคลื่น 2 ชั้น')
      // ภาพที่ยังอยู่นอกจอถูกหยุดโดยตั้งใจ — เลื่อนเข้าจอก่อนตรวจปุ่มหยุด
      await section(page).scrollIntoViewIfNeeded()
      await page.waitForFunction(() => !document.querySelector('#water-diagram')?.hasAttribute('data-offscreen'), null, { timeout: 5000 })
      const state = () => routeSvg(page).locator('path.wr-flow').first().evaluate(el => getComputedStyle(el).animationPlayState)
      assert.equal(await state(), 'running')
      await section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' }).click()
      assert.equal(await state(), 'paused')
    } finally { await context.close() }
  }

  // ตรวจเทียบค่าสดทุกฉาก: scenes = [[ฉาก, ข้อความที่ต้องมีในป้ายบนภาพ[], ข้อความต้องห้ามบนภาพ(regex)]]
  const checkScenes = async (diagramId, scenes) => {
    for (const [sceneName, expectedPills, forbidden] of scenes) {
      const { context, page } = await openScene(browser, baseUrl, sceneName, { diagram: diagramId })
      try {
        for (const text of expectedPills) await pill(page, text).first().waitFor({ timeout: 8000 })
        assert.ok(!forbidden.test(await routeText(page)), `${sceneName}: ค่าที่ไม่สดต้องไม่โชว์เป็นค่าปัจจุบัน (${forbidden})`)
      } finally { await context.close() }
    }
  }

  // ── 7) ผังตำหนักธรรม (?diagram=tamnaktham บน demo) ──
  const tk = DIAGRAMS.tamnaktham
  await check('ตำหนักธรรม: ป้ายระดับน้ำ Y.38 พร้อมระยะ ในภาพและรายการ · ใช้ข้อมูลจริงของตำหนักธรรม · ไม่มีค่าฝน/อ่าง · หมายเลข 1–15 ครบ', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      // ผังนี้ไม่มีอ่างเล็ก: ห้ามมีคำขอรายงานอ่างที่ id ว่าง (null/undefined) — คำขอ 50/30 มาจากการ์ดอ่างเล็กด้านบนของ demo
      assert.deepEqual(reservoirRequests.filter(id => id !== '50' && id !== '30'), [], 'ผังไม่มีอ่างเล็กต้องไม่ยิงคำขอ id แปลก')
      assert.match(await section(page).locator('h2').innerText(), /เส้นทางน้ำ\s*ตำบลตำหนักธรรม/)
      assert.match(await section(page).innerText(), /ข้อมูลจริงของตำหนักธรรม ใช้สาธิต/)
      await pill(page, 'ต่ำกว่าตลิ่ง 2.35 ม.').waitFor({ timeout: 8000 })
      assert.equal(await routeSvg(page).locator('g[data-pill="ok"]').count(), 1, 'ป้ายค่าสดช่องเดียว (Y.38)')
      assert.deepEqual(await pillLook(page, 'ok'), [{ stroke: CHIP_TONES.ok.stroke, dashed: false }])
      assert.equal(await routeSvg(page).locator('g[data-pill="plan"]').count(), 5, 'ป้าย "แผน" 5 จุด')
      assert.equal(await routeSvg(page).locator('[data-river] g[aria-hidden="true"]').count(), 0, 'แม่น้ำยมไม่มีสถานีวัด = ไม่วาดลูกศรบอกระยะต่ำกว่าตลิ่ง')
      assert.equal(await routeSvg(page).locator('[data-river] rect[rx], [data-river] g[data-pill]').count(), 0, 'แม่น้ำยมไม่มีช่องค่าสด = ไม่วาดป้ายเปล่าบนแม่น้ำ')
      assert.deepEqual(await unknownPillTones(page), [], 'ป้ายทุกใบต้องมีโทนที่รู้จัก')
      const text = await routeText(page)
      assert.ok(!/อ่าง \d|ฝน/.test(text), 'ผังนี้ไม่มีป้ายอ่าง/ฝน')
      assert.equal(await routeSvg(page).locator('[data-pin]').count(), 15)
      assert.equal(await routeList(page).locator('li[data-stop]').count(), 15)
      const list = await routeList(page).innerText()
      assert.ok(list.includes('บ้านแม่คำมีตำหนักธรรม ห่าง 0.7 กม. · ต่ำกว่าตลิ่ง 2.35 ม.'))
      for (const item of [...tk.route.stops, tk.route.river]) assert.ok(list.includes(item.name), `รายการขาดจุด ${item.n} ${item.name}`)
      assert.equal(await routeList(page).locator('[data-group]').count(), 0, 'ตำหนักธรรมเรียงตามลำน้ำ ไม่มีหัวข้อกลุ่ม')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'tk-normal-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ตำหนักธรรม: ค่าค้าง/ค่าว่าง/ไม่มีสถานี = บอกตรงๆ ไม่ใช่ค่าสด ไม่เป็น 0', async () => {
    await checkScenes('tamnaktham', [
      ['tkStale', ['ไม่มีค่าใหม่'], /ต่ำกว่าตลิ่ง|2\.35/],
      ['tkNull', ['ไม่มีค่า'], /ตลิ่ง|ปกติ/],
      ['tkEmpty', ['ไม่มีค่า'], /ตลิ่ง|ปกติ|0 ม\./],
    ])
    const { context, page } = await openScene(browser, baseUrl, 'tkStale', { diagram: 'tamnaktham' })
    try {
      await pill(page, 'ไม่มีค่าใหม่').first().waitFor({ timeout: 8000 })
      assert.deepEqual(await pillLook(page, 'stale'), [{ stroke: CHIP_TONES.stale.stroke, dashed: true }], 'ป้ายที่ค้างต้องขอบประสีเทา')
      assert.ok((await routeList(page).innerText()).includes('บ้านแม่คำมีตำหนักธรรม ห่าง 0.7 กม. · ไม่มีค่าใหม่'))
    } finally { await context.close() }
  })

  await check('ตำหนักธรรม: เส้นวิ่ง 2 เส้น (น้ำแม่คำมี + คลองชลประทาน) พร้อมหัวลูกศร · ห้วยสาขา/แม่น้ำยมไม่วิ่ง · ฝาย/สถานีสูบน้ำแผนก่อสร้าง 5 จุดไม่มีแอนิเมชัน · ปุ่มหยุดทำงาน', async () => {
    await checkFlows('tamnaktham', 'tkNormal', ['canal', 'mkm'], [3, 5, 8, 11, 12], 3)
  })

  await check('ตำหนักธรรม: คำอธิบายสัญลักษณ์เฉพาะที่ใช้ · คำกำกับบังคับครบ · ที่มา/ของที่ไม่ได้วาด · รายการครบ · แผนก่อสร้างมีแท็ก', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      await pill(page, 'ต่ำกว่าตลิ่ง 2.35 ม.').waitFor({ timeout: 8000 })
      const legend = await section(page).locator('[data-route-legend]').innerText()
      for (const needed of ['ฝาย', 'ประตูระบายน้ำ', 'สะพาน', 'ระบบประปา', 'กล่องแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', 'เส้นวิ่ง + หัวลูกศร', 'ขอบประ = ไม่มีค่า']) assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      for (const absent of ['อ่างเก็บน้ำ', 'หนอง', 'หมู่บ้าน', 'ลายขีดแดง']) assert.ok(!legend.includes(absent), `ผังนี้ไม่มี "${absent}" ต้องไม่มีบรรทัดอธิบาย`)
      const artText = await section(page).innerText()
      await tabButton(page, /^ที่มา$/).click()
      const text = artText + '\n' + await section(page).innerText()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'ไม่ใช่แผนที่', 'ไม่มีเข็มทิศ', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ผังน้ำตำบลตำหนักธรรม อำเภอหนองม่วงไข่', 'ไฟล์ลงวันที่ 9 พ.ค. 2567', 'เขตหมู่บ้าน', 'ห้วยหาด']) {
        assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      }
      assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 1)
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), tk.omitted.length)
      await tabButton(page, /^แผนภาพ/).click()
      const planned = routeList(page).locator('li[data-status="planned"]')
      assert.equal(await planned.count(), 5)
      for (const li of await planned.all()) assert.ok((await li.innerText()).includes('แผนก่อสร้าง · ไม่เคลื่อนไหว'))
    } finally { await context.close() }
  })

  // ── 8) ผังน้ำเลา (?diagram=namlao บน demo) ──
  const nl = DIAGRAMS.namlao
  await check('น้ำเลา: ป้ายอ่างแม่คำปอง + ฝน 2 สถานี ในภาพและรายการ · บอกชื่อสถานีและระยะ · ไม่มีป้ายระดับน้ำ/อ่างเล็ก · หมายเลข 1–21 · หัวข้อกลุ่มตามสายในผัง', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      assert.deepEqual(reservoirRequests.filter(id => id !== '50' && id !== '30'), [], 'ผังไม่มีอ่างเล็กต้องไม่ยิงคำขอ id แปลก')
      assert.match(await section(page).locator('h2').innerText(), /เส้นทางน้ำ\s*ตำบลน้ำเลา/)
      assert.match(await section(page).innerText(), /ข้อมูลจริงของน้ำเลา ใช้สาธิต/)
      await pill(page, '84.5%').waitFor({ timeout: 8000 })
      await pill(page, 'ฝน 12.5 มม.').waitFor()
      await pill(page, 'ฝน 0 มม.').waitFor()
      assert.equal(await routeSvg(page).locator('g[data-pill="ok"]').count(), 3, 'ป้ายค่าสด 3 ช่อง')
      assert.equal(await routeSvg(page).locator('g[data-pill="plan"]').count(), 3, 'ป้าย "แผน" 3 จุด')
      const text = await routeText(page)
      assert.ok(!/ตลิ่ง|YOM003/.test(text), 'ผังนี้ไม่มีป้ายระดับน้ำ')
      assert.equal(await routeSvg(page).locator('[data-river] g[aria-hidden="true"]').count(), 0, 'ลำน้ำแม่ถางไม่มีสถานีวัด = ไม่วาดลูกศรบอกระยะต่ำกว่าตลิ่ง')
      assert.equal(await routeSvg(page).locator('[data-river] rect[rx], [data-river] g[data-pill]').count(), 0, 'ลำน้ำแม่ถางไม่มีช่องค่าสด = ไม่วาดป้ายเปล่าบนแม่น้ำ')
      assert.deepEqual(await unknownPillTones(page), [], 'ป้ายทุกใบต้องมีโทนที่รู้จัก')
      assert.equal(await routeSvg(page).locator('[data-pin]').count(), 21)
      assert.equal(await routeList(page).locator('li[data-stop]').count(), 21)
      const list = await routeList(page).innerText()
      for (const expected of ['อ่างเก็บน้ำแม่คำปอง ห่าง 3.6 กม.', '84.5% ของความจุที่ระดับเก็บกัก', '5.71/6.76 ล้าน ลบ.ม.', 'สถานีบ้านบุญแจ่ม ห่าง 2.6 กม.', 'สถานีอ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา ห่าง 2.9 กม.']) {
        assert.ok(list.includes(expected), `รายการต้องมี "${expected}"`)
      }
      const groups = await routeList(page).locator('[data-group]').allInnerTexts()
      assert.deepEqual(groups, [...new Set(nl.route.stops.map(s => s.group)), nl.route.river.group], 'หัวข้อกลุ่มเรียงตามสายในผังต้นฉบับ')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'nl-normal-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('น้ำเลา: อ่างเกิน 100% อธิบายตัวเลขเอง · ตัวเลขซ้ำเดิมเป็นเหลือง · ค้างไม่ใช่ค่าสด · ว่าง/ไม่มีสถานีไม่เป็น 0', async () => {
    let r = await openScene(browser, baseUrl, 'nlOver', { diagram: 'namlao' })
    try {
      await pill(r.page, '100.4%').waitFor({ timeout: 8000 })
      assert.ok((await routeList(r.page).innerText()).includes('มากกว่า 100% = เกินความจุที่ระดับเก็บกักปกติ'))
    } finally { await r.context.close() }
    r = await openScene(browser, baseUrl, 'nlSame', { diagram: 'namlao' })
    try {
      await pill(r.page, 'ตัวเลขซ้ำเดิม').first().waitFor({ timeout: 8000 })
      assert.equal(await routeSvg(r.page).locator('g[data-pill="warn"]').count(), 1, 'ป้ายอ่างที่ตัวเลขซ้ำเดิมเป็นโทนเหลือง')
      assert.deepEqual(await pillLook(r.page, 'warn'), [{ stroke: CHIP_TONES.warn.stroke, dashed: false }])
    } finally { await r.context.close() }
    r = await openScene(browser, baseUrl, 'nlStale', { diagram: 'namlao' })
    try {
      await pill(r.page, 'ไม่มีรายงานใหม่').first().waitFor({ timeout: 8000 })
      assert.equal(await pill(r.page, 'ไม่มีค่าใหม่').count(), 2, 'ฝน 2 สถานีค้าง')
      assert.equal(await routeSvg(r.page).locator('g[data-pill="stale"]').count(), 3, 'อ่าง + ฝน 2 สถานี ค้างทั้งหมด')
      assert.deepEqual(await pillLook(r.page, 'stale'), Array(3).fill({ stroke: CHIP_TONES.stale.stroke, dashed: true }))
      const text = await routeText(r.page)
      assert.ok(!/12\.5|ฝน 3 /.test(text), 'ฝนที่ค้างต้องไม่โชว์เป็นค่าปัจจุบัน')
    } finally { await r.context.close() }
    for (const scene of ['nlNull', 'nlEmpty']) {
      r = await openScene(browser, baseUrl, scene, { diagram: 'namlao' })
      try {
        await r.page.locator('g[data-pill="na"] text', { hasText: /^ไม่มีค่า$/ }).first().waitFor({ timeout: 8000 })
        assert.equal(await routeSvg(r.page).locator('g[data-pill="na"] text', { hasText: /^ไม่มีค่า$/ }).count(), 3, `${scene}: ทั้ง 3 ช่องต้องบอกว่าไม่มีค่า`)
        const text = await routeText(r.page)
        assert.ok(!/ปกติ|0 มม|0%/.test(text), `${scene}: ห้ามกลายเป็น 0 หรือ "ปกติ"`)
      } finally { await r.context.close() }
    }
  })

  await check('น้ำเลา: เส้นวิ่ง 8 เส้น (ลำน้ำแม่คำปอง + ห้วยสาขาที่ผังวาดลูกศร) พร้อมหัวลูกศร · ห้วยลูกศรนิ่งไม่วิ่ง · ฝาย/อ่างแผนก่อสร้าง 3 จุดไม่มีแอนิเมชัน · ปุ่มหยุดทำงาน', async () => {
    await checkFlows('namlao', 'nlNormal', ['hin', 'hsk', 'khuem', 'mkp', 'obj', 'sra50', 'tao', 'thare'], [2, 5, 7], 0)
  })

  await check('น้ำเลา: คำอธิบายสัญลักษณ์เฉพาะที่ใช้ · อ่างไม่มีข้อมูลขอบประ · ที่มา/ของที่ไม่ได้วาด (ลายขีดแดงไม่ตีความ · เส้นขอบเขต · YOM003 นอกตำบล) · คำกำกับบังคับ · ไม่เขียนว่าแล้ง/ท่วม', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      await pill(page, '84.5%').waitFor({ timeout: 8000 })
      const legend = await section(page).locator('[data-route-legend]').innerText()
      for (const needed of ['อ่างเก็บน้ำ', 'ฝาย', 'หนอง', 'หมู่บ้าน', 'กล่องแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', 'เส้นวิ่ง + หัวลูกศร', 'ขอบประ = ไม่มีค่า']) assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      for (const absent of ['สะพาน', 'ระบบประปา', 'ประตูระบายน้ำ', 'ลายขีดแดง', 'ชำรุด']) assert.ok(!legend.includes(absent), `ผังนี้ไม่มี "${absent}" ต้องไม่มีบรรทัดอธิบาย`)
      assert.equal(await routeSvg(page).locator('g[data-stop] ellipse[stroke-dasharray="5 4"]').count(), 3, 'อ่างไม่มีข้อมูล 3 ผืน (ห้วยทรายขาว 2 + ห้วยขึมโยธินฯ 1) วาดขอบประเทา')
      const artText = await section(page).innerText()
      await tabButton(page, /^ที่มา$/).click()
      const text = artText + '\n' + await section(page).innerText()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'ไม่ใช่แผนที่', 'ไม่มีเข็มทิศ', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ผังน้ำตำบลน้ำเลา อำเภอร้องกวาง', 'ไฟล์ลงวันที่ 30 เม.ย. 2567', 'ไม่ตีความ', 'เส้นขอบเขต', 'นอกตำบล', '28 รายการเป็น 20 จุด']) {
        assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      }
      assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 1)
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), nl.omitted.length)
      await tabButton(page, /^แผนภาพ/).click()
      // ข้อความบนตัวภาพ (ไม่นับกล่องที่มาที่ต้องพูดถึงคำอธิบายผังต้นฉบับ) ต้องไม่ตีความลายขีดแดงว่าเป็นพื้นที่แล้ง/ท่วม
      assert.ok(!/แล้ง|ท่วม/.test(await routeText(page)), 'ภาพห้ามเขียนว่าแล้ง/ท่วม')
      const list = await routeList(page).innerText()
      assert.ok(!/แล้ง|ท่วม/.test(list), 'รายการห้ามเขียนว่าแล้ง/ท่วม')
      for (const item of [...nl.route.stops, nl.route.river]) assert.ok(list.includes(item.name), `รายการขาดจุด ${item.n} ${item.name}`)
      const planned = routeList(page).locator('li[data-status="planned"]')
      assert.equal(await planned.count(), 3)
      for (const li of await planned.all()) assert.ok((await li.innerText()).includes('แผนก่อสร้าง · ไม่เคลื่อนไหว'))
    } finally { await context.close() }
  })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
if (failed.length > 0) process.exit(1)
