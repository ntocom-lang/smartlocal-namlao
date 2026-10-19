// หน้าเจ้าหน้าที่: ส่วน "ประกาศน้ำ-ฝนของหน่วยงาน" ใน "เหตุการณ์น้ำ-ฝน" + แถว "ต้องทำตอนนี้" บนหน้าแรก (เฟส 2 · PR 2.2) — เทสต์เบราว์เซอร์
//   node tests/water-announcements-ui.playwright.mjs                (localhost:5174 · dev server ต้องตั้ง tenant เป็น demo)
//   WA_PROFILE_ROOT=<โฟลเดอร์ .chrome-test-profiles> ใช้เมื่อรันจาก worktree ที่ไม่มีโฟลเดอร์นี้
//   WA_PROFILE=TEST-admin (ค่าเริ่มต้น) · WA_SHOT_DIR=<โฟลเดอร์> บันทึกภาพหน้าจอ · WA_QUICK=1 ตรวจเฉพาะ 390px
//
// ใช้ session ของบัญชีทดสอบบนสนามซ้อม (demo) ย้ายมาใส่ localhost เหมือน water-events-ui · ฟังก์ชันประกาศทั้งหมดถูกแทนด้วยข้อมูลจำลองในเบราว์เซอร์
// (ไม่เขียน/ไม่แก้ข้อมูลจริง · ไม่มีการเรียก approve/decline/cancel จริงไปที่ฐานข้อมูล)
//
// เรื่องที่ล็อกไว้ (ผู้มีสิทธิ์เท่านั้นที่มีงาน · คนอื่นไม่เพิ่มงาน · ผลถึงประชาชนทันทีต้องกดยืนยันซ้ำ):
//   1. อปท. ที่ไม่ได้เปิดประกาศ/ไม่มีสิทธิ์ดู = ไม่เห็นส่วนนี้เลย · โหลดพลาดจริง = ข้อความเตือนเล็กๆ ส่วนเหตุการณ์ยังใช้ได้
//   2. เจ้าหน้าที่ทั่วไป (can_approve=false) = อ่านอย่างเดียว ไม่มีปุ่มตัดสิน · ผู้มีสิทธิ์เห็นปุ่มเฉพาะตอนมีร่างสด/ฉบับที่เผยแพร่อยู่
//   3. เผยแพร่/ยกเลิกต้องกดยืนยันซ้ำ — กดครั้งแรกยังไม่เรียกฐานข้อมูล · "ยังก่อน" ย้อนกลับไม่เรียกอะไร
//   4. ร่างเก่าเกิน 3 ชม. ซ่อนปุ่ม · ผลที่ทำไม่ได้ (draft_too_old/event_closed/already_handled) แสดงข้อความภาษาคน
//   5. กล่องตั้งค่าผู้ยืนยัน: เฉพาะ can_manage_approvers · ไม่โหลดรายชื่อจนกว่าจะเปิด · ครบ 5 คนปิดปุ่มตั้ง · ช่องกรอกมีช่องเดียวต่อคน
//   6. ส่วนเหตุการณ์ของหน้า (data-we-list) ยังอ่านอย่างเดียวเหมือนเดิม — ไม่มีช่องกรอก ปุ่มมีแค่ open/back/retry
//   7. หน้าแรก: แถว "ประกาศน้ำ-ฝนรอคุณยืนยัน" ขึ้นเฉพาะผู้ยืนยันที่มีร่าง · ไม่ล้นจอ 360/390/768/1280 · เป้ากด ≥ 44px
import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.WA_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const PROFILE = process.env.WA_PROFILE || 'TEST-admin'
const BASE_URL = (process.env.WA_TEST_BASE_URL || 'http://localhost:5174').replace(/\/$/, '')
const SHOT_DIR = process.env.WA_SHOT_DIR || ''
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const LABEL = 'เหตุการณ์น้ำ-ฝน'
const MIN_TAP = 44
const HOUR = 3600_000
const MIN = 60_000

