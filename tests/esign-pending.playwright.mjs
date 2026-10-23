// "ใบรอลงนามของฉัน" (ชุด S3b) — การ์ดบนหน้าแรกเจ้าหน้าที่ · แถบบนหน้าการใช้รถ · เตือนไม่บล็อกตอนบันทึกออกเดินทาง — ทดสอบในเบราว์เซอร์จริง
//
// ใช้ "ฐานข้อมูลจำลอง" แบบเดียวกับ tests/esign-trip-panel.playwright.mjs: ดักเฉพาะ RPC ลงนามออนไลน์ + รายการทริปที่กำลังดำเนินอยู่ + PATCH ของทริป
// จึงไม่เขียนข้อมูลอะไรของสนามซ้อม (ล็อกอิน/หน้า/ข้อมูลอื่นเป็นของจริง) · ความถูกต้องของ esign_my_pending ฝั่ง DB ดู tests/esign-db.test.mjs (PGlite)
// ไม่กด "ออกจากระบบ" (signOut ออกทุกอุปกรณ์)
//
// ตรวจ:
//   - หน้าแรก: การ์ดขึ้นเมื่อมีใบรอ (ข้อความ/ปุ่ม อนุมัติ vs ลงนาม/จำนวน) · ไม่มีใบรอ = ไม่มีการ์ด · แสดง 5 ใบแรกพร้อมบอกว่าเหลือ
//   - ดึงพลาดต้องเตือน ไม่ขึ้นไฟเขียว "ไม่มีงานค้าง" + ลองใหม่ได้
//   - ลงนามจากการ์ดโดยไม่เปิดทริป: ส่งช่อง/ภาพ/approve ถูก · แถวหาย · ข้อความ "ลงนามแล้ว" ยังอยู่หลังใบสุดท้าย · คนถือหลายช่อง ช่องถัดไปโผล่หลังลงช่องแรก
//   - แถบหน้าการใช้รถ: ครบทุกใบ · ลงนามแล้วโหลดรายการทริปใหม่ · ไม่มีใบรอ = ไม่มีแถบ
//   - ออกรถ: ทริปออนไลน์ที่ผู้มีอำนาจยังไม่ลงนาม = มีกรอบเตือน แต่ยังออกได้ (PATCH ไป) · ลงนามแล้ว/เซ็นสด = ไม่เตือน (เซ็นสดไม่ยิง RPC ลงนาม)
//   - เค้าโครงมือถือ 390/360 ไม่ล้น ปุ่ม ≥ 44px
//
//   ES_TEST_BASE_URL=http://demo.localhost:5176 node tests/esign-pending.playwright.mjs
//   ES_ONLY=ออกรถ,มือถือ  รันเฉพาะชุดที่ชื่อมีคำนี้ · ES_SHOTS=<โฟลเดอร์>  ถ่ายภาพหน้าจอ · ES_PROFILE=TEST-fleet-admin (ค่าเริ่มต้น)
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const PROFILE_ROOT = process.env.ES_PROFILE_ROOT || path.join(process.cwd(), '.chrome-test-profiles')
const BASE = (process.env.ES_TEST_BASE_URL || 'http://demo.localhost:5174').replace(/\/$/, '')
const PROFILE = process.env.ES_PROFILE || 'TEST-fleet-admin'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'demo.localhost', 'localhost', '127.0.0.1'])
const DEMO_MUNICIPALITY = 'adff0caf-aed5-4469-9c2a-899643a5cf9a'
const MIN_TAP = 44
const RPC_NAMES = ['esign_my_pending', 'esign_trip_status', 'esign_sign_fleet_trip_stamped', 'esign_my_signer_overview', 'esign_my_signatures',
  'fleet_vehicle_last_odometer', 'fleet_vehicle_odometer_gaps']
const SLOT_LABEL = { requester: 'ผู้ขออนุญาต', dept_head: 'ผู้อำนวยการสำนัก/กอง หรือผู้แทน', authority: 'ผู้มีอำนาจสั่งใช้ยานพาหนะ' }
const PIN = '246810'
const TRIP_ID = n => `00000000-0000-4000-8000-0000000a01${String(n).padStart(2, '0')}`
const ONLINE_TRIP_ID = TRIP_ID(90)
const WET_TRIP_ID = TRIP_ID(91)
const ONLINE_DEST = 'ทดสอบออกรถลงนามออนไลน์ ศาลากลางจังหวัดแพร่'
const WET_DEST = 'ทดสอบออกรถเซ็นสด ที่ว่าการอำเภอเมือง'

