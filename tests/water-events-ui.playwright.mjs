// หน้า "เหตุการณ์น้ำ-ฝน" ของเจ้าหน้าที่ (เฟส 3 · PR 3.2) — เทสต์เบราว์เซอร์
//   node tests/water-events-ui.playwright.mjs                      (localhost:5174 · dev server ต้องตั้ง tenant เป็น demo)
//   WE_PROFILE_ROOT=<โฟลเดอร์ .chrome-test-profiles> ใช้เมื่อรันจาก worktree ที่ไม่มีโฟลเดอร์นี้
//   WE_PROFILE=TEST-officer (ค่าเริ่มต้น) · WE_SHOT_DIR=<โฟลเดอร์> บันทึกภาพหน้าจอ
//
// ใช้ session ของบัญชีทดสอบบนสนามซ้อม (demo) ย้ายมาใส่ localhost เหมือน staff-nav-layout · อ่านอย่างเดียว ไม่สร้าง/แก้ข้อมูล
// ฟังก์ชัน list_water_events/get_water_event ถูกแทนด้วยข้อมูลจำลองในเบราว์เซอร์ (ยังไม่ได้ติดตั้งบนฐานข้อมูลจริง และตอนนี้ยังไม่มีเหตุการณ์จริง)
//
// เรื่องที่ล็อกไว้ ("ต้องไม่เพิ่มงานให้เจ้าหน้าที่"):
//   1. หน้านี้ไม่มี input/textarea/select/form/contenteditable และปุ่มมีแค่ open/back/retry ทุกขนาดจอ ทุกสถานะ
//   2. ไม่มีคำขอเขียนไปที่ไหนเลย (ไม่มี PATCH/PUT/DELETE · ไม่อ่านตารางเหตุการณ์ตรง · เรียกแค่ฟังก์ชันอ่าน 2 ตัว)
//   3. ข้อความสถานะระบบจดไม่สั่งให้ใครทำอะไร · ว่างเพราะสงบ / ระบบเงียบ / ไม่มีบันทึก แยกกันชัด
//   4. ค่าว่าง = "ไม่มีค่า" ไม่เป็น 0 · เส้นกราฟขาดตรงช่วงสถานีไม่ส่งค่า · ข้อความ สสน. แสดงตามต้นฉบับ (ไม่ตีความ HTML)
//   5. ไม่ล้นจอ 360/390/768/1280px · เป้ากดสูง ≥ 44px
import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.WE_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const PROFILE = process.env.WE_PROFILE || 'TEST-officer'
const BASE_URL = (process.env.WE_TEST_BASE_URL || 'http://localhost:5174').replace(/\/$/, '')
const SHOT_DIR = process.env.WE_SHOT_DIR || ''
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const LABEL = 'เหตุการณ์น้ำ-ฝน'
const MIN_TAP = 44
const HOUR = 3600_000

