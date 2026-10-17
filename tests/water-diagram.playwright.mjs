// E2E: ผังน้ำตำบล (ทุ่งแค้ว + ตำหนักธรรม + น้ำเลา) (src/components/water/WaterDiagram.jsx) บนหน้า /water-situation
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
import { isAnimated } from '../src/lib/waterDiagram/model.js'

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

async function openScene(browser, baseUrl, sceneName, { width = 1280, height = 900, reducedMotion = 'no-preference', diagram = null } = {}) {
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
  await page.goto(`${baseUrl}/water-situation${diagram ? `?diagram=${diagram}` : ''}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#water-diagram').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1200)
  return { context, page, problems, reservoirRequests }
}

const section = page => page.locator('#water-diagram')
const modeButton = (page, label) => section(page).getByRole('button', { name: label, exact: true })
const mapSvg = page => section(page).locator('.wd-mapbox > svg')
const slotText = (page, text) => mapSvg(page).locator('text', { hasText: text })
// SVG ไม่มี innerText — ใช้ textContent ของตัวผังเท่านั้น (ไม่ปนไอคอนปุ่ม)
const mapText = page => mapSvg(page).textContent()

const results = []
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`)
  }
}

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })
const animatedExpected = THUNGKAEW_DIAGRAM.elements.filter(isAnimated).length