if (!ALLOWED_HOSTS.has(new URL(BASE).hostname)) throw new BlockedError(`ปฏิเสธการยิงไปที่ ${new URL(BASE).hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)

// ── PNG ทดสอบ ────────────────────────────────────────────────────────────────────────────────────
const crcChunk = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}
function encodePng(width, height, pixel) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x++) row.set(pixel(x, y), 1 + x * 4)
    rows.push(row)
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crcChunk('IHDR', ihdr), crcChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), crcChunk('IEND', Buffer.alloc(0))])
}
const imageItem = (n, isDefault) => ({
  id: `00000000-0000-4000-8000-00000000030${n}`, label: `แบบที่ ${n}`, is_default: isDefault, created_at: '2026-10-2' + n + 'T03:00:00Z', width: 40, height: 16,
  png_base64: encodePng(40, 16, (x, y) => [(x * 7 + n * 31) & 255, (y * 13 + n * 17) & 255, n & 255, 255]).toString('base64'),
})

// ── ข้อมูลจำลอง ──────────────────────────────────────────────────────────────────────────────────
// ใบรอลงนามหนึ่งแถวตามรูปของ esign_my_pending (ชื่อฟิลด์เทียบกับ SQL แล้วใน tests/esign-lib.test.mjs)
const pendingItem = (n, slot = 'authority') => ({
  trip_id: TRIP_ID(n), slot, slot_label: SLOT_LABEL[slot], decision: slot === 'authority' ? 'approve' : 'sign', trip_status: 'approved',
  requester_name: 'สมหญิง ผู้ขอ', vehicle_name: '[TEST] กระบะลงนามออนไลน์', destination: `ทดสอบใบรอลงนาม ${n}`, purpose: 'ประชุมทดสอบใบรอลงนาม',
  planned_departure: `2026-11-0${(n % 8) + 1}T02:00:00+00:00`,
})

const fabricateTrip = (id, destination, esignSlots) => ({
  id, municipality_id: DEMO_MUNICIPALITY, vehicle_id: '00000000-0000-4000-8000-0000000b0001', department_id: null, driver_id: null, status: 'approved',
  requested_by: '00000000-0000-4000-8000-0000000c0001', created_by: '00000000-0000-4000-8000-0000000c0001', requester_position: 'นักวิชาการศึกษา',
  destination, destination_locality: 'อำเภอเมือง', destination_province: 'แพร่', purpose: 'ประชุมทดสอบเตือนตอนออกรถ', passengers: 2,
  planned_departure: '2026-11-03T02:00:00+00:00', planned_return: '2026-11-03T09:00:00+00:00', document_date: '2026-10-30', trip_date: '2026-11-03',
  created_at: '2026-10-23T03:00:00+00:00', started_at: null, returned_at: null, odometer_start: null, odometer_end: null, distance_km: null,
  approved_by: null, approved_at: null, approval_method: 'auto_queue', notes: null, waitlist_reasons: [], reject_reason: null, backdated_reason: null,
  dept_head_department_id: null, order_authority_role: null, order_authority_label: null,
  esign_slots: esignSlots, esign_verify_code: esignSlots ? 'a'.repeat(32) : null,
  vehicle: { id: '00000000-0000-4000-8000-0000000b0001', name: '[TEST] กระบะลงนามออนไลน์', license_plate: 'ทด 1234', asset_code: null, asset_kind: 'vehicle', meter_unit: 'km' },
  driver: null,
  requester: { id: '00000000-0000-4000-8000-0000000c0001', full_name: 'สมหญิง ผู้ขอ', job_title: 'นักวิชาการศึกษา', position: null },
  creator: { id: '00000000-0000-4000-8000-0000000c0001', full_name: 'สมหญิง ผู้ขอ' },
  approver: null, departments: { name: 'กองการศึกษา', short_name: 'ศึกษา' },
})

// สถานะทริปตามรูปของ esign_trip_status — signed = ช่องที่ลงนามแล้ว
function tripStatus(signed = {}) {
  const slots = ['requester', 'dept_head', 'authority', 'sk1'].map(slot => ({
    slot, label: SLOT_LABEL[slot] ?? 'ผู้บริหารท้องถิ่น (บันทึกรับรอง สก.๑)', mode: slot === 'sk1' ? 'wet' : 'online', applicable: slot !== 'sk1', signed: Boolean(signed[slot]),
    waiting_for_previous: false, can_sign: false, can_revoke: false, blocked: null, expected_name: slot === 'authority' ? 'สมศักดิ์ นายก' : null,
    signature: signed[slot] ? { signer_name: 'ผู้ลงนาม', signer_position: 'ตำแหน่ง', signed_as: '', decision: 'sign', signed_at: '2026-10-23T04:00:00Z', content_matches: true, mine: false, with_image: false } : null,
  }))
  const done = Object.values(signed).filter(Boolean).length
  return { found: true, mode: 'online', verify_code: 'a'.repeat(32), trip_status: 'approved', slots, required: 3, signed_count: done, complete: done === 3, integrity: done ? 'ok' : 'none', locked: done > 0, can_revoke_all: false }
}

function makeBackend({ items = [], library = [], pendingMode = 'ok', statusSigned = {} } = {}) {
  const state = {
    items: [...items], library: [...library], pendingMode, statusSigned, pin: PIN, calls: [], tripReads: 0, tripPatches: [], afterSign: {},
    trips: [fabricateTrip(ONLINE_TRIP_ID, ONLINE_DEST, { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' }), fabricateTrip(WET_TRIP_ID, WET_DEST, null)],
  }
  const handlers = {
    esign_my_pending: () => (state.pendingMode === 'fail' ? { ok: false, code: 'error' } : { ok: true, count: state.items.length, items: state.items }),
    esign_trip_status: () => tripStatus(state.statusSigned),
    esign_my_signer_overview: () => ({
      ok: true, pin_set: true, pin_set_at: '2026-10-20T03:00:00Z', duty_acked: true, suspended: false, suspended_at: null, locked_until: null, failed_count: 0,
      image_count: state.library.length, signature_count: 0, signature_count_month: 0,
    }),
    esign_my_signatures: () => ({ ok: true, max: 5, items: state.library }),
    esign_sign_fleet_trip_stamped: args => {
      if (args.p_pin !== state.pin) return { ok: false, code: 'bad_pin', remaining: 4 }
      const key = `${args.p_trip_id}:${args.p_slot}`
      state.items = state.items.filter(item => `${item.trip_id}:${item.slot}` !== key)
      // คนถือหลายช่องในทริปเดียว: ลงช่องแรกแล้วช่องถัดไปถึงคิว (DB คำนวณใหม่ตอนเรียก esign_my_pending)
      for (const next of state.afterSign[key] ?? []) state.items.push(next)
      return { ok: true, already: false, signature_id: `sig-${key}`, signed_at: '2026-10-23T04:00:00Z', complete: false, stamped: Boolean(args.p_image_id) }
    },
    fleet_vehicle_last_odometer: () => [],
    fleet_vehicle_odometer_gaps: () => [],
  }
  state.handle = (name, args) => {
    state.calls.push({ name, args })
    return handlers[name](args)
  }
  return state
}

const corsFor = request => ({
  'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
  'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'content-range',
})

async function installBackend(context, backend) {
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  const rpcPattern = new RegExp(`/rest/v1/rpc/(${RPC_NAMES.join('|')})(\\?|$)`)
  await context.route(rpcPattern, async route => {
    const request = route.request()
    const cors = corsFor(request)
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    const body = backend.handle(rpcPattern.exec(request.url())[1], request.postDataJSON() ?? {})
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
  })
  // แจ้งเตือน Telegram ตอนออกรถ — ห้ามยิงจริง (ทริปจำลองไม่มีในฐานข้อมูล)
  await context.route(/\/functions\/v1\/notify-telegram/, async route => {
    const cors = corsFor(route.request())
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ skipped: true, reason: 'test' }) })
  })
  await context.route(/\/rest\/v1\/fleet_trips\?/, async route => {
    const request = route.request()
    const cors = corsFor(request)
    const url = decodeURIComponent(request.url())
    const method = request.method()
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    if (method === 'GET' && url.includes('select=*,vehicle:') && url.includes('status=in.(pending,waitlisted,approved,in_progress)')) {
      backend.tripReads += 1
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': `0-${backend.trips.length - 1}/${backend.trips.length}` }, body: JSON.stringify(backend.trips) })
      return
    }
    if (method === 'PATCH') {
      // ออกเดินทาง: บันทึกว่าส่งอะไรไป แล้วตอบเหมือนอัปเดตสำเร็จ (ไม่แตะข้อมูลจริง)
      const id = /id=eq\.([0-9a-f-]+)/.exec(url)?.[1]
      backend.tripPatches.push({ id, body: request.postDataJSON() })
      await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ id }]) })
      return
    }
    await route.fallback()
  })
}

// ── เบราว์เซอร์/เซสชัน ────────────────────────────────────────────────────────────────────────────
async function transferDemoSession(page) {
  if (!/^https?:\/\/(demo\.localhost|localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await safeEvaluate(page, () => Object.entries(localStorage).filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'), undefined, [])
  if (!entries.find(([key]) => key.endsWith('-auth-token'))) throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  await page.addInitScript(pairs => { for (const [key, value] of pairs) { try { localStorage.setItem(key, value) } catch { /* ไม่มีโควตา */ } } }, entries)
}

async function withProfile(name, fn) {
  const dir = path.join(PROFILE_ROOT, name)
  try { await access(dir) } catch { throw new BlockedError(`ไม่พบโปรไฟล์ ${name}`) }
  let context
  try {
    context = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: !process.argv.includes('--headed'), viewport: { width: 1280, height: 900 } })
  } catch { throw new BlockedError(`เปิด ${name} ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`) }
  try {
    const page = context.pages()[0] || await context.newPage()
    const auth = trackProfileResolution(page)
    await transferDemoSession(page)
    return await fn(page, auth, context)
  } finally { await context.close().catch(() => {}) }
}

const dialogs = []
let phoneModalSkipped = false
// กล่อง "เพิ่มเบอร์มือถือ" เด้งทับหลังโหลดหน้า ~5 วิ — รอบแรกรอให้เด้งแล้วกดข้าม (จำใน sessionStorage) รอบหลังไม่ต้องรอ
const skipPhoneModal = async page => {
  await page.getByRole('button', { name: 'ข้ามไปก่อน' }).first().click({ timeout: phoneModalSkipped ? 800 : 9_000 }).catch(() => {})
  phoneModalSkipped = true
}

async function openHome(page, auth) {
  await page.goto('about:blank')
  await page.goto(`${BASE}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== '/staff') throw new BlockedError(`ถูกพาออกจาก /staff ไปที่ ${new URL(page.url()).pathname}`)
  await skipPhoneModal(page)
  await page.locator('h1', { hasText: 'แดชบอร์ดสำหรับเจ้าหน้าที่' }).first().waitFor({ timeout: 25_000 })
}

