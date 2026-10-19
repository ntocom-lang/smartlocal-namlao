// E2E: ส่วน "ระบบน้ำของตำบล" บนหน้า /water-situation (src/components/water/WaterSystem.jsx) — ดีไซน์ฉบับปิด docs/water-system.md
// demo ใช้ระบบของน้ำเลาเป็นค่าเริ่มต้น (ข้อมูลจริงของน้ำเลา ใช้สาธิต) · ?system=namlao เปิดชัดเจน
//
// ตรวจ: คำกำกับบังคับ · 3 ขั้น (ก่อนถึง/ในตำบล/ไหลต่อ) · ป้ายความสัมพันธ์บนการ์ดอ่าง/ระดับน้ำ (305 ต้นน้ำ · 304 สายข้างเคียง · YOM003 ผังไม่ระบุ)
//   · ค่าสดไม่มี = "ไม่มีค่าสดในระบบ" · ไม่มีช่องกรอก · เป้ากด ≥ 44px
//   · ไม่ล้นจอ 360/390/768/1280 · ไม่มีคำขอเขียน · ?system= แปลก = กลับค่าเริ่มต้น
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
  await page.route('**/api/small-reservoir*', route => route.fulfill({ status: 503, json: { error: 'RESERVOIR_UNAVAILABLE' } }))
  await page.route('**/rest/v1/rpc/get_public_dam_history', route => {
    historyCalls.push(route.request().postData())
    return route.fulfill({ json: { days: 30, radius_km: 10, dams: [] } })
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
  await check('ปกติ: คำกำกับครบ · 3 ขั้น · ป้ายความสัมพันธ์ 305/304/YOM003 อยู่ที่การ์ดอ่างเดิม · ไม่มีการ์ดแนวโน้ม/กล่อง "ไม่ได้ใส่"', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'ready')
    try {
      const text = await section(page).innerText()
      for (const phrase of ['ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้แสดงว่ามีน้ำไหลจริง', 'ไม่ได้รับรองว่าปลอดภัย', 'ต้นน้ำอยู่ไกลกว่านี้ ผังที่ใช้ไม่ครอบคลุม', 'ที่มาของข้อมูล']) {
        assert.ok(text.includes(phrase), `ต้องมี "${phrase}"`)
      }
      assert.match(text, /ผังตำบลอายุ \d+ ปี \d+ เดือน/, 'ต้องบอกอายุผัง')
      assert.equal(await section(page).locator('[data-step]').count(), 3, 'ต้องมี 3 ขั้น')
      for (const title of ['ก่อนถึงตำบล', 'ในตำบล', 'ไหลต่อไปที่']) assert.ok(text.includes(title), title)
      const noLive = text.includes('ไม่มีค่าสดในระบบ')
      assert.ok(noLive, 'อ่างที่ไม่ผูกสถานีต้องเขียน "ไม่มีค่าสดในระบบ"')

      // ตัดออกแล้ว (เจ้าของระบบสั่ง 2026-10-19): การ์ดแนวโน้มอ่าง 30 วัน + กล่อง "ผังต้นฉบับมี แต่เราไม่ได้ใส่"
      //   เหตุผล: ซ้ำกับการ์ดอ่างเดิมของหน้า / ภาษาเทคนิคเกินไปสำหรับชาวบ้าน
      assert.equal(await section(page).locator('[data-related-dam], [data-trend], [data-system-omitted]').count(), 0, 'ต้องไม่มีการ์ดแนวโน้มและกล่อง "ไม่ได้ใส่"')
      for (const gone of ['ผังต้นฉบับมี แต่เราไม่ได้ใส่', 'แนวโน้มปริมาณน้ำในอ่าง', 'ดูตัวเลขล่าสุดของอ่างนี้', 'พื้นที่ลายขีดแดง', 'ไม่ใช่การพยากรณ์']) {
        assert.ok(!text.includes(gone), `ส่วนระบบน้ำห้ามมี "${gone}" (ตัดออกแล้ว)`)
      }
      // ข้อความของอ่างอยู่ที่การ์ดอ่างเดิมของหน้าเท่านั้น (ชาวบ้านเห็นข้อความเดียวกันสองที่จะสับสน)
      assert.equal(((await section(page).innerText()).match(/ซ้ำเดิม/g) || []).length, 0, 'คำเตือนตัวเลขซ้ำเดิมต้องไม่ขึ้นในส่วนระบบน้ำ')
      assert.ok((await page.locator('#water-dam-305').innerText()).includes('ซ้ำเดิม'), 'คำเตือนตัวเลขซ้ำเดิมยังอยู่ที่การ์ดอ่างเดิม')
      const text304 = await page.locator('#water-dam-304').innerText()
      assert.ok(text304.includes('สายข้างเคียง') && text304.includes('น้ำแม่หล่าย'), 'แม่ถางต้องเป็นสายข้างเคียงพร้อมคำอธิบายที่การ์ดอ่างเดิม')

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

      // ไม่ดึงประวัติอ่างอีก (ตัดการ์ดแนวโน้มแล้ว) — ค่าสดมาจาก stations ที่หน้าโหลดอยู่แล้ว ไม่มีคำขอเพิ่ม
      await page.waitForTimeout(1500)
      assert.equal(historyCalls.length, 0, 'ห้ามเรียก get_public_dam_history')
      assert.deepEqual(writes, [], 'ห้ามมีคำขอเขียน')
      assert.deepEqual(problems, [])
      await shootSection(page, 'section-ready-1280.png')
    } finally { await context.close() }
  })

  // ── 2) ไม่มีอ่างในระบบ ──
  await check('ไม่มีอ่างในระบบ: ไม่มีการ์ดอ่าง · ขั้น "ในตำบล" บอก "ไม่มีค่าสดในระบบ" ไม่เขียนว่าปกติ', async () => {
    const { context, page } = await openScene(browser, baseUrl, 'nodam')
    try {
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

  // ── 3b) ตำหนักธรรม + ทุ่งแค้ว (ดูบน demo ผ่าน ?system=) ──
  await check('ตำหนักธรรม: คำกำกับ · 3 ขั้น · Y.38 ค่าสด + ป้ายอยู่ในตำบล · YOM003 ผังไม่ระบุ · ไม่มีอ่าง/ไม่มีกล่อง "ไม่ได้ใส่"/ไม่เรียกประวัติอ่าง · ที่ผังไม่ยืนยันเป็นเส้นประ', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'tamnaktham', { query: '?system=tamnaktham' })
    try {
      assert.equal(await section(page).getAttribute('data-water-system'), 'tamnaktham')
      const text = await section(page).innerText()
      for (const phrase of ['ระบบน้ำของตำบลตำหนักธรรม', 'ตัวอย่างบนสนามซ้อม', 'ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้แสดงว่ามีน้ำไหลจริง', 'ไม่ได้รับรองว่าปลอดภัย',
        'ต้นน้ำอยู่ไกลกว่านี้ ผังที่ใช้ไม่ครอบคลุม', 'ที่มาของข้อมูล', 'ฝาย 6 แห่ง · ห้วยสาขา 4 สาย · แผนก่อสร้าง 5 รายการ']) {
        assert.ok(text.includes(phrase), `ต้องมี "${phrase}"`)
      }
      assert.match(text, /ผังตำบลอายุ \d+ ปี \d+ เดือน/)
      assert.equal(await section(page).locator('[data-step]').count(), 3)
      assert.equal(await section(page).locator('[data-related-dam]').count(), 0, 'ตำหนักธรรมไม่มีอ่าง ห้ามมีการ์ดอ่าง')
      assert.ok(!text.includes('อ่าง 0 แห่ง') && !text.includes('สระ 0') && !text.includes(' 0 แห่ง'), 'ห้ามเขียนจำนวน 0')
      assert.equal(historyCalls.length, 0, 'ไม่มีอ่างกลาง ต้องไม่เรียกประวัติอ่าง')
      // Y.38 ผูกค่าสด
      const gauge = section(page).locator('[data-node="in-gauge-y38"]')
      assert.ok((await gauge.innerText()).includes('ค่าสด'))
      // ที่ผังไม่ยืนยัน = เส้นประ + ป้าย "ผังไม่ระบุ" (ขั้น 1 มี 5 รายการ แสดง 3 ก่อน — ขยายก่อนตรวจ)
      const step1 = section(page).locator('[data-step="1"]')
      assert.equal(await step1.locator('li').count(), 3)
      await step1.getByRole('button', { name: /ดูทั้งหมด 5 รายการ/ }).click()
      assert.equal(await step1.locator('li').count(), 5)
      for (const id of ['up-name-link', 'up-reservoir-province', 'up-canal-source']) {
        const node = section(page).locator(`[data-node="${id}"]`)
        assert.equal(await node.getAttribute('data-status'), 'unconfirmed', id)
        assert.ok((await node.innerText()).includes('ผังไม่ระบุ'), `${id}: ต้องติดป้ายผังไม่ระบุ`)
      }
      assert.ok((await section(page).locator('[data-node="up-reservoir-province"]').innerText()).includes('ไม่มีค่าสดในระบบ'), 'อ่างต้นสายตามผังจังหวัดต้องเขียน "ไม่มีค่าสดในระบบ"')
      // ป้ายบนการ์ดระดับน้ำเดิม
      const levels = page.locator('#water-levels')
      const levelText = await levels.innerText()
      assert.ok(levelText.includes('อยู่ในตำบล') && levelText.includes('ผังไม่ระบุ'), 'Y.38 = อยู่ในตำบล · YOM003 = ผังไม่ระบุ')
      assert.ok(await levels.locator('[data-relation-note]').count() >= 1)
      // ไม่มีกล่อง "ไม่ได้ใส่" (ตัดออกแล้ว) — เรื่องอ่างแม่คำปอง/แม่ถาง/ฝาย ม.12 อยู่ในทะเบียนให้ อบต. ยืนยัน ไม่ขึ้นหน้าเว็บ
      assert.equal(await section(page).locator('[data-system-omitted]').count(), 0)
      assert.ok(!text.includes('ผังต้นฉบับมี แต่เราไม่ได้ใส่') && !text.includes('ม.12'), 'ไม่มีกล่อง "ไม่ได้ใส่"')
      for (const bad of ['เหลืออีก', 'จะหมด', 'คาดว่า', 'ปกติ']) assert.ok(!text.includes(bad), `ห้ามมี "${bad}"`)
      // ปุ่มย่อ/ขยาย: ขั้น "ในตำบล" มี 10 รายการ แสดง 3 ก่อน
      const step2 = section(page).locator('[data-step="2"]')
      assert.equal(await step2.locator('li').count(), 3)
      await step2.getByRole('button', { name: /ดูทั้งหมด 10 รายการ/ }).click()
      assert.equal(await step2.locator('li').count(), 10)
      assert.deepEqual(writes, [])
      assert.deepEqual(problems, [])
      await shootSection(page, 'section-tamnaktham-1280.png')
    } finally { await context.close() }
  })
  await check('ทุ่งแค้ว: อ่างเล็กไม่ขึ้นป้ายค่าสด (รายสัปดาห์ ไม่ใช่ค่าสด) · อ่างห้วยเฮือ "ไม่มีค่าสดในระบบ" · ฝน RES038 ค่าสด · ไม่เรียกประวัติอ่าง', async () => {
    const { context, page, problems, writes, historyCalls } = await openScene(browser, baseUrl, 'thungkaew', { query: '?system=thungkaew' })
    try {
      assert.equal(await section(page).getAttribute('data-water-system'), 'thungkaew')
      const text = await section(page).innerText()
      assert.ok(text.includes('ระบบน้ำของตำบลทุ่งแค้ว') && text.includes('ตัวอย่างบนสนามซ้อม'))
      assert.ok(text.includes('อ่าง 3 แห่ง · ฝายประมาณ 27 แห่ง · หนอง 3 แห่ง · ห้วยสาขาประมาณ 23 สาย · แผนก่อสร้าง 3 รายการ'))
      assert.equal(await section(page).locator('[data-related-dam]').count(), 0)
      assert.equal(historyCalls.length, 0)
      await section(page).locator('[data-step="2"]').getByRole('button', { name: /ดูทั้งหมด \d+ รายการ/ }).click()
      const yoiNode = section(page).locator('[data-node="in-res-yoi"]')
      const yoi = await yoiNode.innerText()
      assert.ok(yoi.includes('ไม่ใช่ค่าสด') && !yoi.includes('ไม่มีค่าสดในระบบ'), `อ่างห้วยยอยต้องบอกว่าไม่ใช่ค่าสด ได้ "${yoi}"`)
      assert.equal(await yoiNode.locator('span.rounded-full').count(), 0, 'อ่างเล็กไม่ขึ้นป้ายค่าสด/ไม่มีค่าสด (มีการ์ดรายสัปดาห์ของตัวเอง)')
      assert.ok((await section(page).locator('[data-node="in-res-hue"]').innerText()).includes('ไม่มีค่าสดในระบบ'))
      assert.ok((await section(page).locator('[data-node="in-rain-res038"]').innerText()).includes('ค่าสด'))
      assert.equal(await section(page).locator('[data-node="in-plan-box"]').getAttribute('data-status'), 'planned')
      assert.equal(await section(page).locator('[data-node="in-repair"]').getAttribute('data-status'), 'repair')
      assert.equal(await section(page).locator('[data-node="down-canal-end"]').getAttribute('data-status'), 'unconfirmed')
      const levelText = await page.locator('#water-levels').innerText()
      assert.ok(levelText.includes('ผังไม่ระบุ'), 'YOM003 ต้องติดป้ายผังไม่ระบุ')
      assert.ok(!text.includes('ปกติ'))
      assert.deepEqual(writes, [])
      assert.deepEqual(problems, [])
      await shootSection(page, 'section-thungkaew-1280.png')
    } finally { await context.close() }
  })
  for (const sceneName of ['tamnaktham', 'thungkaew']) {
    for (const width of [360, 390, 768, 1280]) {
      await check(`${sceneName} ${width}px: ไม่ล้นจอ · เป้ากด ≥ ${MIN_TAP}px · ไม่มีช่องกรอก`, async () => {
        const { context, page, problems } = await openScene(browser, baseUrl, sceneName, { width, query: `?system=${sceneName}` })
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
          // ปุ่มเปลี่ยนชื่อเป็น "ย่อรายการ" หลังกด จึงกดปุ่มแรกที่ยังเป็น "ดูทั้งหมด" ซ้ำจนไม่เหลือ
          const more = section(page).getByRole('button', { name: /ดูทั้งหมด \d+ รายการ/ })
          while (await more.count() > 0) await more.first().click()
          const after = await page.evaluate(() => ({
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            el: document.querySelector('#water-system').scrollWidth - document.querySelector('#water-system').clientWidth,
          }))
          assert.ok(after.doc <= 1 && after.el <= 1, `ขยายทุกรายการแล้วล้นจอ ${JSON.stringify(after)}`)
          await shootSection(page, `section-${sceneName}-${width}.png`)
          assert.deepEqual(problems, [])
        } finally { await context.close() }
      })
    }
  }
  await check('อปท. อื่นนอกทะเบียน/ใส่ ?system= แปลกบน demo: ไม่เห็นระบบของที่ไม่มี และไม่พัง', async () => {
    for (const [query, expected] of [['?system=tamnaktham', 'tamnaktham'], ['?system=thungkaew', 'thungkaew'], ['?system=namlao', 'namlao'], ['?system=TAMNAKTHAM', 'namlao'], ['?system=tamnaktham%20', 'namlao']]) {
      const { context, page, problems } = await openScene(browser, baseUrl, 'tamnaktham', { query })
      try {
        assert.equal(await section(page).getAttribute('data-water-system'), expected, `query "${query}"`)
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    }
  })

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
