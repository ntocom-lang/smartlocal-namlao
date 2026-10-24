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
  // ข้อความค่าสดยาวสุดที่ระบบสร้างได้ (เกิน 100% + ซ้ำเดิม 9 วัน + ชื่อสถานีฝนยาว) — ใช้ตรวจว่าแผ่นรายการ A4 ไม่ล้นในกรณีเลวร้ายสุด
  nlLong: { dams: null, stations: [nlDam({ storage_percent: 100.4, dam_same_count: 9, dam_same_since: hoursAgo(24 * 8) }), nlRain('STN0911', 'บ้านบุญแจ่ม', 12.5, 2.6), nlRain('RES040', 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา', 0, 2.9)] },
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

async function openScene(browser, baseUrl, sceneName, { width = 1280, height = 900, reducedMotion = 'no-preference', diagram = null, tab = 'route', announcement = null, initScript = null } = {}) {
  const scene = SCENES[sceneName]
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH', reducedMotion })
  if (initScript) await context.addInitScript(initScript)
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
// WD_ONLY="คำ1|คำ2" รันเฉพาะข้อที่ชื่อมีคำใดคำหนึ่ง (ไว้ใช้ตอนทำ red-check ทีละส่วน — รันปกติไม่ตั้งค่านี้ = ครบทุกข้อ)
const ONLY = (process.env.WD_ONLY ?? '').split('|').filter(Boolean)
async function check(name, run) {
  if (ONLY.length > 0 && !ONLY.some(part => name.includes(part))) return
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`)
  }
}

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })

try {
  // ═══ ผังทุกผังแสดง "ภาพนำเสนอ" (โปสเตอร์) แทนภาพเกาะลอยในหน้า — ทุ่งแค้ว (ข้อ 1–6 + แท็บ) · ตำหนักธรรม (ข้อ 7) · น้ำเลา (ข้อ 8) ═══
  const route = DIAGRAMS.thungkaew.route
  const routeList = page => section(page).locator('[data-route-list]')
  const tabButton = (page, name) => section(page).getByRole('tab', { name })
  // ภาพนำเสนอในหน้า (ไม่ใช่ในหน้าต่างพิมพ์)
  const posterSvg = page => section(page).locator('[data-poster-inline] svg[data-poster]')
  // รอให้ค่าสดของภาพนำเสนอขึ้นแล้ว (ทุ่งแค้ว = วงแหวนอ่างห้วยยอย · น้ำเลา = วงแหวนอ่างแม่คำปอง · ตำหนักธรรม = ป้ายระดับน้ำ Y.38)
  const READY = { thungkaew: ['[data-poster-ring] text', '73.2%'], namlao: ['[data-poster-ring] text', '84.5%'], tamnaktham: ['[data-poster-pill] text', 'ต่ำกว่าตลิ่ง 2.35 ม.'] }
  const posterReady = (svg, id) => svg.locator(READY[id][0], { hasText: READY[id][1] }).first().waitFor({ timeout: 10_000 })
  const TONES = Object.keys(CHIP_TONES)
  // ข้อความของส่วนที่เป็นค่าสดบนโปสเตอร์ (วงแหวน + แคปซูล + การ์ดค่าวัด) — ไม่นับท้ายภาพที่เล่าชื่อสถานีในรายการ "ไม่ได้ใส่ในภาพนี้"
  const posterLiveText = svg => svg.locator('[data-poster-ring], [data-poster-pill], [data-poster-live-card]').allTextContents().then(parts => parts.join(' | '))
  // สภาพค่าสดบนโปสเตอร์ใบใดใบหนึ่ง (วงแหวนอ่างทุกวง + แคปซูลทุกใบ + ช่องในการ์ดค่าวัด) ใช้เทียบภาพในหน้ากับหน้าต่างพิมพ์ได้
  const posterState = svg => svg.evaluate(el => {
    const ringOf = ring => ({
      tone: ring.getAttribute('data-tone'),
      text: ring.querySelector('text').textContent,
      filled: [...ring.querySelectorAll('circle[stroke-dasharray]')].some(c => c.getAttribute('stroke') !== 'rgba(148,163,184,.3)'),
      // หมายเหตุใต้ชื่ออ่าง (เช่น ตัวเลขซ้ำเดิม) อยู่ในกลุ่มวงแหวนเอง — ข้อความเดียวกันซ้ำในการ์ดค่าวัดด้วย เทสต์ที่ดูข้อความรวมของภาพจึงมองไม่ออกว่าหมายเหตุใต้อ่างหาย
      note: ring.querySelectorAll('text')[1]?.textContent ?? null,
    })
    const rings = [...el.querySelectorAll('[data-poster-ring]')]
    return {
      ring: rings[0] ? ringOf(rings[0]) : null,
      rings: rings.map(ring => ({ slot: ring.getAttribute('data-poster-ring'), ...ringOf(ring) })),
      pills: [...el.querySelectorAll('[data-poster-pill]')].map(p => ({
        slot: p.getAttribute('data-poster-pill'), tone: p.getAttribute('data-tone'), text: p.querySelector('text').textContent,
        dashed: p.querySelector('rect').hasAttribute('stroke-dasharray'),
      })).sort((a, b) => a.slot.localeCompare(b.slot)),
      liveRows: [...el.querySelectorAll('[data-poster-live-row]')].map(row => row.getAttribute('data-poster-live-row')),
      text: el.textContent,
    }
  })
  const ringsOf = state => state.rings.map(r => [r.slot, r.tone, r.text, r.filled, r.note]).sort((a, b) => a[0].localeCompare(b[0]))
  const pillsOf = state => state.pills.map(p => [p.slot, p.tone, p.text, p.dashed])

  // ── 1–4) ทุ่งแค้ว: ค่าสด ปกติ / ค้าง / ไม่มีสถานี+Worker ล่ม / ค่าว่าง ──
  const TKW_SLOTS = ['dam-30', 'dam-50', 'level-YOM003', 'rain-RES038']
  const TKW_WHERE = 'หนองม่วงไข่ ห่าง 4.8 กม.'
  await check('ทุ่งแค้ว: ค่าสดปกติ — วงแหวนอ่าง 2 แห่ง + ป้ายฝน + ป้ายระดับน้ำที่แม่น้ำ · การ์ดค่าวัดบอกสถานีและระยะ · หมายเลข 1–14 · รายการจุดบอกค่าเดียวกัน · ลำดับหัวโปสเตอร์ → ปุ่มหยุด → คำกำกับ → แท็บ → ภาพ', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'normal')
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'thungkaew')
      await svg.locator('[data-poster-ring] text', { hasText: '76.8%' }).first().waitFor({ timeout: 10_000 })
      assert.deepEqual([...new Set(reservoirRequests)].sort(), ['30', '50'], 'ขอรายงานอ่างเล็กเฉพาะ 2 อ่างของผัง')
      assert.equal(await section(page).locator('svg[data-route-art]').count(), 0, 'ทุ่งแค้วไม่แสดงภาพเกาะลอยแล้ว')
      assert.equal(await section(page).locator('[data-route-legend]').count(), 0, 'คำอธิบายสัญลักษณ์ของภาพเกาะลอยไม่ติดมา (ภาพนำเสนอมีคำอธิบายในภาพเอง)')
      const state = await posterState(svg)
      assert.deepEqual(ringsOf(state), [['dam-30', 'ok', '76.8%', true, null], ['dam-50', 'ok', '73.2%', true, null]], 'วงแหวนอ่างห้วยปุ่ย/ห้วยยอย')
      assert.deepEqual(pillsOf(state), [['level-YOM003', 'ok', 'ต่ำกว่าตลิ่ง 4.55 ม.', false], ['rain-RES038', 'ok', 'ฝน 12.5 มม.', false]], 'ป้ายระดับน้ำที่แม่น้ำ + ป้ายฝน ขอบทึบสีฟ้า')
      assert.deepEqual([...state.liveRows].sort(), TKW_SLOTS, 'การ์ดค่าวัดครบ 4 ช่อง')
      assert.ok([...state.rings, ...state.pills].every(item => TONES.includes(item.tone)), 'ป้ายทุกใบต้องมีโทนที่รู้จัก')
      const liveText = await posterLiveText(svg)
      assert.ok(liveText.includes(`${TKW_WHERE} · ต่ำกว่าตลิ่ง 4.55 ม.`), 'การ์ดค่าวัดบอกสถานีวัดระดับน้ำและระยะห่าง (สถานีอยู่นอกตำบล)')
      assert.ok(liveText.includes('อ่างห้วยยอย: ฝน 12.5 มม.'), 'ฝนที่สถานีอ่างห้วยยอย')
      assert.equal(await svg.locator('[data-poster-node]').count(), 14)
      assert.deepEqual(await svg.locator('g[data-poster-node][data-status="planned"]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-poster-node')))), [5, 10], 'จุดแผนก่อสร้าง (ป้าย "แผน")')
      assert.deepEqual(await svg.locator('g[data-poster-node][data-status="repair"]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-poster-node')))), [9], 'จุดชำรุด (ป้าย "ชำรุด")')
      // จุดชำรุดมีป้าย "ชำรุด" ในภาพจริง + สัญลักษณ์ท่อขาด (ไม่ใช่วงเปล่า) · ป้ายนี้ไม่ขึ้นที่จุดอื่น
      assert.equal(await svg.locator('g[data-poster-node="9"]').evaluate(el => el.textContent.includes('ชำรุด')), true, 'จุด 9 มีป้าย "ชำรุด"')
      assert.equal(await svg.locator('g[data-poster-node="9"] path[d="M-4 -8L4 10"]').count(), 1, 'จุด 9 มีสัญลักษณ์ท่อขาด')
      assert.equal(await svg.locator('g[data-poster-node]:not([data-poster-node="9"])').evaluateAll(els => els.filter(el => el.textContent.includes('ชำรุด')).length), 0, 'ไม่มีจุดอื่นที่ติดป้าย "ชำรุด"')
      assert.deepEqual(await svg.locator('[data-poster-tile]').evaluateAll(els => els.map(el => [el.getAttribute('data-poster-tile'), el.querySelectorAll('text')[0].textContent])), [['จุดสำคัญ', '14'], ['แผนก่อสร้าง', '2'], ['ชำรุดตามผัง', '1'], ['จุดวัดค่า', '4']])
      // แม่น้ำยม: หัวลูกศรชี้ซ้ายตามผังต้นฉบับ (วาดจริง 1 ตัว อยู่ปลายซ้ายของแถบ — ไม่ใช่แค่ค่าในข้อมูล)
      assert.equal(await svg.locator('[data-poster-river]').getAttribute('data-poster-river-arrow'), 'left')
      const tkwHead = await svg.locator('[data-poster-river] path[fill="#fff"]').evaluateAll(els => els.map(el => el.getBoundingClientRect()))
      const tkwStrip = await svg.locator('[data-poster-river] rect').first().evaluate(el => el.getBoundingClientRect())
      assert.equal(tkwHead.length, 1, 'หัวลูกศรแม่น้ำ 1 ตัว'); assert.ok(tkwHead[0].right < tkwStrip.left + tkwStrip.width * 0.1, 'หัวลูกศรอยู่ปลายซ้ายของแถบแม่น้ำ')
      assert.equal(await routeList(page).locator('li').count(), 14, 'รายการจุดต้องครบ 14 จุด (13 จุด + แม่น้ำ)')
      const list = await routeList(page).innerText()
      for (const expected of ['73.2% · รายงาน', '76.8% · รายงาน', 'ฝนสะสม 24 ชม. 12.5 มม.', `${TKW_WHERE} · ต่ำกว่าตลิ่ง 4.55 ม.`]) {
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
        await top(svg),
      ]
      assert.deepEqual(order, [...order].sort((x, y) => x - y), `ลำดับบนลงล่างต้องเป็น หัวโปสเตอร์ → ปุ่มหยุด → คำกำกับ → แท็บ → ภาพ: ${order}`)
      assert.equal(await section(page).locator('h2').count(), 1, 'ส่วนนี้มี h2 เดียว (หัวโปสเตอร์)')
      assert.ok(Math.abs(order[0] - (await top(section(page)))) < 2, 'หัวโปสเตอร์ชิดบนสุดของส่วน')
      assert.match(await section(page).innerText(), /ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต/)
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'route-normal-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ทุ่งแค้ว: ค่าค้าง — วงแหวน "ค้าง" ขอบประ + หมายเหตุ "ไม่มีรายงานใหม่" · ป้ายฝน/ระดับน้ำ "ไม่มีค่าใหม่" ขอบประเทา · ไม่โชว์ค่าที่ค้างเป็นตัวเลขปัจจุบัน · รายการจุดและหน้าต่างพิมพ์ตรงกัน', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'stale')
    try {
      const svg = posterSvg(page)
      await svg.locator('[data-poster-pill] text', { hasText: 'ไม่มีค่าใหม่' }).first().waitFor({ timeout: 10_000 })
      await svg.locator('[data-poster-ring] text', { hasText: 'ค้าง' }).first().waitFor({ timeout: 10_000 })
      const state = await posterState(svg)
      assert.deepEqual(ringsOf(state), [['dam-30', 'stale', 'ค้าง', false, 'ไม่มีรายงานใหม่'], ['dam-50', 'stale', 'ค้าง', false, 'ไม่มีรายงานใหม่']], 'อ่างทั้งสองค้าง: วงแหวนไม่มีส่วนเติม บอกว่าไม่มีรายงานใหม่')
      assert.deepEqual(pillsOf(state), [['level-YOM003', 'stale', 'ไม่มีค่าใหม่', true], ['rain-RES038', 'stale', 'ไม่มีค่าใหม่', true]], 'ป้ายที่ค้างต้องขอบประสีเทา ไม่ใช่ขอบทึบสีฟ้า')
      const liveText = await posterLiveText(svg)
      assert.ok(!/12\.5|4\.55|ต่ำกว่าตลิ่ง|73\.2|76\.8/.test(liveText), 'ค่าที่ค้างต้องไม่โชว์เป็นค่าปัจจุบัน')
      assert.equal(await svg.locator('[data-poster-ring] circle[stroke-dasharray^="4 4"]').count(), 2, 'วงแหวนที่ค้างเป็นเส้นประ')
      const list = await routeList(page).innerText()
      assert.ok(list.includes('ไม่มีรายงานใหม่ตั้งแต่') && list.includes('ไม่มีค่าใหม่ (วัดล่าสุด'))
      await page.locator('[data-poster-open]').click()
      const dialog = page.locator('[data-poster-overlay] svg[data-poster]')
      await dialog.waitFor({ timeout: 10_000 })
      assert.deepEqual(await posterState(dialog), state, 'หน้าต่างพิมพ์ต้องแสดงค่าเดียวกับภาพในหน้า')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'route-stale-1280.png') })
    } finally { await context.close() }
  })

  await check('ทุ่งแค้ว: ไม่มีสถานี + Worker ล่ม — "ไม่มีค่า" + "โหลดไม่ได้" ไม่มีเลข 0 หรือคำว่าปกติ · การ์ดค่าวัดมีแถวเสมอ · ไม่เกิด JS error', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'empty')
    try {
      const svg = posterSvg(page)
      await svg.locator('[data-poster-ring] text', { hasText: 'ไม่มีค่า' }).first().waitFor({ timeout: 10_000 })
      await svg.locator('[data-poster-ring] text', { hasText: 'โหลดไม่ได้' }).first().waitFor({ timeout: 10_000 })
      const state = await posterState(svg)
      assert.deepEqual(ringsOf(state), [['dam-30', 'na', 'ไม่มีค่า', false, 'โหลดไม่ได้'], ['dam-50', 'na', 'ไม่มีค่า', false, 'โหลดไม่ได้']], 'อ่าง 2 แห่งโหลดไม่ได้')
      assert.deepEqual(pillsOf(state), [['level-YOM003', 'na', 'ไม่มีค่า', true], ['rain-RES038', 'na', 'ไม่มีค่า', true]], 'ป้ายไม่มีค่าต้องขอบประสีเทา')
      assert.deepEqual([...state.liveRows].sort(), TKW_SLOTS, 'การ์ดค่าวัดต้องมีแถวทุกช่องแม้ไม่มีค่า')
      const liveText = await posterLiveText(svg)
      assert.ok(!/ปกติ|0 มม|0%/.test(liveText), 'ห้ามมี "ปกติ" หรือ 0 เมื่อไม่มีค่า')
      const list = await routeList(page).innerText()
      assert.ok(list.includes('ยังโหลดรายงานอ่างนี้ไม่ได้ในตอนนี้') && list.includes('ไม่มีค่าในระบบ'))
      assert.deepEqual(problems, [], 'Worker ล่มต้องไม่ทำให้เกิด JS error')
    } finally { await context.close() }
  })

  await check('ทุ่งแค้ว: ค่าว่างจากต้นทาง (rain/bank เป็น null) ไม่กลายเป็น 0 หรือ "ต่ำกว่าตลิ่ง 0"', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nullvalues')
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'thungkaew')
      const state = await posterState(svg)
      assert.deepEqual(pillsOf(state), [['level-YOM003', 'na', 'ไม่มีค่า', true], ['rain-RES038', 'na', 'ไม่มีค่า', true]], 'ฝนและระดับน้ำว่าง = ไม่มีค่า')
      assert.ok(!/ตลิ่ง|0 มม/.test(await posterLiveText(svg)))
    } finally { await context.close() }
  })

  // ── 4) เลย์เอาต์ ──
  // ทุกผัง: ไม่มีปุ่มสลับโหมดผัง/ซูม · มือถือเริ่มที่แผนภาพ · จอใหญ่ภาพบนรายการล่าง · ทุกแท็บไม่ล้นจอ
  for (const [id, scene, shotName] of [['thungkaew', 'normal', 'route'], ['tamnaktham', 'tkNormal', 'tk-route'], ['namlao', 'nlNormal', 'nl-route']]) for (const width of [360, 390, 768, 1280]) {
    await check(`เลย์เอาต์ ${id} ${width}px: ไม่เลื่อนแนวนอน · ไม่ล้นขอบจอ · ปุ่ม/ลิงก์ ≥ 44px · ตัวหนังสือบนภาพไม่เล็กเกินไป · ภาพ/รายการ/ที่มาตามแท็บ`, async () => {
      const { context, page } = await openScene(browser, baseUrl, scene, { width, diagram: id === 'thungkaew' ? null : id })
      try {
        const artSvg = posterSvg(page)
        await posterReady(artSvg, id)
        assert.equal(await section(page).getByRole('group', { name: 'โหมดแสดงผัง' }).count(), 0, 'มุมมองใหม่ไม่มีปุ่มสลับโหมดผัง')
        assert.equal(await section(page).getByRole('button', { name: 'ย่อผัง' }).count() + await section(page).getByRole('button', { name: 'ขยายผัง' }).count(), 0, 'ภาพพอดีจอ ไม่มีปุ่มซูม')
        // ตรวจเลย์เอาต์ของแท็บที่เปิดอยู่ตอนนี้ (เรียกซ้ำทุกแท็บ)
        const layoutIssues = async label => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${label}: หน้าเลื่อนแนวนอน`)
          const clipped = await section(page).evaluate((root, limit) => [...root.querySelectorAll('*')]
            // ชิ้นส่วนภายใน SVG ข้าม (คลื่นแม่น้ำกว้างเกินกรอบโดยตั้งใจและถูกตัดด้วย clipPath) — ตรวจตัว svg เองพอ
            // ภาพนำเสนอกว้างขั้นต่ำ 900px เลื่อนแนวนอนในกรอบของมันเอง (ตั้งใจ) — ตรวจตัวกรอบว่าไม่ล้นจอ ไม่ตรวจชิ้นส่วนข้างใน
            .filter(el => (el.offsetParent !== null || el instanceof SVGElement) && !el.parentElement?.closest('svg') && !el.parentElement?.closest('[data-poster-inline]'))
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
        // ขนาดตัวหนังสือจริงบนจอ = font-size × สัดส่วนที่ภาพถูกย่อ (ภาพกว้างขั้นต่ำ 900px บนมือถือ)
        const minPx = await artSvg.evaluate(svg => {
          const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
          return Math.min(...[...svg.querySelectorAll('text.wp-lbl, g[data-poster-pill] text')].map(t => parseFloat(getComputedStyle(t).fontSize) * scale))
        })
        assert.ok(minPx >= (width <= 360 ? 8.5 : 9.5), `ตัวหนังสือบนภาพเล็กเกินไป ${minPx.toFixed(1)}px ที่ ${width}px`)
        const art = await artSvg.boundingBox()
        if (width < 1024) {
          assert.equal(await routeList(page).isVisible(), false, 'มือถือ/แท็บเล็ต: เริ่มที่แท็บแผนภาพ ยังไม่เห็นรายการ')
          await tabButton(page, /^รายการจุด/).click()
          assert.equal(await routeList(page).isVisible(), true)
          assert.equal(await artSvg.isVisible(), false, 'แท็บรายการจุดต้องซ่อนภาพ')
          await layoutIssues('แท็บรายการจุด')
        } else {
          const list = await routeList(page).boundingBox()
          assert.ok(list && list.y >= art.y + art.height - 2, 'จอใหญ่: ภาพนำเสนอเต็มกว้างอยู่บน รายการจุดอยู่ใต้ภาพ')
          assert.equal(await section(page).getByRole('tab', { name: /^รายการจุด/ }).count(), 0, 'จอกว้างรายการอยู่ข้างภาพแล้ว ไม่มีแท็บรายการ')
        }
        await tabButton(page, /^ที่มา$/).click()
        assert.equal(await section(page).locator('[data-diagram-source]').isVisible(), true)
        assert.equal(await artSvg.isVisible(), false, 'แท็บที่มาต้องซ่อนภาพ')
        await layoutIssues('แท็บที่มา')
        await tabButton(page, /^แผนภาพ/).click()
        await section(page).screenshot({ path: path.join(SHOT_DIR, `${shotName}-${width}.png`) })
      } finally { await context.close() }
    })
  }

  // ── 6) ข้อความบังคับ + ชื่อที่ยังไม่ยืนยัน + ครบทุกจุด (ทุ่งแค้ว) ──
  await check('ทุ่งแค้ว: คำกำกับ "ไม่ได้แสดงว่ามีน้ำไหลจริง" + "ไม่ใช่แผนที่" + คำอธิบายสัญลักษณ์เฉพาะที่ใช้ + ที่มา + ลิงก์ต้นฉบับ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'thungkaew')
      const artText = await section(page).innerText()
      await tabButton(page, /^ที่มา$/).click()
      const text = artText + '\n' + await section(page).innerText()
      await tabButton(page, /^แผนภาพ/).click()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ไม่ใช่แผนที่', 'ไม่ได้หมายถึงสิ่งก่อสร้างหรือพื้นที่จริง']) {
        assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      }
      const legend = await svg.locator('[data-poster-legend]').evaluate(el => el.textContent)
      for (const needed of ['เส้นวิ่ง = ผังวาดลูกศรทิศน้ำไว้', 'กรอบแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', 'กรอบเหลือง = ชำรุดตามผัง ไม่เคลื่อนไหว', 'ขอบประเทา = ไม่มีข้อมูลในระบบ', 'ป้ายขาว = ค่าวัดจากสถานี']) {
        assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      }
      assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 2, 'ลิงก์ผังต้นฉบับ 2 อัน: ใต้คำกำกับ + ในแท็บที่มา')
      assert.ok(!/แล้ง|ท่วม/.test((await svg.evaluate(el => el.textContent)).replace('ไม่ใช่ประกาศ', '')), 'ภาพห้ามเขียนว่าแล้ง/ท่วม')
      // อ่างห้วยเฮือไม่มีข้อมูลในระบบ = ขอบประเทา (ไม่ใช่แผนก่อสร้าง) 1 จุด · ชำรุด/แผนก่อสร้างขอบสีของตัวเอง
      assert.equal(await svg.locator('g[data-poster-node]:not([data-status="planned"]):not([data-status="repair"]) > circle.wp-node[stroke-dasharray]').count(), 1, 'อ่างห้วยเฮือขอบประเทา')
      assert.equal(await svg.locator('g[data-poster-node][data-status="repair"] > circle.wp-node').evaluate(el => el.style.stroke), 'var(--fix)', 'จุดชำรุดขอบสีเหลือง')
      assert.equal(await svg.locator('g[data-poster-node][data-status="repair"] > circle.wp-node').getAttribute('stroke-dasharray'), null, 'จุดชำรุดขอบทึบ (ต่างจากแผนก่อสร้างที่ขอบประ)')
    } finally { await context.close() }
  })

  await check('กล่องที่มาของทุ่งแค้ว: บอกอายุผังต้นฉบับ + ของที่ไม่ใส่/ไม่ตรงจริง (ชื่อห้วยอ่านไม่ชัด · ตำแหน่งฝาย · โครงสร้างอื่นในผัง)', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      await tabButton(page, /^ที่มา$/).click()
      const text = await section(page).innerText()
      for (const needed of ['ไฟล์ลงวันที่ 9 พ.ค. 2567', 'ที่ผังต้นฉบับมีแต่เราวาดต่างไป หรือไม่ได้วาด', 'ไม่ขอเดาชื่อ', 'ตำแหน่งฝายและลำห้วยแต่ละแห่งบนแผนที่', 'ประปาหมู่ 1 และหมู่ 4']) assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), DIAGRAMS.thungkaew.omitted.length)
    } finally { await context.close() }
  })

  await check('ทุ่งแค้ว: ไม่มีชื่อห้วยแนวตั้ง 4 เส้นที่ยังไม่ยืนยัน (ห้วยจำค่า/ห้วยย่าเฟย) บนหน้า · รายการจุดครบทุกจุดของข้อมูล · ภาพมีชื่อทุกจุด · แผนก่อสร้าง/ชำรุดมีแท็กในรายการ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal')
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'thungkaew')
      const text = await section(page).innerText()
      const svgText = await svg.evaluate(el => el.textContent)
      assert.ok(!/ห้วยจำค่า|ห้วยย่าเฟย/.test(text) && !/ห้วยจำค่า|ห้วยย่าเฟย/.test(svgText))
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
  await check('แท็บ มือถือ 390px: เริ่มที่แผนภาพ · สลับรายการจุด/ที่มาได้ · แผงที่ไม่ได้เลือกถูกซ่อนจริง · ลูกศร/Home/End สลับแท็บ · หน้าสั้นลงมาก', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 390 })
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'thungkaew')
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
      assert.equal(await svg.isVisible(), false)
      const list = await height()
      assert.equal(await routeList(page).locator('li').count(), 14)

      await tabButton(page, /^ที่มา$/).click()
      assert.equal(await section(page).locator('[data-diagram-source]').isVisible(), true)
      assert.equal(await section(page).locator('[data-route-view]').isVisible(), false)
      const source = await height()
      assert.match(await section(page).locator('[data-diagram-source]').innerText(), /ไม่ใช่ประกาศเตือนภัย/)

      // เดิมทั้งหมดอยู่หน้าเดียวสูง ~2,930px ที่ 390px (วัดจริง) — แต่ละแท็บต้องไม่เกินครึ่งหนึ่งเศษ
      // ที่มา < 960 (เดิม 900): ลิงก์ "ดูผังต้นฉบับ" ย้ายมาอยู่ใต้คำกำกับเหนือแท็บ (เจ้าของระบบสั่ง 2569-10-23) เพิ่มความสูงทุกแท็บราว 56px (ปุ่ม 44px + ช่องไฟ)
      assert.ok(art < 1700 && list < 1700 && source < 960, `ความสูงแต่ละแท็บ: แผนภาพ ${art} · รายการ ${list} · ที่มา ${source}`)

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

      // กลับมาแท็บแผนภาพ ค่าสดยังอยู่ครบ (วงแหวน 2 + ป้าย 2)
      await posterReady(svg, 'thungkaew')
      assert.equal(await svg.locator('g[data-tone="ok"]').count(), 4)
    } finally { await context.close() }
  })

  await check('แท็บ จอกว้าง 1280px: ไม่มีแท็บรายการ (รายการอยู่ใต้ภาพ) · แท็บที่มาใช้ได้ · ย่อจอจากกว้างเป็นมือถือแล้วกลับมา/ขยายจอตอนอยู่แท็บรายการ = กลับแท็บแผนภาพ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'normal', { width: 1280 })
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'thungkaew')
      const tabs = section(page).getByRole('tab')
      assert.deepEqual(await tabs.allInnerTexts(), ['แผนภาพและรายการ', 'ที่มา'])
      assert.equal(await routeList(page).isVisible(), true)
      assert.equal(await svg.isVisible(), true)
      // ย่อเป็นมือถือ → ไปแท็บรายการ → ขยายกลับ: รายการขึ้นใต้ภาพ และแท็บที่เลือกเป็นแผนภาพ
      await page.setViewportSize({ width: 390, height: 900 })
      await tabButton(page, /^รายการจุด/).click()
      assert.equal(await svg.isVisible(), false)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.waitForFunction(() => document.querySelector('#water-diagram [role="tab"][aria-selected="true"]')?.innerText === 'แผนภาพและรายการ', null, { timeout: 5000 })
      assert.equal(await routeList(page).isVisible(), true)
      assert.equal(await svg.isVisible(), true)
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
      await posterReady(posterSvg(page), 'thungkaew')
    } finally { await context.close() }
  })

  // ── 8) ผังน้ำเลา (?diagram=namlao บน demo) — แสดง "ภาพนำเสนอ" (โปสเตอร์) แทนภาพเกาะลอย (เจ้าของระบบสั่ง 2569-10-23) ──
  const nl = DIAGRAMS.namlao
  const NL = nl.route
  // จุดที่ผังต้นฉบับไม่มีข้อมูลระดับน้ำ/ไม่ได้ผูกช่องค่าสด (ห้วยทรายขาว–อ่าง · อ่างห้วยขึมโยธินฯ) วาดขอบประเทาในภาพนำเสนอ
  const NA_NODES = 2

  // ── 7) ผังตำหนักธรรม (?diagram=tamnaktham บน demo) — แสดง "ภาพนำเสนอ" (โปสเตอร์) แทนภาพเกาะลอยเหมือนน้ำเลา ──
  const tk = DIAGRAMS.tamnaktham
  const TK = tk.route
  const TK_SLOT = 'level-Y.38'
  const TK_STATION = 'บ้านแม่คำมีตำหนักธรรม ห่าง 0.7 กม.'

  await check('ตำหนักธรรม: ภาพนำเสนอ (โปสเตอร์) อยู่ในหน้าแทนภาพเกาะลอย · ป้ายระดับน้ำ Y.38 บนภาพ + ชื่อสถานี/ระยะในการ์ดค่าวัด · ไม่มีฝน/อ่าง · หมายเลข 1–15 · แผนก่อสร้าง 5 จุด · รายการจุดเป็นแผ่น A4 ไม่มีหัวข้อกลุ่ม', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      // ผังนี้ไม่มีอ่างเล็ก: ห้ามมีคำขอรายงานอ่างที่ id ว่าง (null/undefined) — คำขอ 50/30 มาจากการ์ดอ่างเล็กด้านบนของ demo
      assert.deepEqual(reservoirRequests.filter(id => id !== '50' && id !== '30'), [], 'ผังไม่มีอ่างเล็กต้องไม่ยิงคำขอ id แปลก')
      assert.match(await section(page).locator('h2').innerText(), /เส้นทางน้ำ\s*ตำบลตำหนักธรรม/)
      assert.match(await section(page).innerText(), /ข้อมูลจริงของตำหนักธรรม ใช้สาธิต/)
      const svg = posterSvg(page)
      await posterReady(svg, 'tamnaktham')
      assert.equal(await section(page).locator('svg[data-route-art]').count(), 0, 'ตำหนักธรรมไม่แสดงภาพเกาะลอยแล้ว')
      assert.equal(await section(page).locator('[data-route-legend]').count(), 0, 'คำอธิบายสัญลักษณ์ของภาพเกาะลอยไม่ติดมา (ภาพนำเสนอมีคำอธิบายในภาพเอง)')
      const state = await posterState(svg)
      assert.equal(state.ring, null, 'ผังนี้ไม่มีอ่าง = ไม่มีวงแหวน')
      assert.deepEqual(state.pills.map(p => [p.slot, p.tone, p.text, p.dashed]), [[TK_SLOT, 'ok', 'ต่ำกว่าตลิ่ง 2.35 ม.', false]], 'ป้ายค่าสดช่องเดียว (Y.38) ขอบทึบสีฟ้า')
      assert.deepEqual(state.liveRows, [TK_SLOT])
      assert.ok(TONES.includes(state.pills[0].tone), 'ป้ายต้องมีโทนที่รู้จัก')
      const liveText = await posterLiveText(svg)
      assert.ok(liveText.includes(TK_STATION) && liveText.includes('ต่ำกว่าตลิ่ง 2.35 ม.'), 'การ์ดค่าวัดบอกชื่อสถานีและระยะ (ป้ายบนภาพสั้น ผู้อ่านต้องรู้ว่าวัดที่ไหน ห่างแค่ไหน)')
      assert.ok(!/ฝน|อ่าง/.test(liveText), 'ผังนี้ไม่มีป้ายอ่าง/ฝน')
      assert.equal(await svg.locator('[data-poster-river] [data-poster-pill], [data-poster-river] [data-poster-ring]').count(), 0, 'แม่น้ำยมไม่มีสถานีวัด = ไม่วาดป้ายบนแม่น้ำ')
      assert.equal(await svg.locator('[data-poster-node]').count(), 15)
      // แม่น้ำยม: หัวลูกศรชี้ขวาตามผัง (วาดจริง 1 ตัว อยู่ปลายขวาของแถบ) · คำกำกับตรงกับทิศ
      assert.equal(await svg.locator('[data-poster-river]').getAttribute('data-poster-river-arrow'), 'right')
      const arrowHead = await svg.locator('[data-poster-river] path[fill="#fff"]').evaluateAll(els => els.map(el => el.getBoundingClientRect()))
      const strip = await svg.locator('[data-poster-river] rect').first().evaluate(el => el.getBoundingClientRect())
      assert.equal(arrowHead.length, 1, 'หัวลูกศรแม่น้ำ 1 ตัว'); assert.ok(arrowHead[0].left > strip.left + strip.width * 0.9, 'หัวลูกศรอยู่ปลายขวาของแถบแม่น้ำ')
      assert.ok((await svg.locator('[data-poster-river]').evaluate(el => el.textContent)).includes('หัวลูกศรชี้ไปทางตะวันออกตามผัง'))
      // ทิศของเส้นวิ่งที่หัวลูกศรชี้ (ปลายเส้น): น้ำแม่คำมีลงใต้ · คลองชลประทานไปทางตะวันออก ตามที่ผังวาด
      const ends = await svg.evaluate(el => Object.fromEntries(['mkm', 'canal'].map(id => {
        const path = el.querySelector('g[data-poster-stream="' + id + '"] path[marker-end]')
        const length = path.getTotalLength()
        const a = path.getPointAtLength(0); const b = path.getPointAtLength(length)
        return [id, { dx: b.x - a.x, dy: b.y - a.y }]
      })))
      assert.ok(ends.mkm.dy > 400 && Math.abs(ends.mkm.dx) < 60, 'น้ำแม่คำมีหัวลูกศรชี้ลงใต้ (ปลายเส้นอยู่ล่าง)')
      assert.ok(ends.canal.dx > 800 && Math.abs(ends.canal.dy) < 60, 'คลองชลประทานหัวลูกศรชี้ไปทางตะวันออก (ปลายเส้นอยู่ขวา)')
      // ป้ายชื่อลำน้ำบนเส้น: เฉพาะชื่อที่อยู่ในผัง
      assert.deepEqual((await svg.locator('[data-poster-stream-label]').allTextContents()).sort(), ['คลองชลประทานแม่ยมฝั่งซ้าย', 'ร่องซิง', 'ห้วยเคี่ยน'])
      // จุด 9 = คลองตัดผ่านน้ำแม่คำมี (สัญลักษณ์คลอง ไม่ใช่สะพาน) · จุด 1 = ตัวลำน้ำ (ลายคลื่น)
      assert.equal(await svg.locator('g[data-poster-node="9"] path[d="M0 -10V10"]').count(), 1, 'จุด 9 ใช้สัญลักษณ์คลอง')
      assert.equal(await svg.locator('g[data-poster-node="9"] rect').count(), 0, 'จุด 9 ไม่ถูกวาดเป็นสะพาน')
      assert.equal(await svg.locator('g[data-poster-node="1"] path[d^="M-11 1Q"]').count(), 1, 'จุด 1 ลายคลื่นน้ำ')
      assert.deepEqual(await svg.locator('g[data-poster-node][data-status="planned"]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-poster-node')))), [3, 5, 8, 11, 12], 'จุดแผนก่อสร้างบนภาพ (ป้าย "แผน")')
      assert.deepEqual(await svg.locator('[data-poster-tile]').evaluateAll(els => els.map(el => [el.getAttribute('data-poster-tile'), el.querySelectorAll('text')[0].textContent])), [['จุดสำคัญ', '15'], ['แผนก่อสร้าง', '5'], ['จุดวัดค่า', '1']], 'แถบตัวเลขเฉพาะที่ผังนี้มี (ไม่มี "0 สายน้ำ")')
      assert.equal(await routeList(page).locator('li[data-stop]').count(), 15)
      assert.equal(await routeList(page).getAttribute('data-list-sheet'), 'true', 'จอกว้างใช้แผ่นรายการ A4')
      const list = await routeList(page).innerText()
      assert.ok(list.includes(`${TK_STATION} · ต่ำกว่าตลิ่ง 2.35 ม.`), 'รายการจุดบอกสถานี ระยะ และค่า')
      for (const item of [...TK.stops, TK.river]) assert.ok(list.includes(item.name), `รายการขาดจุด ${item.n} ${item.name}`)
      assert.equal(await routeList(page).locator('[data-group]').count(), 0, 'ตำหนักธรรมเรียงตามลำน้ำ ไม่มีหัวข้อกลุ่ม')
      const art = await svg.boundingBox()
      assert.ok((await routeList(page).boundingBox()).y >= art.y + art.height - 2, 'รายการจุดอยู่ใต้ภาพ')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'tk-normal-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ตำหนักธรรม: ค่าค้าง/ค่าว่าง/ไม่มีสถานี = บอกตรงๆ ไม่ใช่ค่าสด ไม่เป็น 0 · ป้ายขอบประ · การ์ดค่าวัดมีแถวเสมอ · หน้าต่างพิมพ์ตรงกับภาพในหน้า · รายการจุดบอกค่าเดียวกัน', async () => {
    for (const [scene, [tone, text], rowHas, forbidden, listHas] of [
      ['tkStale', ['stale', 'ไม่มีค่าใหม่'], `${TK_STATION} ไม่มีค่าใหม่`, /ต่ำกว่าตลิ่ง|2\.35/, `${TK_STATION} · ไม่มีค่าใหม่`],
      ['tkNull', ['na', 'ไม่มีค่า'], 'ไม่มีค่าในระบบ', /ตลิ่ง|ปกติ/, 'ไม่มีค่าในระบบ'],
      ['tkEmpty', ['na', 'ไม่มีค่า'], 'ไม่มีค่าในระบบ', /ตลิ่ง|ปกติ|0 ม\./, 'ไม่มีค่าในระบบ'],
    ]) {
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: 'tamnaktham' })
      try {
        const svg = posterSvg(page)
        await svg.locator('[data-poster-pill] text', { hasText: text }).first().waitFor({ timeout: 10_000 })
        const state = await posterState(svg)
        assert.deepEqual(state.pills.map(p => [p.slot, p.tone, p.text, p.dashed]), [[TK_SLOT, tone, text, true]], `${scene}: ป้ายขอบประสีเทา`)
        assert.deepEqual(state.liveRows, [TK_SLOT], `${scene}: การ์ดค่าวัดต้องมีแถวช่องนี้เสมอ ไม่ว่าค่าจะเป็นอะไร`)
        const liveText = await posterLiveText(svg)
        assert.ok(liveText.includes(rowHas), `${scene}: การ์ดค่าวัดต้องบอกว่า "${rowHas}"`)
        assert.ok(!forbidden.test(liveText), `${scene}: ค่าที่ไม่สดต้องไม่โชว์เป็นค่าปัจจุบัน (${forbidden})`)
        assert.ok((await routeList(page).innerText()).includes(listHas), `${scene}: รายการจุดต้องมี "${listHas}"`)
        await page.locator('[data-poster-open]').click()
        const dialog = page.locator('[data-poster-overlay] svg[data-poster]')
        await dialog.waitFor({ timeout: 10_000 })
        assert.deepEqual(await posterState(dialog), state, `${scene}: หน้าต่างพิมพ์ต้องแสดงค่าเดียวกับภาพในหน้า`)
      } finally { await context.close() }
    }
  })

  await check('ตำหนักธรรม: คำอธิบายสัญลักษณ์ในภาพเฉพาะที่ใช้ · คำกำกับบังคับครบ · ที่มา/ของที่ไม่ได้วาด (เขตหมู่บ้าน · ห้วยหาด · ประตูระบายน้ำเล็ก) · รายการครบ · แผนก่อสร้างมีแท็ก · ไม่เขียนว่าแล้ง/ท่วม', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'tkNormal', { diagram: 'tamnaktham' })
    try {
      const svg = posterSvg(page)
      await posterReady(svg, 'tamnaktham')
      const legend = await svg.locator('[data-poster-legend]').evaluate(el => el.textContent)
      for (const needed of ['เส้นวิ่ง = ผังวาดลูกศรทิศน้ำไว้', 'กรอบแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', 'ป้ายขาว = ค่าวัดจากสถานี']) assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      for (const absent of ['ชำรุด', 'ขอบประเทา']) assert.ok(!legend.includes(absent), `ผังนี้ไม่มี "${absent}" ต้องไม่มีบรรทัดอธิบาย`)
      // ไม่มีอ่างที่ไม่มีข้อมูล: ไม่มีโนดขอบประเทา (ยกเว้นแผนก่อสร้างที่ขอบประสีแดง)
      assert.equal(await svg.locator('g[data-poster-node]:not([data-status="planned"]) > circle.wp-node[stroke-dasharray]').count(), 0)
      const artText = await section(page).innerText()
      await tabButton(page, /^ที่มา$/).click()
      const text = artText + '\n' + await section(page).innerText()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'ไม่ใช่แผนที่', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ผังน้ำตำบลตำหนักธรรม อำเภอหนองม่วงไข่', 'ไฟล์ลงวันที่ 9 พ.ค. 2567', 'เขตหมู่บ้าน', 'ห้วยหาด']) {
        assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      }
      assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 2, 'ลิงก์ผังต้นฉบับ 2 อัน: ใต้คำกำกับ + ในแท็บที่มา')
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), tk.omitted.length)
      await tabButton(page, /^แผนภาพ/).click()
      assert.ok(!/แล้ง|ท่วม/.test((await svg.evaluate(el => el.textContent)).replace('ไม่ใช่ประกาศ', '')), 'ภาพห้ามเขียนว่าแล้ง/ท่วม')
      const planned = routeList(page).locator('li[data-status="planned"]')
      assert.equal(await planned.count(), 5)
      for (const li of await planned.all()) assert.ok((await li.innerText()).includes('แผนก่อสร้าง · ไม่เคลื่อนไหว'))
    } finally { await context.close() }
  })

  await check('น้ำเลา: ภาพนำเสนอ (โปสเตอร์) อยู่ในหน้าแทนภาพเกาะลอย · ป้ายอ่างแม่คำปอง + ฝน 2 สถานี · ไม่มีป้ายระดับน้ำ/อ่างเล็ก · หมายเลข 1–21 · รายการจุดอยู่ใต้ภาพ หัวข้อกลุ่มตามสายในผัง', async () => {
    const { context, page, problems, reservoirRequests } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      assert.deepEqual(reservoirRequests.filter(id => id !== '50' && id !== '30'), [], 'ผังไม่มีอ่างเล็กต้องไม่ยิงคำขอ id แปลก')
      assert.match(await section(page).locator('h2').innerText(), /เส้นทางน้ำ\s*ตำบลน้ำเลา/)
      assert.match(await section(page).innerText(), /ข้อมูลจริงของน้ำเลา ใช้สาธิต/)
      const svg = posterSvg(page)
      await svg.locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
      assert.equal(await section(page).locator('svg[data-route-art]').count(), 0, 'น้ำเลาไม่แสดงภาพเกาะลอยแล้ว')
      assert.equal(await section(page).locator('[data-route-legend]').count(), 0, 'คำอธิบายสัญลักษณ์ของภาพเกาะลอยไม่ติดมา (ภาพนำเสนอมีคำอธิบายในภาพเอง)')
      const state = await posterState(svg)
      assert.deepEqual(state.ring, { tone: 'ok', text: '84.5%', filled: true, note: null })
      assert.deepEqual(state.pills.map(p => [p.slot, p.tone, p.text]), [['rain-RES040', 'ok', 'ฝน 0 มม.'], ['rain-STN0911', 'ok', 'ฝน 12.5 มม.']])
      assert.ok([state.ring.tone, ...state.pills.map(p => p.tone)].every(tone => TONES.includes(tone)), 'ป้ายทุกใบต้องมีโทนที่รู้จัก')
      const liveText = await posterLiveText(svg)
      assert.ok(!/ตลิ่ง|YOM003/.test(liveText), 'ผังนี้ไม่มีป้ายระดับน้ำ')
      assert.equal(await svg.locator('[data-poster-river] [data-poster-pill], [data-poster-river] [data-poster-ring]').count(), 0, 'ลำน้ำแม่ถางไม่มีสถานีวัด/ช่องค่าสด = ไม่วาดป้ายบนแม่น้ำ')
      assert.equal(await svg.locator('[data-poster-node]').count(), 21)
      assert.equal(await svg.locator('g[data-poster-node][data-status="planned"]').count(), 3, 'จุดแผนก่อสร้าง 3 จุด (ป้าย "แผน")')
      // ลำน้ำแม่ถาง: หัวลูกศรชี้ซ้ายตามผัง อยู่ปลายซ้ายของแถบ
      assert.equal(await svg.locator('[data-poster-river]').getAttribute('data-poster-river-arrow'), 'left')
      const nlHead = await svg.locator('[data-poster-river] path[fill="#fff"]').evaluateAll(els => els.map(el => el.getBoundingClientRect()))
      const nlStrip = await svg.locator('[data-poster-river] rect').first().evaluate(el => el.getBoundingClientRect())
      assert.equal(nlHead.length, 1); assert.ok(nlHead[0].right < nlStrip.left + nlStrip.width * 0.1, 'หัวลูกศรอยู่ปลายซ้ายของแถบ')
      assert.equal(await routeList(page).locator('li[data-stop]').count(), 21)
      // รายการจุดอยู่ใต้ภาพเป็นแผ่น A4 (รายละเอียดตรวจในเทสต์ "แผ่นรายการ A4" ด้านล่าง)
      const art = await svg.boundingBox()
      const listBox = await routeList(page).boundingBox()
      assert.ok(listBox.y >= art.y + art.height - 2, `รายการต้องอยู่ใต้ภาพ (ภาพล่าง ${Math.round(art.y + art.height)} · รายการบน ${Math.round(listBox.y)})`)
      assert.equal(await routeList(page).getAttribute('data-list-sheet'), 'true', 'จอกว้างใช้แผ่นรายการ A4')
      const list = await routeList(page).innerText()
      for (const expected of ['อ่างเก็บน้ำแม่คำปอง ห่าง 3.6 กม.', '84.5% ของความจุที่ระดับเก็บกัก', '5.71/6.76 ล้าน ลบ.ม.', 'สถานีบ้านบุญแจ่ม ห่าง 2.6 กม.', 'สถานีอ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา ห่าง 2.9 กม.']) {
        assert.ok(list.includes(expected), `รายการต้องมี "${expected}"`)
      }
      const groups = await routeList(page).locator('[data-group]').allInnerTexts()
      assert.deepEqual(groups, [...new Set(NL.stops.map(s => s.group)), NL.river.group], 'หัวข้อกลุ่มเรียงตามสายในผังต้นฉบับ')
      await section(page).screenshot({ path: path.join(SHOT_DIR, 'nl-normal-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  for (const [id, scene, ROUTE, label] of [['thungkaew', 'normal', route, 'ทุ่งแค้ว'], ['namlao', 'nlNormal', NL, 'น้ำเลา'], ['tamnaktham', 'tkNormal', TK, 'ตำหนักธรรม']]) {
    await check(`${label}: เส้นวิ่งในภาพตรงผัง (ลำที่ผังวาดลูกศร) พร้อมหัวลูกศร · ลำที่ผังวาดลูกศรนิ่งไม่วิ่ง · แผนก่อสร้างไม่มีแอนิเมชัน · เส้นประจากแผนก่อสร้างไม่วิ่ง · ปุ่มหยุดเคลื่อนไหวหยุดลายวิ่ง · ลดการเคลื่อนไหว = ไม่วิ่งแต่หัวลูกศรยังอยู่`, async () => {
      const flowIds = ROUTE.streams.filter(s => s.flow).map(s => s.id).sort()
      let r = await openScene(browser, baseUrl, scene, { diagram: id })
      try {
        const { page } = r
        const svg = posterSvg(page)
        await posterReady(svg, id)
        assert.deepEqual(await svg.locator('g[data-poster-stream][data-flow="true"]').evaluateAll(els => els.map(el => el.getAttribute('data-poster-stream')).sort()), flowIds, 'เส้นวิ่งต้องเท่ากับลำที่ผังวาดลูกศรทุกเส้น ไม่เกิน ไม่ขาด')
        const names = await svg.locator('g[data-poster-stream][data-flow="true"] .wp-flow').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
        assert.deepEqual(names, flowIds.map(() => 'wp-dash'), 'เส้นวิ่งทุกเส้นต้องมีแอนิเมชัน')
        assert.equal(await svg.locator('g[data-poster-stream][data-flow="false"] .wp-flow').count(), 0, 'เส้นนิ่งไม่มีลายวิ่ง')
        assert.equal(await svg.locator('g[data-poster-stream][data-flow="true"] path[marker-end]').count(), flowIds.length, 'เส้นวิ่งมีหัวลูกศรปลายทาง')
        assert.equal(await svg.locator('g[data-poster-stream][data-flow="false"] path[marker-end]').count(), 0, 'ลำที่ไม่วิ่งไม่มีหัวลูกศร (ไม่เดาทิศ)')
        assert.deepEqual(await svg.locator('g[data-poster-node][data-status="planned"]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-poster-node')))), ROUTE.stops.filter(s => s.status === 'planned').map(s => s.n), 'จุดแผนก่อสร้างบนภาพ')
        assert.equal(await svg.evaluate(el => [...el.querySelectorAll('g[data-status="planned"] *, g[data-status="repair"] *')].filter(node => getComputedStyle(node).animationName !== 'none').length), 0, 'แผนก่อสร้าง/ชำรุดห้ามมีแอนิเมชัน')
        // เส้นประแดงจากแผนก่อสร้างไปลำน้ำ: เป็น "ความสัมพันธ์ตามผัง" ไม่ใช่ลำน้ำ — ต้องมีครบตามข้อมูล เป็นเส้นประ และไม่วิ่ง
        const stemIds = Object.entries(ROUTE.poster.nodes).filter(([, node]) => node.stem).map(([n]) => n).sort()
        assert.ok(stemIds.length > 0, 'ข้อมูลผังมีเส้นประจากแผนก่อสร้าง')
        assert.deepEqual(await svg.locator('[data-poster-stem]').evaluateAll(els => els.map(el => el.getAttribute('data-poster-stem')).sort()), stemIds, 'เส้นประจากแผนก่อสร้างไปลำน้ำต้องครบตามข้อมูล')
        assert.equal(await svg.locator('[data-poster-stem][stroke-dasharray]').count(), stemIds.length, 'เส้นจากแผนก่อสร้างต้องเป็นเส้นประ (ไม่ใช่ลำน้ำ)')
        assert.equal(await svg.locator('[data-poster-stem]').evaluateAll(els => els.filter(el => getComputedStyle(el).animationName !== 'none').length), 0, 'เส้นประไม่วิ่ง')
        // ภาพที่ยังอยู่นอกจอถูกหยุดโดยตั้งใจ (ไม่กินแบต) — เลื่อนเข้าจอก่อนตรวจปุ่มหยุด
        await section(page).scrollIntoViewIfNeeded()
        await page.waitForFunction(() => !document.querySelector('#water-diagram')?.hasAttribute('data-offscreen'), null, { timeout: 5000 })
        const state = () => svg.locator('.wp-flow').first().evaluate(el => getComputedStyle(el).animationPlayState)
        assert.equal(await state(), 'running')
        await section(page).getByRole('button', { name: 'หยุดเคลื่อนไหว' }).click()
        assert.equal(await state(), 'paused', 'ปุ่มหยุดต้องหยุดลายวิ่งของภาพนำเสนอด้วย')
        await section(page).getByRole('button', { name: 'เล่นเคลื่อนไหว' }).click()
        assert.equal(await state(), 'running')
      } finally { await r.context.close() }
      r = await openScene(browser, baseUrl, scene, { diagram: id, reducedMotion: 'reduce' })
      try {
        const svg = posterSvg(r.page)
        await posterReady(svg, id)
        const names = await svg.locator('.wp-flow').evaluateAll(els => els.map(el => getComputedStyle(el).animationName))
        assert.ok(names.length === flowIds.length && names.every(name => name === 'none'), `ลดการเคลื่อนไหว: ลายวิ่งต้องหยุด (${[...new Set(names)]})`)
        assert.equal(await svg.locator('g[data-poster-stream][data-flow="true"] path[marker-end]').count(), flowIds.length, 'ดูทิศจากหัวลูกศรได้แม้ไม่วิ่ง')
        assert.match(await section(r.page).innerText(), /ตั้งค่าให้ลดการเคลื่อนไหว/)
      } finally { await r.context.close() }
    })
  }

  await check('น้ำเลา: คำอธิบายสัญลักษณ์ในภาพเฉพาะที่ใช้ · อ่างไม่มีข้อมูลขอบประ · ที่มา/ของที่ไม่ได้วาด (ลายขีดแดงไม่ตีความ · เส้นขอบเขต · YOM003 นอกตำบล) · คำกำกับบังคับ · ไม่เขียนว่าแล้ง/ท่วม', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      const svg = posterSvg(page)
      await svg.locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
      const legend = await svg.locator('[data-poster-legend]').evaluate(el => el.textContent)
      for (const needed of ['เส้นวิ่ง = ผังวาดลูกศรทิศน้ำไว้', 'กรอบแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', 'ขอบประเทา = ไม่มีข้อมูลในระบบ', 'ป้ายขาว = ค่าวัดจากสถานี']) assert.ok(legend.includes(needed), `คำอธิบายสัญลักษณ์ขาด "${needed}"`)
      assert.ok(!legend.includes('ชำรุด'), 'ผังนี้ไม่มีโครงสร้างชำรุด ต้องไม่มีบรรทัดอธิบาย')
      assert.equal(await svg.locator('g[data-poster-node]:not([data-status="planned"]) > circle.wp-node[stroke-dasharray]').count(), NA_NODES, 'อ่างที่ไม่มีข้อมูลวาดขอบประเทา')
      const artText = await section(page).innerText()
      await tabButton(page, /^ที่มา$/).click()
      const text = artText + '\n' + await section(page).innerText()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'ไม่ใช่แผนที่', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ผังน้ำตำบลน้ำเลา อำเภอร้องกวาง', 'ไฟล์ลงวันที่ 30 เม.ย. 2567', 'ไม่ตีความ', 'เส้นขอบเขต', 'นอกตำบล', '28 รายการเป็น 20 จุด']) {
        assert.ok(text.includes(needed), `ต้องมี "${needed}"`)
      }
      assert.equal(await section(page).locator('a[href^="https://www.phraepao.go.th/"]').count(), 2, 'ลิงก์ผังต้นฉบับ 2 อัน: ใต้คำกำกับ + ในแท็บที่มา')
      assert.equal(await section(page).locator('[data-diagram-omitted] li').count(), nl.omitted.length)
      await tabButton(page, /^แผนภาพ/).click()
      // ข้อความบนตัวภาพ (ไม่นับกล่องที่มาที่ต้องพูดถึงคำอธิบายผังต้นฉบับ) ต้องไม่ตีความลายขีดแดงว่าเป็นพื้นที่แล้ง/ท่วม
      assert.ok(!/แล้ง|ท่วม/.test((await svg.evaluate(el => el.textContent)).replace('ไม่ใช่ประกาศ', '')), 'ภาพห้ามเขียนว่าแล้ง/ท่วม')
      const list = await routeList(page).innerText()
      assert.ok(!/แล้ง|ท่วม/.test(list), 'รายการห้ามเขียนว่าแล้ง/ท่วม')
      for (const item of [...NL.stops, NL.river]) assert.ok(list.includes(item.name), `รายการขาดจุด ${item.n} ${item.name}`)
      const planned = routeList(page).locator('li[data-status="planned"]')
      assert.equal(await planned.count(), 3)
      for (const li of await planned.all()) assert.ok((await li.innerText()).includes('แผนก่อสร้าง · ไม่เคลื่อนไหว'))
    } finally { await context.close() }
  })

  await check('น้ำเลา: ปุ่มสลับโหมดมืด/สว่างของภาพในหน้า · เริ่มที่โหมดมืด · กดสว่างแล้วภาพเปลี่ยนจริง (พื้นขาว ตัวอักษรเข้ม) กดกลับมืดได้ · หน้าต่างพิมพ์เปิดมาที่โหมดเดียวกัน · แผ่นรายการไม่เปลี่ยน', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      const svg = posterSvg(page)
      await svg.locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
      const group = section(page).locator('[data-poster-theme]')
      assert.equal(await group.getAttribute('role'), 'group'); assert.equal(await group.getAttribute('aria-label'), 'โหมดสีของภาพ')
      const dark = group.getByRole('button', { name: 'โหมดมืด' })
      const light = group.getByRole('button', { name: 'โหมดสว่าง' })
      assert.equal(await dark.getAttribute('aria-pressed'), 'true'); assert.equal(await light.getAttribute('aria-pressed'), 'false')
      const look = () => svg.evaluate(el => {
        const style = getComputedStyle(el)
        const lum = hex => { const n = parseInt(hex.trim().slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 }
        return { theme: el.getAttribute('data-theme'), bg: lum(style.getPropertyValue('--bg0')), ink: lum(style.getPropertyValue('--ink')) }
      })
      let now = await look()
      assert.equal(now.theme, 'dark'); assert.ok(now.bg < 0.2 && now.ink > 0.8, `โหมดมืด: พื้นเข้ม ตัวอักษรอ่อน (${JSON.stringify(now)})`)
      await light.click()
      assert.equal(await light.getAttribute('aria-pressed'), 'true'); assert.equal(await dark.getAttribute('aria-pressed'), 'false')
      now = await look()
      assert.equal(now.theme, 'light'); assert.ok(now.bg > 0.9 && now.ink < 0.2, `โหมดสว่าง: พื้นขาว ตัวอักษรเข้ม (${JSON.stringify(now)})`)
      // ค่าสด/จำนวนจุดยังเหมือนเดิม (สลับสีอย่างเดียว ไม่ทำให้ข้อมูลหาย)
      assert.equal(await svg.locator('[data-poster-node]').count(), 21)
      assert.equal(await svg.locator('[data-poster-ring] text').first().textContent(), '84.5%')
      // แผ่นรายการเป็นสีสว่างเสมอ ไม่ขึ้นกับโหมด
      const sheetBg = () => section(page).locator('.wl-sheet').evaluate(el => getComputedStyle(el).backgroundColor)
      const before = await sheetBg(); assert.equal(before, 'rgb(255, 255, 255)')
      // หน้าต่างพิมพ์เปิดมาที่โหมดสว่างเหมือนภาพในหน้า · สลับในหน้าต่างไม่ย้อนกลับมาเปลี่ยนภาพในหน้า
      await page.locator('[data-poster-open]').click()
      const dialog = page.locator('[data-poster-overlay] svg[data-poster]')
      await dialog.waitFor({ timeout: 10_000 })
      assert.equal(await dialog.getAttribute('data-theme'), 'light', 'หน้าต่างพิมพ์เริ่มที่โหมดเดียวกับภาพในหน้า')
      assert.equal(await page.locator('[data-poster-overlay]').getByRole('button', { name: /โหมดสว่าง/ }).getAttribute('aria-pressed'), 'true')
      await page.locator('[data-poster-overlay]').getByRole('button', { name: /โหมดมืด/ }).click()
      assert.equal(await dialog.getAttribute('data-theme'), 'dark')
      assert.equal(await svg.getAttribute('data-theme'), 'light', 'สลับในหน้าต่างไม่เปลี่ยนภาพในหน้า')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached', timeout: 3000 })
      assert.equal(await sheetBg(), before, 'แผ่นรายการไม่เปลี่ยนสี')
      // กดกลับโหมดมืดได้ · แท็บอื่นแล้วกลับมาโหมดที่เลือกไว้ยังอยู่ (แผงไม่ถูกถอดทิ้ง)
      await dark.click()
      assert.equal((await look()).theme, 'dark')
      await light.click()
      await tabButton(page, /^ที่มา$/).click()
      await tabButton(page, /^แผนภาพ/).click()
      assert.equal((await look()).theme, 'light', 'สลับแท็บแล้วกลับมา โหมดที่เลือกไว้ต้องอยู่')
      await section(page).locator('[data-poster-panel]').screenshot({ path: path.join(SHOT_DIR, 'nl-poster-light-1280.png') })
    } finally { await context.close() }
  })

  await check('น้ำเลา: ปุ่มโหมดมืด/สว่างบนมือถือ 390px ไม่ล้นหน้า · แตะได้ ≥ 44px · ใช้คีย์บอร์ดกดได้', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao', width: 390, height: 800 })
    try {
      await posterSvg(page).locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
      const info = await page.evaluate(() => ({
        docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        buttons: [...document.querySelectorAll('[data-poster-theme] button, [data-poster-open]')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.right <= window.innerWidth + 0.5] }),
      }))
      assert.equal(info.docOverflow, false)
      assert.equal(info.buttons.length, 3)
      assert.ok(info.buttons.every(([w, h, inside]) => w >= 44 && h >= 44 && inside), `ปุ่มแตะได้และอยู่ในจอ: ${JSON.stringify(info.buttons)}`)
      await section(page).locator('[data-poster-theme-option="light"]').focus()
      await page.keyboard.press('Enter')
      assert.equal(await posterSvg(page).getAttribute('data-theme'), 'light', 'กด Enter บนปุ่มโหมดสว่างได้')
    } finally { await context.close() }
  })

  // จำโหมดมืด/สว่างที่ผู้ใช้เลือกไว้ในเครื่อง (เจ้าของระบบสั่ง 2569-10-23)
  await check('น้ำเลา: จำโหมดที่เลือกไว้ในเครื่อง — กดสว่างแล้วเปิดหน้าใหม่ยังเป็นสว่าง · กดกลับมืดแล้วเปิดใหม่เป็นมืด · หน้าต่างพิมพ์เปิดมาที่โหมดที่จำไว้ · โหมดที่เลือกในหน้าต่างพิมพ์ไม่ถูกจำ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    const theme = () => posterSvg(page).getAttribute('data-theme')
    const stored = () => page.evaluate(() => localStorage.getItem('water-route-poster-theme'))
    const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await posterSvg(page).locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 15_000 }) }
    try {
      await posterSvg(page).locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
      assert.equal(await theme(), 'dark', 'ครั้งแรกที่ไม่เคยเลือก = โหมดมืด'); assert.equal(await stored(), null, 'แค่เปิดหน้าไม่เขียนอะไรลงเครื่อง')
      await section(page).locator('[data-poster-theme-option="light"]').click()
      assert.equal(await stored(), 'light')
      await reload()
      assert.equal(await theme(), 'light', 'เปิดหน้าใหม่ต้องยังเป็นโหมดสว่าง')
      assert.equal(await section(page).locator('[data-poster-theme-option="light"]').getAttribute('aria-pressed'), 'true'); assert.equal(await section(page).locator('[data-poster-theme-option="dark"]').getAttribute('aria-pressed'), 'false')
      // หน้าต่างพิมพ์เปิดมาที่โหมดที่จำไว้ · สลับในหน้าต่างแล้วปิด ไม่ไปเปลี่ยนค่าที่จำ
      await page.locator('[data-poster-open]').click()
      const dialog = page.locator('[data-poster-overlay] svg[data-poster]')
      await dialog.waitFor({ timeout: 10_000 })
      assert.equal(await dialog.getAttribute('data-theme'), 'light')
      await page.locator('[data-poster-overlay]').getByRole('button', { name: /โหมดมืด/ }).click()
      assert.equal(await dialog.getAttribute('data-theme'), 'dark'); assert.equal(await stored(), 'light', 'โหมดที่เลือกในหน้าต่างพิมพ์ไม่ถูกจำ')
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached', timeout: 3000 })
      await reload()
      assert.equal(await theme(), 'light', 'เปิดใหม่หลังสลับในหน้าต่างพิมพ์ ภาพในหน้ายังเป็นสว่างที่จำไว้')
      await section(page).locator('[data-poster-theme-option="dark"]').click()
      assert.equal(await stored(), 'dark')
      await reload()
      assert.equal(await theme(), 'dark', 'กดกลับมืดแล้วเปิดใหม่ต้องเป็นมืด')
    } finally { await context.close() }
  })

  await check('น้ำเลา: ค่าที่จำไว้แปลก หรือที่เก็บข้อมูลของเบราว์เซอร์ใช้ไม่ได้ — ภาพขึ้นโหมดมืด ปุ่มสลับยังใช้ได้ ไม่มี error ในหน้า', async () => {
    const cases = [
      ['ค่าแปลก', () => { localStorage.setItem('water-route-poster-theme', 'rainbow') }],
      ['ค่าว่าง', () => { localStorage.setItem('water-route-poster-theme', '') }],
      ['อ่านที่เก็บข้อมูลไม่ได้', () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } }) }],
      ['อ่านได้แต่เขียนไม่ได้', () => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') } }],
    ]
    for (const [label, initScript] of cases) {
      const { context, page, problems } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao', initScript })
      try {
        const svg = posterSvg(page)
        await svg.locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
        assert.equal(await svg.getAttribute('data-theme'), 'dark', `${label}: ต้องขึ้นโหมดมืด`)
        await section(page).locator('[data-poster-theme-option="light"]').click()
        assert.equal(await svg.getAttribute('data-theme'), 'light', `${label}: กดสว่างแล้วภาพต้องเปลี่ยนในรอบนี้`)
        await section(page).locator('[data-poster-theme-option="dark"]').click()
        assert.equal(await svg.getAttribute('data-theme'), 'dark')
        assert.deepEqual(problems, [], `${label}: ต้องไม่มี error ในหน้า`)
      } finally { await context.close() }
    }
  })

  await check('ลิงก์ "ดูผังต้นฉบับ" ย้ายมาอยู่ใต้กรอบคำกำกับสีฟ้าในแท็บเส้นทางน้ำ (ทุกตำบล) · ชี้ไฟล์ภาพของตำบลนั้น เปิดแท็บใหม่ · อยู่เหนือแท็บ ไม่ต้องเลื่อนหา · แท็บสถานการณ์ไม่มีลิงก์นี้แล้ว', async () => {
    const FILES = { thungkaew: '66598230820240509_181654.jpg', tamnaktham: '82389834520240509_182321.jpg', namlao: '171202098020240430_133004.jpg' }
    for (const [id, scene] of [['thungkaew', 'normal'], ['tamnaktham', 'tkNormal'], ['namlao', 'nlNormal']]) {
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: id === 'thungkaew' ? null : id })
      try {
        await section(page).locator('[data-diagram-disclaimer]').waitFor({ timeout: 10_000 })
        const near = section(page).locator('a[data-original-link-near]')
        assert.equal(await near.count(), 1, `${id}: ต้องมีลิงก์ใต้คำกำกับ 1 อัน`)
        assert.equal(await near.innerText(), 'ดูผังต้นฉบับ')
        const href = await near.getAttribute('href')
        assert.ok(href.endsWith(FILES[id]), `${id}: ต้องชี้ไฟล์ภาพของตำบลนี้ (${href})`)
        assert.equal(await near.getAttribute('target'), '_blank'); assert.match(await near.getAttribute('rel'), /noopener/)
        // ลิงก์ในแท็บ "ที่มา" ยังอยู่และชี้ที่เดียวกัน
        assert.equal(await section(page).locator('[data-diagram-source] a[data-original-link]').getAttribute('href'), href, `${id}: ลิงก์ในแท็บที่มาต้องชี้ที่เดียวกัน`)
        // ตำแหน่ง: ใต้กรอบคำกำกับ (ห่างไม่เกิน 24px) และเหนือแถบแท็บ — กดได้ทันทีไม่ต้องเลื่อนหา
        const [cap, link, tabs] = await Promise.all([
          section(page).locator('[data-diagram-disclaimer]').boundingBox(), near.boundingBox(), section(page).getByRole('tablist').boundingBox(),
        ])
        assert.ok(link.y >= cap.y + cap.height - 1 && link.y - (cap.y + cap.height) <= 24, `${id}: ลิงก์ต้องอยู่ใต้กรอบคำกำกับเลย (ห่าง ${Math.round(link.y - (cap.y + cap.height))}px)`)
        assert.ok(link.y + link.height <= tabs.y + 1, `${id}: ลิงก์ต้องอยู่เหนือแท็บ`)
        assert.ok(link.height >= 44 && link.width >= 44, `${id}: ขนาดกดได้ ≥ 44px (${Math.round(link.width)}×${Math.round(link.height)})`)
        // เห็นได้ทุกแท็บของส่วนนี้ (อยู่เหนือแท็บ) — เปิดแท็บ "ที่มา" แล้วยังเห็น
        await tabButton(page, /^ที่มา$/).click()
        assert.equal(await near.isVisible(), true, `${id}: ลิงก์ยังเห็นเมื่ออยู่แท็บที่มา`)
      } finally { await context.close() }
    }
    // แท็บสถานการณ์: กล่อง "ที่มาของข้อมูล" ของระบบน้ำของตำบลไม่มีลิงก์ผังต้นฉบับแล้ว (ย้ายไปแท็บเส้นทางน้ำ) แต่ข้อความที่มายังอยู่
    for (const [id, scene] of [['thungkaew', 'normal'], ['tamnaktham', 'tkNormal'], ['namlao', 'nlNormal']]) {
      // เปิดที่แท็บเส้นทางน้ำ (ทุกตำบลรอได้ด้วย #water-diagram) แล้วกดแท็บ "สถานการณ์" — ตำหนักธรรมไม่มีสถานีฝน หน้าสถานการณ์เลยไม่มี #water-rain ที่ openScene รอ
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: id === 'thungkaew' ? null : id })
      try {
        await page.getByRole('tab', { name: 'สถานการณ์' }).click()
        const box = page.locator('[data-system-source]')
        await box.waitFor({ state: 'attached', timeout: 10_000 })
        assert.ok((await box.innerText()).includes('ถอดจากผังของศูนย์บริหารจัดการน้ำจังหวัดแพร่'), `${id}: ข้อความที่มายังอยู่`)
        assert.equal(await box.locator('a').count(), 0, `${id}: กล่องที่มาของแท็บสถานการณ์ต้องไม่มีลิงก์ผังต้นฉบับแล้ว`)
        assert.equal(await page.locator('#water-panel-situation a[data-original-link]').count(), 0, `${id}: แท็บสถานการณ์ไม่มีลิงก์ผังต้นฉบับ`)
      } finally { await context.close() }
    }
  })

  await check('น้ำเลา: ภาพในหน้าเริ่มที่โหมดมืด · เปิดหน้าต่างพิมพ์แล้ว id ของภาพสองใบไม่ซ้ำกันและแต่ละใบอ้างเฉพาะ id ของตัวเอง · สลับโหมดในหน้าต่างไม่ทำให้ภาพในหน้าเปลี่ยน', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      const inline = posterSvg(page)
      await inline.locator('[data-poster-ring] text', { hasText: '84.5%' }).waitFor({ timeout: 10_000 })
      assert.equal(await inline.getAttribute('data-theme'), 'dark')
      await page.locator('[data-poster-open]').click()
      const dialog = page.locator('[data-poster-overlay] svg[data-poster]')
      await dialog.waitFor({ timeout: 10_000 })
      await page.locator('[data-poster-overlay]').getByRole('button', { name: /โหมดสว่าง/ }).click()
      assert.equal(await dialog.getAttribute('data-theme'), 'light')
      assert.equal(await inline.getAttribute('data-theme'), 'dark', 'โหมดในหน้าต่างต้องไม่ไปเปลี่ยนภาพในหน้า')
      const idCheck = await page.evaluate(() => {
        const svgs = [...document.querySelectorAll('svg[data-poster]')]
        const ids = svgs.flatMap(svg => [...svg.querySelectorAll('[id]')].map(el => el.id))
        const stray = svgs.flatMap(svg => [...svg.querySelectorAll('*')]
          .flatMap(el => ['fill', 'stroke', 'filter', 'marker-end'].map(attr => el.getAttribute(attr)))
          .map(value => value?.match(/^url\(#(.+)\)$/)?.[1]).filter(Boolean)
          .filter(ref => !svg.querySelector('[id="' + ref + '"]')))
        return { count: svgs.length, total: ids.length, unique: new Set(ids).size, stray }
      })
      assert.equal(idCheck.count, 2, 'ในหน้า 1 ใบ + ในหน้าต่าง 1 ใบ')
      assert.equal(idCheck.unique, idCheck.total, 'id ของ defs ซ้ำกันข้ามภาพ (url(#…) จะชี้ไปใบแรกเสมอ ธีมของอีกใบเพี้ยน)')
      assert.deepEqual(idCheck.stray, [], 'ทุก url(#…) ต้องชี้ id ที่อยู่ในภาพใบเดียวกัน')
    } finally { await context.close() }
  })

  // ═══ ไม่มีกล่อง "ไม่มีเข็มทิศ" (เจ้าของระบบสั่ง 2569-10-22: ไม่มีก็ไม่ต้องแสดง) + โปสเตอร์ "ภาพนำเสนอ A4" ของน้ำเลา ═══
  for (const [id, scene] of [['thungkaew', 'normal'], ['tamnaktham', 'tkNormal'], ['namlao', 'nlNormal']]) {
    await check(`${id}: ไม่มีกล่องหมายเหตุเข็มทิศ · คำกำกับบังคับยังบอกว่าทิศไม่ตรงจริง · มีปุ่มภาพนำเสนอ + แผ่นรายการ`, async () => {
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: id })
      try {
        await posterSvg(page).waitFor({ timeout: 10_000 })
        assert.equal(await section(page).locator('[data-route-note]').count(), 0, 'ไม่มีกล่องหมายเหตุเข็มทิศ')
        await tabButton(page, /^ที่มา$/).click()
        const text = await section(page).innerText()
        assert.ok(!text.includes('เข็มทิศ'), 'หน้าไม่พูดถึงเข็มทิศ')
        assert.ok(text.includes('ไม่ใช่แผนที่') && text.includes('ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง'), 'คำกำกับบังคับต้องบอกว่าทิศไม่ตรงจริง')
        assert.equal(await section(page).locator('[data-poster-open]').count(), 1, 'ปุ่มภาพนำเสนอ A4 อยู่เหนือภาพ')
        assert.equal(await section(page).locator('[data-list-sheet]').count(), 1, 'จอกว้างใช้แผ่นรายการ A4')
      } finally { await context.close() }
    })
  }

  // ผังที่มีภาพนำเสนอ: ตารางความคาดหวังต่อผัง (เพิ่มผังใหม่ = เพิ่มแถว) — nodes = จำนวนจุดรวมลำน้ำปลายทาง · needs = ข้อความของที่ไม่ได้วาดที่ต้องขึ้นท้ายภาพ
  const POSTERS = [
    { id: 'thungkaew', scene: 'normal', long: 'stale', ready: { normal: '73.2%', stale: 'ไม่มีค่าใหม่' }, nodes: 14, tiles: [['จุดสำคัญ', '14'], ['แผนก่อสร้าง', '2'], ['ชำรุดตามผัง', '1'], ['จุดวัดค่า', '4']], needs: ['ชื่อห้วยแนวตั้ง 4 เส้นกลางผัง'], liveSlots: ['dam-30', 'dam-50', 'level-YOM003', 'rain-RES038'], sheetScenes: ['normal', 'stale', 'empty', 'nullvalues'] },
    { id: 'namlao', scene: 'nlNormal', long: 'nlLong', ready: { nlNormal: '84.5%', nlLong: '100.4%' }, nodes: 21, tiles: [['จุดสำคัญ', '21'], ['สายน้ำในผัง', '4'], ['แผนก่อสร้าง', '4'], ['จุดวัดค่า', '3']], needs: ['พื้นที่ลายขีดแดงทางซ้ายล่าง'], liveSlots: ['dam-305', 'rain-RES040', 'rain-STN0911'], sheetScenes: ['nlNormal', 'nlOver', 'nlSame', 'nlStale', 'nlNull', 'nlEmpty', 'nlLong'] },
    { id: 'tamnaktham', scene: 'tkNormal', long: 'tkStale', ready: { tkNormal: 'ต่ำกว่าตลิ่ง 2.35 ม.', tkStale: 'ไม่มีค่าใหม่' }, nodes: 15, tiles: [['จุดสำคัญ', '15'], ['แผนก่อสร้าง', '5'], ['จุดวัดค่า', '1']], needs: ['เขตหมู่บ้าน'], liveSlots: ['level-Y.38'], sheetScenes: ['tkNormal', 'tkStale', 'tkNull', 'tkEmpty'] },
  ]
  const posterLook = page => page.locator('[data-poster-overlay]')
  const openPoster = async (scene, opts = {}) => {
    const opened = await openScene(browser, baseUrl, scene, { diagram: 'namlao', ...opts })
    await opened.page.locator('[data-poster-open]').click()
    await opened.page.locator('[data-poster-overlay] svg[data-poster]').waitFor({ timeout: 10_000 })
    return opened
  }

  // จัดวางบนภาพ: ข้อความไม่ทับกัน · ชื่อตำบลไม่ทับกล่องคำอธิบาย · กล่องคำอธิบายไม่ชนแถบตัวเลข · ข้อความในการ์ดค่าวัดไม่ล้นการ์ด · ท้ายภาพไม่ล้นกรอบ
  // วัดจากกล่องข้อความจริงของเบราว์เซอร์ (getBoundingClientRect) ไม่ใช่ตัวเลขที่ข้อมูลระบุ — ตัวหนังสือไทยสูงกว่าที่คิด ตำแหน่งในข้อมูลที่ดูพอดีอาจทับกันจริง
  for (const P of POSTERS) for (const scene of [P.scene, P.long]) {
    await check(`${P.id} (${scene}): ภาพนำเสนอจัดวางไม่ทับกัน · ชื่อตำบล/กล่องคำอธิบาย/แถบตัวเลขไม่ชนกัน · การ์ดค่าวัดและท้ายภาพไม่ล้นกรอบ`, async () => {
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: P.id })
      try {
        const svg = posterSvg(page)
        await svg.locator('[data-poster-ring] text, [data-poster-pill] text', { hasText: P.ready[scene] }).first().waitFor({ timeout: 10_000 })
        const layout = await svg.evaluate(el => {
          const rect = node => node.getBoundingClientRect()
          const box = rect(el)
          // หัวเรื่อง/ท้ายภาพเป็นบรรทัดเรียงชิดกันโดยตั้งใจ (กล่องข้อความไทยซ้อนกันได้เล็กน้อย) จึงไม่ตรวจซ้อนกันของสองส่วนนี้ — ตรวจเฉพาะข้อความในตัวภาพ
          const items = [...el.querySelectorAll('text.wp-lbl, g[data-poster-pill] text, g[data-poster-ring] text, [data-poster-live-card] text, [data-poster-legend] text, [data-poster-tile] text, [data-poster-callout] text, [data-poster-river] text, [data-poster-zone] text')]
            .map(node => ({ t: node.textContent.trim().slice(0, 30), r: rect(node) })).filter(x => x.t)
          const overlaps = []
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i].r; const b = items[j].r
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (w > 2 && h > 3) overlaps.push(`${items[i].t} ✕ ${items[j].t}`)
          }
          const outside = [...el.querySelectorAll('text')].filter(node => { const r = rect(node); return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1 }).map(node => node.textContent.trim().slice(0, 30))
          const title = rect(el.querySelector('[data-poster-title]'))
          const legend = rect(el.querySelector('[data-poster-legend] rect'))
          const firstTile = el.querySelector('[data-poster-tile] rect')
          const card = el.querySelector('[data-poster-live-card] rect')
          const cardRight = card ? rect(card).right : null
          const rowsRight = [...el.querySelectorAll('[data-poster-live-row]')].map(row => rect(row).right)
          const footer = [...el.querySelectorAll('[data-poster-footer] text')].map(node => rect(node).right)
          return {
            overlaps, outside, titleRight: title.right, legendLeft: legend.left, legendRight: legend.right, tileLeft: rect(firstTile).left,
            cardRight, rowsRight, footerRight: Math.max(...footer), boxRight: box.right, scale: box.width / el.viewBox.baseVal.width,
          }
        })
        assert.deepEqual(layout.overlaps, [], 'ข้อความที่ทับกันบนภาพ')
        assert.deepEqual(layout.outside, [], 'ข้อความที่ล้นกรอบภาพ')
        const px = layout.scale
        assert.ok(layout.titleRight + 6 * px <= layout.legendLeft, `ชื่อตำบลทับกล่องคำอธิบาย (ชื่อสิ้นสุด ${layout.titleRight.toFixed(0)} · กล่องเริ่ม ${layout.legendLeft.toFixed(0)})`)
        assert.ok(layout.legendRight + 3 * px <= layout.tileLeft, `กล่องคำอธิบายชนแถบตัวเลข (กล่องสิ้นสุด ${layout.legendRight.toFixed(0)} · แถบเริ่ม ${layout.tileLeft.toFixed(0)})`)
        if (layout.cardRight !== null) assert.ok(layout.rowsRight.every(right => right + 6 * px <= layout.cardRight), `ข้อความในการ์ดค่าวัดล้นการ์ด (${layout.rowsRight.map(r => r.toFixed(0))} > ${layout.cardRight.toFixed(0)})`)
        assert.ok(layout.footerRight + 20 * px <= layout.boxRight, `ข้อความท้ายภาพยาวชิด/ล้นขอบ (${layout.footerRight.toFixed(0)} · ขอบ ${layout.boxRight.toFixed(0)})`)
      } finally { await context.close() }
    })
  }

  for (const P of POSTERS) {
    await check(`${P.id}: โปสเตอร์ A4: เปิดเป็นหน้าต่าง (dialog) โฟกัสที่ปุ่มปิด · ${P.nodes} จุด · ตัวเลขหัวโปสเตอร์คำนวณจากผัง · ไม่มีเข็มทิศ · ข้อความบังคับครบ · ปิดด้วย Esc แล้วโฟกัสกลับปุ่มเดิม`, async () => {
      const route = DIAGRAMS[P.id].route
      const { context, page, problems } = await openPoster(P.scene, { diagram: P.id })
      try {
        const dialog = posterLook(page)
        assert.equal(await dialog.getAttribute('role'), 'dialog'); assert.equal(await dialog.getAttribute('aria-modal'), 'true')
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'ปิดภาพนำเสนอ', 'โฟกัสเริ่มที่ปุ่มปิด')
        assert.equal(await page.locator('style[data-poster-print]').count(), 1, 'กฎหน้าพิมพ์ถูกฉีดตอนเปิด')
        assert.equal(await dialog.locator('[data-poster-node]').count(), route.stops.length + 1, 'ทุกจุด + ลำน้ำปลายทาง')
        for (const stop of [...route.stops, route.river]) assert.equal(await dialog.locator(`[data-poster-node="${stop.n}"]`).count(), 1, `จุด ${stop.n} ต้องมีบนโปสเตอร์`)
        const tiles = await dialog.locator('[data-poster-tile]').evaluateAll(els => els.map(el => [el.getAttribute('data-poster-tile'), el.querySelectorAll('text')[0].textContent]))
        assert.deepEqual(tiles, P.tiles)
        const text = await dialog.locator('svg[data-poster]').evaluate(svg => svg.textContent)
        assert.ok(!text.includes('เข็มทิศ'), 'ไม่มีเข็มทิศบนโปสเตอร์')
        for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'ไม่ใช่แผนที่ ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง', 'ยังไม่ผ่านการยืนยันโดย อบต.', 'ไม่ได้ใส่ในภาพนี้', ...P.needs, 'วาดใหม่']) {
          assert.ok(text.includes(needed), `โปสเตอร์ต้องมี "${needed}"`)
        }
        assert.ok(!/แล้ง|ท่วม/.test(text.replace('ไม่ใช่ประกาศ', '')), 'โปสเตอร์ห้ามเขียนว่าแล้ง/ท่วม')
        // ฟอนต์ราชการ + font-size-adjust 0.45 ต้องถึงเบราว์เซอร์จริง (เคยหลุดเงียบๆ เพราะ React เขียนเลข 0.45 เป็น "0.45px")
        assert.deepEqual(await dialog.locator('svg[data-poster]').evaluate(svg => [getComputedStyle(svg).fontFamily.startsWith('THSarabunPSK'), getComputedStyle(svg).fontSizeAdjust]), [true, '0.45'], 'ฟอนต์ราชการ + font-size-adjust ของโปสเตอร์')
        const minFont = await dialog.locator('svg[data-poster]').evaluate(svg => Math.min(...[...svg.querySelectorAll('text')].map(t => parseFloat(getComputedStyle(t).fontSize))))
        assert.ok(minFont >= 10, `ตัวอักษรเล็กสุดต้อง ≥ 10 หน่วย (${minFont})`)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached', timeout: 3000 })
        assert.equal(await page.locator('style[data-poster-print]').count(), 0, 'กฎหน้าพิมพ์ถูกถอดตอนปิด (ไม่ค้างไปกระทบการพิมพ์หน้าอื่น)')
        assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-poster-open')), true, 'โฟกัสกลับปุ่มเดิม')
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }

  await check('โปสเตอร์ A4: เส้นวิ่ง/หัวลูกศรตรงกับผังทุกเส้น · แผนก่อสร้างเป็นกรอบประแดง 3 จุด ไม่มีแอนิเมชัน · ธีมมืด/สว่างสลับได้ · Tab วนอยู่ในหน้าต่าง', async () => {
    const { context, page } = await openPoster('nlNormal')
    try {
      const dialog = posterLook(page)
      const flowing = await dialog.locator('g[data-poster-stream][data-flow="true"]').evaluateAll(els => els.map(el => el.getAttribute('data-poster-stream')).sort())
      assert.deepEqual(flowing, NL.streams.filter(x => x.flow).map(x => x.id).sort(), 'เส้นวิ่งต้องเท่ากับลำที่ผังวาดลูกศรทุกเส้น ไม่เกิน ไม่ขาด')
      assert.equal(await dialog.locator('g[data-poster-stream][data-flow="true"] path[marker-end]').count(), flowing.length, 'เส้นวิ่งมีหัวลูกศรปลายทาง')
      assert.equal(await dialog.locator('g[data-poster-stream][data-flow="false"] path[marker-end]').count(), 0, 'เส้นที่ผังวาดลูกศรนิ่ง/ตกแต่งไม่มีหัวลูกศร')
      assert.equal(await dialog.locator('g[data-poster-stream][data-flow="false"] .wp-flow').count(), 0, 'เส้นนิ่งไม่มีลายวิ่ง')
      const planned = await dialog.locator('g[data-poster-node][data-status="planned"]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-poster-node'))))
      assert.deepEqual(planned, NL.stops.filter(x => x.status === 'planned').map(x => x.n))
      const animatedInPlan = await dialog.evaluate(root => [...root.querySelectorAll('g[data-status="planned"] *')].filter(el => getComputedStyle(el).animationName !== 'none').length)
      assert.equal(animatedInPlan, 0, 'แผนก่อสร้างไม่เคลื่อนไหว')
      // ธีม
      assert.equal(await dialog.locator('svg[data-poster]').getAttribute('data-theme'), 'dark')
      await dialog.getByRole('button', { name: /โหมดสว่าง/ }).click()
      assert.equal(await dialog.locator('svg[data-poster]').getAttribute('data-theme'), 'light')
      assert.equal(await dialog.getByRole('button', { name: /โหมดสว่าง/ }).getAttribute('aria-pressed'), 'true')
      assert.equal(await dialog.getByRole('button', { name: /โหมดมืด/ }).getAttribute('aria-pressed'), 'false')
      // โฟกัสวนในหน้าต่าง (ไม่หลุดไปหน้าเว็บด้านหลัง)
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-poster-overlay]')), true, 'โฟกัสต้องอยู่ในหน้าต่างเสมอ')
      }
    } finally { await context.close() }
  })

  // ค่าสดบนภาพนำเสนอ 6 ฉาก: ค่า/โทน/ขอบประตรงกติกา · ค้าง/ซ้ำเดิม/ไม่มีค่า บอกตรงๆ ไม่ลงสีสถานการณ์ ไม่เป็น 0 · หน้าต่างพิมพ์แสดงค่าเดียวกับภาพในหน้า · รายการจุดบอกค่าเดียวกัน
  const DAM_SLOTS = ['dam-305', 'rain-RES040', 'rain-STN0911']
  for (const [scene, expect] of [
    ['nlNormal', { ringNote: null, ring: ['ok', '84.5%', true], pills: [['rain-RES040', 'ok', 'ฝน 0 มม.'], ['rain-STN0911', 'ok', 'ฝน 12.5 มม.']], note: null, list: ['84.5% ของความจุที่ระดับเก็บกัก', 'ฝนสะสม 24 ชม. 12.5 มม.'] }],
    ['nlOver', { ring: [null, '100.4%', true], pills: null, note: null, list: ['มากกว่า 100% = เกินความจุที่ระดับเก็บกักปกติ'] }],
    ['nlSame', { ringNote: 'ตัวเลขซ้ำเดิม', ring: ['warn', '84.5%', true], pills: [['rain-RES040', 'ok', 'ฝน 1 มม.'], ['rain-STN0911', 'ok', 'ฝน 1 มม.']], note: 'ตัวเลขซ้ำเดิม', list: ['ต้นทางอาจยังไม่ได้ปรับข้อมูล'] }],
    ['nlStale', { ring: ['stale', 'ค้าง', false], pills: [['rain-RES040', 'stale', 'ไม่มีค่าใหม่'], ['rain-STN0911', 'stale', 'ไม่มีค่าใหม่']], note: null, list: ['ไม่มีรายงานใหม่'], forbidden: /12\.5|ฝน 3 / }],
    ['nlNull', { ring: ['na', 'ไม่มีค่า', false], pills: [['rain-RES040', 'na', 'ไม่มีค่า'], ['rain-STN0911', 'na', 'ไม่มีค่า']], note: null, list: [], forbidden: /ปกติ|0 มม|0%/ }],
    ['nlEmpty', { ring: ['na', 'ไม่มีค่า', false], pills: [['rain-RES040', 'na', 'ไม่มีค่า'], ['rain-STN0911', 'na', 'ไม่มีค่า']], note: null, list: [], forbidden: /ปกติ|0 มม|0%/ }],
  ]) {
    await check(`ภาพนำเสนอ น้ำเลา ค่าสด (${scene}): ค่า/โทน/ขอบบนภาพตรงกติกา · ไม่ลงสีสถานการณ์ ไม่เป็น 0 · หน้าต่างพิมพ์ตรงกับภาพในหน้า · รายการจุดบอกค่าเดียวกัน`, async () => {
      const { context, page } = await openScene(browser, baseUrl, scene, { diagram: 'namlao' })
      try {
        const svg = posterSvg(page)
        await svg.locator('[data-poster-ring] text', { hasText: expect.ring[1] }).first().waitFor({ timeout: 10_000 })
        const state = await posterState(svg)
        if (expect.ring[0]) assert.equal(state.ring.tone, expect.ring[0], 'โทนวงแหวนอ่าง')
        else assert.ok(['ok', 'warn'].includes(state.ring.tone), `โทนวงแหวนอ่าง (${state.ring.tone})`)
        assert.equal(state.ring.text, expect.ring[1])
        // วงแหวนไม่มีค่า/ค้าง = ไม่มีส่วนเติม (ไม่เป็น 0% ที่ดูเหมือนว่างเปล่าจริง) · มีค่า = มีส่วนเติม
        assert.equal(state.ring.filled, expect.ring[2], 'วงแหวนเติมเฉพาะตอนมีค่า')
        if (expect.ringNote !== undefined) assert.equal(state.ring.note, expect.ringNote, 'หมายเหตุใต้ชื่ออ่างบนภาพ (ตัวเลขซ้ำเดิมต้องบอกตรงนี้ ไม่ใช่แค่ในการ์ดค่าวัด)')
        for (const pill of state.pills) assert.ok(TONES.includes(pill.tone), `${pill.slot}: โทนที่ไม่รู้จัก ${pill.tone}`)
        if (expect.pills) {
          assert.deepEqual(state.pills.map(p => [p.slot, p.tone, p.text]), expect.pills)
          for (const pill of state.pills) assert.equal(pill.dashed, pill.tone === 'stale' || pill.tone === 'na', `${pill.slot}: ค้าง/ไม่มีค่าต้องขอบประ`)
        }
        const fullText = state.text
        if (expect.note) assert.ok(fullText.includes(expect.note), `ต้องบอก "${expect.note}"`)
        else assert.ok(!fullText.includes('ตัวเลขซ้ำเดิม'))
        // การ์ดค่าวัดล่าสุด: ครบ 3 ช่องที่ผูกไว้ในผัง ไม่ว่าค่าจะเป็นอะไร
        assert.deepEqual(state.liveRows, DAM_SLOTS)
        if (expect.forbidden) assert.ok(!expect.forbidden.test(await posterLiveText(svg)), `${scene}: ค่าที่ไม่สดต้องไม่โชว์เป็นค่าปัจจุบัน (${expect.forbidden})`)
        // รายการจุดใต้ภาพบอกค่าเดียวกัน (liveBadges ตัวเดียวกัน ไม่คิดค่าเอง)
        const list = await routeList(page).innerText()
        for (const needed of expect.list) assert.ok(list.includes(needed), `รายการจุดต้องมี "${needed}" (${scene})`)
        // หน้าต่างพิมพ์ = ภาพเดียวกัน
        await page.locator('[data-poster-open]').click()
        const dialog = page.locator('[data-poster-overlay] svg[data-poster]')
        await dialog.waitFor({ timeout: 10_000 })
        assert.deepEqual(await posterState(dialog), state, 'หน้าต่างพิมพ์ต้องแสดงค่าเดียวกับภาพในหน้า')
      } finally { await context.close() }
    })
  }

  // ═══ แผ่นรายการจุด A4 (ใต้โปสเตอร์ จอ ≥ 1024px · แผ่นที่ 2 ของใบพิมพ์) — เจ้าของระบบสั่ง 2569-10-23 "ย่อให้เหลือเท่ากระดาษ A4 เหมือนกัน ขอเป็นระเบียบด้วย" ═══
  // วัดว่าเนื้อหาทุกจุดอยู่ในแผ่นจริง (ไม่ถูกตัดด้วย overflow:hidden) และเหลือที่ว่างก่อนท้ายแผ่น — ข้อความค่าสดยาวสุด (nlLong) คือกรณีเลวร้ายสุดที่ระบบสร้างได้
  const listSheetFit = locator => locator.evaluate(el => {
    const box = el.getBoundingClientRect()
    const foot = el.querySelector('[data-list-footer]').getBoundingClientRect()
    const cols = [...el.querySelectorAll('[data-list-col]')]
    const items = [...el.querySelectorAll('li[data-stop]')]
    return {
      w: box.width, h: box.height, cols: cols.length, items: items.length,
      clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
      itemsOutside: items.filter(li => { const b = li.getBoundingClientRect(); return b.bottom > foot.top + 0.5 || b.right > box.right + 0.5 }).map(li => li.getAttribute('data-stop')),
      spare: Math.min(...cols.map(col => foot.top - col.getBoundingClientRect().bottom)),
      colNumbers: cols.map(col => [...col.querySelectorAll('li[data-stop]')].map(li => Number(li.getAttribute('data-stop')))),
    }
  })
  const SPARE_PX_MIN = 0.012 // เหลือที่ว่างอย่างน้อย 1.2% ของความสูงแผ่นระหว่างคอลัมน์ที่สูงสุดกับท้ายแผ่น (ข้อความค่าสดยาวขึ้นเล็กน้อยก็ยังไม่ล้น)

  await check('แผ่นรายการ A4 น้ำเลา 1280px: อยู่ใต้โปสเตอร์ · สัดส่วน 257:168 เท่าพื้นที่พิมพ์ · 3 คอลัมน์ตามสาย (1–8 | 9–15 | 16–21) ไม่ฉีกกลุ่ม · ครบ 21 จุด ไม่ถูกตัด · มีคำกำกับบังคับ+ที่มา+เวลาข้อมูลท้ายแผ่น · ไม่มีรายการเดิมซ้ำ', async () => {
    const { context, page, problems } = await openScene(browser, baseUrl, 'nlNormal', { diagram: 'namlao' })
    try {
      const sheet = section(page).locator('[data-list-sheet]')
      await sheet.waitFor({ timeout: 10_000 })
      assert.equal(await section(page).locator('[data-route-list]').count(), 1, 'มีรายการจุดชุดเดียวในหน้า (แผ่นรายการแทนรายการเดิม ไม่ใช่ซ้อนกัน)')
      assert.equal(await section(page).locator('ol.wr-list').count(), 0, 'รายการเดิมต้องไม่ถูกวาดซ้ำบนจอกว้าง')
      const fit = await listSheetFit(sheet)
      assert.ok(Math.abs(fit.w / fit.h - 257 / 168) < 0.01, `สัดส่วนแผ่นต้อง 257:168 (ได้ ${(fit.w / fit.h).toFixed(3)})`)
      assert.equal(fit.cols, 3); assert.equal(fit.items, 21)
      assert.equal(fit.clipped, false, 'เนื้อหาล้นแผ่น (overflow:hidden ตัดทิ้ง)')
      assert.deepEqual(fit.itemsOutside, [], 'จุดที่ตกนอกแผ่น/ทับท้ายแผ่น')
      assert.ok(fit.spare >= fit.h * SPARE_PX_MIN, `ที่ว่างท้ายคอลัมน์ ${fit.spare.toFixed(1)}px น้อยเกินไป`)
      const range = nums => [nums[0], nums[nums.length - 1]]
      assert.deepEqual(fit.colNumbers.map(range), [[1, 8], [9, 15], [16, 21]], 'คอลัมน์ละสาย/กลุ่มสายที่ติดกัน')
      for (const nums of fit.colNumbers) assert.deepEqual(nums, nums.map((_, i) => nums[0] + i), 'หมายเลขในคอลัมน์ต้องเรียงต่อเนื่อง')
      // หัวข้อกลุ่มอยู่คอลัมน์เดียวกับจุดแรกของกลุ่ม · คอลัมน์ละอย่างน้อย 1 กลุ่ม
      assert.deepEqual(await sheet.locator('[data-list-col]').evaluateAll(cols => cols.map(col => [...col.querySelectorAll('[data-group]')].length)), [1, 2, 3])
      // ใต้โปสเตอร์ และอยู่ในแท็บเดียวกัน
      const [art, box] = [await posterSvg(page).boundingBox(), await sheet.boundingBox()]
      assert.ok(box.y >= art.y + art.height - 2, 'แผ่นรายการอยู่ใต้โปสเตอร์')
      // ท้ายแผ่น: คำกำกับบังคับ + ที่มา + เวลาข้อมูลสด (แผ่นนี้พิมพ์แยกได้ และมีค่าวัดอยู่ในแผ่น)
      const footer = await sheet.locator('[data-list-footer]').innerText()
      for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'ไม่ใช่แผนที่', 'ที่มา', 'วาดใหม่', 'ยังไม่ผ่านการยืนยันโดย อบต.', 'ไม่ใช่ประกาศเตือนภัย', 'ข้อมูลสด ณ']) assert.ok(footer.includes(needed), `ท้ายแผ่นต้องมี "${needed}"`)
      // ฟอนต์ราชการ + ขนาดตัวอักษรเป็นสัดส่วนของแผ่น (ไม่ตายตัวเป็น px)
      const style = await sheet.evaluate(el => ({ family: getComputedStyle(el).fontFamily, adjust: getComputedStyle(el).fontSizeAdjust, container: getComputedStyle(el).containerType }))
      assert.match(style.family, /THSarabunPSK/); assert.equal(style.adjust, '0.45'); assert.equal(style.container, 'inline-size')
      await sheet.screenshot({ path: path.join(SHOT_DIR, 'nl-list-sheet-1280.png') })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  for (const P of POSTERS) for (const scene of P.sheetScenes) {
    await check(`แผ่นรายการ A4 ${P.id} (${scene}) ที่ 1024/1280/1920px: ทุกจุดอยู่ในแผ่น ไม่ล้น เหลือที่ว่างท้ายคอลัมน์ · ค่าสดครบทุกจุดที่ผูกไว้ (ค้าง/ซ้ำเดิม/ไม่มีค่าก็บอกตรงๆ)`, async () => {
      for (const width of [1024, 1280, 1920]) {
        const { context, page } = await openScene(browser, baseUrl, scene, { diagram: P.id, width, height: 1000 })
        try {
          const sheet = section(page).locator('[data-list-sheet]')
          await sheet.waitFor({ timeout: 10_000 })
          const fit = await listSheetFit(sheet)
          assert.equal(fit.clipped, false, `${scene}@${width}: เนื้อหาล้นแผ่น`)
          assert.deepEqual(fit.itemsOutside, [], `${scene}@${width}: จุดที่ตกนอกแผ่น`)
          assert.ok(fit.spare >= fit.h * SPARE_PX_MIN, `${scene}@${width}: ที่ว่างท้ายคอลัมน์ ${fit.spare.toFixed(1)}px (แผ่นสูง ${fit.h.toFixed(0)}px)`)
          assert.deepEqual(await sheet.locator('[data-list-live]').evaluateAll(els => els.map(el => el.getAttribute('data-list-live')).sort()), [...P.liveSlots].sort(), 'ช่องค่าสดที่ผูกไว้ต้องอยู่ในแผ่นครบ')
        } finally { await context.close() }
      }
    })
  }

  await check('แผ่นรายการ A4: ต้นฉบับเดียวกับรายการเดิม (ข้อความทุกจุดเหมือน WaterRouteList) · ขอบเขต 1024px: ≥1024 ใช้แผ่น <1024 ใช้รายการเดิมในแท็บรายการจุด · ย่อ/ขยายจอสลับถูก', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nlSame', { diagram: 'namlao', width: 1024, height: 900 })
    try {
      const sheet = section(page).locator('[data-list-sheet]')
      await sheet.waitFor({ timeout: 10_000 })
      // เนื้อหาเดียวกับรายการเดิม: เทียบข้อความของจุดทุกจุดกับรายการเดิม (ย่อจอแล้วอ่านจากแท็บรายการจุด)
      const norm = text => text.replace(/\s+/g, ' ').trim()
      const sheetTexts = await sheet.locator('li[data-stop]').evaluateAll(els => els.map(el => [el.getAttribute('data-stop'), el.innerText]))
      await page.setViewportSize({ width: 1023, height: 900 })
      await tabButton(page, /^รายการจุด/).waitFor({ timeout: 5000 })
      assert.equal(await section(page).locator('[data-list-sheet]').count(), 0, '<1024px: ไม่ใช้แผ่นรายการ')
      await tabButton(page, /^รายการจุด/).click()
      await section(page).locator('ol.wr-list').waitFor({ timeout: 5000 })
      const oldTexts = await section(page).locator('li[data-stop]').evaluateAll(els => els.map(el => [el.getAttribute('data-stop'), el.innerText]))
      assert.equal(oldTexts.length, 21)
      for (const [n, text] of oldTexts) {
        const mine = sheetTexts.find(([m]) => m === n)
        assert.ok(mine, `แผ่นขาดจุด ${n}`)
        // ตัวเลขหมายเลข + ชื่อ + คำอธิบาย + แท็ก + ค่าสด ต้องเหมือนกัน (ลำดับ/ช่องว่างต่างได้เพราะจัดวางต่างกัน)
        assert.deepEqual(norm(mine[1]).split(' ').sort(), norm(text).split(' ').sort(), `จุด ${n}: ข้อความในแผ่นต้องเท่ารายการเดิม`)
      }
      await page.setViewportSize({ width: 1280, height: 900 })
      await tabButton(page, /^แผนภาพ/).waitFor({ timeout: 5000 })
      await section(page).locator('[data-list-sheet]').waitFor({ timeout: 5000 })
      assert.equal(await section(page).locator('ol.wr-list').count(), 0, 'ขยายจอแล้วรายการเดิมต้องหายไป ใช้แผ่นแทน')
    } finally { await context.close() }
  })

  // พิมพ์จริง: จำลองสื่อ print แล้วสั่ง PDF ตาม @page ที่หน้าฉีดไว้ → ต้อง 2 หน้า A4 แนวนอน (แผ่น 1 ภาพนำเสนอ · แผ่น 2 รายการจุด) ทั้งสองธีม
  // ใช้ฉาก nlLong (ข้อความค่าสดยาวสุด) เพื่อให้แผ่นรายการอยู่ในสภาพเลวร้ายสุด
  for (const P of POSTERS) for (const theme of ['dark', 'light']) {
    await check(`ใบพิมพ์ภาพนำเสนอ ${P.id} (${theme}): PDF 2 หน้า A4 แนวนอน · ซ่อนหน้าเว็บ/ปุ่ม/ป้ายแผ่น · แผ่น 1 โปสเตอร์ในพื้นที่พิมพ์ 257 × 170 มม. · แผ่น 2 รายการจุดเต็มพื้นที่พิมพ์ ไม่ล้น ตัวอักษรไม่เล็กกว่า 6pt`, async () => {
      const { context, page } = await openPoster(P.long, { diagram: P.id })
      try {
        if (theme === 'light') await posterLook(page).getByRole('button', { name: /โหมดสว่าง/ }).click()
        await page.emulateMedia({ media: 'print' })
        const layout = await page.evaluate(() => {
          const mm = px => px * 25.4 / 96
          const sheets = [...document.querySelectorAll('[data-poster-sheet]')]
          const rect = el => el.getBoundingClientRect()
          const sheet = rect(sheets[0])
          const svg = rect(sheets[0].querySelector('svg'))
          const list = sheets[1].querySelector('.wl-sheet')
          const listBox = rect(list)
          const listWrap = rect(sheets[1])
          const foot = rect(list.querySelector('[data-list-footer]'))
          const cols = [...list.querySelectorAll('[data-list-col]')]
          const pt = el => parseFloat(getComputedStyle(el).fontSize) * 0.75
          const smallest = Math.min(...[...list.querySelectorAll('li[data-stop] *, [data-list-footer], .wl-title')].filter(el => el.children.length === 0 || el.matches('[data-list-footer]')).map(pt))
          const page1 = document.querySelector('[data-poster-page]')
          return {
            rootDisplay: getComputedStyle(document.getElementById('root')).display, toolbarDisplay: getComputedStyle(document.querySelector('[data-poster-toolbar]')).display,
            labels: [...document.querySelectorAll('[data-poster-label]')].map(el => getComputedStyle(el).display),
            sheetAbsLeft: mm(sheet.left), pageMargin: getComputedStyle(page1).margin,
            sheets: sheets.length, sheetW: mm(sheet.width), sheetH: mm(sheet.height), svgW: mm(svg.width), svgH: mm(svg.height),
            left: mm(svg.left - sheet.left), top: mm(svg.top - sheet.top),
            listSheetH: mm(listWrap.height), listW: mm(listBox.width), listH: mm(listBox.height), listLeft: mm(listBox.left - listWrap.left), listTop: mm(listBox.top - listWrap.top),
            listClipped: list.scrollHeight > list.clientHeight + 1, listSpare: mm(Math.min(...cols.map(col => foot.top - rect(col).bottom))),
            listOutside: [...list.querySelectorAll('li[data-stop]')].filter(li => rect(li).bottom > foot.top + 0.5).length,
            namePt: pt(list.querySelector('.wl-name')), smallestPt: smallest,
          }
        })
        assert.equal(layout.rootDisplay, 'none', 'หน้าเว็บที่เหลือไม่ติดไปบนกระดาษ')
        assert.equal(layout.toolbarDisplay, 'none', 'ปุ่มไม่ติดไปบนกระดาษ')
        assert.deepEqual(layout.labels, ['none', 'none'], 'ป้าย "แผ่นที่ N" ไม่ติดไปบนกระดาษ')
        assert.ok(Math.abs(layout.sheetAbsLeft) < 0.6 && layout.pageMargin === '0px', `แผ่นต้องชิดขอบกระดาษซ้าย ไม่ถูกจัดกลางด้วยกรอบหน้าจอ (${layout.sheetAbsLeft.toFixed(1)} มม. margin ${layout.pageMargin})`)
        assert.equal(layout.sheets, 2, 'ใบพิมพ์ 2 แผ่น')
        assert.ok(Math.abs(layout.sheetW - 297) < 0.6 && layout.sheetH <= 209.5, `กล่องหน้า ${layout.sheetW.toFixed(1)} × ${layout.sheetH.toFixed(1)} มม.`)
        assert.ok(Math.abs(layout.left - 20) < 0.8 && Math.abs(layout.top - 30) < 0.8, `ขอบแนวนอนของระบบ ซ้าย 2 ซม. บน 3 ซม. (ได้ ${layout.left.toFixed(1)} / ${layout.top.toFixed(1)} มม.)`)
        assert.ok(layout.svgW <= 257.6 && layout.svgH <= 170.6, `ภาพต้องอยู่ในพื้นที่พิมพ์ 257 × 170 มม. (ได้ ${layout.svgW.toFixed(1)} × ${layout.svgH.toFixed(1)})`)
        assert.ok(layout.svgW >= 200 && layout.svgH >= 160, 'ภาพต้องใหญ่เต็มพื้นที่ ไม่หดจนเล็ก')
        // แผ่นรายการ: กล่องหน้า 208 มม. · เนื้อหาเต็มพื้นที่พิมพ์ 257 × 168 ที่ขอบ 2 ซม./3 ซม. · ไม่ถูกตัด · ตัวอักษรอ่านได้
        assert.ok(layout.listSheetH <= 209.5, `กล่องหน้าแผ่นรายการ ${layout.listSheetH.toFixed(1)} มม.`)
        assert.ok(Math.abs(layout.listW - 257) < 0.8 && Math.abs(layout.listH - 168) < 0.8, `แผ่นรายการ ${layout.listW.toFixed(1)} × ${layout.listH.toFixed(1)} มม. ต้องเท่าพื้นที่พิมพ์ 257 × 168`)
        assert.ok(Math.abs(layout.listLeft - 20) < 0.8 && Math.abs(layout.listTop - 30) < 0.8, `ขอบแผ่นรายการ ซ้าย 2 ซม. บน 3 ซม. (ได้ ${layout.listLeft.toFixed(1)} / ${layout.listTop.toFixed(1)} มม.)`)
        assert.equal(layout.listClipped, false, 'แผ่นรายการล้น (ถูกตัดทิ้งตอนพิมพ์)')
        assert.equal(layout.listOutside, 0, 'มีจุดตกนอกแผ่น')
        assert.ok(layout.listSpare >= 2, `ที่ว่างท้ายคอลัมน์ ${layout.listSpare.toFixed(1)} มม. น้อยเกินไป (ข้อความค่าสดยาวกว่านี้จะล้น)`)
        assert.ok(layout.namePt >= 9.5, `ชื่อจุดบนกระดาษ ${layout.namePt.toFixed(1)}pt เล็กเกินไป`)
        assert.ok(layout.smallestPt >= 6, `ตัวอักษรเล็กสุดบนกระดาษ ${layout.smallestPt.toFixed(1)}pt เล็กกว่า 6pt`)
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        const text = pdf.toString('latin1')
        const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
        assert.equal(pages, 2, `ต้องจบ 2 แผ่น (ได้ ${pages})`)
        const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
        assert.ok(boxes.length >= 1 && boxes.every(box => Math.abs(Number(box[1]) - 841.89) < 1.5 && Math.abs(Number(box[2]) - 595.28) < 1.5), `กระดาษทุกแผ่นต้องเป็น A4 แนวนอน (MediaBox ${boxes.map(b => `${b[1]}×${b[2]}`)})`)
      } finally { await context.close() }
    })
  }

  await check('โปสเตอร์ A4 บนมือถือ 390px: เปิดได้ ไม่ล้นหน้าเว็บ เลื่อนภาพแนวนอนในกรอบได้ ปุ่มแตะได้ ≥ 44px', async () => {
    const { context, page } = await openPoster('nlNormal', { width: 390, height: 800 })
    try {
      const dialog = posterLook(page)
      const info = await page.evaluate(() => {
        const stage = document.querySelector('[data-poster-stage]')
        return {
          docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          stageScrolls: stage.scrollWidth > stage.clientWidth,
          buttons: [...document.querySelectorAll('[data-poster-toolbar] button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }),
        }
      })
      assert.equal(info.docOverflow, false, 'หน้าเว็บไม่เลื่อนแนวนอน')
      assert.equal(info.stageScrolls, true, 'ภาพกว้างกว่าจอ เลื่อนในกรอบได้')
      assert.ok(info.buttons.every(([w, h]) => w >= 44 && h >= 44), `ปุ่มแตะได้ ≥ 44px: ${JSON.stringify(info.buttons)}`)
      assert.equal(await dialog.getByRole('button', { name: /พิมพ์/ }).isVisible(), true)
    } finally { await context.close() }
  })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
if (failed.length > 0) process.exit(1)
