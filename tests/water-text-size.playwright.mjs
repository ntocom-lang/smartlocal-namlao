// E2E: ตัวอักษรบนแท็บสถานการณ์ของหน้า /water-situation ต้องไม่เล็กกว่า 12px (ขนาดที่ตามองเห็นจริง รวมตัวอักษรในกราฟ SVG ที่ถูกย่อ)
// ที่มา: เทียบกับเว็บ ทต.หนองหอย 2569-10-28 — ของเราเนื้อหา 38–55% เล็กกว่า 12px (ค่ากลาง 11px) ของเขา 7% (ค่ากลาง 14px)
// ข้อมูลที่ต้องอ่านเช่น "วัน–เวลาวัด" "ต่ำกว่าตลิ่ง" ป้ายสถานะ ตัวเลขตารางรายชั่วโมง เล็กจนผู้สูงอายุอ่านยาก
//
// 12px เป็นเกณฑ์ที่ผมตั้งเอง (สมมติฐาน ไม่ได้อ้างมาตรฐานใด) — เปลี่ยนที่ MIN_PX
// อ่านอย่างเดียว ไม่เขียนข้อมูลใด · RPC/Worker ถูกจำลองในเบราว์เซอร์ (tenant demo มีอ่างเล็กและรายงานรายชั่วโมงให้ตรวจครบ):
//   VITE_TENANT_SLUG=demo npx vite --port 5177
//   WT_TEST_BASE_URL=http://localhost:5177 node tests/water-text-size.playwright.mjs
// WT_ONLY="คำ|คำ" รันเฉพาะข้อที่ชื่อมีคำใดคำหนึ่ง (ไว้ทำ red-check)
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const BASE = (process.env.WT_TEST_BASE_URL || 'http://localhost:5177').replace(/\/$/, '')
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
if (!ALLOWED_HOSTS.has(new URL(BASE).hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${new URL(BASE).hostname}`)
const SHOT_DIR = process.env.WT_SHOT_DIR || path.join(process.cwd(), 'screenshots', 'water-text-size')
const MIN_PX = 12
const HOUR = 3_600_000
const DAY = 86_400_000
await mkdir(SHOT_DIR, { recursive: true })

const hoursAgo = hours => new Date(Date.now() - hours * HOUR).toISOString()
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
// ครบทุกส่วนที่มีข้อความเล็ก: ฝน (ในตำบล/ฝนเล็กน้อย/ไม่มีฝน) · อ่างกลาง 2 อ่าง (ต้นน้ำ/สายข้างเคียง/ตัวเลขซ้ำ) · ระดับน้ำ 2 สถานี (ในตำบล/ผังไม่ระบุ)
const STATIONS = [
  station('rain', 'STN0911', 'บ้านบุญแจ่ม', { is_primary: true, recorded_at: hoursAgo(0.5), rain_24h_mm: 3.5, rain_1h_mm: 1 }),
  station('rain', 'STN0912', 'บ้านป่ากล้วย', { recorded_at: hoursAgo(0.5), rain_24h_mm: 0 }),
  station('dam', '305', 'อ่างเก็บน้ำแม่คำปอง', { is_primary: true, recorded_at: bangkokMidnight(0), storage_percent: 100.6, dam_storage_mcm: 6.8, dam_capacity_mcm: 6.76, prev_recorded_at: bangkokMidnight(1), prev_dam_storage_mcm: 6.85, dam_inflow_mcm: 0.25, dam_released_mcm: 0.25, dam_same_count: 4, dam_same_since: hoursAgo(72), dam_same_capped: false }),
  station('dam', '304', 'อ่างเก็บน้ำแม่ถาง', { tambon_name: 'บ้านเวียง', distance_km: 4.3, recorded_at: bangkokMidnight(0), storage_percent: 52.9, dam_storage_mcm: 16.2, dam_capacity_mcm: 30.62, prev_recorded_at: bangkokMidnight(1), prev_dam_storage_mcm: 16.3, dam_inflow_mcm: 0.07 }),
  station('waterlevel', 'YOM003', 'หนองม่วงไข่', { tambon_name: 'น้ำรัด', amphoe_name: 'หนองม่วงไข่', river_name: 'แม่น้ำยม', distance_km: 14.1, recorded_at: hoursAgo(0.5), bank_diff_m: 5.95, waterlevel_msl: 153.69, storage_percent: 16, situation_text: 'น้ำน้อย', situation_color: '#eab308', prev_recorded_at: hoursAgo(1.5), prev_waterlevel_msl: 153.6 }),
  station('waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', { tambon_name: 'ตำหนักธรรม', amphoe_name: 'หนองม่วงไข่', river_name: 'น้ำแม่คำมี', distance_km: 0.7, recorded_at: hoursAgo(0.5), bank_diff_m: 5.1, waterlevel_msl: 150.1, storage_percent: 20, situation_text: 'น้ำน้อย', situation_color: '#eab308', prev_recorded_at: hoursAgo(1.5), prev_waterlevel_msl: 150.1 }),
]
const hydroReport = () => ({
  station: 'Y.20', fetchedAt: hoursAgo(0.3), refreshFailed: false,
  points: Array.from({ length: 30 }, (_, i) => ({ at: Date.now() - (29 - i) * HOUR - 0.3 * HOUR, level: 1.2 + Math.sin(i / 4) * 0.2, discharge: 5 + i / 10 })),
})
const reservoirReport = id => ({
  id, name: id === '50' ? 'อ่างเก็บน้ำห้วยยอย' : 'อ่างเก็บน้ำห้วยปุย', capacity: 1.5,
  rows: Array.from({ length: 26 }, (_, i) => ({ d: new Date(Date.now() - i * 7 * DAY).toISOString().slice(0, 10), pct: Math.max(10, 96 - i * 2.5), vol: 1.4 - i * 0.03 })),
})

async function open(browser, width, { tab = 'situation' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'th-TH' })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|net::ERR/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`) })
  await page.route('**/rest/v1/rpc/get_public_water_situation', route => route.fulfill({ json: { synced_at: hoursAgo(0.2), stations: STATIONS, warnings: [] } }))
  await page.route('**/api/hydro-hourly*', route => route.fulfill({ json: hydroReport() }))
  await page.route('**/api/small-reservoir*', route => route.fulfill({ json: reservoirReport(new URL(route.request().url()).searchParams.get('id')) }))
  await page.route('**/rest/v1/complaint_categories*', route => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/rpc/get_public_dam_history', route => route.fulfill({ json: { days: 30, radius_km: 10, dams: [] } }))
  if (tab === 'route') {
    // แท็บผังน้ำตำบล: demo เปิดผังตำบลอื่นด้วย ?diagram= (ผังน้ำเลา = ผังที่มีองค์ประกอบมากสุด)
    await page.goto(`${BASE}/water-situation?diagram=namlao&system=namlao&tab=route`, { waitUntil: 'domcontentloaded' })
    await page.locator('#water-diagram').waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(1500)
    return { context, page, problems }
  }
  await page.goto(`${BASE}/water-situation?system=namlao`, { waitUntil: 'domcontentloaded' })
  await page.locator('#water-panel-situation').waitFor({ state: 'attached', timeout: 30_000 })
  await page.getByText('บ้านบุญแจ่ม').first().waitFor({ timeout: 30_000 })
  await page.locator('[data-water-radar]').waitFor({ timeout: 20_000 })
  await page.locator('.hydro-panel').waitFor({ timeout: 20_000 })
  await page.getByText('อ่างเก็บน้ำห้วยยอย').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  return { context, page, problems }
}

