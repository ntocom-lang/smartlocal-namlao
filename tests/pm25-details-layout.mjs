// Anonymous local-build acceptance. All backend data is synthetic and intercepted;
// no citizen data, login session, database writes or paid APIs are involved.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = 'https://demo.rk-networks.com'
const dist = path.resolve('dist')
const now = Date.now()
const hour = Math.floor(now / 3600000) * 3600000
const timestamp = new Date(hour).toISOString()
const points = Array.from({ length: 168 }, (_, i) => ({ time: hour - (167 - i) * 3600000, value: 12 + i % 7 }))
const station = (id, name, lat, pm25) => ({ id, name, lat, lon: 100.2, pm25, aqi: 24, aqiPollutant: 'PM25', province: 'แพร่', area: 'พื้นที่ทดสอบ, แพร่', measuredAt: timestamp })
const feed = { source: 'Air4Thai', fetchedAt: timestamp, refreshFailed: false, stations: [station('69t', 'สถานีทดสอบ A', 18.1, 14), station('70t', 'สถานีทดสอบ B', 18.2, 21)] }
const area = { source: 'GISTDA', fetchedAt: timestamp, area: { districtId: '5401', subdistrictId: '540104', district: 'เมืองแพร่', province: 'แพร่', subdistrict: 'ตำบลทดสอบ 4' }, tambons: Array.from({ length: 8 }, (_, i) => ({ id: `54010${i + 1}`, name: `ตำบลทดสอบ ${i + 1}`, hourly: 9 + i, average24: 11 + i, measuredAt: timestamp })) }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
let mode = 'normal'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*.supabase.co/**', async route => {
    const isTenant = new URL(route.request().url()).pathname === '/rest/v1/municipalities'
    const body = isTenant ? { id: 'pm25-test', slug: 'demo', name: 'องค์การบริหารส่วนตำบลทดสอบ', province: 'แพร่', latitude: mode === 'no-location' ? null : 18.1, longitude: mode === 'no-location' ? null : 100.2, ui_style: 'servicehub', enabled_modules: ['water-situation'] } : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/air-quality') return route.fulfill({ json: feed })
    if (url.pathname === '/api/pm25-details') {
      if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
      if (url.searchParams.get('kind') === 'area') return route.fulfill({ json: mode === 'stale' ? { ...area, tambons: area.tambons.map(t => ({ ...t, measuredAt: new Date(hour - 86400000).toISOString() })) } : area })
      const id = url.searchParams.get('station')
      const selectedPoints = id === '70t' ? points.map(p => ({ ...p, value: p.value + 20 })) : points
      return route.fulfill({ json: { source: 'Air4Thai', stationId: id, points: mode === 'stale' ? selectedPoints.map(p => ({ ...p, time: p.time - 86400000 })) : selectedPoints, fetchedAt: timestamp } })
    }
    let file = url.pathname.startsWith('/assets/') ? path.join(dist, url.pathname) : path.join(dist, url.pathname === '/pm25' ? '_template.html' : url.pathname)
    if (!file.startsWith(dist + path.sep)) return route.abort()
    try { await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' }) } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto(`${origin}/pm25`, { waitUntil: 'domcontentloaded' })
    await page.locator('.pm25-tambon-row').first().waitFor()
    await page.locator('.pm25-station-pin').first().waitFor()
    await page.getByRole('button', { name: '7 วัน', exact: true }).click()
    await page.getByText('ดูตัวเลขรายวัน', { exact: true }).click()
    assert.equal(await page.locator('.pm25-history-table tbody tr').count(), 7)
    await page.getByRole('button', { name: '24 ชั่วโมง', exact: true }).click()
    assert.equal(await page.locator('.pm25-history-table tbody tr').count(), 24)
    await page.getByRole('button', { name: 'ดูครบ 8 ตำบล' }).click()
    assert.equal(await page.locator('.pm25-tambon-row').count(), 8)
    await page.locator('#pm25-station').selectOption('70t')
    await page.waitForFunction(() => document.querySelector('.pm25-history-table tbody tr td:nth-child(2)')?.textContent === '38')
    assert.equal(await page.locator('[data-testid=pm25-value]').innerText(), '21')
    await page.locator('.pm25-station-pin').first().click()
    await page.locator('.leaflet-popup-content').waitFor()
    assert.match(await page.locator('.leaflet-popup-content').innerText(), /µg\/m³/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`)
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: graph periods, station switch, map popup, subdistrict expansion, no overflow`)
  }
  for (mode of ['error', 'stale', 'no-location']) {
    await page.goto(`${origin}/pm25`, { waitUntil: 'domcontentloaded' })
    if (mode === 'error') await page.getByText('โหลดข้อมูลย้อนหลังไม่ได้ ค่าล่าสุดส่วนบนยังดูได้ตามปกติ').waitFor()
    if (mode === 'stale') { await page.getByText(/ประวัติไม่เป็นปัจจุบัน/).waitFor(); assert.match(await page.locator('[data-testid=pm25-comparison]').innerText(), /ข้อมูลยังไม่ครบ/) }
    if (mode === 'no-location') await page.getByText(/ยังไม่มีพิกัดหน่วยงานที่ใช้ค้นตำบลได้/).waitFor()
    assert.equal(await page.locator('[data-testid=pm25-value]').innerText(), '14')
    console.log(`PASS independent ${mode} state`)
  }
  assert.deepEqual(errors, [])
  if (process.env.PM25_SCREENSHOT) {
    mode = 'normal'
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${origin}/pm25`, { waitUntil: 'domcontentloaded' })
    await page.locator('.pm25-tambon-row').first().waitFor()
    await page.locator('.pm25-station-pin').first().waitFor()
    await page.screenshot({ path: process.env.PM25_SCREENSHOT, fullPage: true })
  }
} finally { await browser.close() }