const tripCell = (page, destination) => page.getByText(destination).and(page.locator(':visible')).first()
async function openFleetTrips(page, auth) {
  await page.goto('about:blank')
  await page.goto(`${BASE}/fleet`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== '/fleet') throw new BlockedError(`ถูกพาออกจาก /fleet ไปที่ ${new URL(page.url()).pathname}`)
  await skipPhoneModal(page)
  const tab = page.locator('button:visible', { hasText: /^s*การใช้รถ/ }).first() // เดสก์ท็อป = แท็บ · มือถือ = ไทล์ที่มีคำอธิบายต่อท้าย
  await tab.waitFor({ timeout: 25_000 }).catch(() => { throw new BlockedError('ไม่พบแท็บ "การใช้รถ"') })
  await tab.click()
  await tripCell(page, ONLINE_DEST).waitFor({ timeout: 20_000 })
}

const card = page => page.locator('[data-pending-sign="home"]')
// หน้ายานพาหนะเรนเดอร์เนื้อหาสองชุด (มือถือ/เดสก์ท็อป ซ่อนด้วย CSS) — นับเฉพาะชุดที่มองเห็น
const banner = page => page.locator('[data-pending-sign="banner"]:visible')
const rows = scope => scope.locator('[data-pending-sign-row]')
const pendingCalls = backend => backend.calls.filter(call => call.name === 'esign_my_pending')
const lastSign = backend => backend.calls.filter(call => call.name === 'esign_sign_fleet_trip_stamped').at(-1)