if (!ALLOWED_HOSTS.has(new URL(BASE_URL).hostname)) {
  console.log(`BLOCKED: ปฏิเสธการยิงไปที่ ${new URL(BASE_URL).hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  process.exit(2)
}

// ── ข้อมูลจำลอง ──
const iso = (ms) => new Date(ms).toISOString()
function fixtures(now) {
  const at = (h) => iso(now + h * HOUR)
  const E_OPEN = '11111111-1111-4111-8111-111111111111'
  const E_CALM = '22222222-2222-4222-8222-222222222222'
  const E_LOST = '33333333-3333-4333-8333-333333333333'
  const trig = (kind, station_name, value, h) => ({ kind, station_code: 'X', station_name, value, recorded_at: at(h) })
  const events = [
    { id: E_OPEN, opened_at: at(-5), ended_at: null, closed_at: null, close_reason: null, last_fresh_at: at(-0.3),
      open_reason: { rule_version: 1, triggers: [trig('rain', 'บ้านบุญแจ่ม', 112.3, -5), trig('waterlevel', 'บ้านแม่คำมีตำหนักธรรม', 0.8, -5), trig('ews', 'ก', 2, -5), trig('warning', 'น้ำท่วมฉับพลัน', null, -5)] },
      stations_count: 4, readings_count: 1234, peak_rain_24h_mm: 112.3, min_bank_diff_m: 0.8, warnings_count: 2 },
    { id: E_CALM, opened_at: at(-24 * 10), ended_at: at(-24 * 9), closed_at: at(-24 * 8), close_reason: 'calm',
      open_reason: { rule_version: 1, triggers: [trig('rain', 'บ้านบุญแจ่ม', 95, -240)] },
      stations_count: 3, readings_count: 210, peak_rain_24h_mm: 95, min_bank_diff_m: null, warnings_count: 0 },
    { id: E_LOST, opened_at: at(-24 * 20), ended_at: at(-24 * 18), closed_at: at(-24 * 18), close_reason: 'data_lost',
      open_reason: { rule_version: 1, triggers: [trig('waterlevel', 'Y.38', 0.5, -480)] },
      stations_count: 0, readings_count: 0, peak_rain_24h_mm: null, min_bank_diff_m: null, warnings_count: 0 },
  ]
  const rainRows = [-9, -8, -7, -1, -0.3].map((h, i) => ({ t: at(h), rain_24h: [95.5, 112.3, 80, 20, 0][i], ...(i === 1 ? { rain_1h: 14 } : {}) }))
  const detail = {
    now: iso(now),
    event: { id: E_OPEN, opened_at: at(-5), ended_at: null, closed_at: null, close_reason: null, last_fresh_at: at(-0.3), open_reason: events[0].open_reason },
    stations: [
      { station_type: 'rain', station_code: 'R1', station_name: 'บ้านบุญแจ่ม', readings: rainRows },
      { station_type: 'rain', station_code: 'R2', station_name: 'อ่างห้วยขึมโยธินอุทกพัฒนา', readings: [{ t: at(-3) }, { t: at(-2) }] },
      { station_type: 'waterlevel', station_code: 'L1', station_name: 'บ้านแม่คำมีตำหนักธรรม', readings: [
        { t: at(-5), level_msl: 150.5, bank_diff: 2.5 }, { t: at(-4), bank_diff: 1.2 }, { t: at(-3), level_msl: 151.7, bank_diff: 0.8 }, { t: at(-2), level_msl: 151.2, bank_diff: 1.3 }] },
      { station_type: 'dam', station_code: '305', station_name: 'อ่างแม่คำปอง', readings: [0, 1, 2].map(d => ({ t: at(-72 + d * 24), storage_pct: 101.2, dam_storage: 6.1, dam_inflow: 0.2, dam_released: 0.1 })) },
    ],
    warnings: [
      { issued_at: at(-6), message: 'เตือนภัยน้ำท่วมฉับพลัน <b>ไม่ตัดแต่ง</b>\nบรรทัดสอง', station_name: 'สสน.', tambon_name: 'ต.บ้านเวียง' },
      { issued_at: at(-2), message: 'ข้อความที่สอง' },
    ],
  }
  return { events, detail, E_OPEN, E_CALM, E_LOST }
}

// scene: 'empty-ok' | 'empty-late' | 'empty-unknown' | 'events' | 'missing' | 'error' | 'denied'
const state = { scene: 'events', calls: [], failFirst: false }

async function installStubs(context) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  await context.route(/\/rest\/v1\/rpc\/(list_water_events|get_water_event)(\?|$)/, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const name = req.url().match(/rpc\/(\w+)/)[1]
    const body = JSON.parse(req.postData() || '{}')
    state.calls.push({ name, body })
    const now = Date.now()
    const fx = fixtures(now)
    const json = (data, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) })
    const sc = state.scene
    if (sc === 'denied') return json({ code: '42501', message: 'ไม่มีสิทธิ์ดูเหตุการณ์น้ำ-ฝนของหน่วยงานนี้' }, 403)
    if (sc === 'error') {
      if (state.failFirst) { state.failFirst = false; return json({ code: 'PGRST202', message: 'Could not find the function public.list_water_events in the schema cache' }, 404) }
      return json({ now: iso(now), recorder: { last_ok_at: iso(now - 20 * 60_000) }, total: 0, events: [] })
    }
    if (name === 'get_water_event') {
      if (sc === 'missing') return json(null)
      return json(fx.detail)
    }
    if (sc === 'empty-ok') return json({ now: iso(now), recorder: { last_ok_at: iso(now - 20 * 60_000), last_error_at: null }, total: 0, events: [] })
    if (sc === 'empty-late') return json({ now: iso(now), recorder: { last_ok_at: iso(now - 5 * HOUR), last_error_at: null }, total: 0, events: [] })
    if (sc === 'empty-unknown') return json({ now: iso(now), recorder: null, total: 0, events: [] })
    return json({ now: iso(now), recorder: { last_ok_at: iso(now - 20 * 60_000), last_error_at: null }, total: 3, events: fx.events })
  })
}

async function transferDemoSession(page) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'))
  if (!entries.find(([key]) => key.endsWith('-auth-token'))) throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  await page.addInitScript(pairs => {
    for (const [key, value] of pairs) { try { localStorage.setItem(key, value) } catch { /* โควตาเต็ม */ } }
  }, entries)
}

async function openPanel(page, auth, width, height = 900) {
  await page.setViewportSize({ width, height })
  await page.goto(`${BASE_URL}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== '/staff') throw new BlockedError(`บัญชี ${PROFILE} เข้า /staff ไม่ได้ (ไปที่ ${new URL(page.url()).pathname})`)
  await page.getByText('แดชบอร์ดสำหรับเจ้าหน้าที่').first().waitFor({ timeout: 40_000 })
  const skip = page.getByRole('button', { name: 'ข้ามไปก่อน' })
  if (await skip.count()) await skip.first().click()
  if (width < 768) await page.getByRole('button', { name: 'เมนู', exact: true }).last().click()
  const entry = page.locator('button:visible', { hasText: LABEL }).first()
  await entry.waitFor({ state: 'visible', timeout: 15_000 })
  await entry.click()
  await page.locator('[data-we-list], [data-we-error]').first().waitFor({ timeout: 15_000 })
}

