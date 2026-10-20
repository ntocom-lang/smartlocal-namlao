// E2E หน้าลิงก์ติดตามเรื่อง (/t/<โทเคน>) ฝั่งผู้แจ้งที่ไม่ล็อกอิน — RPC ของลิงก์ทั้ง 3 ตัวถูกจำลองในเบราว์เซอร์ ไม่เขียนข้อมูลใด
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม:
//   VITE_TENANT_SLUG=demo npm run dev -- --port 5174 --strictPort
//   node tests/complaint-track-browser.playwright.mjs            (http://localhost:5174)
//   TRACK_TEST_BASE_URL=http://127.0.0.1:5176 TRACK_SHOT_DIR=<โฟลเดอร์> node tests/complaint-track-browser.playwright.mjs
//
// ตรวจ: ทุกสถานะแสดงขั้นความคืบหน้าถูก · ให้คะแนนส่งค่าที่เลือก+ความเห็น แล้วขึ้นขอบคุณ · แจ้งกลับตรวจเหตุผลก่อนส่ง
// ส่งแล้วเรื่องกลับไปขั้นรับเรื่อง · รหัสผิดพลาดจากฐานข้อมูลขึ้นข้อความไทย · เจ้าหน้าที่เห็นแต่อ่านอย่างเดียว
// ลิงก์ผิดรูปแบบไม่เรียกฐานข้อมูลเลย · ยิงถี่ (429) มีปุ่มลองใหม่ · ไม่ล้นจอ 360/390/768/1280 · เป้ากด ≥ 44px · ไม่มีข้อมูลส่วนบุคคลบนหน้า
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_BASE_URL = 'http://localhost:5174'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const SHOT_DIR = process.env.TRACK_SHOT_DIR || path.join(process.cwd(), 'screenshots', 'complaint-track')
const MIN_TAP = 44
const WIDTHS = [360, 390, 768, 1280]
const TOKEN = '8f2c91d04be7a3561c0f9e2d7a41b8c3'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function resolveBaseUrl() {
  const raw = (process.env.TRACK_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${url.hostname}`)
  return raw
}

const iso = (offsetHours) => new Date(Date.now() + offsetHours * 3_600_000).toISOString()
const dueDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

// รูปร่างเดียวกับที่ get_complaint_by_track_token() คืน (ตรวจรายการคีย์ฝั่งฐานข้อมูลที่ tests/complaint-track-db.test.mjs)
const view = (overrides = {}) => ({
  found: true, ref_no: 'ES-69-0123', category: 'light', category_label: 'ไฟฟ้าสาธารณะ', village: 'หมู่ 3',
  status: 'received', created_at: iso(-30), due_date: dueDate(2), closed_at: null, is_adhoc: false,
  result_note: null, reject_reason: null, timeline: [{ status: 'received', at: iso(-28) }],
  rated: false, can_rate: false, can_reopen: false, reopen_days_left: 0, reopened: false, viewer: 'link', server_now: iso(0),
  ...overrides,
})
const closedView = (overrides = {}) => view({
  status: 'closed', closed_at: iso(-20), result_note: 'เปลี่ยนหลอดไฟและตรวจสายแล้ว ไฟติดปกติ',
  timeline: [{ status: 'received', at: iso(-28) }, { status: 'in_progress', at: iso(-26) }, { status: 'closed', at: iso(-20) }],
  can_rate: true, can_reopen: true, reopen_days_left: 6, ...overrides,
})

async function open(browser, baseUrl, { route = `/t/${TOKEN}`, width = 390, height = 900, handlers = {} }) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH' })
  const page = await context.newPage()
  const problems = []
  const writes = []
  const calls = { get: [], rate: [], reopen: [] }
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('request', request => {
    if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`)
  })
  // บันทึกสถิติเข้าชม (เขียนฐานข้อมูลจริง) — ไม่ให้ทดสอบทำตัวเลขผู้เข้าชมเพี้ยน
  await page.route(/\/rest\/v1\/rpc\/(record_|log_|get_site_open_summary)/, r => r.fulfill({ json: null }))
  const fulfillWith = (kind, fallback) => async route => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    calls[kind].push(body)
    const result = typeof handlers[kind] === 'function' ? handlers[kind](body, calls[kind].length) : (handlers[kind] ?? fallback)
    if (result?.__http) return route.fulfill({ status: result.__http, json: result.body })
    return route.fulfill({ json: result })
  }
  await page.route('**/rest/v1/rpc/get_complaint_by_track_token', fulfillWith('get', { found: false }))
  await page.route('**/rest/v1/rpc/rate_complaint_by_track_token', fulfillWith('rate', { ok: true, verified: false }))
  await page.route('**/rest/v1/rpc/reopen_complaint_by_track_token', fulfillWith('reopen', { ok: true, status: 'received' }))
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
  return { context, page, problems, writes, calls }
}