if (!ALLOWED_HOSTS.has(new URL(BASE_URL).hostname)) {
  console.log(`BLOCKED: ปฏิเสธการยิงไปที่ ${new URL(BASE_URL).hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  process.exit(2)
}

const iso = (ms) => new Date(ms).toISOString()
const ID_PENDING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_CURRENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BODY = 'ประกาศจาก เทศบาลตำบลสาธิต\nข้อมูลสถานการณ์น้ำ-ฝน ณ 20 ต.ค. 2569 เวลา 10:00 น.\n• สถานีฝน บ้านบุญแจ่ม วัดฝนสะสม 24 ชั่วโมงได้ 95.5 มม. (วัดเมื่อ 20 ต.ค. 2569 เวลา 09:40 น.)\nค่าข้างต้นเป็นค่าที่สถานีวัดได้ ไม่ใช่การพยากรณ์ ขอให้ติดตามประกาศจาก เทศบาลตำบลสาธิต ต่อไป'
const PEOPLE = [
  { id: 'p1', name: 'นางสาวสมหญิง ใจดี', job_title: 'ปลัดเทศบาล', role: 'staff', is_approver: false, authority_note: null },
  { id: 'p2', name: 'นายสมชาย รักงาน', job_title: 'หัวหน้าสำนักปลัด', role: 'officer', is_approver: true, authority_note: 'ตามคำสั่งหน่วยงาน ที่ 1/2569' },
  { id: 'p3', name: 'นางสมศรี มีสุข', job_title: null, role: 'admin', is_approver: false, authority_note: null },
]

// ── สถานะจำลอง ──
const state = { scene: 'idle-approver', calls: [], failApprove: null, approvers: PEOPLE.map(p => ({ ...p })), listApproversCalls: 0, todo: { can_approve: false, pending: false } }
const base = (now, over = {}) => ({
  now: iso(now), enabled: true, default_expiry_hours: 24, can_approve: true, can_manage_approvers: false, approvers_count: 2,
  recorder: { last_ok_at: iso(now - 10 * MIN), last_error_at: null }, pending: null, current: null, history: [], ...over,
})
const pendingFresh = (now) => ({ id: ID_PENDING, body: BODY, drafted_at: iso(now - 20 * MIN) })
const currentActive = (now) => ({ id: ID_CURRENT, body: BODY, published_at: iso(now - 2 * HOUR), expires_at: iso(now + 22 * HOUR) })
const history = (now) => [
  { id: 'h1', status: 'expired', body: BODY, drafted_at: iso(now - 50 * HOUR), published_at: iso(now - 49 * HOUR), expires_at: iso(now - 25 * HOUR), closed_at: iso(now - 25 * HOUR) },
  { id: 'h2', status: 'declined', body: BODY, drafted_at: iso(now - 80 * HOUR), published_at: null, expires_at: null, closed_at: iso(now - 79 * HOUR) },
]
function announcementPayload(now) {
  switch (state.scene) {
    case 'disabled': return base(now, { enabled: false, can_approve: false })
    case 'idle-approver': return base(now, { history: history(now) })
    case 'pending-approver': return base(now, { pending: pendingFresh(now) })
    case 'current-approver': return base(now, { current: currentActive(now), history: history(now) })
    case 'renew-approver': return base(now, { current: currentActive(now), pending: pendingFresh(now) })
    case 'pending-staff': return base(now, { can_approve: false, pending: pendingFresh(now) })
    case 'stale-approver': return base(now, { pending: { id: ID_PENDING, body: BODY, drafted_at: iso(now - 4 * HOUR) } })
    case 'no-approvers-admin': return base(now, { can_approve: false, can_manage_approvers: true, approvers_count: 0, pending: pendingFresh(now) })
    case 'no-approvers-staff': return base(now, { can_approve: false, approvers_count: 0 })
    case 'admin-manage': return base(now, { can_approve: false, can_manage_approvers: true, approvers_count: state.approvers.filter(p => p.is_approver).length })
    default: return base(now)
  }
}

async function installStubs(context) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const json = (route, data, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(data) })
  // เหตุการณ์ (ฟังก์ชันของเฟส 3) — สถานะเรียบง่ายพอให้หน้ารายการขึ้น
  await context.route(/\/rest\/v1\/rpc\/(list_water_events|get_water_event)(\?|$)/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const now = Date.now()
    return json(route, {
      now: iso(now), recorder: { last_ok_at: iso(now - 20 * MIN), last_error_at: null }, total: 1,
      events: [{ id: '11111111-1111-4111-8111-111111111111', opened_at: iso(now - 5 * HOUR), ended_at: null, closed_at: null, close_reason: null, last_fresh_at: iso(now - 20 * MIN),
        open_reason: { rule_version: 1, triggers: [{ kind: 'rain', station_code: 'X', station_name: 'บ้านบุญแจ่ม', value: 95.5, recorded_at: iso(now - 5 * HOUR) }] },
        stations_count: 2, readings_count: 40, peak_rain_24h_mm: 95.5, min_bank_diff_m: null, warnings_count: 0 }],
    })
  })
  await context.route(/\/rest\/v1\/rpc\/(list_water_announcements|approve_water_announcement|decline_water_announcement|cancel_water_announcement|list_water_announcement_approvers|set_water_announcement_approver|water_announcement_todo)(\?|$)/, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const name = req.url().match(/rpc\/(\w+)/)[1]
    const body = JSON.parse(req.postData() || '{}')
    state.calls.push({ name, body })
    const now = Date.now()
    if (name === 'water_announcement_todo') return json(route, state.todo)
    if (name === 'list_water_announcements') {
      if (state.scene === 'denied') return json(route, { code: '42501', message: 'ไม่มีสิทธิ์ดูประกาศน้ำ-ฝนของหน่วยงานนี้' }, 403)
      if (state.scene === 'missing-fn') return json(route, { code: 'PGRST202', message: 'Could not find the function public.list_water_announcements in the schema cache' }, 404)
      if (state.scene === 'broken') return json(route, { code: '57014', message: 'canceling statement due to statement timeout' }, 500)
      return json(route, announcementPayload(now))
    }
    if (name === 'approve_water_announcement' || name === 'decline_water_announcement' || name === 'cancel_water_announcement') {
      if (state.failApprove) return json(route, { ok: false, reason: state.failApprove })
      if (name === 'approve_water_announcement') { state.scene = 'current-approver'; return json(route, { ok: true, id: body._announcement_id, status: 'published', published_at: iso(now), expires_at: iso(now + 24 * HOUR) }) }
      if (name === 'decline_water_announcement') { state.scene = 'idle-approver'; return json(route, { ok: true, id: body._announcement_id, status: 'declined' }) }
      state.scene = 'idle-approver'
      return json(route, { ok: true, id: body._announcement_id, status: 'cancelled' })
    }
    if (name === 'list_water_announcement_approvers') {
      state.listApproversCalls += 1
      return json(route, { max_approvers: 5, enabled: true, people: state.approvers })
    }
    if (name === 'set_water_announcement_approver') {
      const person = state.approvers.find(p => p.id === body._profile_id)
      if (body._is_approver && state.approvers.filter(p => p.is_approver && p.id !== body._profile_id).length >= 5) return json(route, { ok: false, reason: 'max_reached', max: 5 })
      if (person) { person.is_approver = body._is_approver; person.authority_note = body._is_approver ? (body._authority_note || null) : null }
      return json(route, { ok: true, approvers_count: state.approvers.filter(p => p.is_approver).length })
    }
    return json(route, null)
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

async function gotoStaff(page, auth, width, height = 900) {
  await page.setViewportSize({ width, height })
  await page.goto(`${BASE_URL}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== '/staff') throw new BlockedError(`บัญชี ${PROFILE} เข้า /staff ไม่ได้ (ไปที่ ${new URL(page.url()).pathname})`)
  await page.getByText('แดชบอร์ดสำหรับเจ้าหน้าที่').first().waitFor({ timeout: 40_000 })
  const skip = page.getByRole('button', { name: 'ข้ามไปก่อน' })
  if (await skip.count()) await skip.first().click()
}
async function openPanel(page, auth, width) {
  await gotoStaff(page, auth, width)
  if (width < 768) await page.getByRole('button', { name: 'เมนู', exact: true }).last().click()
  const entry = page.locator('button:visible', { hasText: LABEL }).first()
  await entry.waitFor({ state: 'visible', timeout: 15_000 })
  await entry.click()
  await page.locator('[data-we-list], [data-we-error]').first().waitFor({ timeout: 15_000 })
}