async function openSignDialog(page, scope) {
  await scope.locator('[data-pending-sign-button]').first().click()
  await page.locator('[data-sign-dialog]').waitFor()
  await page.locator('[data-sign-summary]').waitFor()
  await page.locator('[data-sign-pin]').waitFor({ timeout: 10_000 })
}
const enterPin = (page, pin) => page.locator('[data-sign-pin]').fill(pin)

const noOverflow = async (page, where) => {
  const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
  assert.ok(m.scrollW <= m.clientW + 1, `${where}: เลื่อนแนวนอน (${m.scrollW} > ${m.clientW})`)
}
const tapSize = async (locator, where) => {
  const box = await locator.boundingBox()
  assert.ok(box, `${where}: ไม่พบปุ่ม`)
  assert.ok(box.height >= MIN_TAP - 0.5, `${where}: ปุ่มเตี้ยกว่า ${MIN_TAP}px (${Math.round(box.width)}×${Math.round(box.height)})`)
}

// ── ตรวจ: หน้าแรก ────────────────────────────────────────────────────────────────────────────────
async function checkHomeCard(page, auth, context) {
  const backend = makeBackend({ items: [pendingItem(1, 'authority'), pendingItem(2, 'dept_head')] })
  await installBackend(context, backend)
  await openHome(page, auth)
  await card(page).waitFor({ timeout: 20_000 })
  assert.equal(await rows(card(page)).count(), 2)
  assert.equal((await card(page).locator('[data-pending-sign-count]').innerText()).replace(/\s+/g, ' ').trim().startsWith('2'), true, 'ป้ายจำนวนต้องเป็น 2')
  const text = await card(page).innerText()
  for (const expected of ['รอลงนามของฉัน', 'สมหญิง ผู้ขอ ขอใช้รถไป ทดสอบใบรอลงนาม 1', 'ช่องที่รอคุณ: ผู้มีอำนาจสั่งใช้ยานพาหนะ', 'ช่องที่รอคุณ: ผู้อำนวยการสำนัก/กอง หรือผู้แทน', '[TEST] กระบะลงนามออนไลน์']) {
    assert.ok(text.includes(expected), `การ์ดไม่มี "${expected}"`)
  }
  assert.equal((await rows(card(page)).nth(0).locator('[data-pending-sign-button]').innerText()).trim(), 'อนุมัติ (ลงนาม)', 'ช่องผู้มีอำนาจคืออนุมัติ')
  assert.equal((await rows(card(page)).nth(1).locator('[data-pending-sign-button]').innerText()).trim(), 'ลงนาม')
  assert.equal(await page.locator('[data-home-clear]').count(), 0, 'มีใบรอลงนามอยู่ ต้องไม่ขึ้นไฟเขียว "ไม่มีงานค้าง"')
  assert.ok(await card(page).evaluate(element => Boolean(element.closest('[data-home-todo]'))), 'การ์ดต้องอยู่ในส่วน "ต้องทำตอนนี้"')
  assert.deepEqual(pendingCalls(backend)[0].args, {}, 'esign_my_pending ไม่รับอาร์กิวเมนต์ — ห้ามส่ง p_muni')
  return 'การ์ด 2 ใบ ข้อความ/ปุ่มถูกช่อง · ไม่ขึ้นไฟเขียว · ไม่ส่ง p_muni'
}