// ตรวจ "ไม่มีงานให้เจ้าหน้าที่" + ไม่ล้นจอ + เป้ากด — ใช้กับทุกสถานะของหน้า
async function auditPanel(page, where) {
  const audit = await page.evaluate(({ minTap }) => {
    const root = document.querySelector('[data-we-list], [data-we-detail], [data-we-error], [data-we-missing]')?.parentElement ?? null
    const scope = root ?? document.body
    const fields = scope.querySelectorAll('input, textarea, select, form, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="switch"], [type="checkbox"]').length
    const links = scope.querySelectorAll('a[href]').length
    const buttons = [...scope.querySelectorAll('button')].map(b => ({ nav: b.getAttribute('data-we-nav'), h: b.getBoundingClientRect().height, text: b.textContent.trim().slice(0, 30) }))
    const overflow = []
    for (const el of scope.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5)) overflow.push(`${el.tagName.toLowerCase()} ${Math.round(r.left)}..${Math.round(r.right)}`)
    }
    return { fields, links, buttons, overflow: overflow.slice(0, 5), pageOverflow: document.documentElement.scrollWidth - innerWidth, minTap }
  }, { minTap: MIN_TAP })
  assert.equal(audit.fields, 0, `${where}: หน้านี้ห้ามมีช่องกรอก/ตัวเลือก (พบ ${audit.fields})`)
  assert.equal(audit.links, 0, `${where}: หน้านี้ไม่มีลิงก์ออก (พบ ${audit.links})`)
  for (const b of audit.buttons) {
    assert.ok(['open', 'back', 'retry'].includes(b.nav), `${where}: ปุ่ม "${b.text}" ไม่ใช่ open/back/retry`)
    assert.ok(b.h >= MIN_TAP - 0.5, `${where}: ปุ่ม "${b.text}" เตี้ยกว่า ${MIN_TAP}px (${Math.round(b.h)})`)
  }
  assert.equal(audit.overflow.length, 0, `${where}: มีของล้นจอ ${audit.overflow.join(' | ')}`)
  assert.ok(audit.pageOverflow <= 1, `${where}: หน้าเลื่อนแนวนอนได้ ${audit.pageOverflow}px`)
  return audit
}