const section = (page) => page.locator('[data-wa-section]')
const calls = (name) => state.calls.filter(c => c.name === name)
const reset = (scene) => { state.scene = scene; state.calls = []; state.failApprove = null; state.listApproversCalls = 0; state.approvers = PEOPLE.map(p => ({ ...p })) }
async function reloadPanel(page, auth, width, scene) {
  reset(scene)
  await openPanel(page, auth, width)
}

// ตรวจเลย์เอาต์ของส่วนประกาศ: ไม่ล้นจอ · ปุ่ม/ช่องกรอกสูง ≥ 44px · ปุ่มทุกปุ่มมี data-wa-action
async function auditSection(page, where, { allowFields = false } = {}) {
  const a = await page.evaluate(({ minTap }) => {
    const root = document.querySelector('[data-wa-section]')
    if (!root) return null
    const buttons = [...root.querySelectorAll('button')].map(b => ({ action: b.getAttribute('data-wa-action'), h: b.getBoundingClientRect().height, text: b.textContent.trim().slice(0, 30), visible: b.getBoundingClientRect().width > 0 }))
    const fields = [...root.querySelectorAll('input, textarea, select, form, [contenteditable=""], [contenteditable="true"]')].map(f => ({ tag: f.tagName.toLowerCase(), type: f.getAttribute('type'), h: f.getBoundingClientRect().height }))
    const overflow = []
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5)) overflow.push(`${el.tagName.toLowerCase()} ${Math.round(r.left)}..${Math.round(r.right)}`)
    }
    return { buttons, fields, overflow: overflow.slice(0, 5), pageOverflow: document.documentElement.scrollWidth - innerWidth, minTap }
  }, { minTap: MIN_TAP })
  assert.ok(a, `${where}: ไม่พบส่วนประกาศ`)
  for (const b of a.buttons.filter(x => x.visible)) {
    assert.ok(b.action, `${where}: ปุ่ม "${b.text}" ไม่มี data-wa-action`)
    assert.ok(b.h >= MIN_TAP - 0.5, `${where}: ปุ่ม "${b.text}" เตี้ยกว่า ${MIN_TAP}px (${Math.round(b.h)})`)
  }
  if (allowFields) {
    for (const f of a.fields) { assert.equal(f.tag, 'input'); assert.equal(f.type, 'text'); assert.ok(f.h >= MIN_TAP - 0.5, `${where}: ช่องกรอกเตี้ย ${Math.round(f.h)}px`) }
  } else assert.equal(a.fields.length, 0, `${where}: ส่วนประกาศห้ามมีช่องกรอก (พบ ${a.fields.length})`)
  assert.equal(a.overflow.length, 0, `${where}: มีของล้นจอ ${a.overflow.join(' | ')}`)
  assert.ok(a.pageOverflow <= 1, `${where}: หน้าเลื่อนแนวนอนได้ ${a.pageOverflow}px`)
  return a
}