async function checkHomeEmpty(page, auth, context) {
  const backend = makeBackend({ items: [] })
  await installBackend(context, backend)
  await openHome(page, auth)
  await page.waitForTimeout(2_500)
  assert.ok(pendingCalls(backend).length >= 1, 'หน้าแรกต้องถาม esign_my_pending')
  assert.equal(await card(page).count(), 0, 'ไม่มีใบรอ ต้องไม่มีการ์ด')
  assert.equal(await page.locator('[data-pending-sign-error]').count(), 0)
  return 'ไม่มีใบรอ = ไม่มีการ์ด ไม่มีข้อความเตือน'
}

async function checkHomeLimit(page, auth, context) {
  const backend = makeBackend({ items: [1, 2, 3, 4, 5, 6, 7].map(n => pendingItem(n, 'dept_head')) })
  await installBackend(context, backend)
  await openHome(page, auth)
  await card(page).waitFor({ timeout: 20_000 })
  assert.equal(await rows(card(page)).count(), 5, 'หน้าแรกแสดงสูงสุด 5 ใบ')
  const more = await card(page).locator('[data-pending-sign-more]').innerText()
  assert.ok(more.includes('แสดง 5 จาก 7 ใบ') && more.includes('การใช้รถ'), more)
  assert.ok((await card(page).locator('[data-pending-sign-count]').innerText()).trim().startsWith('7'), 'ป้ายจำนวนต้องนับทั้งหมด ไม่ใช่เฉพาะที่แสดง')
  return 'แสดง 5 จาก 7 พร้อมบอกว่าที่เหลืออยู่ที่ไหน'
}

async function checkHomeError(page, auth, context) {
  const backend = makeBackend({ items: [pendingItem(1, 'authority')], pendingMode: 'fail' })
  await installBackend(context, backend)
  await openHome(page, auth)
  await page.locator('[data-pending-sign-error]').waitFor({ timeout: 20_000 })
  assert.ok((await page.locator('[data-pending-sign-error]').innerText()).includes('อาจมีใบที่รอคุณอยู่'))
  await page.waitForTimeout(800)
  assert.equal(await page.locator('[data-home-clear]').count(), 0, 'ดึงใบรอลงนามพลาดต้องไม่ขึ้นไฟเขียว "ไม่มีงานค้าง"')
  // ลองใหม่: ดึงสำเร็จแล้วการ์ดขึ้น เตือนหาย
  backend.pendingMode = 'ok'
  const before = pendingCalls(backend).length
  await page.locator('[data-pending-sign-error] button', { hasText: 'ลองใหม่' }).click()
  await card(page).waitFor({ timeout: 10_000 })
  assert.ok(pendingCalls(backend).length > before, 'ปุ่มลองใหม่ต้องยิงดึงใหม่')
  assert.equal(await page.locator('[data-pending-sign-error]').count(), 0)
  return 'ดึงพลาด = เตือน ไม่ขึ้นไฟเขียว · ลองใหม่แล้วการ์ดขึ้น'
}