async function shot(page, selector, name) {
  if (!SHOT_DIR) return
  await mkdir(SHOT_DIR, { recursive: true })
  // ตัวเลื่อนจริงอยู่ในแอป — ขยายความสูงจอชั่วคราวให้ภาพเห็นทั้งหน้า (เลย์เอาต์ขึ้นกับความกว้างเท่านั้น)
  const vp = page.viewportSize()
  await page.setViewportSize({ width: vp.width, height: 3200 })
  await page.waitForTimeout(300)
  await page.locator(selector).first().screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  await page.setViewportSize(vp)
}

async function noWrites(page, fn) {
  const bad = []
  const onReq = (req) => {
    const url = req.url()
    if (/\/rest\/v1\/(water_events|water_event_readings|water_event_warnings)(\?|\/|$)/.test(url)) bad.push(`อ่านตารางตรง ${url}`)
    if (/supabase\.co/.test(url) && ['PATCH', 'PUT', 'DELETE'].includes(req.method())) bad.push(`${req.method()} ${url}`)
  }
  page.on('request', onReq)
  try { return await fn() } finally {
    page.off('request', onReq)
    assert.deepEqual(bad, [], `มีคำขอเขียน/อ่านตรงที่ไม่ควรมี: ${bad.join(' | ')}`)
  }
}

// ── สถานะ: ว่างเพราะสงบ / ระบบเงียบ / ไม่มีบันทึก ──
async function checkEmpty(page, auth, width) {
  const notes = []
  for (const [scene, kind] of [['empty-ok', 'ok'], ['empty-late', 'late'], ['empty-unknown', 'unknown']]) {
    state.scene = scene
    await openPanel(page, auth, width)
    await page.locator('[data-we-empty]').waitFor({ timeout: 10_000 })
    const rec = page.locator('[data-we-recorder]')
    assert.equal(await rec.getAttribute('data-we-recorder'), kind, `${scene}: สถานะตัวจดผิด`)
    const recText = (await rec.textContent()).trim()
    assert.ok(!/แจ้ง|กรุณา|โปรด|ติดต่อ|ผู้ดูแลระบบ|กด|ตรวจสอบ/.test(recText), `${scene}: ข้อความสถานะสั่งงานเจ้าหน้าที่: ${recText}`)
    const empty = (await page.locator('[data-we-empty]').textContent()).replace(/\s+/g, ' ')
    assert.match(empty, /ยังไม่มีเหตุการณ์ที่ระบบจดไว้/)
    for (const criterion of ['90.1 มม.', 'ต่ำกว่าตลิ่งไม่เกิน 1 ม.', 'ระดับ 2–3', 'อำเภอและจังหวัดเดียวกับหน่วยงาน', 'อ่างเก็บน้ำไม่ใช้เปิดเหตุการณ์', 'ไม่มีใครต้องกดปิดหรือกรอกอะไร']) {
      assert.ok(empty.includes(criterion), `${scene}: คำอธิบายเกณฑ์ขาด "${criterion}"`)
    }
    if (kind === 'ok') { assert.match(empty, /ไม่มีอะไรที่เจ้าหน้าที่ต้องทำ/); assert.match(recText, /ระบบตรวจล่าสุด/) }
    else assert.ok(!empty.includes('ไม่มีสถานีใดเข้าเกณฑ์ตอนนี้'), `${scene}: ห้ามบอกว่า "ไม่มีสถานีเข้าเกณฑ์" ทั้งที่ระบบไม่ได้ตรวจ/ไม่มีบันทึก`)
    if (kind === 'late') assert.match(recText, /ไม่ได้ตรวจมา 5 ชม\..*ข้อมูลช่วงนี้อาจไม่ครบ/)
    if (kind === 'unknown') assert.match(recText, /ยังไม่มีบันทึกว่าระบบจดเหตุการณ์เคยตรวจ/)
    await auditPanel(page, `${scene} ${width}px`)
    if (kind === 'ok') await shot(page, '[data-we-list]', `we-empty-${width}`)
    if (kind === 'late') await shot(page, '[data-we-list]', `we-late-${width}`)
    notes.push(kind)
  }
  return notes.join('/')
}