try {
  // ── 1) ค่าสดปกติ: ผังภาพ + รายการ ──
  await check('ค่าสดปกติ: ป้ายบนผัง (อ่าง 2 แห่ง · ฝน · ระดับน้ำพร้อมระยะ) และรายการสายน้ำตรงกัน', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'normal')
    try {
      await modeButton(page, 'ผังภาพ').click()
      await slotText(page, 'อ่าง 73.2%').waitFor({ timeout: 8000 })
      await slotText(page, 'อ่าง 76.8%').waitFor({ timeout: 8000 })
      await slotText(page, 'ฝน 12.5 มม.').waitFor()
      await slotText(page, 'ห่าง 4.8 กม. · ต่ำกว่าตลิ่ง 4.55 ม.').waitFor()
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'normal-map-1280.png') })
      await modeButton(page, 'สายน้ำ (รายการ)').click()
      const lanes = await section(page).innerText()
      for (const expected of ['73.2% · รายงาน', 'ฝนสะสม 24 ชม. 12.5 มม.', 'หนองม่วงไข่ ห่าง 4.8 กม. · ต่ำกว่าตลิ่ง 4.55 ม.']) {
        assert.ok(lanes.includes(expected), `รายการสายน้ำต้องมี "${expected}"`)
      }
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'normal-lanes-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  // ── 2) ค้าง: ไม่ใช่ "ปกติ" ──
  await check('ค่าค้าง: รายงานอ่างเก่า/สถานีค้าง ขึ้น "ไม่มีรายงานใหม่/ไม่มีค่าใหม่" ไม่ลงค่าเหมือนสด', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'stale')
    try {
      await modeButton(page, 'ผังภาพ').click()
      await slotText(page, 'ไม่มีรายงานใหม่').first().waitFor({ timeout: 8000 })
      await slotText(page, 'ฝน ไม่มีค่าใหม่').waitFor()
      await slotText(page, 'หนองม่วงไข่ ห่าง 4.8 กม. ไม่มีค่าใหม่').waitFor()
      assert.equal(await slotText(page, 'ต่ำกว่าตลิ่ง').count(), 0, 'ค่าระดับน้ำที่ค้างต้องไม่โชว์เป็นค่าปัจจุบัน')
      assert.equal(await slotText(page, '12.5').count(), 0, 'ฝนที่ค้างต้องไม่โชว์ตัวเลข')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'stale-map-1280.png') })
    } finally { await context.close() }
  })

  // ── 3) ไม่มีสถานี/Worker ล่ม: บอกว่าไม่มี ไม่กลายเป็น 0 ──
  await check('ไม่มีสถานี + Worker ล่ม: "ไม่มีค่าในระบบ/ยังโหลดค่าไม่ได้" ไม่มีเลข 0 หรือคำว่าปกติ', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'empty')
    try {
      await modeButton(page, 'ผังภาพ').click()
      await slotText(page, 'ยังโหลดค่าไม่ได้').first().waitFor({ timeout: 8000 })
      assert.equal(await slotText(page, 'ไม่มีค่าในระบบ').count(), 2, 'ฝนและระดับน้ำไม่มีสถานี = ไม่มีค่าในระบบ')
      const text = await mapText(page)
      assert.ok(!/ปกติ|0 มม\./.test(text), 'ห้ามมีคำว่า "ปกติ" หรือ "0 มม." เมื่อไม่มีค่า')
      assert.deepEqual(problems, [], 'Worker ล่มต้องไม่ทำให้เกิด JS error')
    } finally { await context.close() }
  })

  await check('ค่าว่างจากต้นทาง (rain/bank เป็น null) ไม่กลายเป็น 0 หรือ "ต่ำกว่าตลิ่ง 0"', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nullvalues')
    try {
      await modeButton(page, 'ผังภาพ').click()
      await slotText(page, 'อ่าง 73.2%').waitFor({ timeout: 8000 })
      assert.equal(await slotText(page, 'ไม่มีค่าในระบบ').count(), 2)
      const text = await mapText(page)
      assert.ok(!/ตลิ่ง|0 มม/.test(text))
    } finally { await context.close() }
  })

  // ── 4) เลย์เอาต์ ──
  for (const [diagram, scene, shotPrefix] of [[null, 'normal', 'lanes'], ['tamnaktham', 'tkNormal', 'tk-lanes'], ['namlao', 'nlNormal', 'nl-lanes']]) for (const width of [360, 390, 768, 1280]) {
    await check(`เลย์เอาต์ ${diagram ?? 'thungkaew'} ${width}px: โหมดเริ่มต้นถูก · ไม่เลื่อนแนวนอนทั้งหน้า · ปุ่มและลิงก์ ≥ 44px`, async () => {
      const { context, page } = await openScene(browser, baseUrl, scene, { width, diagram })
      try {
        const expected = width >= 768 ? 'ผังภาพ' : 'สายน้ำ (รายการ)'
        assert.equal(await modeButton(page, expected).getAttribute('aria-pressed'), 'true', `จอ ${width}px ต้องเริ่มที่โหมด ${expected}`)
        for (const mode of ['ผังภาพ', 'สายน้ำ (รายการ)']) {
          await modeButton(page, mode).click()
          await page.waitForTimeout(400)
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
          assert.equal(overflow, false, `โหมด ${mode} ทำให้หน้าเลื่อนแนวนอน`)
          // ตรวจไม่ให้เนื้อหาถูกตัดขอบจอ: หน้าไม่เลื่อนแนวนอนก็ยังมีข้อความล้นกรอบแล้วโดน overflow ของกรอบแม่ตัดได้ (เจอที่ 390px)
          // ยกเว้นตัวแผนที่ที่เลื่อนในกล่องของมันเองโดยตั้งใจ
          const clipped = await section(page).evaluate((root, limit) => [...root.querySelectorAll('*')]
            .filter(el => el.offsetParent !== null && !el.closest('.wd-mapbox') && !(el instanceof SVGElement && el.closest('svg')?.closest('.wd-mapbox')))
            .map(el => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.right > limit + 1)
            .map(({ el, r }) => `${el.tagName}.${String(el.className).slice(0, 20)} right=${Math.round(r.right)} "${(el.textContent || '').trim().slice(0, 20)}"`), width)
          assert.deepEqual(clipped, [], `โหมด ${mode}: องค์ประกอบล้นขอบจอ ${width}px`)
          const small = await section(page).evaluate(root => [...root.querySelectorAll('button, a[href]')]
            .filter(el => el.offsetParent !== null)
            .map(el => ({ t: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
            .filter(item => item.h < 44 || (item.w < 44 && item.t.length < 3)))
          assert.deepEqual(small, [], `ปุ่ม/ลิงก์เล็กกว่า 44px: ${JSON.stringify(small)}`)
        }
        await section(page).screenshot({ path: path.join(SHOT_DIR, `${shotPrefix}-${width}.png`) })
      } finally { await context.close() }
    })
  }

  // ── 5) เส้นวิ่ง / หยุด / ลดการเคลื่อนไหว ──
  await check(`เส้นวิ่ง: จำนวนเท่ากับเส้นที่ข้อมูลระบุว่าวิ่ง (${animatedExpected}) · โครงสร้างชำรุด/แผนก่อสร้างไม่มีเส้นวิ่งทับ`, async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await modeButton(page, 'ผังภาพ').click()
      assert.equal(await section(page).locator('path.wd-flow').count(), animatedExpected)
      const names = await section(page).locator('path.wd-flow').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.ok(names.every(name => name === 'wd-flow'), 'เส้นวิ่งทุกเส้นต้องมีแอนิเมชัน')
      // ลายขีดแดง (ชำรุด) และเส้นประแดง (แผนก่อสร้าง) ต้องไม่มีแอนิเมชันในตัวมันเอง
      const redStatic = await section(page).evaluate(root => [...root.querySelectorAll('svg rect[fill="url(#wd-hatch)"], svg path[stroke="#b91c1c"]')]
        .filter(el => getComputedStyle(el).animationName !== 'none').length)
      assert.equal(redStatic, 0)
      assert.ok(await section(page).locator('path.wd-shimmer').count() >= 1, 'คลองสองปลายลูกศรต้องระยิบ (ไม่วิ่ง)')
    } finally { await context.close() }
  })

  await check('ปุ่ม "หยุดเคลื่อนไหว": หยุดแอนิเมชันจริง · กดอีกครั้งเล่นต่อ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await modeButton(page, 'ผังภาพ').click()
      const state = () => section(page).locator('path.wd-flow').first().evaluate(el => getComputedStyle(el).animationPlayState)
      assert.equal(await state(), 'running')
      await section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' }).click()
      assert.equal(await state(), 'paused')
      assert.equal(await section(page).getByRole('button', { name: 'เล่นเคลื่อนไหว' }).getAttribute('aria-pressed'), 'true')
      await section(page).getByRole('button', { name: 'เล่นเคลื่อนไหว' }).click()
      assert.equal(await state(), 'running')
    } finally { await context.close() }
  })

  await check('ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว": เส้นไม่วิ่งเลย + มีข้อความบอก', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal', { reducedMotion: 'reduce' })
    try {
      await modeButton(page, 'ผังภาพ').click()
      const names = await section(page).locator('path.wd-flow').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
      assert.ok(names.length > 0 && names.every(name => name === 'none'), `animationName ต้องเป็น none: ${[...new Set(names)]}`)
      assert.match(await section(page).innerText(), /ตั้งค่าให้ลดการเคลื่อนไหว/)
    } finally { await context.close() }
  })

  // ── 6) ข้อความบังคับ + ชื่อที่ยังไม่ยืนยัน + ครบทุกโหนด ──
  await check('คำกำกับ "ไม่ได้แสดงว่ามีน้ำไหลจริง" + ที่มา + ลิงก์ต้นฉบับ อยู่ครบทั้งสองโหมด', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      for (const mode of ['ผังภาพ', 'สายน้ำ (รายการ)']) {
        await modeButton(page, mode).click()
        const text = await section(page).innerText()
        for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย']) {
          assert.ok(text.includes(needed), `โหมด ${mode} ต้องมี "${needed}"`)
        }
        assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 1)
      }
    } finally { await context.close() }
  })

  await check('กล่องที่มาของทุ่งแค้ว: บอกอายุผังต้นฉบับ + ของที่ไม่ใส่ชื่อเพราะอ่านไม่ชัด (ไม่ต้องมีใครถามว่าทำไมห้วยไม่มีชื่อ)', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      const text = await section(page).innerText()
      for (const needed of ['ไฟล์ลงวันที่ 9 พ.ค. 2567', 'ที่ผังต้นฉบับมีแต่เราวาดต่างไป หรือไม่ได้วาด', 'ไม่ขอเดาชื่อ']) assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), THUNGKAEW_DIAGRAM.omitted.length)
    } finally { await context.close() }
  })

  await check('ไม่มีชื่อห้วยแนวตั้ง 4 เส้นที่ยังไม่ยืนยัน (ห้วยจำค่า/ห้วยย่าเฟย) บนหน้า · โหมดรายการมีครบทุกรายการของข้อมูล', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await modeButton(page, 'ผังภาพ').click()
      assert.equal(/ห้วยจำค่า|ห้วยย่าเฟย/.test(await mapText(page)), false)
      await modeButton(page, 'สายน้ำ (รายการ)').click()
      const text = await section(page).innerText()
      assert.ok(!/ห้วยจำค่า|ห้วยย่าเฟย/.test(text))
      for (const lane of THUNGKAEW_DIAGRAM.lanes) {
        assert.ok(text.includes(lane.title), `ขาดสาย ${lane.title}`)
        for (const item of lane.items) assert.ok(text.includes(item.name), `ขาดรายการ ${item.name}`)
      }
    } finally { await context.close() }
  })

  // ── 7) ผังตำหนักธรรม (?diagram=tamnaktham บน demo) ──
  const tk = DIAGRAMS.tamnaktham
  await check('ตำหนักธรรม: ป้ายระดับน้ำ Y.38 พร้อมระยะ ในผังภาพและรายการ · ป้ายบอกว่าใช้ข้อมูลจริงของตำหนักธรรม · ไม่มีค่าฝน/อ่าง', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      // ผังนี้ไม่มีอ่างเล็ก: ห้ามมีคำขอรายงานอ่างที่ id ว่าง (null/undefined) — คำขอ 50/30 มาจากการ์ดอ่างเล็กด้านบนของ demo
      assert.deepEqual(reservoirRequests.filter(id => id !== '50' && id !== '30'), [], 'ผังไม่มีอ่างเล็กต้องไม่ยิงคำขอ id แปลก')
      assert.match(await section(page).locator('h2').innerText(), /ผังน้ำตำบลตำหนักธรรม/)
      assert.match(await section(page).innerText(), /ข้อมูลจริงของตำหนักธรรม ใช้สาธิต/)
      await modeButton(page, 'ผังภาพ').click()
      await slotText(page, 'บ้านแม่คำมีตำหนักธรรม ห่าง 0.7 กม. · ต่ำกว่าตลิ่ง 2.35 ม.').waitFor({ timeout: 8000 })
      const text = await mapText(page)
      assert.ok(!/อ่าง \d|ฝน \d/.test(text), 'ผังนี้ไม่มีป้ายอ่าง/ฝน')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'tk-normal-map-1280.png') })
      await modeButton(page, 'สายน้ำ (รายการ)').click()
      assert.ok((await section(page).innerText()).includes('บ้านแม่คำมีตำหนักธรรม ห่าง 0.7 กม. · ต่ำกว่าตลิ่ง 2.35 ม.'))
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'tk-normal-lanes-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ตำหนักธรรม: ค่าค้าง/ค่าว่าง/ไม่มีสถานี = บอกตรงๆ ไม่ใช่ค่าสด ไม่เป็น 0', async () => {
    for (const [scene, expected, forbidden] of [
      ['tkStale', 'บ้านแม่คำมีตำหนักธรรม ห่าง 0.7 กม. ไม่มีค่าใหม่', /ต่ำกว่าตลิ่ง|2\.35/],
      ['tkNull', 'ไม่มีค่าในระบบ', /ตลิ่ง|ปกติ/],
      ['tkEmpty', 'ไม่มีค่าในระบบ', /ตลิ่ง|ปกติ|0 ม\./],
    ]) {
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: 'tamnaktham' })
      try {
        await modeButton(page, 'ผังภาพ').click()
        await slotText(page, expected).waitFor({ timeout: 8000 })
        assert.ok(!forbidden.test(await mapText(page)), `${scene}: ค่าที่ไม่สดต้องไม่โชว์เป็นค่าปัจจุบัน`)
      } finally { await context.close() }
    }
  })

  const tkAnimated = tk.elements.filter(isAnimated).length
  await check(`ตำหนักธรรม: เส้นวิ่ง ${tkAnimated} เส้น (น้ำแม่คำมี + คลอง + แม่น้ำยม) · ฝาย/สถานีสูบแผนก่อสร้างสีแดงไม่มีแอนิเมชัน · ปุ่มหยุดทำงาน`, async () => {
    const { context, page } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      await modeButton(page, 'ผังภาพ').click()
      assert.equal(await section(page).locator('path.wd-flow').count(), tkAnimated)
      const redStatic = await section(page).evaluate(root => [...root.querySelectorAll('.wd-mapbox svg rect[fill="#b91c1c"], .wd-mapbox svg circle[stroke="#b91c1c"]')]
        .filter(el => getComputedStyle(el).animationName !== 'none').length)
      assert.equal(redStatic, 0)
      assert.equal(await section(page).locator('.wd-mapbox svg rect[fill="#b91c1c"]').count(), 2, 'ฝายแผนก่อสร้าง 2 แท่ง (หมู่ 1 และหมู่ 12)')
      assert.equal(await section(page).locator('.wd-mapbox svg circle[stroke="#b91c1c"]').count(), 3, 'สถานีสูบน้ำแผนก่อสร้าง 3 จุด')
      assert.equal(await section(page).locator('path.wd-shimmer').count(), 0, 'ผังนี้ไม่มีคลองสองทิศ')
      const state = () => section(page).locator('path.wd-flow').first().evaluate(el => getComputedStyle(el).animationPlayState)
      assert.equal(await state(), 'running')
      await section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' }).click()
      assert.equal(await state(), 'paused')
    } finally { await context.close() }
  })

  await check('ตำหนักธรรม: ทุกสัญลักษณ์บนผังมีคำอธิบาย · กล่องที่มาบอกอายุผังและเขตหมู่บ้านที่วาดเป็นสีเทา · คำกำกับบังคับครบ · รายการสายน้ำครบ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      await modeButton(page, 'ผังภาพ').click()
      const legend = await section(page).locator('.wd-legend').innerText()
      for (const needed of ['ประตูระบายน้ำ', 'สะพาน', 'ระบบประปา', 'สถานีสูบน้ำแผนก่อสร้าง', 'ฝายแผนก่อสร้าง', 'เขตตำบล', 'เขตหมู่บ้าน']) assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      assert.ok(!legend.includes('อ่างเก็บน้ำ') && !legend.includes('หนอง'), 'ผังนี้ไม่มีอ่าง/หนอง ต้องไม่มีบรรทัดอธิบาย')
      for (const mode of ['ผังภาพ', 'สายน้ำ (รายการ)']) {
        await modeButton(page, mode).click()
        const text = await section(page).innerText()
        for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ผังน้ำตำบลตำหนักธรรม อำเภอหนองม่วงไข่', 'ไฟล์ลงวันที่ 9 พ.ค. 2567', 'เขตหมู่บ้านริมน้ำแม่คำมี', 'เส้นประเทา']) {
          assert.ok(text.includes(needed), `โหมด ${mode} ต้องมี "${needed}"`)
        }
        assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 1)
      }
      const text = await section(page).innerText()
      for (const lane of tk.lanes) {
        assert.ok(text.includes(lane.title), `ขาดสาย ${lane.title}`)
        for (const item of lane.items) assert.ok(text.includes(item.name), `ขาดรายการ ${item.name}`)
      }
      for (const planned of tk.lanes.flatMap(lane => lane.items).filter(item => item.status === 'planned')) {
        assert.ok(text.includes('แผนก่อสร้าง · ไม่เคลื่อนไหว'), `${planned.name}: ต้องบอกว่าแผนก่อสร้าง`)
      }
    } finally { await context.close() }
  })
  // ── 8) ผังน้ำเลา (?diagram=namlao บน demo) ──
  const nl = DIAGRAMS.namlao
  await check('น้ำเลา: ป้ายอ่างแม่คำปอง + ฝน 2 สถานี ในผังภาพและรายการ · บอกชื่อสถานีและระยะ · ไม่มีป้ายระดับน้ำ/อ่างเล็ก', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      assert.deepEqual(reservoirRequests.filter(id => id !== '50' && id !== '30'), [], 'ผังไม่มีอ่างเล็กต้องไม่ยิงคำขอ id แปลก')
      assert.match(await section(page).locator('h2').innerText(), /ผังน้ำตำบลน้ำเลา/)
      assert.match(await section(page).innerText(), /ข้อมูลจริงของน้ำเลา ใช้สาธิต/)
      await modeButton(page, 'ผังภาพ').click()
      await slotText(page, 'อ่าง 84.5%').waitFor({ timeout: 8000 })
      await slotText(page, 'ฝน 12.5 มม.').waitFor()
      await slotText(page, 'ฝน 0 มม.').waitFor()
      const text = await mapText(page)
      assert.ok(!/ตลิ่ง|YOM003/.test(text), 'ผังนี้ไม่มีป้ายระดับน้ำ')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'nl-normal-map-1280.png') })
      await modeButton(page, 'สายน้ำ (รายการ)').click()
      const lanes = await section(page).innerText()
      for (const expected of ['อ่างเก็บน้ำแม่คำปอง ห่าง 3.6 กม.', '84.5% ของความจุที่ระดับเก็บกัก', '5.71/6.76 ล้าน ลบ.ม.', 'สถานีบ้านบุญแจ่ม ห่าง 2.6 กม.', 'สถานีอ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา ห่าง 2.9 กม.']) {
        assert.ok(lanes.includes(expected), `รายการสายน้ำต้องมี "${expected}"`)
      }
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'nl-normal-lanes-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('น้ำเลา: อ่างเกิน 100% อธิบายตัวเลขเอง · ตัวเลขซ้ำเดิมเป็นเหลือง · ค้างไม่ใช่ค่าสด · ว่าง/ไม่มีสถานีไม่เป็น 0', async () => {
    let r = await openScene(browser, baseUrl, 'nlOver', { diagram: 'namlao' })
    try {
      await modeButton(r.page, 'ผังภาพ').click()
      await slotText(r.page, 'อ่าง 100.4%').waitFor({ timeout: 8000 })
      await modeButton(r.page, 'สายน้ำ (รายการ)').click()
      assert.ok((await section(r.page).innerText()).includes('มากกว่า 100% = เกินความจุที่ระดับเก็บกักปกติ'))
    } finally { await r.context.close() }
    r = await openScene(browser, baseUrl, 'nlSame', { diagram: 'namlao' })
    try {
      await modeButton(r.page, 'ผังภาพ').click()
      await slotText(r.page, 'อ่าง 84.5% · ตัวเลขซ้ำเดิม').waitFor({ timeout: 8000 })
    } finally { await r.context.close() }
    r = await openScene(browser, baseUrl, 'nlStale', { diagram: 'namlao' })
    try {
      await modeButton(r.page, 'ผังภาพ').click()
      await slotText(r.page, 'อ่าง 84.5% · ไม่มีรายงานใหม่').waitFor({ timeout: 8000 })
      await slotText(r.page, 'ฝน ไม่มีค่าใหม่').first().waitFor()
      const text = await mapText(r.page)
      assert.ok(!/ฝน 12\.5|ฝน 3 /.test(text), 'ฝนที่ค้างต้องไม่โชว์เป็นค่าปัจจุบัน')
    } finally { await r.context.close() }
    for (const scene of ['nlNull', 'nlEmpty']) {
      r = await openScene(browser, baseUrl, scene, { diagram: 'namlao' })
      try {
        await modeButton(r.page, 'ผังภาพ').click()
        await slotText(r.page, 'ไม่มีค่าในระบบ').first().waitFor({ timeout: 8000 })
        assert.equal(await slotText(r.page, 'ไม่มีค่าในระบบ').count(), 3, `${scene}: ทั้ง 3 ช่องต้องบอกว่าไม่มีค่า`)
        const text = await mapText(r.page)
        assert.ok(!/ปกติ|0 มม|0%/.test(text), `${scene}: ห้ามกลายเป็น 0 หรือ "ปกติ"`)
      } finally { await r.context.close() }
    }
  })

  const nlAnimated = nl.elements.filter(isAnimated).length
  await check(`น้ำเลา: เส้นวิ่ง ${nlAnimated} เส้นตามข้อมูล · ฝายแดง 3 แท่ง + อ่างแดง 1 ไม่มีแอนิเมชัน · ลายขีดแดงไม่ถูกวาดเป็นพื้นที่ · ปุ่มหยุดทำงาน`, async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      await modeButton(page, 'ผังภาพ').click()
      assert.equal(await section(page).locator('path.wd-flow').count(), nlAnimated)
      assert.equal(await section(page).locator('.wd-mapbox svg rect[fill="#b91c1c"]').count(), 3, 'ฝายแผนก่อสร้าง 3 แท่ง')
      assert.equal(await section(page).locator('.wd-mapbox svg > path[fill="#b91c1c"]').count(), 1, 'อ่างแผนก่อสร้าง 1 แห่ง')
      const redStatic = await section(page).evaluate(root => [...root.querySelectorAll('.wd-mapbox svg rect[fill="#b91c1c"], .wd-mapbox svg > path[fill="#b91c1c"]')]
        .filter(el => getComputedStyle(el).animationName !== 'none').length)
      assert.equal(redStatic, 0)
      assert.equal(await section(page).locator('.wd-mapbox svg rect[fill="url(#wd-hatch)"]').count(), 0, 'ลายขีดแดงต้องไม่ถูกวาดเป็นพื้นที่ (ผังไม่ระบุความหมาย)')
      assert.ok((await mapText(page)).includes('ผังต้นฉบับวาดลายขีดแดงตรงนี้ ไม่ระบุความหมาย'))
      const state = () => section(page).locator('path.wd-flow').first().evaluate(el => getComputedStyle(el).animationPlayState)
      assert.equal(await state(), 'running')
      await section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' }).click()
      assert.equal(await state(), 'paused')
    } finally { await context.close() }
  })

  await check('น้ำเลา: คำอธิบายสัญลักษณ์ครบ · กล่องที่มาบอกอายุผัง + ของที่ไม่ได้วาด/วาดต่าง (ลายขีดแดงไม่ตีความ · ขอบเขตเทา · YOM003 นอกตำบล) · คำกำกับบังคับ · ไม่เขียนว่าแล้ง/ท่วม', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      await modeButton(page, 'ผังภาพ').click()
      const legend = await section(page).locator('.wd-legend').innerText()
      for (const needed of ['อ่างเก็บน้ำ', 'อ่างแผนก่อสร้าง', 'ฝายแผนก่อสร้าง', 'แหล่งน้ำ', 'เขตตามผัง', 'ลำห้วยสาขา']) assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      assert.ok(!legend.includes('ชำรุด') && !legend.includes('สะพาน') && !legend.includes('ประปา'), 'ผังนี้ไม่มีของเหล่านี้ ต้องไม่มีบรรทัดอธิบาย')
      for (const mode of ['ผังภาพ', 'สายน้ำ (รายการ)']) {
        await modeButton(page, mode).click()
        const text = await section(page).innerText()
        for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ผังน้ำตำบลน้ำเลา อำเภอร้องกวาง', 'ไฟล์ลงวันที่ 30 เม.ย. 2567', 'ไม่ตีความ', 'เส้นประเทา', 'นอกตำบล']) {
          assert.ok(text.includes(needed), `โหมด ${mode} ต้องมี "${needed}"`)
        }
        assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 1)
        assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), nl.omitted.length)
      }
      const text = await section(page).innerText()
      for (const lane of nl.lanes) {
        assert.ok(text.includes(lane.title), `ขาดสาย ${lane.title}`)
        for (const item of lane.items) assert.ok(text.includes(item.name), `ขาดรายการ ${item.name}`)
      }
      // ข้อความบนตัวผังภาพ (ไม่นับกล่องที่มาที่ต้องพูดถึงคำอธิบายผังต้นฉบับ) ต้องไม่ตีความลายขีดแดงว่าเป็นพื้นที่แล้ง/ท่วม
      await modeButton(page, 'ผังภาพ').click()
      assert.ok(!/แล้ง|ท่วม/.test(await mapText(page)), 'ผังภาพห้ามเขียนว่าแล้ง/ท่วม')
    } finally { await context.close() }
  })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
if (failed.length > 0) process.exit(1)