// ส่วนเหตุการณ์ (data-we-list) ต้องยังอ่านอย่างเดียวเหมือนเดิม
async function auditEventsList(page, where) {
  const r = await page.evaluate(() => {
    const list = document.querySelector('[data-we-list]')
    return {
      fields: list.querySelectorAll('input, textarea, select, form, [contenteditable=""], [contenteditable="true"]').length,
      navs: [...list.querySelectorAll('button')].map(b => b.getAttribute('data-we-nav')),
      insideSection: Boolean(list.closest('[data-wa-section]')) || Boolean(document.querySelector('[data-wa-section]')?.contains(list)),
    }
  })
  assert.equal(r.fields, 0, `${where}: ส่วนเหตุการณ์ห้ามมีช่องกรอก`)
  for (const nav of r.navs) assert.equal(nav, 'open', `${where}: ปุ่มในส่วนเหตุการณ์ต้องเป็น open เท่านั้น (พบ ${nav})`)
  assert.equal(r.insideSection, false)
}

async function shot(page, selector, name) {
  if (!SHOT_DIR) return
  await mkdir(SHOT_DIR, { recursive: true })
  const vp = page.viewportSize()
  await page.setViewportSize({ width: vp.width, height: 3000 })
  await page.waitForTimeout(300)
  await page.locator(selector).first().screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  await page.setViewportSize(vp)
}

// ── ฉาก ──
async function checkHidden(page, auth, width) {
  const notes = []
  for (const scene of ['disabled', 'denied', 'missing-fn']) {
    await reloadPanel(page, auth, width, scene)
    await page.waitForTimeout(700)
    assert.equal(await section(page).count(), 0, `${scene}: ต้องไม่เห็นส่วนประกาศ`)
    assert.equal(await page.locator('[data-wa-error]').count(), 0, `${scene}: ไม่ขึ้นข้อความผิดพลาด`)
    assert.equal(calls('list_water_announcements').length >= 1, true)
    assert.equal(calls('list_water_announcement_approvers').length + calls('approve_water_announcement').length, 0, `${scene}: ไม่เรียกอย่างอื่น`)
    await auditEventsList(page, scene)
    notes.push(scene)
  }
  await reloadPanel(page, auth, width, 'broken')
  await page.locator('[data-wa-error]').waitFor({ timeout: 10_000 })
  assert.match(await page.locator('[data-wa-error]').innerText(), /ส่วนอื่นของหน้านี้ยังใช้ได้/)
  await page.locator('[data-we-list]').waitFor({ timeout: 5_000 })
  assert.equal(await section(page).count(), 0)
  notes.push('broken = เตือนเล็กๆ')
  return `ไม่เห็นส่วนประกาศเมื่อ ปิดใช้/ไม่มีสิทธิ์/ฟังก์ชันไม่พร้อม · พังจริงเตือนเล็กๆ ส่วนเหตุการณ์ยังอยู่ (${notes.join(', ')})`
}

async function checkIdle(page, auth, width) {
  await reloadPanel(page, auth, width, 'idle-approver')
  await section(page).waitFor({ timeout: 10_000 })
  await page.locator('[data-wa-idle]').waitFor()
  assert.match(await section(page).innerText(), /คุณเป็นผู้มีสิทธิ์ยืนยันประกาศของหน่วยงานนี้/)
  assert.equal(await section(page).locator('[data-wa-action]').count(), 0, 'ไม่มีร่าง/ฉบับที่เผยแพร่ = ไม่มีปุ่มตัดสิน')
  const text = await section(page).innerText()
  assert.match(text, /ไม่มีคนกดยืนยัน ประชาชนจะไม่เห็นอะไร/); assert.match(text, /ระบบไม่ประกาศแทน ไม่สั่งอพยพ/)
  // ประวัติ: พับไว้ · เปิดแล้วเห็นสถานะภาษาคน
  const hist = page.locator('[data-wa-history]')
  assert.equal(await hist.count(), 1)
  await page.locator('[data-wa-history] > summary').click()
  const rows = await hist.locator('[data-wa-history-row]').allInnerTexts()
  assert.ok(rows[0].includes('หมดอายุ') && rows[1].includes('เลือกไม่ประกาศ'), rows.join(' | '))
  await auditSection(page, `idle ${width}px`)
  await auditEventsList(page, `idle ${width}px`)
  await shot(page, '[data-wa-section]', `staff-idle-${width}`)
  return 'ไม่มีร่าง: ข้อความอธิบาย · ไม่มีปุ่ม · ประวัติพับไว้'
}

