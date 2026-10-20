// E2E หน้าแบบสำรวจความเห็น (/survey/:id, /surveys) + การ์ดหน้าแรก ฝั่งประชาชน — RPC ถูกจำลองในเบราว์เซอร์ ไม่เขียนข้อมูลใด
// ยิงได้เฉพาะ dev server ในเครื่อง (tenant demo) หรือสนามซ้อม:
//   VITE_TENANT_SLUG=demo npm run dev -- --port 5174 --strictPort
//   node tests/community-survey-browser.playwright.mjs            (http://localhost:5174)
//   SURVEY_TEST_BASE_URL=http://127.0.0.1:5176 SURVEY_SHOT_DIR=<โฟลเดอร์> node tests/community-survey-browser.playwright.mjs
//
// ตรวจ: ผู้ไม่ล็อกอินเห็นคำถาม/ตัวเลือกและปุ่มเข้าสู่ระบบ ไม่เห็นผล · ผู้ตอบได้เลือกข้อเดียว+ความเห็น (ส่งค่าที่เลือกและความเห็นถูกต้อง)
// แล้วเห็นผลพร้อมป้าย "คำตอบของคุณ" · ซ่อนกล่องความเห็นเมื่อเจ้าหน้าที่ปิดช่อง · ป้าย "ไม่ใช่มติ" ทุกสถานะ · รหัสผิดพลาดขึ้นข้อความไทย
// ยิงถี่ (429) มีข้อความรอ · id ผิดรูปแบบไม่เรียกฐานข้อมูลเลย · การ์ดหน้าแรกเลือกถูกตามสถานะ · ไม่ล้นจอ 360/390/768/1280 · เป้ากด ≥ 44px
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_BASE_URL = 'http://localhost:5174'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const SHOT_DIR = process.env.SURVEY_SHOT_DIR || path.join(process.cwd(), 'screenshots', 'community-survey')
const MIN_TAP = 44
const WIDTHS = [360, 390, 768, 1280]
const SID = '3b1f6c1e-8d7a-4f0e-9a52-6c4d2b8e7f10'
const OPT = ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444']
const LABELS = ['ซ่อมถนนและทางเข้าหมู่บ้าน', 'เพิ่มไฟส่องสว่างสาธารณะ', 'ระบบประปาและแหล่งน้ำ', 'ทางระบายน้ำและป้องกันน้ำท่วม']
const QUESTION = 'ปีงบประมาณหน้า ควรให้หน่วยงานทำเรื่องใดก่อน?'
const NOTICE = 'ความเห็นประกอบการพิจารณา ไม่ใช่มติและไม่ใช่การประชาคม'

function resolveBaseUrl() {
  const raw = (process.env.SURVEY_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`ยิงได้เฉพาะ localhost หรือสนามซ้อม ไม่ใช่ ${url.hostname}`)
  return raw
}

const iso = hours => new Date(Date.now() + hours * 3_600_000).toISOString()

// รูปร่างเดียวกับที่ get_survey() คืน (ตรวจรายการคีย์ฝั่งฐานข้อมูลที่ tests/community-survey-db.test.mjs)
const options = counts => LABELS.map((label, i) => ({ id: OPT[i], label, position: i + 1, count: counts ? counts[i] : null }))
const sum = counts => counts.reduce((a, b) => a + b, 0)
const survey = (overrides = {}) => ({
  found: true, id: SID, question: QUESTION, status: 'open', closes_at: iso(24 * 9), allow_comment: true,
  options: options(null), total: 23, split: null, results_visible: false, has_voted: false,
  can_vote: true, vote_block: null, server_now: iso(0), ...overrides,
})
const votedView = (counts = [9, 7, 4, 3], overrides = {}) => survey({
  options: options(counts), total: sum(counts), split: { citizen: 15, official: sum(counts) - 15 }, results_visible: true, has_voted: true,
  can_vote: false, vote_block: 'already_voted', ...overrides,
})
const closedView = (counts = [9, 7, 4, 3]) => votedView(counts, { status: 'closed', closes_at: iso(-48), has_voted: false, vote_block: 'closed' })