// ขนาดที่ตามองเห็นจริงของทุกข้อความในแท็บสถานการณ์: ตัวอักษร HTML = font-size · ตัวอักษรใน SVG = font-size × (กว้างที่แสดง ÷ กว้าง viewBox)
// ที่ตั้งใจข้าม: ข้อความในภาพแชร์ที่ซ่อนอยู่ (ไม่ได้แสดง) และองค์ประกอบที่ไม่แสดง/ขนาด 0
// skipSvg: แท็บผังน้ำตำบลมีภาพโปสเตอร์ SVG (A4 ย่อลงจอมือถือ ตัวหนังสือ 8–11px เป็นธรรมชาติของโปสเตอร์ ต้องดูภาพขยาย/แท็บ "รายการจุด") — เทสต์นี้ตรวจเฉพาะข้อความ HTML ของแท็บนั้น
const measure = (page, { root: rootSelector = '#water-panel-situation', skipSvg = false } = {}) => page.evaluate(({ rootSelector, skipSvg }) => {
  const root = document.querySelector(rootSelector)
  const rows = []
  for (const el of root.querySelectorAll('*')) {
    if (skipSvg && (el.ownerSVGElement || el.tagName.toLowerCase() === 'svg')) continue
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
    if (!own) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    // เนื้อหาใน <details> ที่ยังปิดอยู่ไม่ได้ถูกแสดง
    const closed = el.closest('details:not([open])')
    if (closed && !el.closest('summary')) continue
    let px = parseFloat(style.fontSize)
    const svg = el.ownerSVGElement || (el.tagName.toLowerCase() === 'svg' ? el : null)
    if (svg?.viewBox?.baseVal?.width) px *= svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    rows.push({ px: Math.round(px * 100) / 100, tag: el.tagName.toLowerCase(), text: own.slice(0, 40), cls: (el.getAttribute('class') || '').slice(0, 70) })
  }
  return rows
}, { rootSelector, skipSvg })
const overflowX = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const results = []
const ONLY = (process.env.WT_ONLY ?? '').split('|').filter(Boolean)
async function check(name, run) {
  if (ONLY.length > 0 && !ONLY.some(part => name.includes(part))) return
  try { await run(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').slice(0, 8).join('\n      ')}`)
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [360, 390, 768, 1280]) {
    await check(`${width}px: ตัวอักษรบนแท็บสถานการณ์ไม่เล็กกว่า ${MIN_PX}px · ไม่ล้นจอ`, async () => {
      const { context, page, problems } = await open(browser, width)
      try {
        const rows = await measure(page)
        assert.ok(rows.length > 120, `วัดได้แค่ ${rows.length} จุด — ข้อมูลจำลองไม่ครบหรือหน้าไม่ขึ้น`)
        // ต้องมีข้อความจากทุกส่วนที่เคยเล็ก (กันเทสต์เขียวเพราะวัดไม่ถึง)
        const all = rows.map(r => r.text).join('|')
        for (const part of ['ไม่มีฝน', 'ต้นน้ำของตำบล', 'น้ำเข้า-ออกต่อวัน', 'ระดับตลิ่ง', 'เทียบความจุของอ่าง', 'เส้นประ = 100%', 'ภาพเรดาร์ไม่ใช่ประกาศเตือนภัย', 'HYDRO-1']) {
          assert.ok(all.includes(part), `วัดไม่ถึงข้อความ "${part}" — ส่วนนั้นไม่ขึ้นในข้อมูลจำลอง`)
        }
        const small = rows.filter(r => r.px < MIN_PX - 0.05)
        assert.deepEqual(small.map(r => `${r.px}px <${r.tag} ${r.cls}> "${r.text}"`).slice(0, 12), [], `มี ${small.length} จุดเล็กกว่า ${MIN_PX}px`)
        const overflow = await overflowX(page)
        assert.ok(overflow <= 1, `ล้นแนวนอน ${overflow}px`)
        assert.deepEqual(problems, [])
        if (width === 360 || width === 390 || width === 768 || width === 1280) {
          // ถ่ายเป็นส่วนๆ ที่เสี่ยงเพี้ยนที่สุดเมื่อตัวอักษรใหญ่ขึ้น (ภาพเต็มหน้าเล็กเกินดูรายละเอียด)
          const parts = [['hero', '.water-summary--rain'], ['rain', '#water-rain'], ['dam', '#water-dam-305'], ['level', '#water-levels'], ['hydro', '.hydro-panel'], ['small', '#water-small-dams']]
          for (const [name, selector] of parts) {
            const target = page.locator(selector).first()
            if (await target.count()) { await target.scrollIntoViewIfNeeded(); await target.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}.png`) }) }
          }
          if (width === 360) await page.locator('.water-summary--rain').locator('xpath=..').screenshot({ path: path.join(SHOT_DIR, 'hero-row-360.png') })
        }
      } finally { await context.close() }
    })
  }

  for (const width of [360, 390]) {
    await check(`${width}px: ป้ายสถานะในการ์ดสรุป 3 ใบอยู่บรรทัดเดียว ("น้ำปานกลาง" ไม่หักกลางคำ)`, async () => {
      const { context, page } = await open(browser, width)
      try {
        const badges = await page.evaluate(() => [...document.querySelectorAll('.water-summary')].map(card => {
          const badge = [...card.querySelectorAll('span')].find(s => s.querySelector('.water-status-dot'))
          return { card: card.className.match(/summary--(\w+)/)?.[1], text: badge?.textContent?.trim(), h: badge ? Math.round(badge.getBoundingClientRect().height) : null }
        }))
        assert.equal(badges.length, 3, `ต้องมีการ์ดสรุป 3 ใบ ได้ ${badges.length}`)
        for (const b of badges) { assert.ok(b.text, `การ์ด ${b.card} ไม่มีป้ายสถานะ`); assert.ok(b.h <= 28, `ป้าย "${b.text}" ของการ์ด ${b.card} หักเป็นหลายบรรทัด (สูง ${b.h}px)`) }
      } finally { await context.close() }
    })
  }

  for (const width of [390, 768]) {
    await check(`${width}px: แท็บผังน้ำตำบล ข้อความ HTML (อายุผัง ป้ายความสัมพันธ์ รายการจุด ที่มา) ไม่เล็กกว่า ${MIN_PX}px (ไม่รวมภาพโปสเตอร์ SVG)`, async () => {
      const { context, page, problems } = await open(browser, width, { tab: 'route' })
      try {
        const seen = new Set()
        const small = []
        // ทั้ง 3 แท็บย่อยของผัง: แผนภาพ (+ก่อนถึงตำบล/ไหลต่อไปที่) · รายการจุด · ที่มา
        for (const name of ['แผนภาพ', 'รายการจุด', 'ที่มา']) {
          await page.locator('#water-diagram').getByRole('tab', { name }).click()
          await page.waitForTimeout(700)
          const rows = await measure(page, { root: '#water-panel-route', skipSvg: true })
          assert.ok(rows.length > 15, `แท็บย่อย "${name}" วัดได้แค่ ${rows.length} จุด`)
          rows.forEach(r => seen.add(r.text))
          small.push(...rows.filter(r => r.px < MIN_PX - 0.05).map(r => `[${name}] ${r.px}px <${r.tag} ${r.cls}> "${r.text}"`))
        }
        assert.ok([...seen].some(t => t.includes('ผังต้นฉบับอายุ')), 'วัดไม่ถึงบรรทัดอายุผัง')
        assert.deepEqual(small.slice(0, 10), [], `มี ${small.length} จุดเล็กกว่า ${MIN_PX}px`)
        assert.ok((await overflowX(page)) <= 1, 'แท็บผังน้ำตำบลล้นแนวนอน')
        assert.deepEqual(problems, [])
      } finally { await context.close() }
    })
  }

  await check('390px: ตารางรายชั่วโมงที่กางออก ตัวอักษรไม่เล็กกว่า 12px และไม่ล้นจอ', async () => {
    const { context, page } = await open(browser, 390)
    try {
      await page.locator('.hydro-table summary').click()
      await page.waitForTimeout(500)
      const rows = (await measure(page)).filter(r => ['td', 'th', 'caption'].includes(r.tag))
      assert.ok(rows.length > 20, `ตารางมีข้อความแค่ ${rows.length} จุด — ไม่ได้กางหรือไม่มีข้อมูล`)
      const small = rows.filter(r => r.px < MIN_PX - 0.05)
      assert.deepEqual(small.map(r => `${r.px}px <${r.tag}> "${r.text}"`).slice(0, 8), [], `ตารางมี ${small.length} จุดเล็กกว่า ${MIN_PX}px`)
      assert.ok((await overflowX(page)) <= 1, 'ตารางทำให้หน้าล้นแนวนอน')
      await page.locator('.hydro-table').screenshot({ path: path.join(SHOT_DIR, 'hydro-table-390.png') })
    } finally { await context.close() }
  })

  await check('390px: ข้อความในการ์ดไม่ทับกัน (ป้ายบนภาพตัดขวางลำน้ำ · ตัวเลขขีดบนแถบอ่าง)', async () => {
    const { context, page } = await open(browser, 390)
    try {
      // ป้ายสองอันบนภาพตัดขวาง (ระดับตลิ่ง / ต่ำกว่าตลิ่ง ...) และขีดตัวเลข 30 50 80 บนแถบอ่าง ต้องไม่ซ้อนกันเอง
      const overlaps = await page.evaluate(() => {
        const found = []
        const groups = [...document.querySelectorAll('#water-panel-situation svg, #water-panel-situation [aria-hidden="true"].relative, #water-panel-situation .water-channel, #water-panel-situation [data-cross-section]')]
        const scopes = groups.length ? groups : [document.querySelector('#water-panel-situation')]
        for (const scope of scopes) {
          const leaves = [...scope.querySelectorAll('span, text')].filter(el => el.children.length === 0 && (el.textContent || '').trim()).map(el => ({ el, r: el.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.height > 0)
          for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
            const a = leaves[i].r, b = leaves[j].r
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (w > 2 && h > 2) found.push(`"${leaves[i].el.textContent.trim().slice(0, 18)}" ทับ "${leaves[j].el.textContent.trim().slice(0, 18)}" (${Math.round(w)}×${Math.round(h)}px)`)
          }
        }
        return found
      })
      assert.deepEqual(overlaps.slice(0, 6), [], 'มีข้อความทับกัน')
    } finally { await context.close() }
  })
} finally {
  await browser.close()
}

if (results.length === 0) { console.log('FAIL  ไม่มีข้อทดสอบรันเลย (ตัวกรอง WT_ONLY ผิด?)'); process.exit(1) }
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`)
process.exit(failed.length ? 1 : 0)