async function checkApproveFlow(page, auth, width) {
  await reloadPanel(page, auth, width, 'pending-approver')
  await page.locator('[data-wa-pending]').waitFor({ timeout: 10_000 })
  const pending = page.locator('[data-wa-pending]')
  const body = await pending.locator('[data-wa-body]').innerText()
  assert.ok(body.includes('ประกาศจาก เทศบาลตำบลสาธิต') && body.includes('ไม่ใช่การพยากรณ์'), 'ข้อความร่างแสดงครบ')
  assert.match(await pending.innerText(), /ยังไม่ขึ้นหน้าประชาชน/); assert.match(await pending.innerText(), /ยืนยันได้ถึง/)
  assert.deepEqual(await section(page).locator('[data-wa-action]').evaluateAll(els => els.map(e => e.getAttribute('data-wa-action'))), ['approve', 'decline'])
  await shot(page, '[data-wa-section]', `staff-pending-${width}`)
  // กดครั้งแรก = เปิดขั้นยืนยันเท่านั้น ยังไม่เรียกฐานข้อมูล
  await page.locator('[data-wa-action="approve"]').click()
  await page.locator('[data-wa-confirm="approve"]').waitFor()
  assert.equal(calls('approve_water_announcement').length, 0, 'กด "ยืนยันและเผยแพร่" ครั้งแรกยังไม่ส่งไปฐานข้อมูล')
  assert.match(await page.locator('[data-wa-confirm="approve"]').innerText(), /ให้ประชาชนเห็นทันที ใช้ได้ 24 ชั่วโมง/)
  await auditSection(page, `confirm ${width}px`)
  await shot(page, '[data-wa-section]', `staff-confirm-${width}`)
  // ยังก่อน → ย้อนกลับ
  await page.locator('[data-wa-action="approve-back"]').click()
  assert.equal(await page.locator('[data-wa-confirm]').count(), 0); assert.equal(calls('approve_water_announcement').length, 0)
  // เผยแพร่จริง
  await page.locator('[data-wa-action="approve"]').click()
  await page.locator('[data-wa-action="approve-confirm"]').click()
  await page.locator('[data-wa-current]').waitFor({ timeout: 10_000 })
  assert.equal(calls('approve_water_announcement').length, 1); assert.equal(calls('approve_water_announcement')[0].body._announcement_id, ID_PENDING)
  assert.match(await page.locator('[data-wa-notice="ok"]').innerText(), /เผยแพร่ประกาศแล้ว — ประชาชนเห็นได้ทันที ใช้ได้ถึง/)
  assert.equal(await page.locator('[data-wa-pending]').count(), 0, 'ร่างหายหลังเผยแพร่')
  assert.match(await page.locator('[data-wa-current]').innerText(), /ประชาชนเห็นอยู่/)
  await auditSection(page, `หลังเผยแพร่ ${width}px`)
  await shot(page, '[data-wa-section]', `staff-published-${width}`)
  return 'กดครั้งแรกเปิดขั้นยืนยัน (ไม่เรียก DB) · ยังก่อนย้อนกลับ · เผยแพร่เรียก DB 1 ครั้งด้วย id ที่ถูก · ขึ้นแจ้งผลและฉบับที่เผยแพร่อยู่'
}

async function checkDeclineCancel(page, auth, width) {
  await reloadPanel(page, auth, width, 'pending-approver')
  await page.locator('[data-wa-action="decline"]').click()
  await page.locator('[data-wa-idle]').waitFor({ timeout: 10_000 })
  assert.equal(calls('decline_water_announcement').length, 1)
  assert.match(await page.locator('[data-wa-notice="ok"]').innerText(), /ไม่ประกาศแล้ว — ระบบจะไม่ร่างเรื่องเดิมซ้ำภายใน 12 ชั่วโมง/)
  await reloadPanel(page, auth, width, 'current-approver')
  await page.locator('[data-wa-current]').waitFor({ timeout: 10_000 })
  assert.deepEqual(await section(page).locator('[data-wa-action]').evaluateAll(els => els.map(e => e.getAttribute('data-wa-action'))), ['cancel'])
  await page.locator('[data-wa-action="cancel"]').click()
  await page.locator('[data-wa-confirm="cancel"]').waitFor()
  assert.equal(calls('cancel_water_announcement').length, 0, 'ยกเลิกครั้งแรกยังไม่ส่งไปฐานข้อมูล')
  await page.locator('[data-wa-action="cancel-back"]').click()
  assert.equal(calls('cancel_water_announcement').length, 0)
  await page.locator('[data-wa-action="cancel"]').click()
  await page.locator('[data-wa-action="cancel-confirm"]').click()
  await page.locator('[data-wa-idle]').waitFor({ timeout: 10_000 })
  assert.equal(calls('cancel_water_announcement').length, 1); assert.equal(calls('cancel_water_announcement')[0].body._announcement_id, ID_CURRENT)
  assert.match(await page.locator('[data-wa-notice="ok"]').innerText(), /ยกเลิกประกาศแล้ว — ประชาชนไม่เห็นประกาศนี้อีก/)
  await auditSection(page, `ยกเลิก ${width}px`)
  return 'ไม่ประกาศเรียก DB 1 ครั้ง · ยกเลิกต้องผ่านขั้นยืนยัน แล้วเรียก DB 1 ครั้ง'
}