// ── รายการ + รายละเอียด ──
async function checkEvents(page, auth, width, { fullDetail = true } = {}) {
  state.scene = 'events'
  state.calls = []
  await openPanel(page, auth, width)
  const fx = fixtures(Date.now())
  const cards = page.locator('[data-we-card]')
  await cards.first().waitFor({ timeout: 10_000 })
  assert.equal(await cards.count(), 3, `รายการต้องมี 3 เหตุการณ์`)
  const first = (await cards.nth(0).textContent()).replace(/\s+/g, ' ')
  assert.match(first, /กำลังเกิดเหตุการณ์/); assert.match(first, /นาน 5 ชม\./); assert.match(first, /เป็นต้นมา/)
  assert.match(first, /ฝนสะสม 24 ชม\. 112\.3 มม\. ที่บ้านบุญแจ่ม/); assert.match(first, /และอีก 1 สัญญาณ/)
  assert.match(first, /ใกล้ตลิ่งที่สุด: ต่ำกว่าตลิ่ง 0\.80 ม\./); assert.match(first, /4 สถานี · 1,234 ค่าที่จด · ข้อความ สสน\. 2 ฉบับ/)
  const second = (await cards.nth(1).textContent()).replace(/\s+/g, ' ')
  assert.match(second, /จบแล้ว/); assert.match(second, /ระบบปิดเอง: ค่าไม่เข้าเกณฑ์ต่อเนื่อง 24 ชม\./); assert.ok(!/ใกล้ตลิ่งที่สุด/.test(second), 'เหตุการณ์ที่ไม่มีค่าระดับน้ำต้องไม่มีบรรทัดใกล้ตลิ่ง (ไม่ใช่ 0)')
  const third = (await cards.nth(2).textContent()).replace(/\s+/g, ' ')
  assert.match(third, /ไม่ได้แปลว่าเหตุการณ์จบจริง/); assert.ok(!/สูงสุด/.test(third), 'เหตุการณ์ที่ไม่มีค่าที่จดไว้ต้องไม่มี "สูงสุด"')
  assert.equal(await page.locator('[data-we-recorder]').getAttribute('data-we-recorder'), 'ok')
  await auditPanel(page, `รายการ ${width}px`)
  await shot(page, '[data-we-list]', `we-list-${width}`)
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `we-page-${width}.png`) }) // ทั้งหน้า (เห็นตำแหน่งเมนู) ที่ความสูงจอปกติ

  await noWrites(page, async () => {
    await cards.first().click()
    await page.locator('[data-we-detail]').waitFor({ timeout: 10_000 })
    const call = state.calls.find(c => c.name === 'get_water_event')
    assert.equal(call.body._event_id, fx.E_OPEN, 'ส่ง id ของการ์ดที่กด'); assert.match(call.body._municipality_id, /^[0-9a-f-]{36}$/)
    const detail = (await page.locator('[data-we-detail]').textContent()).replace(/\s+/g, ' ')
    assert.match(detail, /ระบบเปิดเหตุการณ์เพราะ/); assert.match(detail, /ค่าสดล่าสุดที่ระบบเห็น/)
    assert.match(detail, /ไม่ใช่การประเมินความเสียหาย/); assert.match(detail, /ไม่ใช่ 0/)
    assert.equal(await page.locator('[data-we-station]').count(), 4)
    // ฝน R1: ค่าสูงสุด + ช่วงขาด 1 ช่วง (-7 → -1 ชม.) + เส้นกราฟขาดเป็น 2 ท่อน
    const r1 = page.locator('[data-we-station="rain:R1"]')
    assert.match(await r1.textContent(), /ฝนสะสม 24 ชม\. สูงสุด 112\.3 มม\. \(ฝนหนักมาก\)/)
    assert.match(await r1.locator('[data-we-gaps]').textContent(), /สถานีไม่ส่งค่า 1 ช่วง/)
    assert.equal(await r1.locator('[data-we-chart] path').count(), 2, 'ช่องว่าง 6 ชม. ต้องตัดเส้นเป็น 2 ท่อน ไม่ลากข้าม')
    assert.match(await r1.locator('figcaption').textContent(), /เส้นขาดช่วงที่สถานีไม่ส่งค่า/)
    // ฝน R2: ไม่มีค่าเลย = บอกตรงๆ ไม่ใช่ 0 · ไม่มีกราฟ
    const r2 = page.locator('[data-we-station="rain:R2"]')
    const r2Text = (await r2.textContent()).replace(/\s+/g, ' ')
    assert.match(r2Text, /ไม่มีค่าฝนที่วัดได้/); assert.ok(!/ 0 มม\./.test(r2Text), 'สถานีที่ไม่มีค่าห้ามแสดง 0 มม.'); assert.equal(await r2.locator('[data-we-chart]').count(), 0)
    // ระดับน้ำ: จุดที่ไม่มีระดับน้ำไม่ถูกเติมเป็น 0 (กราฟใช้เฉพาะจุดที่มีค่า)
    const l1 = page.locator('[data-we-station="waterlevel:L1"]')
    assert.match(await l1.textContent(), /ใกล้ตลิ่งที่สุด: ต่ำกว่าตลิ่ง 0\.80 ม\./)
    assert.equal(await l1.locator('[data-we-chart] path').count(), 1)
    // อ่าง: เกิน 100% มีคำอธิบาย + ตัวเลขซ้ำเดิม
    const dam = (await page.locator('[data-we-station="dam:305"]').textContent()).replace(/\s+/g, ' ')
    assert.match(dam, /เกินความจุที่ระดับเก็บกักปกติ/); assert.match(dam, /ซ้ำเดิม 3 รายงานติดกัน/)
    // ข้อความ สสน. ตามต้นฉบับ: แท็ก HTML แสดงเป็นตัวอักษร ไม่ถูกตีความ
    const w = page.locator('[data-we-warning]').first()
    assert.ok((await w.textContent()).includes('<b>ไม่ตัดแต่ง</b>'), 'ข้อความ สสน. ต้องแสดงตามต้นฉบับ')
    assert.equal(await w.locator('b').count(), 0, 'ห้ามตีความ HTML ในข้อความ สสน.')
    assert.equal(await page.locator('[data-we-warning]').count(), 2)
    // ทุกค่าบนกราฟเป็นเลขจริง
    const paths = await page.locator('[data-we-chart] path').evaluateAll(els => els.map(e => e.getAttribute('d')))
    assert.ok(paths.every(d => d && !/NaN|Infinity/.test(d)))
    await auditPanel(page, `รายละเอียด ${width}px`)
    await shot(page, '[data-we-detail]', `we-detail-${width}`)
    if (fullDetail) {
      await page.locator('[data-we-nav="back"]').first().click()
      await page.locator('[data-we-list]').waitFor({ timeout: 5_000 })
      assert.equal(await page.locator('[data-we-card]').count(), 3, 'กลับแล้วรายการต้องอยู่ครบ')
    }
  })
  return `${width}px รายการ+รายละเอียด`
}