async function open(browser, baseUrl, { route = `/survey/${SID}`, width = 390, height = 900, handlers = {}, seed = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH' })
  if (seed) await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch { /* ไม่เป็นไร */ } }, seed)
  const page = await context.newPage()
  const problems = []
  const writes = []
  const calls = { get: [], vote: [], list: [] }
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  page.on('request', request => {
    if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`)
  })
  await page.route(/\/rest\/v1\/rpc\/(record_|log_|get_site_open_summary)/, r => r.fulfill({ json: null }))
  const fulfillWith = (kind, fallback) => async route => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    calls[kind].push(body)
    const result = typeof handlers[kind] === 'function' ? handlers[kind](body, calls[kind].length) : (handlers[kind] ?? fallback)
    if (result?.__http) return route.fulfill({ status: result.__http, json: result.body })
    return route.fulfill({ json: result })
  }
  await page.route('**/rest/v1/rpc/get_survey', fulfillWith('get', { found: false }))
  await page.route('**/rest/v1/rpc/cast_survey_vote', fulfillWith('vote', { ok: true, comment_saved: false, comment_masked: false }))
  await page.route('**/rest/v1/rpc/list_surveys', fulfillWith('list', []))
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
  return { context, page, problems, writes, calls }
}

async function audit(page, where, selector = '[data-survey-page]') {
  const a = await page.evaluate(({ minTap, selector }) => {
    const small = [...document.querySelectorAll(`${selector} button, ${selector} a[href], ${selector} textarea, ${selector} input[type=radio]`)]
      .filter(el => el.offsetParent !== null && el.tagName !== 'INPUT')
      .map(el => ({ tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
      .filter(el => el.h < minTap && el.tag !== 'A')
    const main = document.querySelector(selector)?.getBoundingClientRect()
    return { small, pageOverflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth, left: Math.round(main?.left ?? 0), right: Math.round(main?.right ?? 0) }
  }, { minTap: MIN_TAP, selector })
  assert.ok(a.pageOverflow <= 1, `${where}: หน้าล้นจอ ${a.pageOverflow}px`)
  assert.ok(a.left >= -0.5 && a.right <= a.vw + 0.5, `${where}: เนื้อหาล้นกรอบจอ ${a.left}..${a.right} (จอ ${a.vw})`)
  assert.deepEqual(a.small, [], `${where}: ปุ่มเตี้ยกว่า ${MIN_TAP}px`)
}

// สัดส่วนความต่างสีของตัวอักษรบนพื้นขาว (WCAG) — ตัวเลือกในฟอร์มเคยไม่กำหนดสี รับสีอ่อนจากส่วนอื่นของแอปจนอ่านไม่ออก
function contrastOnWhite(rgb) {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [0, 0, 0]).slice(0, 3).map(Number).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return 1.05 / (luminance + 0.05)
}

const results = []
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) } catch (error) {
    results.push({ name, ok: false, error }); console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`)
  }
}
const textOf = page => page.locator('[data-survey-page]').innerText()
const ready = async page => { await page.getByText(QUESTION).first().waitFor({ timeout: 30_000 }); await page.waitForTimeout(600) }