async function checkRenew(page, auth, width) {
  await reloadPanel(page, auth, width, 'renew-approver')
  await page.locator('[data-wa-pending]').waitFor({ timeout: 10_000 })
  assert.ok(await page.locator('[data-wa-current]').count() === 1)
  assert.match(await page.locator('[data-wa-pending]').innerText(), /ร่างฉบับต่ออายุ — รอผู้มีสิทธิ์ยืนยัน/)
  await auditSection(page, `ต่ออายุ ${width}px`)
  return 'มีฉบับที่เผยแพร่อยู่และร่างต่ออายุพร้อมกัน แยกป้ายชัด'
}

async function checkStaffReadOnly(page, auth, width) {
  await reloadPanel(page, auth, width, 'pending-staff')
  await page.locator('[data-wa-pending]').waitFor({ timeout: 10_000 })
  assert.equal(await section(page).locator('[data-wa-action]').count(), 0, 'เจ้าหน้าที่ทั่วไปไม่มีปุ่มตัดสินเลย')
  assert.equal(await section(page).locator('button').count(), 0, 'ไม่มีปุ่มใดๆ ในส่วนนี้')
  assert.match(await page.locator('[data-wa-readonly]').innerText(), /เจ้าหน้าที่คนอื่นไม่ต้องทำอะไร/)
  assert.equal(await page.locator('[data-wa-you-approve]').count(), 0)
  assert.equal(await page.locator('[data-wa-admin]').count(), 0)
  await auditSection(page, `staff ${width}px`)
  await shot(page, '[data-wa-section]', `staff-readonly-${width}`)
  await reloadPanel(page, auth, width, 'no-approvers-staff')
  await page.locator('[data-wa-no-approvers]').waitFor({ timeout: 10_000 })
  assert.match(await page.locator('[data-wa-no-approvers]').innerText(), /แจ้งผู้ดูแลระบบของหน่วยงาน/)
  assert.equal(await page.locator('[data-wa-admin]').count(), 0)
  return 'อ่านอย่างเดียว ไม่มีปุ่ม · ยังไม่มีผู้ยืนยัน = บอกให้แจ้งผู้ดูแลระบบ · ไม่เห็นกล่องตั้งค่า'
}

async function checkStaleAndFailures(page, auth, width) {
  await reloadPanel(page, auth, width, 'stale-approver')
  await page.locator('[data-wa-draft-stale]').waitFor({ timeout: 10_000 })
  assert.equal(await section(page).locator('[data-wa-action]').count(), 0, 'ร่างเก่าเกิน 3 ชม. ไม่มีปุ่ม')
  assert.match(await page.locator('[data-wa-draft-stale]').innerText(), /เก่าเกิน 3 ชั่วโมง/)
  const reasons = { draft_too_old: /เก่าเกิน 3 ชั่วโมง/, event_closed: /เหตุการณ์นี้สิ้นสุดแล้ว/, already_handled: /ถูกจัดการไปแล้ว/, disabled: /ถูกปิดอยู่/ }
  for (const [reason, re] of Object.entries(reasons)) {
    await reloadPanel(page, auth, width, 'pending-approver')
    state.failApprove = reason
    await page.locator('[data-wa-action="approve"]').click()
    await page.locator('[data-wa-action="approve-confirm"]').click()
    await page.locator('[data-wa-notice="warn"]').waitFor({ timeout: 10_000 })
    assert.match(await page.locator('[data-wa-notice="warn"]').innerText(), re, reason)
    assert.equal(await page.locator('[data-wa-current]').count(), 0, `${reason}: ไม่ขึ้นว่าเผยแพร่แล้ว`)
    await auditSection(page, `${reason} ${width}px`)
  }
  return 'ร่างเก่า = ไม่มีปุ่ม · ผลที่ทำไม่ได้ 4 แบบ ขึ้นข้อความภาษาคน ไม่ขึ้นว่าเผยแพร่แล้ว'
}