async function checkError(page, auth, width) {
  const notes = []
  // 1) ฟังก์ชันยังไม่ติดตั้ง → บอกตรงๆ + โหลดใหม่ได้
  state.scene = 'error'; state.failFirst = true
  await openPanel(page, auth, width)
  const alert = page.locator('[data-we-error]')
  await alert.waitFor({ timeout: 10_000 })
  assert.match(await alert.textContent(), /ยังไม่ได้ติดตั้งฟังก์ชันอ่านเหตุการณ์/)
  await auditPanel(page, `ผิดพลาด ${width}px`)
  await page.locator('[data-we-nav="retry"]').click()
  await page.locator('[data-we-list]').waitFor({ timeout: 10_000 })
  assert.equal(await page.locator('[data-we-error]').count(), 0, 'โหลดใหม่สำเร็จแล้วต้องไม่เหลือข้อความผิดพลาด')
  notes.push('ติดตั้งไม่ครบ→โหลดใหม่ได้')
  // 2) ไม่มีสิทธิ์
  state.scene = 'denied'
  await openPanel(page, auth, width)
  assert.match(await page.locator('[data-we-error]').textContent(), /บัญชีนี้ไม่มีสิทธิ์ดูเหตุการณ์น้ำ-ฝน/)
  notes.push('ไม่มีสิทธิ์')
  // 3) เหตุการณ์ที่หายไประหว่างเปิดดู
  state.scene = 'events'
  await openPanel(page, auth, width)
  state.scene = 'missing'
  await page.locator('[data-we-card]').first().click()
  await page.locator('[data-we-missing]').waitFor({ timeout: 10_000 })
  await auditPanel(page, `ไม่พบเหตุการณ์ ${width}px`)
  await page.locator('[data-we-nav="back"]').click()
  await page.locator('[data-we-list]').waitFor({ timeout: 5_000 })
  notes.push('เหตุการณ์หาย')
  return notes.join(' · ')
}