async function checkHomeSign(page, auth, context) {
  const backend = makeBackend({ items: [pendingItem(1, 'authority')], library: [imageItem(1, true)] })
  await installBackend(context, backend)
  await openHome(page, auth)
  await card(page).waitFor({ timeout: 20_000 })
  // ลงนามจากการ์ดโดยไม่เปิดทริป: กล่องลงนามมีสรุปของใบนั้น · แนบภาพค่าเริ่มต้นให้เอง
  await openSignDialog(page, card(page))
  const summary = await page.locator('[data-sign-summary]').innerText()
  for (const expected of ['ทดสอบใบรอลงนาม 1', 'ประชุมทดสอบใบรอลงนาม', 'สมหญิง ผู้ขอ', '[TEST] กระบะลงนามออนไลน์']) assert.ok(summary.includes(expected), `สรุปไม่มี "${expected}"`)
  assert.ok((await page.locator('#sign-trip-title').innerText()).startsWith('อนุมัติ:'), 'ช่องผู้มีอำนาจ = หัวกล่อง "อนุมัติ"')
  assert.equal(await page.locator('[data-sign-attach]').isChecked(), true)
  await enterPin(page, PIN)
  const before = pendingCalls(backend).length
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.deepEqual(lastSign(backend).args, { p_trip_id: TRIP_ID(1), p_slot: 'authority', p_pin: PIN, p_decision: 'approve', p_image_id: imageItem(1, true).id, p_png_base64: null })
  // ลงนามเสร็จ: ดึงรายการใหม่ · แถวหาย · ข้อความ "อนุมัติแล้ว" ยังอยู่แม้เป็นใบสุดท้าย (ส่วน "ต้องทำตอนนี้" ไม่หายทั้งก้อน)
  await page.locator('[data-pending-sign-notice]').waitFor({ timeout: 10_000 })
  const notice = await page.locator('[data-pending-sign-notice]').innerText()
  assert.ok(notice.includes('อนุมัติแล้ว') && notice.includes('แนบภาพลายเซ็น'), notice)
  assert.ok(pendingCalls(backend).length > before, 'ลงนามแล้วต้องดึงรายการใหม่')
  assert.equal(await rows(card(page)).count(), 0, 'ลงนามแล้วแถวต้องหาย')
  assert.equal(await page.locator('[data-home-todo]').count(), 1)
  return 'ลงนามจากการ์ด: ส่งช่อง/approve/ภาพถูก · แถวหาย · ข้อความอยู่ต่อ'
}

async function checkHomeChain(page, auth, context) {
  // คนเดียวถือสองช่องในทริปเดียว (ผอ.กอง + ผู้มีอำนาจ): ลงช่องแรกแล้วช่องที่สองถึงคิว ต้องโผล่ในการ์ดเดิม
  const backend = makeBackend({ items: [pendingItem(5, 'dept_head')] })
  backend.afterSign[`${TRIP_ID(5)}:dept_head`] = [pendingItem(5, 'authority')]
  await installBackend(context, backend)
  await openHome(page, auth)
  await card(page).waitFor({ timeout: 20_000 })
  await openSignDialog(page, card(page))
  assert.equal(await page.locator('[data-sign-attach]').count() ? await page.locator('[data-sign-attach]').isChecked() : false, false, 'ไม่มีภาพในคลังต้องไม่ติ๊กแนบ')
  await enterPin(page, PIN)
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.deepEqual(lastSign(backend).args, { p_trip_id: TRIP_ID(5), p_slot: 'dept_head', p_pin: PIN, p_decision: null, p_image_id: null, p_png_base64: null })
  await page.locator('[data-pending-sign-row][data-slot="authority"]').waitFor({ timeout: 10_000 })
  assert.equal(await rows(card(page)).count(), 1)
  assert.equal(await page.locator('[data-pending-sign-row][data-slot="dept_head"]').count(), 0)
  return 'ลงช่องแรกแล้วช่องถัดไปของคนเดิมโผล่ในการ์ดเดิม'
}

// ── ตรวจ: หน้าการใช้รถ ────────────────────────────────────────────────────────────────────────────
async function checkFleetBanner(page, auth, context) {
  const backend = makeBackend({ items: [1, 2, 3, 4, 5, 6, 7].map(n => pendingItem(n, 'dept_head')), library: [] })
  await installBackend(context, backend)
  await openFleetTrips(page, auth)
  await banner(page).waitFor({ timeout: 15_000 })
  assert.equal(await rows(banner(page)).count(), 7, 'แถบหน้าการใช้รถแสดงครบทุกใบ (ไม่จำกัด 5)')
  // หน้านี้เรนเดอร์เนื้อหาสองชุดพร้อมกัน (มือถือ/เดสก์ท็อป) — ต้องแชร์คำขอเดียว ไม่ยิง esign_my_pending สองรอบ
  assert.equal(pendingCalls(backend).length, 1, `ต้องยิง esign_my_pending รอบเดียวตอนเปิดหน้า (ยิง ${pendingCalls(backend).length})`)
  assert.equal(await banner(page).locator('[data-pending-sign-more]').count(), 0)
  // แถบอยู่เหนือปุ่ม "ขออนุญาตใช้รถ" และรายการทริป
  const order = await page.evaluate(() => {
    const bannerEl = document.querySelector('[data-pending-sign="banner"]')
    const request = [...document.querySelectorAll('button')].find(button => button.textContent.includes('ขออนุญาตใช้รถ') && button.offsetParent)
    return { bannerY: bannerEl.getBoundingClientRect().top, requestY: request ? request.getBoundingClientRect().top : null }
  })
  assert.ok(order.requestY === null || order.bannerY < order.requestY, `แถบต้องอยู่บนสุด ${JSON.stringify(order)}`)
  // ลงนามจากแถบ (ไม่เปิดทริป) แล้วรายการทริปโหลดใหม่ · แถบเหลือ 6
  const reads = backend.tripReads
  await openSignDialog(page, banner(page))
  await enterPin(page, PIN)
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  await page.waitForFunction(() => [...document.querySelectorAll('[data-pending-sign="banner"] [data-pending-sign-row]')].filter(element => element.offsetParent !== null).length === 6, null, { timeout: 10_000 })
    .catch(async () => {
      const left = await rows(banner(page)).count()
      throw new Error(`แถบยังมี ${left} ใบ (ควร 6) · RPC ที่ยิง: ${backend.calls.map(call => call.name).join(',')} · ผลดึงล่าสุดมี ${backend.items.length} ใบ`)
    })
  assert.equal(lastSign(backend).args.p_trip_id, TRIP_ID(1))
  assert.ok(backend.tripReads > reads, 'ลงนามจากแถบแล้วต้องโหลดรายการทริปใหม่')
  assert.equal(await page.locator('[data-trip-esign]').count(), 0, 'ลงนามจากแถบต้องไม่เปิดรายละเอียดทริป')
  return 'แถบครบ 7 ใบ อยู่บนสุด · ลงนามแล้วเหลือ 6 + โหลดทริปใหม่'
}