async function checkAdminBox(page, auth, width) {
  await reloadPanel(page, auth, width, 'no-approvers-admin')
  await page.locator('[data-wa-no-approvers]').waitFor({ timeout: 10_000 })
  assert.match(await page.locator('[data-wa-no-approvers]').innerText(), /ตั้งได้ที่ด้านล่างของส่วนนี้/)
  assert.equal(await section(page).locator('[data-wa-action="approve"]').count(), 0, 'ผู้ดูแลระบบที่ไม่ใช่ผู้ยืนยันไม่มีปุ่มเผยแพร่')
  assert.equal(await page.locator('[data-wa-admin]').count(), 1)
  assert.equal(state.listApproversCalls, 0, 'ยังไม่เปิดกล่อง = ไม่โหลดรายชื่อ')
  await page.locator('[data-wa-admin] summary').click()
  await page.locator('[data-wa-person]').first().waitFor({ timeout: 10_000 })
  assert.equal(state.listApproversCalls, 1)
  assert.equal(await page.locator('[data-wa-person]').count(), 3)
  assert.match(await page.locator('[data-wa-approver-count]').innerText(), /ตอนนี้ 1 จาก 5 คน/)
  assert.match(await page.locator('[data-wa-admin]').innerText(), /ระบบไม่ตัดสินแทน/)
  // ตั้งคนที่ 1 → ช่องอ้างอิงอำนาจโผล่ → บันทึกข้อความ
  await page.locator('[data-wa-person="p1"] [data-wa-action="approver-on"]').click()
  await page.locator('[data-wa-person="p1"][data-wa-approver="true"]').waitFor({ timeout: 10_000 })
  const setCalls = calls('set_water_announcement_approver')
  assert.deepEqual({ p: setCalls[0].body._profile_id, on: setCalls[0].body._is_approver, muni: typeof setCalls[0].body._municipality_id }, { p: 'p1', on: true, muni: 'string' })
  assert.match(await page.locator('[data-wa-admin-notice="ok"]').innerText(), /ตั้ง นางสาวสมหญิง ใจดี เป็นผู้มีสิทธิ์ยืนยันแล้ว/)
  const note = page.locator('[data-wa-person="p1"] input[type="text"]')
  assert.equal(await page.locator('[data-wa-person="p1"] [data-wa-action="approver-note"]').isDisabled(), true, 'ยังไม่แก้ข้อความ = ปุ่มบันทึกกดไม่ได้')
  await note.fill('ตามคำสั่งหน่วยงาน ที่ 9/2569')
  await page.locator('[data-wa-person="p1"] [data-wa-action="approver-note"]').click()
  await page.waitForTimeout(500)
  const last = calls('set_water_announcement_approver').at(-1).body
  assert.deepEqual({ p: last._profile_id, on: last._is_approver, note: last._authority_note }, { p: 'p1', on: true, note: 'ตามคำสั่งหน่วยงาน ที่ 9/2569' })
  await auditSection(page, `admin box ${width}px`, { allowFields: true })
  await shot(page, '[data-wa-section]', `staff-admin-${width}`)
  // ถอนสิทธิ์
  await page.locator('[data-wa-person="p2"] [data-wa-action="approver-off"]').click()
  await page.locator('[data-wa-person="p2"][data-wa-approver="false"]').waitFor({ timeout: 10_000 })
  const off = calls('set_water_announcement_approver').at(-1).body
  assert.deepEqual({ p: off._profile_id, on: off._is_approver, note: off._authority_note }, { p: 'p2', on: false, note: null })
  // ครบ 5 คน: ปุ่มตั้งของคนที่เหลือต้องกดไม่ได้
  state.approvers = [1, 2, 3, 4, 5].map(i => ({ id: `q${i}`, name: `เจ้าหน้าที่ ${i}`, job_title: null, role: 'staff', is_approver: true, authority_note: null }))
    .concat([{ id: 'q6', name: 'เจ้าหน้าที่ 6', job_title: null, role: 'staff', is_approver: false, authority_note: null }])
  await reloadPanel(page, auth, width, 'admin-manage')
  state.approvers = [1, 2, 3, 4, 5].map(i => ({ id: `q${i}`, name: `เจ้าหน้าที่ ${i}`, job_title: null, role: 'staff', is_approver: true, authority_note: null }))
    .concat([{ id: 'q6', name: 'เจ้าหน้าที่ 6', job_title: null, role: 'staff', is_approver: false, authority_note: null }])
  await page.locator('[data-wa-admin] summary').click()
  await page.locator('[data-wa-person="q6"]').waitFor({ timeout: 10_000 })
  assert.equal(await page.locator('[data-wa-person="q6"] [data-wa-action="approver-on"]').isDisabled(), true, 'ครบ 5 คนแล้วตั้งเพิ่มไม่ได้')
  assert.match(await page.locator('[data-wa-admin]').innerText(), /ครบ 5 คนแล้ว/)
  return 'กล่องตั้งค่า: ไม่โหลดจนกว่าจะเปิด · ตั้ง/บันทึกข้อความ/ถอน เรียก DB ถูกต้อง · ครบ 5 คนปิดปุ่ม · ช่องกรอกช่องเดียวต่อคน สูง ≥ 44px'
}