const baseUrl = resolveBaseUrl()
await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await check('ผู้ไม่ล็อกอิน: เห็นคำถามกับตัวเลือก+ป้ายไม่ใช่มติ · ไม่เห็นผล · มีปุ่มเข้าสู่ระบบ ไม่มีปุ่มส่งคำตอบ · เรียกฐานข้อมูลด้วย id กับรหัส อปท. เท่านั้น', async () => {
    const { context, page, problems, writes, calls } = await open(browser, baseUrl, {
      handlers: { get: survey({ can_vote: false, vote_block: 'login_required' }) },
    })
    try {
      await ready(page)
      const text = await textOf(page)
      assert.match(text, new RegExp(QUESTION.replace('?', '\\?')))
      for (const label of LABELS) assert.match(text, new RegExp(label), `ไม่เห็นตัวเลือก ${label}`)
      assert.match(text, new RegExp(NOTICE))
      assert.match(text, /เข้าสู่ระบบ/)
      assert.match(text, /ตอบแล้ว 23 คน/)
      assert.doesNotMatch(text, /ผลแบบสำรวจ\n/)
      assert.doesNotMatch(text, /\d+ คน · \d+%/)
      assert.equal(await page.getByRole('button', { name: 'ส่งคำตอบ' }).count(), 0)
      assert.equal(await page.locator('input[type=radio]').count(), 0)
      // หัวเว็บของแอปก็มีลิงก์เข้าสู่ระบบ — นับเฉพาะในหน้าแบบสำรวจ และต้องพากลับมาที่หน้านี้หลังล็อกอิน
      const login = page.locator('[data-survey-page]').getByRole('link', { name: /เข้าสู่ระบบ/ })
      assert.equal(await login.count(), 1)
      assert.ok(calls.get.length >= 1 && calls.get.every(c => Object.keys(c).sort().join() === '_municipality_id,_survey_id' && c._survey_id === SID))
      assert.deepEqual(problems, []); assert.deepEqual(writes, [])
      await page.screenshot({ path: path.join(SHOT_DIR, 'guest-390.png'), fullPage: true })
    } finally { await context.close() }
  })

  await check('ผู้ล็อกอินที่ยังไม่ตอบ: เลือกได้ข้อเดียว · ส่งคำตอบต้องเลือกก่อน · ส่งค่าที่เลือก+ความเห็นที่ตัดช่องว่างแล้ว · เห็นผลหลังตอบพร้อมป้ายคำตอบของคุณและขอบคุณ', async () => {
    let voted = false
    const { context, page, problems, writes, calls } = await open(browser, baseUrl, {
      handlers: {
        get: () => (voted ? votedView([9, 8, 4, 3]) : survey()),
        vote: () => { voted = true; return { ok: true, comment_saved: true, comment_masked: false } },
      },
    })
    try {
      await ready(page)
      for (const [what, locator] of [['ตัวเลือก', page.locator('label[for^="opt-"]').first()], ['ป้ายช่องความเห็น', page.getByText('ความเห็นเพิ่มเติม (ไม่บังคับ)')]]) {
        const color = await locator.evaluate(el => getComputedStyle(el).color)
        assert.ok(contrastOnWhite(color) >= 4.5, `${what}: สีตัวอักษรจางเกินอ่านไม่ออก (${color})`)
      }
      const submit = page.getByRole('button', { name: 'ส่งคำตอบ' })
      assert.equal(await submit.isDisabled(), true, 'ยังไม่เลือกคำตอบต้องกดส่งไม่ได้')
      await page.getByLabel(LABELS[1]).check()
      await page.getByLabel(LABELS[2]).check()
      assert.equal(await page.locator('input[type=radio]:checked').count(), 1, 'ต้องเลือกได้ข้อเดียว')
      await page.getByLabel(LABELS[1]).check()
      await page.getByLabel('ความเห็นเพิ่มเติม (ไม่บังคับ)').fill('  ไฟทางเข้าซอยมืดมาก  ')
      assert.equal(await submit.isDisabled(), false)
      await submit.click()
      await page.getByText('คำตอบของคุณ').first().waitFor({ timeout: 10_000 })
      assert.equal(calls.vote.length, 1)
      assert.deepEqual(calls.vote[0], { _survey_id: SID, _municipality_id: calls.get[0]._municipality_id, p_option_id: OPT[1], p_comment: 'ไฟทางเข้าซอยมืดมาก' })
      const text = await textOf(page)
      assert.match(text, /ขอบคุณที่ร่วมตอบแบบสำรวจ/)
      assert.match(text, /9 คน · 38%/); assert.match(text, /8 คน · 33%/)
      assert.match(text, /ตอบแล้ว 24 คน \(ประชาชน 15 · ผู้มีตำแหน่ง 9\)/)
      assert.match(text, new RegExp(NOTICE))
      assert.equal(await page.locator('input[type=radio]').count(), 0, 'ตอบแล้วต้องไม่มีฟอร์มตอบอีก')
      // ป้าย "คำตอบของคุณ" อยู่ข้างตัวเลือกที่เลือกเท่านั้น
      const mineRow = page.locator('li', { hasText: 'คำตอบของคุณ' })
      assert.equal(await mineRow.count(), 1); assert.match(await mineRow.innerText(), new RegExp(LABELS[1]))
      assert.deepEqual(problems, []); assert.deepEqual(writes, [])
      await page.screenshot({ path: path.join(SHOT_DIR, 'voted-390.png'), fullPage: true })
    } finally { await context.close() }
  })

  await check('ไม่พิมพ์ความเห็น = ส่ง p_comment เป็น null · เจ้าหน้าที่ปิดช่องความเห็นแล้วไม่เห็นกล่องพิมพ์', async () => {
    const withBox = await open(browser, baseUrl, { handlers: { get: survey() } })
    try {
      await ready(withBox.page)
      await withBox.page.getByLabel(LABELS[0]).check()
      await withBox.page.getByRole('button', { name: 'ส่งคำตอบ' }).click()
      await withBox.page.waitForTimeout(800)
      assert.equal(withBox.calls.vote.length, 1)
      assert.equal(withBox.calls.vote[0].p_comment, null)
    } finally { await withBox.context.close() }
    const noBox = await open(browser, baseUrl, { handlers: { get: survey({ allow_comment: false }) } })
    try {
      await ready(noBox.page)
      assert.equal(await noBox.page.getByLabel('ความเห็นเพิ่มเติม (ไม่บังคับ)').count(), 0)
      assert.doesNotMatch(await textOf(noBox.page), /ความเห็นเห็นได้เฉพาะเจ้าหน้าที่/)
    } finally { await noBox.context.close() }
  })

  await check('ระบบซ่อนข้อมูลส่วนตัวในความเห็น → ผู้ตอบถูกบอก · รหัสผิดพลาดจากฐานข้อมูลขึ้นข้อความไทย (ปิดรับ/ข้าม อปท.) ไม่ขึ้นรหัสดิบ', async () => {
    const masked = await open(browser, baseUrl, { handlers: { get: survey(), vote: { ok: true, comment_saved: true, comment_masked: true } } })
    try {
      await ready(masked.page)
      await masked.page.getByLabel(LABELS[0]).check()
      await masked.page.getByRole('button', { name: 'ส่งคำตอบ' }).click()
      await masked.page.getByText(/ซ่อนเบอร์โทร เลขบัตร หรืออีเมลในความเห็นของคุณให้แล้ว/).waitFor({ timeout: 10_000 })
    } finally { await masked.context.close() }
    for (const [code, expected] of [['not_open', /ปิดรับแล้ว/], ['other_municipality', /ผู้ใช้ที่สังกัดหน่วยงานนี้เท่านั้น/], ['invalid_option', /เลือกคำตอบอีกครั้ง/]]) {
      const { context, page } = await open(browser, baseUrl, { handlers: { get: survey(), vote: { ok: false, code } } })
      try {
        await ready(page)
        await page.getByLabel(LABELS[0]).check()
        await page.getByRole('button', { name: 'ส่งคำตอบ' }).click()
        await page.getByRole('alert').first().waitFor({ timeout: 10_000 })
        const alert = await page.getByRole('alert').first().innerText()
        assert.match(alert, expected, code)
        assert.doesNotMatch(alert, new RegExp(code))
      } finally { await context.close() }
    }
  })

  await check('ตอบซ้ำ (already_voted) ถือว่าสำเร็จ โหลดใหม่แล้วเห็นผล ไม่ขึ้น error · ยิงถี่ (429) ขึ้นข้อความรอและกดส่งใหม่ได้', async () => {
    let voted = false
    const dup = await open(browser, baseUrl, { handlers: { get: () => (voted ? votedView() : survey()), vote: () => { voted = true; return { ok: false, code: 'already_voted' } } } })
    try {
      await ready(dup.page)
      await dup.page.getByLabel(LABELS[0]).check()
      await dup.page.getByRole('button', { name: 'ส่งคำตอบ' }).click()
      await dup.page.getByText('ผลแบบสำรวจ').first().waitFor({ timeout: 10_000 })
      assert.equal(await dup.page.getByRole('alert').count(), 0)
    } finally { await dup.context.close() }

    const busy = await open(browser, baseUrl, {
      handlers: { get: survey(), vote: (_body, n) => (n === 1 ? { __http: 429, body: { code: 'PT429', message: 'ส่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' } } : { ok: true, comment_saved: false, comment_masked: false }) },
    })
    try {
      await ready(busy.page)
      await busy.page.getByLabel(LABELS[0]).check()
      const submit = busy.page.getByRole('button', { name: 'ส่งคำตอบ' })
      await submit.click()
      await busy.page.getByRole('alert').first().waitFor({ timeout: 10_000 })
      assert.match(await busy.page.getByRole('alert').first().innerText(), /ส่งถี่เกินไป/)
      assert.equal(await submit.isEnabled(), true, 'ยิงถี่แล้วต้องกดส่งใหม่ได้')
    } finally { await busy.context.close() }
  })

  await check('ปิดรับแล้ว: ทุกคน (รวมผู้ไม่ล็อกอิน) เห็นผล · ไม่มีฟอร์มตอบ · ไม่มีป้ายคำตอบของคุณถ้าเครื่องนี้ไม่ได้ตอบ · มีลิงก์ส่งต่อ', async () => {
    const { context, page, problems } = await open(browser, baseUrl, { handlers: { get: closedView() } })
    try {
      await ready(page)
      const text = await textOf(page)
      assert.match(text, /ปิดรับแล้ว/); assert.match(text, /ปิดเมื่อ/)
      assert.match(text, /9 คน · 39%/); assert.match(text, /7 คน · 30%/); assert.match(text, /4 คน · 17%/); assert.match(text, /3 คน · 13%/)
      assert.doesNotMatch(text, /คำตอบของคุณ/)
      assert.equal(await page.locator('input[type=radio]').count(), 0)
      assert.match(text, new RegExp(NOTICE))
      assert.match(text, /คัดลอกลิงก์/)
      assert.deepEqual(problems, [])
      await page.screenshot({ path: path.join(SHOT_DIR, 'closed-390.png'), fullPage: true })
    } finally { await context.close() }
  })

  await check('เครื่องที่เคยตอบจำคำตอบไว้ → ไฮไลต์ "คำตอบของคุณ" หลังโหลดใหม่ · ไม่มีใครตอบ (ปิดแล้วว่าง) ขึ้น "ยังไม่มีผู้ตอบ"', async () => {
    const remembered = await open(browser, baseUrl, { handlers: { get: votedView() }, seed: [`survey_mine_${SID}`, OPT[2]] })
    try {
      await ready(remembered.page)
      const mineRow = remembered.page.locator('li', { hasText: 'คำตอบของคุณ' })
      assert.equal(await mineRow.count(), 1)
      assert.match(await mineRow.innerText(), new RegExp(LABELS[2]))
    } finally { await remembered.context.close() }
    const empty = await open(browser, baseUrl, { handlers: { get: closedView([0, 0, 0, 0]) } })
    try {
      await ready(empty.page)
      assert.match(await textOf(empty.page), /ยังไม่มีผู้ตอบ/)
    } finally { await empty.context.close() }
  })

  await check('คนในหน่วยงานอื่น: บอกชัดว่าตอบไม่ได้ ไม่มีฟอร์ม · ไม่พบแบบสำรวจ: ข้อความไทย+ลิงก์ไปรายการ · id ผิดรูปแบบไม่เรียกฐานข้อมูลเลย', async () => {
    const other = await open(browser, baseUrl, { handlers: { get: survey({ can_vote: false, vote_block: 'other_municipality' }) } })
    try {
      await ready(other.page)
      const text = await textOf(other.page)
      assert.match(text, /ผู้ใช้ที่สังกัดหน่วยงานนี้เท่านั้น/)
      assert.equal(await other.page.locator('input[type=radio]').count(), 0)
    } finally { await other.context.close() }
    const missing = await open(browser, baseUrl, { handlers: { get: { found: false } } })
    try {
      await missing.page.getByText('ไม่พบแบบสำรวจนี้').waitFor({ timeout: 30_000 })
      assert.equal(await missing.page.getByRole('link', { name: 'ดูแบบสำรวจทั้งหมด' }).count(), 1)
    } finally { await missing.context.close() }
    const bad = await open(browser, baseUrl, { route: '/survey/ไม่ใช่รหัส', handlers: {} })
    try {
      await bad.page.getByText('ไม่พบแบบสำรวจนี้').waitFor({ timeout: 30_000 })
      await bad.page.waitForTimeout(800)
      assert.equal(bad.calls.get.length, 0, 'id ผิดรูปแบบต้องไม่ยิงฐานข้อมูล')
    } finally { await bad.context.close() }
  })

  await check('เครือข่ายล่ม: ขึ้นข้อความไทยและปุ่มลองใหม่ ลองแล้วโหลดได้', async () => {
    // ใช้ธง (ไม่นับครั้ง) เพราะโหมด dev รัน effect ตอน mount 2 รอบ — นับครั้งแล้วรอบสองจะได้ผลปกติ ทับข้อความผิดพลาด
    let broken = true
    const { context, page } = await open(browser, baseUrl, {
      // ใช้ 400 (ไม่ลองซ้ำ) แทน 5xx — ตัว fetch ของแอปลองซ้ำเมื่อเจอ 5xx ทำให้ข้อความผิดพลาดมาช้าเกินรอ
      handlers: { get: () => (broken ? { __http: 400, body: { code: '42501', message: 'permission denied' } } : survey()) },
    })
    try {
      await page.getByText('โหลดไม่สำเร็จ').waitFor({ timeout: 30_000 })
      broken = false
      await page.getByRole('button', { name: 'ลองใหม่' }).click()
      await page.getByText(QUESTION).first().waitFor({ timeout: 10_000 })
    } finally { await context.close() }
  })

  await check('หน้ารายการ /surveys: เปิดอยู่ขึ้นก่อน · ปิดแล้วแสดงผล · ป้ายไม่ใช่มติ · ว่างมีข้อความ', async () => {
    const list = [
      { id: SID, question: QUESTION, status: 'open', closes_at: iso(24 * 9), total: 23, has_voted: true, allow_comment: true },
      { id: 'c9999999-9999-4999-8999-999999999999', question: 'ท่านพอใจกับการให้บริการของหน่วยงานมากน้อยเพียงใด?', status: 'closed', closes_at: iso(-24 * 30), total: 41, has_voted: false, allow_comment: false },
    ]
    const { context, page, problems } = await open(browser, baseUrl, { route: '/surveys', handlers: { list } })
    try {
      await page.getByText(QUESTION).first().waitFor({ timeout: 30_000 })
      const text = await textOf(page)
      assert.ok(text.indexOf(QUESTION) < text.indexOf('ท่านพอใจกับการให้บริการ'), 'เปิดอยู่ต้องขึ้นก่อน')
      assert.match(text, /คุณตอบแล้ว/); assert.match(text, /ปิดเมื่อ/); assert.match(text, /ตอบแล้ว 41 คน/)
      assert.match(text, new RegExp(NOTICE))
      assert.equal(await page.locator('main a[href^="/survey/"]').count(), 2)
      assert.deepEqual(problems, [])
    } finally { await context.close() }
    const none = await open(browser, baseUrl, { route: '/surveys', handlers: { list: [] } })
    try {
      await none.page.getByText('ยังไม่มีแบบสำรวจ').waitFor({ timeout: 30_000 })
    } finally { await none.context.close() }
  })

  await check('การ์ดหน้าแรก: ชวนตอบเมื่อยังไม่ตอบ · ขอบคุณ+ดูผลเมื่อตอบแล้ว · ผลล่าสุดเมื่อเพิ่งปิด · ไม่มีอะไรเมื่อว่าง/ปิดนานแล้ว · ลิงก์ไปหน้าตอบ', async () => {
    const make = (over = {}) => ({ id: SID, question: QUESTION, status: 'open', closes_at: iso(24 * 5), total: 12, has_voted: false, allow_comment: true, ...over })
    const home = async list => open(browser, baseUrl, { route: '/', handlers: { list } })
    const card = page => page.locator('section[aria-label="แบบสำรวจความเห็น"]')

    let h = await home([make()])
    try {
      await card(h.page).waitFor({ timeout: 40_000 })
      const text = await card(h.page).innerText()
      assert.match(text, /ร่วมตอบแบบสำรวจ/); assert.match(text, /ตอบแบบสำรวจ \(ใช้เวลาไม่ถึง 1 นาที\)/); assert.match(text, /เหลืออีก 5 วัน/); assert.match(text, /ตอบแล้ว 12 คน/)
      assert.equal(await h.page.locator(`section[aria-label="แบบสำรวจความเห็น"] a[href="/survey/${SID}"]`).count(), 1)
      assert.deepEqual(h.writes, [])
      await h.page.screenshot({ path: path.join(SHOT_DIR, 'home-card-390.png') })
    } finally { await h.context.close() }

    h = await home([make({ has_voted: true })])
    try {
      await card(h.page).waitFor({ timeout: 40_000 })
      const text = await card(h.page).innerText()
      assert.match(text, /ขอบคุณที่ร่วมตอบแบบสำรวจ/); assert.match(text, /ดูผลแบบสำรวจ/)
    } finally { await h.context.close() }

    h = await home([make({ status: 'closed', closes_at: iso(-24 * 3), has_voted: true })])
    try {
      await card(h.page).waitFor({ timeout: 40_000 })
      assert.match(await card(h.page).innerText(), /ผลแบบสำรวจล่าสุด/)
    } finally { await h.context.close() }

    for (const list of [[], [make({ status: 'closed', closes_at: iso(-24 * 40) })]]) {
      h = await home(list)
      try {
        await h.page.waitForTimeout(3500)
        assert.equal(await card(h.page).count(), 0, 'ต้องไม่มีการ์ดเมื่อไม่มีแบบสำรวจที่เกี่ยวข้อง')
      } finally { await h.context.close() }
    }

    h = await home([make(), make({ id: 'd8888888-8888-4888-8888-888888888888', question: 'เรื่องที่สอง ทดสอบ' })])
    try {
      await card(h.page).waitFor({ timeout: 40_000 })
      assert.equal(await h.page.getByRole('link', { name: /ดูแบบสำรวจทั้งหมด \(2\)/ }).count(), 1)
    } finally { await h.context.close() }
  })

  await check('ไม่ล้นจอและเป้ากด ≥ 44px: หน้าตอบ (ยังไม่ตอบ/ตอบแล้ว/ปิด) และหน้ารายการ ที่ 360 / 390 / 768 / 1280', async () => {
    for (const width of WIDTHS) {
      for (const [name, handler] of [['guest', survey({ can_vote: false, vote_block: 'login_required' })], ['voting', survey()], ['voted', votedView()], ['closed', closedView()]]) {
        const { context, page } = await open(browser, baseUrl, { width, handlers: { get: handler } })
        try {
          await ready(page)
          await audit(page, `${name} @${width}`)
          if (name === 'voting' && width === 360) await page.screenshot({ path: path.join(SHOT_DIR, 'voting-360.png'), fullPage: true })
          if (name === 'voted' && width === 1280) await page.screenshot({ path: path.join(SHOT_DIR, 'voted-1280.png'), fullPage: true })
        } finally { await context.close() }
      }
      const { context, page } = await open(browser, baseUrl, { route: '/surveys', width, handlers: { list: [{ id: SID, question: QUESTION, status: 'open', closes_at: iso(24 * 9), total: 23, has_voted: false, allow_comment: true }] } })
      try {
        await page.getByText(QUESTION).first().waitFor({ timeout: 30_000 })
        await page.waitForTimeout(500)
        await audit(page, `list @${width}`)
      } finally { await context.close() }
    }
  })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\nสรุป: ผ่าน ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