async function checkFleetNoBanner(page, auth, context) {
  const backend = makeBackend({ items: [] })
  await installBackend(context, backend)
  await openFleetTrips(page, auth)
  await page.waitForTimeout(2_000)
  assert.ok(pendingCalls(backend).length >= 1)
  assert.equal(await banner(page).count(), 0, 'ไม่มีใบรอ ต้องไม่มีแถบ')
  return 'ไม่มีใบรอ = ไม่มีแถบ'
}

// ── ตรวจ: ออกรถ ──────────────────────────────────────────────────────────────────────────────────
async function openDepart(page, destination) {
  const row = page.locator('tr:visible', { hasText: destination }).first()
  await row.locator('button', { hasText: '🚀' }).click()
  await page.getByText('บันทึกออกเดินทาง').first().waitFor({ timeout: 10_000 })
}
const submitDepart = async page => {
  await page.locator('input[type="number"]:visible').first().fill('12345')
  await page.getByRole('button', { name: 'ยืนยันออกเดินทาง' }).click()
}

async function checkDepartWarning(page, auth, context) {
  const backend = makeBackend({ items: [], statusSigned: { requester: true, dept_head: true } })
  await installBackend(context, backend)
  await openFleetTrips(page, auth)
  await openDepart(page, ONLINE_DEST)
  await page.locator('[data-depart-esign-warning]').waitFor({ timeout: 10_000 })
  const warning = await page.locator('[data-depart-esign-warning]').innerText()
  for (const expected of ['ลงนามออนไลน์ยังไม่ครบ', 'ยังขาด: ผู้มีอำนาจสั่งใช้ยานพาหนะ', 'รอ สมศักดิ์ นายก ลงนาม', 'ไม่บล็อก']) assert.ok(warning.includes(expected), `คำเตือนไม่มี "${expected}"`)
  // เตือนแล้วต้องออกรถได้: PATCH ไปที่ทริปนี้จริง สถานะ in_progress
  await submitDepart(page)
  await page.waitForFunction(() => !document.body.innerText.includes('ยืนยันออกเดินทาง'), null, { timeout: 10_000 })
  assert.equal(backend.tripPatches.length, 1, `ต้อง PATCH ทริป 1 ครั้ง (ได้ ${backend.tripPatches.length})`)
  assert.equal(backend.tripPatches[0].id, ONLINE_TRIP_ID)
  assert.equal(backend.tripPatches[0].body.status, 'in_progress')
  assert.deepEqual(dialogs.filter(d => d.type === 'alert'), [], 'ออกรถต้องไม่มี alert')
  return 'ผู้มีอำนาจยังไม่ลงนาม = มีกรอบเตือน แต่ออกรถได้ (PATCH in_progress)'
}

async function checkDepartNoWarning(page, auth, context) {
  // ผู้มีอำนาจลงนามครบแล้ว → ไม่เตือน
  const signedAll = makeBackend({ items: [], statusSigned: { requester: true, dept_head: true, authority: true } })
  await installBackend(context, signedAll)
  await openFleetTrips(page, auth)
  await openDepart(page, ONLINE_DEST)
  await page.waitForFunction(count => count > 0, signedAll.calls.filter(call => call.name === 'esign_trip_status').length).catch(() => {})
  await page.waitForTimeout(1_500)
  assert.ok(signedAll.calls.some(call => call.name === 'esign_trip_status'), 'ทริปโหมดออนไลน์ต้องอ่านสถานะลงนาม')
  assert.equal(await page.locator('[data-depart-esign-warning]').count(), 0, 'ลงนามครบแล้วต้องไม่เตือน')
  // ทริปเซ็นสด → ไม่เตือน และไม่ยิง RPC ลงนามเลย
  const wet = makeBackend({ items: [] })
  await installBackend(context, wet)
  await openFleetTrips(page, auth)
  await openDepart(page, WET_DEST)
  await page.waitForTimeout(1_500)
  assert.equal(await page.locator('[data-depart-esign-warning]').count(), 0)
  assert.equal(wet.calls.filter(call => call.name === 'esign_trip_status').length, 0, 'ทริปเซ็นสดต้องไม่อ่านสถานะลงนาม')
  return 'ลงนามครบ = ไม่เตือน · ทริปเซ็นสด = ไม่เตือนและไม่ยิง RPC ลงนาม'
}