async function checkHome(page, auth, width) {
  // ผู้ยืนยันที่มีร่าง → แถวขึ้น · กดแล้วเข้าหน้าเหตุการณ์
  reset('pending-approver'); state.todo = { can_approve: true, pending: true, drafted_at: iso(Date.now() - 20 * MIN) }
  await gotoStaff(page, auth, width)
  const row = page.locator('[data-home-work="water-events"]')
  await row.waitFor({ timeout: 20_000 })
  assert.match(await row.innerText(), /ประกาศน้ำ-ฝนรอคุณยืนยัน/); assert.match(await row.innerText(), /ยืนยันได้ภายใน 3 ชั่วโมง/)
  const h = await row.evaluate(e => e.getBoundingClientRect().height)
  assert.ok(h >= MIN_TAP, `แถวเตี้ย ${h}px`)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, true, 'หน้าแรกล้นจอ')
  await shot(page, '[data-home-todo]', `staff-home-${width}`)
  if (width >= 768) {
    await row.click()
    await page.locator('[data-wa-section]').waitFor({ timeout: 15_000 })
  }
  // ไม่ใช่ผู้ยืนยัน/ไม่มีร่าง → ไม่มีแถว
  for (const todo of [{ can_approve: false, pending: false }, { can_approve: true, pending: false }]) {
    reset('idle-approver'); state.todo = todo
    await gotoStaff(page, auth, width)
    await page.waitForTimeout(1500)
    assert.equal(await page.locator('[data-home-work="water-events"]').count(), 0, JSON.stringify(todo))
  }
  state.todo = { can_approve: false, pending: false }
  return 'แถว "ประกาศน้ำ-ฝนรอคุณยืนยัน" ขึ้นเฉพาะผู้ยืนยันที่มีร่าง · ไม่ใช่/ไม่มีร่าง = ไม่มีแถว'
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
    const writes = []
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)))
    page.on('request', req => {
      const url = req.url()
      if (/supabase\.co/.test(url) && ['PATCH', 'PUT', 'DELETE'].includes(req.method())) writes.push(`${req.method()} ${url}`)
      if (/\/rest\/v1\/(water_announcements|water_announcement_settings|water_announcement_approvers)(\?|\/|$)/.test(url)) writes.push(`อ่าน/เขียนตารางตรง ${url}`)
    })
    const auth = trackProfileResolution(page)
    await transferDemoSession(page)
    const run = async (label, fn) => {
      total += 1
      try { const note = await fn(); console.log(`PASS  ${label}${note ? ` — ${note}` : ''}`) } catch (error) {
        failed += 1
        console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${label} — ${String(error.message).split('\n').slice(0, 3).join(' | ')}`)
      }
    }
    const widths = process.env.WA_QUICK ? [390] : [1280, 390, 360, 768]
    for (const w of widths) {
      await run(`${w}px ไม่เปิดใช้/ไม่มีสิทธิ์/ฟังก์ชันไม่พร้อม/พัง`, () => checkHidden(page, auth, w))
      await run(`${w}px ไม่มีร่าง (ผู้ยืนยัน)`, () => checkIdle(page, auth, w))
      await run(`${w}px ร่างรอยืนยัน → ยืนยันซ้ำ → เผยแพร่`, () => checkApproveFlow(page, auth, w))
      if (w === 390 || w === 1280) {
        await run(`${w}px ไม่ประกาศ + ยกเลิก`, () => checkDeclineCancel(page, auth, w))
        await run(`${w}px ร่างต่ออายุ`, () => checkRenew(page, auth, w))
        await run(`${w}px เจ้าหน้าที่ทั่วไป อ่านอย่างเดียว`, () => checkStaffReadOnly(page, auth, w))
        await run(`${w}px ร่างเก่า + ผลที่ทำไม่ได้`, () => checkStaleAndFailures(page, auth, w))
        await run(`${w}px กล่องตั้งค่าผู้ยืนยัน (admin)`, () => checkAdminBox(page, auth, w))
        await run(`${w}px หน้าแรก: ต้องทำตอนนี้`, () => checkHome(page, auth, w))
      }
    }
    total += 1
    if (errors.length) { failed += 1; console.log(`FAIL  JS error ${errors.length} รายการ: ${errors.slice(0, 3).join(' | ')}`) } else console.log('PASS  ไม่มี JS error ตลอดการทดสอบ')
    total += 1
    if (writes.length) { failed += 1; console.log(`FAIL  พบคำขอเขียน/อ่านตารางตรง: ${writes.slice(0, 3).join(' | ')}`) } else console.log('PASS  ไม่มีคำขอเขียน (PATCH/PUT/DELETE) และไม่อ่านตารางประกาศตรง')
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