async function audit(page, where) {
  const a = await page.evaluate(({ minTap }) => {
    const small = [...document.querySelectorAll('[data-track-page] button, [data-track-page] a[href], [data-track-page] textarea')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({ tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
      .filter(el => el.h < minTap && el.tag !== 'A')
    const main = document.querySelector('[data-track-page]')?.getBoundingClientRect()
    return { small, pageOverflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth, left: Math.round(main?.left ?? 0), right: Math.round(main?.right ?? 0) }
  }, { minTap: MIN_TAP })
  assert.ok(a.pageOverflow <= 1, `${where}: หน้าล้นจอ ${a.pageOverflow}px`)
  assert.ok(a.left >= -0.5 && a.right <= a.vw + 0.5, `${where}: เนื้อหาล้นกรอบจอ ${a.left}..${a.right} (จอ ${a.vw})`)
  assert.deepEqual(a.small, [], `${where}: ปุ่มเตี้ยกว่า ${MIN_TAP}px`)
}

const results = []
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false, error }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`)
  }
}
const textOf = page => page.locator('[data-track-page]').innerText()
const ready = async page => { await page.getByText('เลขที่อ้างอิง').first().waitFor({ timeout: 30_000 }); await page.waitForTimeout(600) }

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await check('รอรับเรื่อง: ขั้นแรกกำลังรอ · ขั้นที่เหลือยังไม่ถึง · ไม่มีปุ่มให้คะแนน/แจ้งกลับ · เรียกฐานข้อมูลด้วยโทเคนกับรหัส อปท. เท่านั้น', async () => {
    const { context, page, problems, writes, calls } = await open(browser, baseUrl, { handlers: { get: view({ status: 'pending', timeline: [] }) } })
    try {
      await ready(page)
      const text = await textOf(page)
      assert.match(text, /ES-69-0123/); assert.match(text, /ไฟฟ้าสาธารณะ/); assert.match(text, /หมู่ 3/)
      assert.match(text, /รอเจ้าหน้าที่รับเรื่อง/); assert.match(text, /กำลังดำเนินการ/); assert.match(text, /กำหนดเสร็จภายใน/)
      assert.ok(!/พอใจกับการดำเนินการไหม|แจ้งกลับ/.test(text), 'ยังไม่เสร็จ ห้ามมีส่วนให้คะแนน/แจ้งกลับ')
      assert.match(text, /ไม่แสดงชื่อและเบอร์โทรของผู้แจ้ง/)
      assert.equal(await page.locator('meta[name="robots"][content="noindex"]').count(), 1)
      assert.ok(calls.get.length >= 1 && calls.get.length <= 2, `dev StrictMode เรียก effect ตอน mount ได้ 2 รอบ แต่ production 1 รอบ (พบ ${calls.get.length})`)
      assert.equal(calls.get[0]._token, TOKEN); assert.match(calls.get[0]._municipality_id, UUID)
      assert.deepEqual(Object.keys(calls.get[0]).sort(), ['_municipality_id', '_token'])
      assert.deepEqual(writes, []); assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('กำลังดำเนินการ: ขั้นรับเรื่องผ่านแล้ว · ขั้นกำลังดำเนินการเป็นขั้นปัจจุบัน', async () => {
    const { context, page, problems } = await open(browser, baseUrl, {
      handlers: { get: view({ status: 'in_progress', timeline: [{ status: 'received', at: iso(-28) }, { status: 'in_progress', at: iso(-5) }] }) },
    })
    try {
      await ready(page)
      assert.equal(await page.locator('li[aria-current="step"]').count(), 1)
      assert.match(await page.locator('li[aria-current="step"]').innerText(), /กำลังดำเนินการ/)
      assert.equal(await page.locator('ol li').count(), 3)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ดำเนินการแล้ว: บันทึกผลของเจ้าหน้าที่ + ให้คะแนน + แจ้งกลับ (เหลือ 6 วัน) ครบ', async () => {
    const { context, page, problems } = await open(browser, baseUrl, { handlers: { get: closedView() } })
    try {
      await ready(page)
      const text = await textOf(page)
      assert.match(text, /เปลี่ยนหลอดไฟและตรวจสายแล้ว ไฟติดปกติ/)
      assert.match(text, /พอใจกับการดำเนินการไหม/)
      assert.match(text, /ยังไม่เรียบร้อย แจ้งกลับ \(เหลือ 6 วัน\)/)
      assert.match(text, /ทันกำหนด/)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ให้คะแนน: เลือก 4 + ความเห็น → ส่งค่าตรง · ขึ้นขอบคุณ · เรียกดูซ้ำแล้วไม่มีฟอร์มให้คะแนนอีก', async () => {
    let rated = false
    const { context, page, problems, writes, calls } = await open(browser, baseUrl, {
      handlers: {
        get: () => (rated ? closedView({ rated: true, can_rate: false }) : closedView()),
        rate: () => { rated = true; return { ok: true, verified: false } },
      },
    })
    try {
      await ready(page)
      const submit = page.getByRole('button', { name: 'ส่งคะแนน' })
      assert.equal(await submit.isDisabled(), true, 'ยังไม่เลือกคะแนนต้องกดส่งไม่ได้')
      const getsBefore = calls.get.length
      await page.getByRole('button', { name: /ดี$/ }).first().click()
      await page.getByLabel(/ความคิดเห็นเพิ่มเติม/).fill('  ขอบคุณเจ้าหน้าที่  ')
      await submit.click()
      await page.getByText('ขอบคุณสำหรับความคิดเห็น').waitFor({ timeout: 10_000 })
      assert.equal(calls.rate.length, 1)
      assert.deepEqual(calls.rate[0], { _token: TOKEN, _municipality_id: calls.get[0]._municipality_id, p_rating: 4, p_comment: 'ขอบคุณเจ้าหน้าที่' })
      assert.equal(await page.getByRole('button', { name: 'ส่งคะแนน' }).count(), 0)
      assert.equal(calls.get.length, getsBefore + 1, 'โหลดสถานะใหม่หลังส่งหนึ่งครั้ง')
      assert.deepEqual(writes, []); assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ให้คะแนนไม่สำเร็จ: ข้อความไทยตามรหัส · ไม่มีข้อความขอบคุณ · กดส่งใหม่ได้ · already_rated ถือว่าสำเร็จ', async () => {
    const { context, page, problems } = await open(browser, baseUrl, {
      handlers: { get: closedView(), rate: (_, n) => (n === 1 ? { ok: false, code: 'staff_cannot_rate' } : { ok: false, code: 'already_rated' }) },
    })
    try {
      await ready(page)
      await page.getByRole('button', { name: /ยอดเยี่ยม/ }).click()
      await page.getByRole('button', { name: 'ส่งคะแนน' }).click()
      await page.getByRole('alert').filter({ hasText: 'เจ้าหน้าที่ให้คะแนนแทนผู้แจ้งไม่ได้' }).waitFor({ timeout: 10_000 })
      assert.equal(await page.getByText('ขอบคุณสำหรับความคิดเห็น').count(), 0)
      await page.getByRole('button', { name: 'ส่งคะแนน' }).click()
      await page.getByText('ขอบคุณสำหรับความคิดเห็น').waitFor({ timeout: 10_000 })
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('แจ้งกลับ: เหตุผลสั้นไป → ขึ้นเตือนและไม่เรียก RPC · เหตุผลพอ → ส่งแล้วเรื่องกลับไปขั้นรับเรื่อง', async () => {
    let reopened = false
    const { context, page, problems, writes, calls } = await open(browser, baseUrl, {
      handlers: {
        get: () => (reopened ? view({ status: 'received', reopened: true, timeline: [{ status: 'received', at: iso(-0.1) }] }) : closedView()),
        reopen: () => { reopened = true; return { ok: true, status: 'received' } },
      },
    })
    try {
      await ready(page)
      await page.getByRole('button', { name: /ยังไม่เรียบร้อย แจ้งกลับ/ }).click()
      await page.getByLabel('เหตุผล').fill('abc')
      await page.getByRole('button', { name: 'ส่งเรื่องกลับ' }).click()
      await page.getByRole('alert').filter({ hasText: 'อย่างน้อย 5 ตัวอักษร' }).waitFor()
      assert.equal(calls.reopen.length, 0, 'เหตุผลสั้นต้องไม่ถึงฐานข้อมูล')
      await page.getByLabel('เหตุผล').fill('  ไฟยังไม่ติด  ')
      await page.getByRole('button', { name: 'ส่งเรื่องกลับ' }).click()
      await page.getByText('ส่งเรื่องกลับให้เจ้าหน้าที่แล้ว').waitFor({ timeout: 10_000 })
      assert.deepEqual(calls.reopen, [{ _token: TOKEN, _municipality_id: calls.get[0]._municipality_id, p_reason: 'ไฟยังไม่ติด' }])
      const text = await textOf(page)
      assert.ok(!/พอใจกับการดำเนินการไหม/.test(text), 'เรื่องกลับไปทำต่อแล้ว ห้ามมีส่วนให้คะแนน')
      assert.equal(await page.locator('li[aria-current="step"]').count(), 1)
      assert.match(await page.locator('li[aria-current="step"]').innerText(), /รับเรื่องแล้ว/)
      assert.deepEqual(writes, []); assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('แจ้งกลับไม่สำเร็จ (เกิน 7 วัน) → ข้อความไทยตามรหัส · ยกเลิกแล้วพับกล่องกลับ', async () => {
    const { context, page, problems } = await open(browser, baseUrl, { handlers: { get: closedView(), reopen: { ok: false, code: 'expired' } } })
    try {
      await ready(page)
      await page.getByRole('button', { name: /ยังไม่เรียบร้อย แจ้งกลับ/ }).click()
      await page.getByLabel('เหตุผล').fill('เกินเวลาแล้วแต่ยังไม่เรียบร้อย')
      await page.getByRole('button', { name: 'ส่งเรื่องกลับ' }).click()
      await page.getByRole('alert').filter({ hasText: 'เกิน 7 วันหลังดำเนินการแล้ว' }).waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'ยกเลิก' }).click()
      assert.equal(await page.getByLabel('เหตุผล').count(), 0)
      assert.equal(await page.getByRole('button', { name: /ยังไม่เรียบร้อย แจ้งกลับ/ }).count(), 1)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  await check('ให้คะแนนแล้ว/เคยแจ้งกลับแล้ว: บอกสถานะ ไม่มีปุ่มทำซ้ำ · เจ้าหน้าที่เห็นแจ้งว่าอ่านอย่างเดียว', async () => {
    const done = await open(browser, baseUrl, { handlers: { get: closedView({ rated: true, can_rate: false, can_reopen: false, reopened: true }) } })
    try {
      await ready(done.page)
      const text = await textOf(done.page)
      assert.match(text, /ให้คะแนนเรื่องนี้แล้ว/); assert.match(text, /เคยแจ้งกลับแล้ว/)
      assert.equal(await done.page.getByRole('button', { name: 'ส่งคะแนน' }).count(), 0)
      assert.deepEqual(done.problems, [])
    } finally { await done.context.close() }
    const staff = await open(browser, baseUrl, { handlers: { get: closedView({ viewer: 'staff', can_rate: false, can_reopen: false }) } })
    try {
      await ready(staff.page)
      assert.match(await textOf(staff.page), /คุณกำลังดูในฐานะเจ้าหน้าที่/)
      assert.equal(await staff.page.getByRole('button', { name: 'ส่งคะแนน' }).count(), 0)
      assert.equal(await staff.page.getByRole('button', { name: /แจ้งกลับ/ }).count(), 0)
    } finally { await staff.context.close() }
  })

  await check('ไม่ดำเนินการ/เรื่องเฉพาะกิจ: แสดงเหตุผล / ข้อความอธิบาย ไม่ไล่ขั้นผิด', async () => {
    const rejected = await open(browser, baseUrl, { handlers: { get: view({ status: 'rejected', closed_at: iso(-3), reject_reason: 'อยู่นอกเขตพื้นที่ของ อปท.' }) } })
    try {
      await ready(rejected.page)
      const text = await textOf(rejected.page)
      assert.match(text, /ไม่สามารถดำเนินการได้/); assert.match(text, /อยู่นอกเขตพื้นที่ของ อปท\./)
      assert.ok(!/พอใจกับการดำเนินการไหม/.test(text))
    } finally { await rejected.context.close() }
    const adhoc = await open(browser, baseUrl, { handlers: { get: view({ is_adhoc: true, status: 'pending', category_label: 'กลิ่นเหม็นรบกวน' }) } })
    try {
      await ready(adhoc.page)
      assert.match(await textOf(adhoc.page), /ไม่มีสถานะรายเรื่อง/)
      assert.equal(await adhoc.page.locator('ol li').count(), 1)
    } finally { await adhoc.context.close() }
  })

  await check('ลิงก์ผิด: ไม่พบเรื่อง → ขึ้น "ไม่พบเรื่องนี้" + ทางไปค้นด้วยเลขอ้างอิง · ลิงก์ผิดรูปแบบไม่เรียกฐานข้อมูลเลย', async () => {
    const missing = await open(browser, baseUrl, { handlers: { get: { found: false } } })
    try {
      await missing.page.getByText('ไม่พบเรื่องนี้').first().waitFor({ timeout: 30_000 })
      assert.equal(await missing.page.getByRole('link', { name: 'ค้นหาด้วยเลขที่อ้างอิง' }).getAttribute('href'), '/my-complaints')
      assert.deepEqual(missing.problems, [])
    } finally { await missing.context.close() }
    const malformed = await open(browser, baseUrl, { route: '/t/ไม่ใช่โทเคน', handlers: { get: view() } })
    try {
      await malformed.page.getByText('ไม่พบเรื่องนี้').first().waitFor({ timeout: 30_000 })
      await malformed.page.waitForTimeout(800)
      assert.equal(malformed.calls.get.length, 0, 'ผิดรูปแบบต้องไม่ถึงฐานข้อมูล')
    } finally { await malformed.context.close() }
  })

  await check('ยิงถี่ (429): ขึ้นข้อความรอสักครู่ + ปุ่มลองใหม่ → กดแล้วโหลดได้', async () => {
    let throttled = true
    const { context, page, problems } = await open(browser, baseUrl, {
      handlers: { get: () => (throttled ? { __http: 429, body: { code: 'PT429', message: 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' } } : view()) },
    })
    try {
      await page.getByText('เปิดดูถี่เกินไป').first().waitFor({ timeout: 30_000 })
      throttled = false
      await page.getByRole('button', { name: 'ลองใหม่' }).click()
      await ready(page)
      assert.match(await textOf(page), /ES-69-0123/)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
  })

  for (const width of WIDTHS) {
    await check(`จอ ${width}px: ไม่ล้นจอ · ปุ่มสูง ≥ ${MIN_TAP}px ทั้งตอนให้คะแนนและตอนเปิดกล่องแจ้งกลับ · ไม่มีข้อมูลส่วนบุคคลบนหน้า`, async () => {
      const { context, page, problems } = await open(browser, baseUrl, { width, handlers: { get: closedView() } })
      try {
        await ready(page)
        await audit(page, `ดำเนินการแล้ว ${width}px`)
        await page.getByRole('button', { name: /ดี$/ }).first().click()
        await audit(page, `เลือกคะแนนแล้ว ${width}px`)
        await page.screenshot({ path: path.join(SHOT_DIR, `closed-${width}.png`), fullPage: true })
        await page.getByRole('button', { name: /ยังไม่เรียบร้อย แจ้งกลับ/ }).click()
        await audit(page, `กล่องแจ้งกลับ ${width}px`)
        const html = await page.content()
        for (const secret of ['0812345678', 'นายลับ', 'reporter_name']) assert.ok(!html.includes(secret), `ข้อมูลลับบนหน้า: ${secret}`)
        assert.deepEqual(problems, [])
        if (width === 390) {
          const pending = await open(browser, baseUrl, { width, handlers: { get: view({ status: 'in_progress', timeline: [{ status: 'received', at: iso(-28) }, { status: 'in_progress', at: iso(-5) }] }) } })
          try {
            await ready(pending.page)
            await audit(pending.page, 'กำลังดำเนินการ 390px')
            await pending.page.screenshot({ path: path.join(SHOT_DIR, 'in-progress-390.png'), fullPage: true })
          } finally { await pending.context.close() }
        }
      } finally { await context.close() }
    })
  }
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน — ภาพหน้าจอที่ ${SHOT_DIR}`)
if (failed.length) process.exit(1)