// ── ตรวจ: มือถือ ─────────────────────────────────────────────────────────────────────────────────
async function checkMobile(page, auth, context, width, height) {
  await page.setViewportSize({ width, height })
  try {
    const backend = makeBackend({ items: [pendingItem(1, 'authority'), pendingItem(2, 'dept_head'), pendingItem(3, 'requester')], library: [imageItem(1, true)] })
    await installBackend(context, backend)
    await openHome(page, auth)
    await card(page).waitFor({ timeout: 20_000 })
    await noOverflow(page, `${width}px หน้าแรก`)
    for (const button of await card(page).locator('[data-pending-sign-button]').all()) await tapSize(button, `${width}px ปุ่มในการ์ด`)
    if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `home-${width}.png`) })
    // กล่องลงนามเปิดจากการ์ด: อยู่ในจอ ปุ่มลงนามไม่ถูกบัง (แถบเมนูล่างของมือถือ)
    await openSignDialog(page, card(page))
    await noOverflow(page, `${width}px กล่องลงนาม`)
    const covered = await page.locator('[data-sign-submit]').evaluate(button => {
      const r = button.getBoundingClientRect()
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return top && !button.contains(top) ? (top.outerHTML || '').slice(0, 120) : null
    })
    assert.equal(covered, null, `ปุ่มลงนามถูกบังด้วย ${covered}`)
    await page.keyboard.press('Escape')
    await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 5_000 })
    // แถบหน้าการใช้รถ
    await openFleetTrips(page, auth)
    await banner(page).waitFor({ timeout: 15_000 })
    await noOverflow(page, `${width}px หน้าการใช้รถ`)
    for (const button of await banner(page).locator('[data-pending-sign-button]').all()) await tapSize(button, `${width}px ปุ่มในแถบ`)
    if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `fleet-${width}.png`) })
    return `${width}px ไม่ล้น · ปุ่ม ≥ 44px · กล่องลงนามไม่ถูกบัง`
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 })
  }
}

async function main() {
  let failed = 0
  let total = 0
  let shotPage = null
  const only = (process.env.ES_ONLY || '').split(',').map(word => word.trim()).filter(Boolean)
  const run = async (label, fn) => {
    if (only.length && !only.some(word => label.includes(word))) return
    total += 1
    try {
      const note = await fn()
      console.log(`PASS  ${label}${note ? ` — ${note}` : ''}`)
    } catch (error) {
      failed += 1
      if (process.env.ES_SHOTS) console.log('   stack:', String(error.stack).split('\n').filter(line => line.includes('esign-pending')).slice(0, 4).join(' <- '))
      if (process.env.ES_SHOTS && shotPage) await shotPage.screenshot({ path: path.join(process.env.ES_SHOTS, `fail-${total}.png`) }).catch(() => {})
      console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${label} — ${String(error.message).split('\n').slice(0, 3).join(' | ')}`)
    }
  }
  await withProfile(PROFILE, async (page, auth, context) => {
    shotPage = page
    page.on('dialog', dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); dialog.accept().catch(() => {}) })
    await run('หน้าแรก: การ์ดใบรอลงนาม', () => checkHomeCard(page, auth, context))
    await run('หน้าแรก: ไม่มีใบรอ = ไม่มีการ์ด', () => checkHomeEmpty(page, auth, context))
    await run('หน้าแรก: แสดง 5 ใบแรก', () => checkHomeLimit(page, auth, context))
    await run('หน้าแรก: ดึงพลาดต้องเตือน', () => checkHomeError(page, auth, context))
    await run('หน้าแรก: ลงนามจากการ์ด', () => checkHomeSign(page, auth, context))
    await run('หน้าแรก: ถือหลายช่อง', () => checkHomeChain(page, auth, context))
    await run('หน้าการใช้รถ: แถบรอลงนาม', () => checkFleetBanner(page, auth, context))
    await run('หน้าการใช้รถ: ไม่มีใบรอ = ไม่มีแถบ', () => checkFleetNoBanner(page, auth, context))
    await run('ออกรถ: เตือนแต่ไม่บล็อก', () => checkDepartWarning(page, auth, context))
    await run('ออกรถ: ไม่เตือนเมื่อไม่ควร', () => checkDepartNoWarning(page, auth, context))
    await run('เค้าโครงมือถือ 390', () => checkMobile(page, auth, context, 390, 844))
    await run('เค้าโครงมือถือ 360', () => checkMobile(page, auth, context, 360, 740))
  })
  console.log(`\n${total - failed}/${total} ผ่าน`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${String(error.message).split('\n')[0]}`)
  process.exit(2)
})