async function main() {
  const profileDir = path.join(PROFILE_ROOT, PROFILE)
  try { await access(profileDir) } catch { throw new BlockedError(`ไม่พบโปรไฟล์ ${PROFILE}`) }
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: !process.argv.includes('--headed'), viewport: { width: 1366, height: 768 } })
  } catch { throw new BlockedError(`เปิด ${PROFILE} ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`) }
  let failed = 0
  let total = 0
  try {
    await installStubs(context)
    const page = context.pages()[0] || await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)))
    const auth = trackProfileResolution(page)
    await transferDemoSession(page)
    const run = async (label, fn) => {
      total += 1
      try { const note = await fn(); console.log(`PASS  ${label}${note ? ` — ${note}` : ''}`) } catch (error) {
        failed += 1
        console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${label} — ${String(error.message).split('\n').slice(0, 2).join(' | ')}`)
      }
    }
    // WE_QUICK=1: ตรวจเฉพาะ 390px (ใช้ตอน red-check ให้เร็ว) — รอบเต็มต้องไม่ใส่
    if (!process.env.WE_QUICK) {
      await run('1280px (PC) สถานะว่าง ok/late/unknown', () => checkEmpty(page, auth, 1280))
      await run('1280px (PC) รายการ + รายละเอียด', () => checkEvents(page, auth, 1280))
      await run('1280px (PC) ผิดพลาด/ไม่มีสิทธิ์/เหตุการณ์หาย', () => checkError(page, auth, 1280))
    }
    await run('390px สถานะว่าง ok/late/unknown', () => checkEmpty(page, auth, 390))
    await run('390px รายการ + รายละเอียด', () => checkEvents(page, auth, 390))
    await run('390px ผิดพลาด/ไม่มีสิทธิ์/เหตุการณ์หาย', () => checkError(page, auth, 390))
    if (!process.env.WE_QUICK) {
      await run('360px รายการ + รายละเอียด', () => checkEvents(page, auth, 360, { fullDetail: false }))
      await run('768px รายการ + รายละเอียด', () => checkEvents(page, auth, 768, { fullDetail: false }))
    }
    total += 1
    if (errors.length) { failed += 1; console.log(`FAIL  JS error ${errors.length} รายการ: ${errors.slice(0, 3).join(' | ')}`) } else console.log('PASS  ไม่มี JS error ตลอดการทดสอบ')
  } finally {
    await context.close().catch(() => {})
  }
  console.log(`\n${total - failed}/${total} ผ่าน`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${String(error.message).split('\n')[0]}`)
  process.exit(2)
})
