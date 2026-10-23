// แผง "ลงนามออนไลน์" ในหน้ารายละเอียดคำขอใช้รถ (/fleet → การใช้รถ) + กล่องลงนาม — ทดสอบในเบราว์เซอร์จริง
//
// ใช้ "ฐานข้อมูลจำลอง": ดักเฉพาะ RPC ลงนามออนไลน์ 7 ตัว + รายการทริปที่กำลังดำเนินอยู่ (GET fleet_trips) กับ DELETE/PATCH ของทริป
// จึงไม่เขียนข้อมูลอะไรของสนามซ้อม (ล็อกอิน/หน้า/ข้อมูลอื่นเป็นของจริง) · ความถูกต้องของฟังก์ชันฝั่ง DB ดู tests/esign-db.test.mjs (PGlite)
// ชื่อฟิลด์ที่จำลองถูกเทียบกับ SQL ใน tests/esign-lib.test.mjs · ไม่กด "ออกจากระบบ" (signOut ออกทุกอุปกรณ์)
//
// ตรวจ:
//   - แผงขึ้นเฉพาะทริปที่ตรึงโหมดออนไลน์ · ทริปเซ็นสดไม่ยิง RPC ลงนามเลย · ผู้ที่ไม่เกี่ยวข้อง (DB ตอบไม่พบ) ไม่เห็นแผง
//   - ลงนามครบสาย: แนบภาพค่าเริ่มต้นให้เอง · เลือกแบบอื่น/ไม่แนบ · รหัสผิดเตือนจำนวนที่เหลือ · ช่องผู้มีอำนาจส่ง approve
//   - ไม่มีภาพ → เซ็นสดในกล่องลงนามแล้วเลือกให้เอง (Esc ในกล่องเซ็นสดไม่ปิดกล่องลงนาม) · ยังไม่ตั้งรหัส → ตั้งในกล่องเลย
//   - ระงับ/ล็อก ลงนามไม่ได้ · ถอนลายเซ็น: เห็นเฉพาะผู้ที่ DB บอกว่าถอนได้ · บอกก่อนว่าช่องหลังถูกถอนตามไปกี่ช่อง · ต้องมีเหตุผล
//   - ลบทริปที่มีลายเซ็น (error ของ trigger) ขึ้นข้อความไทยที่บอกให้ใช้ "ยกเลิกคำขอ" · เค้าโครง PC 1280 / มือถือ 390, 360
//
//   ES_TEST_BASE_URL=http://demo.localhost:5176 node tests/esign-trip-panel.playwright.mjs
//   ES_ONLY=ถอน,เค้าโครง  รันเฉพาะชุดที่ชื่อมีคำนี้ · ES_SHOTS=<โฟลเดอร์>  ถ่ายภาพหน้าจอ · ES_PROFILE=TEST-fleet-admin (ค่าเริ่มต้น)
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
const RPC_NAMES = ['esign_trip_status', 'esign_sign_fleet_trip_stamped', 'esign_revoke_fleet_trip', 'esign_my_signer_overview', 'esign_my_signatures',
  'esign_my_signature_add', 'set_esign_pin']
const SLOT_ORDER = ['requester', 'dept_head', 'authority', 'sk1']
const SLOT_LABEL = { requester: 'ผู้ขออนุญาต', dept_head: 'ผู้อำนวยการสำนัก/กอง หรือผู้แทน', authority: 'ผู้มีอำนาจสั่งใช้ยานพาหนะ', sk1: 'ผู้บริหารท้องถิ่น (บันทึกรับรอง สก.๑)' }
const EXPECTED_NAME = { requester: 'สมหญิง ผู้ขอ', dept_head: 'สมชาย หัวหน้ากอง', authority: 'สมศักดิ์ นายก' }
const OWNER_OF = { requester: 'requester', dept_head: 'head', authority: 'mayor' }
const PIN = '246810'
const ONLINE_TRIP_ID = '00000000-0000-4000-8000-0000000a0001'
const WET_TRIP_ID = '00000000-0000-4000-8000-0000000a0002'
const ONLINE_DEST = 'ทดสอบลงนามออนไลน์ ศาลากลางจังหวัดแพร่'
const WET_DEST = 'ทดสอบเซ็นสด ที่ว่าการอำเภอเมือง'

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
const seedPng = seed => encodePng(40, 16, (x, y) => [(x * 7 + seed * 31) & 255, (y * 13 + seed * 17) & 255, seed & 255, 255])
const imageItem = (n, isDefault) => ({ id: `00000000-0000-4000-8000-00000000030${n}`, label: `แบบที่ ${n}`, is_default: isDefault, created_at: '2026-10-2' + n + 'T03:00:00Z', width: 40, height: 16, png_base64: seedPng(n).toString('base64') })

// ── ทริปจำลอง ────────────────────────────────────────────────────────────────────────────────────
const fabricateTrip = (id, destination, esignSlots) => ({
  id, municipality_id: DEMO_MUNICIPALITY, vehicle_id: '00000000-0000-4000-8000-0000000b0001', department_id: null, driver_id: null, status: 'approved',
  requested_by: '00000000-0000-4000-8000-0000000c0001', created_by: '00000000-0000-4000-8000-0000000c0001', requester_position: 'นักวิชาการศึกษา',
  destination, destination_locality: 'อำเภอเมือง', destination_province: 'แพร่', purpose: 'ประชุมทดสอบระบบลงนามออนไลน์', passengers: 2,
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

// ── ฐานข้อมูลจำลองของลงนามออนไลน์: ตัดสินสิทธิ์ตามกติกาเดียวกับ esign_trip_status / esign_sign_fleet_trip_stamped / esign_revoke_fleet_trip ──
// me: ผู้ที่ล็อกอินอยู่ในมุมของ DB — requester | head | mayor | manager (ผู้ดูแลรถ/แอดมิน ไม่ใช่ผู้ลงนามช่องใด) | stranger (ไม่เกี่ยวข้อง)
function makeBackend({ me = 'requester', pinSet = true, suspended = false, lockedUntil = null, library = [], signed = {}, tripStatus = 'approved' } = {}) {
  const state = {
    me, pinSet, suspended, lockedUntil, library: [...library], signed: { ...signed }, tripStatus, pin: PIN, failedCount: 0, calls: [], nextId: 1, delayMs: 0,
    trips: [fabricateTrip(ONLINE_TRIP_ID, ONLINE_DEST, { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' }), fabricateTrip(WET_TRIP_ID, WET_DEST, null)],
  }
  const isManager = () => state.me === 'manager'
  const isRequester = () => state.me === 'requester'
  const activeSigned = () => SLOT_ORDER.filter(slot => state.signed[slot])
  const prereqOk = slot => (slot === 'dept_head' ? Boolean(state.signed.requester) : slot === 'authority' ? Boolean(state.signed.requester && state.signed.dept_head) : true)
  const status = () => {
    if (state.me === 'stranger') return { found: false }
    const slots = SLOT_ORDER.map(slot => {
      const online = slot !== 'sk1'
      const sig = state.signed[slot]
      const canSign = online && !sig && prereqOk(slot) && OWNER_OF[slot] === state.me && !['rejected', 'cancelled'].includes(state.tripStatus)
      return {
        slot, label: SLOT_LABEL[slot], mode: online ? 'online' : 'wet', applicable: slot !== 'sk1', signed: Boolean(sig),
        waiting_for_previous: online && !sig && !prereqOk(slot), can_sign: canSign, can_revoke: Boolean(sig) && (isManager() || isRequester() || sig.by === state.me),
        blocked: null, expected_name: EXPECTED_NAME[slot] ?? null,
        signature: sig ? { signer_name: EXPECTED_NAME[slot], signer_position: 'ตำแหน่งทดสอบ', signed_as: '', decision: slot === 'authority' ? 'approve' : 'sign', signed_at: '2026-10-23T04:00:00Z',
          content_matches: true, mine: sig.by === state.me, with_image: sig.withImage } : null,
      }
    })
    const required = 3
    return {
      found: true, mode: 'online', verify_code: 'a'.repeat(32), trip_status: state.tripStatus, slots, required, signed_count: activeSigned().length,
      complete: activeSigned().length === required, integrity: activeSigned().length ? 'ok' : 'none', locked: activeSigned().length > 0,
      can_revoke_all: activeSigned().length > 0 && (isManager() || isRequester()),
    }
  }
  const handlers = {
    esign_trip_status: () => status(),
    esign_my_signer_overview: () => ({
      ok: true, pin_set: state.pinSet, pin_set_at: state.pinSet ? '2026-10-20T03:00:00Z' : null, duty_acked: state.pinSet, suspended: state.suspended, suspended_at: null,
      locked_until: state.lockedUntil, failed_count: state.failedCount, image_count: state.library.length, signature_count: 0, signature_count_month: 0,
    }),
    esign_my_signatures: () => ({ ok: true, max: 5, items: state.library }),
    esign_my_signature_add: args => {
      const id = `00000000-0000-4000-8000-00000000040${state.nextId++}`
      const isDefault = state.library.length === 0 || args.p_make_default
      if (isDefault) state.library = state.library.map(item => ({ ...item, is_default: false }))
      state.library.push({ id, label: args.p_label, is_default: isDefault, created_at: '2026-10-23T03:00:00Z', width: 100, height: 40, png_base64: args.p_png_base64 })
      return { ok: true, id, already: false, is_default: isDefault }
    },
    set_esign_pin: args => {
      if (args.p_pin === '111111') return { ok: false, code: 'weak_pin' }
      if (!state.pinSet && !args.p_ack_duty) return { ok: false, code: 'duty_ack_required' }
      state.pinSet = true
      state.pin = args.p_pin
      return { ok: true }
    },
    esign_sign_fleet_trip_stamped: args => {
      if (state.suspended) return { ok: false, code: 'suspended' }
      if (!state.pinSet) return { ok: false, code: 'pin_not_set' }
      if (args.p_image_id && !state.library.some(item => item.id === args.p_image_id)) return { ok: false, code: 'image_not_found' }
      const slot = args.p_slot
      if (OWNER_OF[slot] !== state.me) return { ok: false, code: 'not_your_slot' }
      if (!prereqOk(slot)) return { ok: false, code: 'wait_previous' }
      if (args.p_pin !== state.pin) { state.failedCount += 1; return { ok: false, code: 'bad_pin', remaining: Math.max(0, 5 - state.failedCount) } }
      state.failedCount = 0
      state.signed[slot] = { by: state.me, withImage: Boolean(args.p_image_id) }
      return { ok: true, already: false, signature_id: `sig-${slot}`, signed_at: '2026-10-23T04:00:00Z', complete: activeSigned().length === 3, stamped: Boolean(args.p_image_id) }
    },
    esign_revoke_fleet_trip: args => {
      const reason = String(args.p_reason ?? '').trim()
      if (reason.length < 3 || reason.length > 500) return { ok: false, code: 'invalid_reason' }
      const chain = ['requester', 'dept_head', 'authority']
      const targets = !args.p_slot ? SLOT_ORDER : args.p_slot === 'sk1' ? ['sk1'] : chain.slice(chain.indexOf(args.p_slot))
      let revoked = 0
      for (const slot of targets) if (state.signed[slot]) { delete state.signed[slot]; revoked += 1 }
      return { ok: true, revoked }
    },
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
    if (backend.delayMs) await new Promise(resolve => setTimeout(resolve, backend.delayMs))
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
  })
  // ทริปที่กำลังดำเนินอยู่ = ทริปจำลองของเรา (ประวัติ/คำขออื่นๆ เป็นของจริง) · DELETE/PATCH ของทริป = error ของ trigger ลงนามออนไลน์
  await context.route(/\/rest\/v1\/fleet_trips\?/, async route => {
    const request = route.request()
    const cors = corsFor(request)
    const url = decodeURIComponent(request.url())
    const method = request.method()
    if (method === 'GET' && url.includes('select=*,vehicle:') && url.includes('status=in.(pending,waitlisted,approved,in_progress)')) {
      backend.tripReads = (backend.tripReads ?? 0) + 1
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': `0-${backend.trips.length - 1}/${backend.trips.length}` }, body: JSON.stringify(backend.trips) })
      return
    }
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    if (method === 'DELETE' || method === 'PATCH') {
      backend.tripWrites = [...(backend.tripWrites ?? []), `${method} ${url.replace(/^.*rest\/v1\//, '').slice(0, 80)}`]
      const code = method === 'DELETE' ? 'ESIGN_TRIP_HAS_SIGNATURES' : 'ESIGN_TRIP_LOCKED'
      await route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: 'P0001', message: `${code}: ข้อความดิบของฐานข้อมูล`, details: null, hint: null }) })
      return
    }
    await route.fallback()
  })
}

// ── เบราว์เซอร์/เซสชัน (เหมือนเทสต์หน้าโปรไฟล์) ───────────────────────────────────────────────────────────
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
async function openFleetTrips(page, auth) {
  await page.goto('about:blank')
  await page.goto(`${BASE}/fleet`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== '/fleet') throw new BlockedError(`ถูกพาออกจาก /fleet ไปที่ ${new URL(page.url()).pathname}`)
  await page.getByRole('button', { name: 'ข้ามไปก่อน' }).first().click({ timeout: 6_000 }).catch(() => {})
  const tab = page.locator('button:visible', { hasText: /^s*การใช้รถ/ }).first() // เดสก์ท็อป = แท็บ · มือถือ = ไทล์ที่มีคำอธิบายต่อท้าย
  await tab.waitFor({ timeout: 25_000 }).catch(() => { throw new BlockedError('ไม่พบแท็บ "การใช้รถ"') })
  await tab.click()
  await tripCell(page, ONLINE_DEST).waitFor({ timeout: 20_000 })
}

// ช่องปลายทางในตาราง (มีสำเนาที่ซ่อนอยู่ในหน้าอื่น จึงจำกัดเฉพาะที่มองเห็น)
// (เดสก์ท็อป = ตาราง · มือถือ = การ์ด)
const tripCell = (page, destination) => page.getByText(destination).and(page.locator(':visible')).first()
const detailTitle = page => page.locator('h2', { hasText: 'รายละเอียดการใช้รถ' })
async function openTripDetail(page, destination) {
  await tripCell(page, destination).click()
  await detailTitle(page).waitFor({ timeout: 10_000 })
}
async function closeTripDetail(page) {
  await detailTitle(page).locator('xpath=following-sibling::button').click()
  await detailTitle(page).waitFor({ state: 'detached' })
}
const panel = page => page.locator('[data-trip-esign]')
const slotRow = (page, slot) => page.locator(`[data-esign-slot="${slot}"]`)
const sentCalls = (backend, name) => backend.calls.filter(call => call.name === name)
const lastCall = (backend, name) => sentCalls(backend, name).at(-1)

async function openOnlineTrip(page, auth, context, backend) {
  await installBackend(context, backend)
  await openFleetTrips(page, auth)
  await openTripDetail(page, ONLINE_DEST)
  await panel(page).waitFor({ timeout: 10_000 })
}
async function reopenOnlineTrip(page) {
  await closeTripDetail(page)
  await openTripDetail(page, ONLINE_DEST)
  await panel(page).waitFor({ timeout: 10_000 })
}
async function openSignDialog(page, slot) {
  await slotRow(page, slot).locator('[data-sign-slot-button]').click()
  await page.locator('[data-sign-dialog]').waitFor()
  await page.locator('[data-sign-summary]').waitFor()
  await page.locator('[data-sign-pin], [data-sign-blocked], [data-sign-setup-pin], [data-sign-load-error]').first().waitFor({ timeout: 10_000 })
}
const enterPin = async (page, pin) => { await page.locator('[data-sign-pin]').fill(pin) }
const SCRIBBLE = [[[0.15, 0.55], [0.3, 0.3], [0.45, 0.7], [0.6, 0.35], [0.8, 0.6]], [[0.2, 0.8], [0.5, 0.78], [0.85, 0.82]]]
async function drawStrokes(page, strokes) {
  const box = await page.locator('[data-signature-pad]').boundingBox()
  for (const stroke of strokes) {
    await page.mouse.move(box.x + stroke[0][0] * box.width, box.y + stroke[0][1] * box.height)
    await page.mouse.down()
    for (const [x, y] of stroke.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 6 })
    await page.mouse.up()
  }
}
const noOverflow = async (page, where) => {
  const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
  assert.ok(m.scrollW <= m.clientW + 1, `${where}: เลื่อนแนวนอน (${m.scrollW} > ${m.clientW})`)
}
const tapSize = async (locator, where) => {
  const box = await locator.boundingBox()
  assert.ok(box, `${where}: ไม่พบปุ่ม`)
  assert.ok(box.height >= MIN_TAP - 0.5, `${where}: ปุ่มเตี้ยกว่า ${MIN_TAP}px (${Math.round(box.width)}×${Math.round(box.height)})`)
}

// ── ตรวจ ──────────────────────────────────────────────────────────────────────────────────────────
async function checkOnlyOnlineTrips(page, auth, context) {
  const backend = makeBackend({ me: 'requester', library: [imageItem(1, true)] })
  await installBackend(context, backend)
  await openFleetTrips(page, auth)
  // ทริปเซ็นสด (esign_slots ว่าง): ไม่มีแผง และต้องไม่ยิง RPC ลงนามเลย
  await openTripDetail(page, WET_DEST)
  await page.waitForTimeout(1_200)
  assert.equal(await panel(page).count(), 0, 'ทริปเซ็นสดต้องไม่มีแผงลงนามออนไลน์')
  assert.equal(backend.calls.length, 0, `ทริปเซ็นสดต้องไม่ยิง RPC ลงนาม (ยิง ${backend.calls.map(call => call.name)})`)
  await closeTripDetail(page)
  // ทริปออนไลน์: เห็น 3 ช่องออนไลน์ + หมายเหตุช่องที่ยังเซ็นสด
  await openTripDetail(page, ONLINE_DEST)
  await panel(page).waitFor()
  assert.equal(await page.locator('[data-esign-slot]').count(), 3, 'ต้องมี 3 ช่องออนไลน์ (สก.๑ ไม่เข้าเงื่อนไข ไม่แสดง)')
  const text = await panel(page).innerText()
  assert.ok(text.includes('ลงนามแล้ว 0/3 ช่อง'), text.slice(0, 120))
  assert.ok(await page.locator('[data-trip-esign-wet]').innerText().then(t => t.includes('ผู้ขับรถ')), 'ต้องบอกว่าช่องผู้ขับรถยังเซ็นสด')
  assert.equal(await slotRow(page, 'requester').locator('[data-sign-slot-button]').count(), 1, 'ผู้ขอถึงตาแล้วต้องมีปุ่มลงนาม')
  assert.equal(await page.locator('[data-sign-slot-button]').count(), 1, 'ช่องอื่นยังไม่ถึงตา ต้องไม่มีปุ่ม')
  assert.ok((await slotRow(page, 'dept_head').innerText()).includes('รอผู้ลงนามช่องก่อนหน้า'))
  assert.equal(await page.locator('[data-revoke-slot], [data-revoke-all]').count(), 0, 'ยังไม่มีลายเซ็น ต้องไม่มีปุ่มถอน')
  assert.equal(await page.locator('[data-trip-esign-locked]').count(), 0)
  return 'ทริปเซ็นสดไม่มีแผงและไม่ยิง RPC · ทริปออนไลน์เห็น 3 ช่อง ปุ่มลงนามเฉพาะช่องที่ถึงตา'
}

async function checkStranger(page, auth, context) {
  const backend = makeBackend({ me: 'stranger' })
  await openOnlineTrip(page, auth, context, backend).catch(async error => {
    // ผู้ไม่เกี่ยวข้อง: แผงไม่ขึ้น (รอแผงจะหมดเวลา) — ถือเป็นผ่านถ้าเปิดรายละเอียดทริปได้
    if (!String(error.message).includes('Timeout')) throw error
  })
  await detailTitle(page).waitFor()
  await page.waitForTimeout(1_000)
  assert.equal(await panel(page).count(), 0, 'DB ตอบ "ไม่พบ" แล้วต้องไม่แสดงแผง (ไม่บอกว่ามีโหมดออนไลน์)')
  assert.ok(sentCalls(backend, 'esign_trip_status').length >= 1)
  return 'ผู้ที่ไม่เกี่ยวข้องไม่เห็นแผง'
}

async function checkSignFlow(page, auth, context) {
  const backend = makeBackend({ me: 'requester', library: [imageItem(1, true), imageItem(2, false)] })
  await openOnlineTrip(page, auth, context, backend)

  // ผู้ขอ: กล่องลงนาม — สรุปเนื้อหา · แนบภาพค่าเริ่มต้นให้เอง · ปุ่มลงนามรอรหัสครบ 6 หลัก
  await openSignDialog(page, 'requester')
  const summary = await page.locator('[data-sign-summary]').innerText()
  for (const expected of [ONLINE_DEST, 'ประชุมทดสอบระบบลงนามออนไลน์', 'สมหญิง ผู้ขอ', '[TEST] กระบะลงนามออนไลน์']) assert.ok(summary.includes(expected), `สรุปไม่มี "${expected}"`)
  assert.equal(await page.locator('[data-sign-attach]').isChecked(), true, 'ต้องแนบภาพค่าเริ่มต้นให้เอง')
  const options = page.locator('[data-sign-image-option]')
  assert.equal(await options.count(), 2)
  assert.equal(await options.nth(0).getAttribute('aria-checked'), 'true', 'ต้องเลือกภาพค่าเริ่มต้นไว้ล่วงหน้า')
  const broken = await page.locator('[data-sign-image-option] img').evaluateAll(images => images.filter(img => !img.complete || img.naturalWidth === 0).length)
  assert.equal(broken, 0, 'ภาพในกล่องไม่แสดง')
  assert.equal(await page.locator('[data-sign-submit]').isDisabled(), true, 'ยังไม่ใส่รหัสต้องกดไม่ได้')
  await enterPin(page, '12345')
  assert.equal(await page.locator('[data-sign-submit]').isDisabled(), true, 'รหัส 5 หลักต้องกดไม่ได้')
  await enterPin(page, '12a456')
  assert.equal(await page.locator('[data-sign-pin]').inputValue(), '12456', 'ตัวอักษรที่ไม่ใช่ตัวเลขต้องถูกตัดออก')

  // รหัสผิด: ขึ้นข้อความพร้อมจำนวนที่เหลือ · ล้างช่องรหัส · กล่องไม่ปิด
  await enterPin(page, '000000')
  await page.locator('[data-sign-submit]').click()
  const error = await page.locator('[data-sign-error]').innerText()
  assert.ok(error.includes('รหัสลงนามไม่ถูกต้อง') && error.includes('เหลืออีก 4 ครั้ง'), error)
  assert.equal(await page.locator('[data-sign-pin]').inputValue(), '', 'รหัสผิดต้องล้างช่องให้พิมพ์ใหม่')
  assert.equal(await page.locator('[data-sign-dialog]').count(), 1)

  // รหัสถูก: ส่งภาพค่าเริ่มต้น (ไม่ส่งภาพที่วาดตอนลงนาม) · decision ว่าง (DB กำหนดเป็น sign เอง)
  await enterPin(page, PIN)
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  const first = lastCall(backend, 'esign_sign_fleet_trip_stamped').args
  assert.deepEqual(first, { p_trip_id: ONLINE_TRIP_ID, p_slot: 'requester', p_pin: PIN, p_decision: null, p_image_id: imageItem(1, true).id, p_png_base64: null })
  await slotRow(page, 'requester').getByText('ลงนามแล้วโดย').waitFor()
  const signedText = await slotRow(page, 'requester').innerText()
  assert.ok(signedText.includes('ลายเซ็นของฉัน') && signedText.includes('แนบภาพลายเซ็น'), signedText)
  assert.ok((await panel(page).innerText()).includes('ลงนามแล้ว 1/3 ช่อง'))
  assert.equal(await page.locator('[data-trip-esign-locked]').count(), 1, 'มีลายเซ็นแล้วต้องบอกว่าแก้เนื้อหาไม่ได้')
  assert.ok((await page.locator('[data-trip-esign-locked]').innerText()).includes('ถอนลายเซ็น'))
  assert.equal(await page.locator('[data-sign-slot-button]').count(), 0, 'ลงแล้วต้องไม่มีปุ่มลงนามของช่องอื่นที่ไม่ใช่ตา')

  // หัวหน้ากอง: เลือกภาพแบบที่ 2 แทนค่าเริ่มต้น
  backend.me = 'head'
  await reopenOnlineTrip(page)
  await openSignDialog(page, 'dept_head')
  await page.locator('[data-sign-image-option]').nth(1).click()
  assert.equal(await page.locator('[data-sign-image-option]').nth(1).getAttribute('aria-checked'), 'true')
  await enterPin(page, PIN)
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.equal(lastCall(backend, 'esign_sign_fleet_trip_stamped').args.p_image_id, imageItem(2, false).id)

  // ผู้มีอำนาจ: ปุ่ม/หัวกล่องเป็น "อนุมัติ" · ส่ง approve · ไม่แนบภาพ
  backend.me = 'mayor'
  await reopenOnlineTrip(page)
  assert.ok((await slotRow(page, 'authority').locator('[data-sign-slot-button]').innerText()).includes('อนุมัติ'))
  await openSignDialog(page, 'authority')
  assert.ok((await page.locator('#sign-trip-title').innerText()).startsWith('อนุมัติ:'))
  await page.locator('[data-sign-attach]').uncheck()
  assert.equal(await page.locator('[data-sign-image-option]').count(), 0, 'ไม่แนบภาพแล้วต้องซ่อนตัวเลือกภาพ')
  assert.ok((await page.locator('#sign-attach-title').locator('xpath=..').innerText()).includes('ไม่แนบภาพ'))
  await enterPin(page, PIN)
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.deepEqual(lastCall(backend, 'esign_sign_fleet_trip_stamped').args,
    { p_trip_id: ONLINE_TRIP_ID, p_slot: 'authority', p_pin: PIN, p_decision: 'approve', p_image_id: null, p_png_base64: null })
  await page.getByText('ลงนามครบแล้ว').first().waitFor()
  assert.ok((await panel(page).innerText()).includes('ลงนามแล้ว'), 'ต้องมีข้อความผลลงนาม')
  assert.ok((await slotRow(page, 'authority').innerText()).includes('อนุมัติแล้วโดย'))
  return 'สรุปเนื้อหา · แนบภาพค่าเริ่มต้น/เลือกแบบอื่น/ไม่แนบ · รหัสผิดเตือน 4 ครั้ง · authority ส่ง approve · ครบสาย'
}

async function checkNoImageDrawFlow(page, auth, context) {
  const backend = makeBackend({ me: 'requester', library: [] })
  await openOnlineTrip(page, auth, context, backend)
  await openSignDialog(page, 'requester')
  assert.equal(await page.locator('[data-sign-no-image]').count(), 1, 'ไม่มีภาพต้องอธิบายว่าไม่บังคับ')
  assert.equal(await page.locator('[data-sign-attach]').count(), 0)
  await enterPin(page, PIN) // ลงนามด้วยรหัสอย่างเดียวได้ (ปุ่มพร้อมกด) แต่ลองเพิ่มลายเซ็นก่อน
  assert.equal(await page.locator('[data-sign-submit]').isDisabled(), false, 'ไม่มีภาพก็ลงนามด้วยรหัสอย่างเดียวได้')

  await page.locator('[data-sign-add-image]').first().click()
  const add = page.locator('[data-add-signature-dialog]')
  await add.waitFor()
  // Esc ปิดเฉพาะกล่องเซ็นสด กล่องลงนามด้านหลังต้องไม่ปิดตาม
  await page.keyboard.press('Escape')
  await add.waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-sign-dialog]').count(), 1, 'Esc ในกล่องเซ็นสดต้องไม่ปิดกล่องลงนาม')
  assert.equal(await page.locator('[data-sign-pin]').inputValue(), PIN, 'รหัสที่พิมพ์ไว้ต้องไม่หาย')

  await page.locator('[data-sign-add-image]').first().click()
  await add.waitFor()
  await drawStrokes(page, SCRIBBLE)
  await page.locator('[data-save-signature]').click()
  await add.waitFor({ state: 'detached', timeout: 10_000 })
  const saved = lastCall(backend, 'esign_my_signature_add')
  assert.ok(saved, 'ไม่มีการบันทึกลายเซ็นเข้าคลัง')
  assert.equal(saved.args.p_make_default, true)
  const option = page.locator('[data-sign-image-option]')
  await option.first().waitFor({ timeout: 10_000 })
  assert.equal(await page.locator('[data-sign-attach]').isChecked(), true, 'เพิ่มภาพแล้วต้องติ๊กแนบให้เอง')
  assert.equal(await option.first().getAttribute('aria-checked'), 'true', 'ภาพที่เพิ่งเซ็นต้องถูกเลือกให้เอง')
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.equal(lastCall(backend, 'esign_sign_fleet_trip_stamped').args.p_image_id, backend.library[0].id, 'ต้องส่งภาพที่เพิ่งเซ็นเข้าคลังไปกับการลงนาม')
  assert.equal(backend.library.length, 1)
  return 'ไม่มีภาพลงนามด้วยรหัสได้ · เซ็นสดในกล่องแล้วเลือกให้เอง · Esc ไม่ปิดกล่องลงนาม'
}

async function checkSetPinInDialog(page, auth, context) {
  const backend = makeBackend({ me: 'requester', pinSet: false, library: [imageItem(1, true)] })
  await openOnlineTrip(page, auth, context, backend)
  await openSignDialog(page, 'requester')
  assert.equal(await page.locator('[data-sign-setup-pin]').count(), 1, 'ยังไม่ตั้งรหัสต้องให้ตั้งในกล่อง')
  assert.equal(await page.locator('[data-sign-pin]').count(), 0, 'ยังไม่ตั้งรหัสต้องยังไม่มีช่องกรอกรหัสลงนาม')
  assert.equal(await page.locator('[data-sign-submit]').isDisabled(), true)
  await page.locator('#esign-pin-next').fill(PIN)
  await page.locator('#esign-pin-confirm').fill(PIN)
  assert.equal(await page.locator('[data-save-pin]').isDisabled(), true, 'ต้องติ๊กรับทราบหน้าที่ก่อน')
  await page.locator('#esign-duty-ack').check()
  await page.locator('[data-save-pin]').click()
  await page.locator('[data-sign-pin]').waitFor({ timeout: 10_000 })
  assert.equal(await page.locator('[data-sign-setup-pin]').count(), 0)
  assert.ok((await page.locator('[data-sign-dialog]').innerText()).includes('ตั้งรหัสลงนามแล้ว'), 'ต้องบอกว่าตั้งรหัสแล้ว')
  assert.deepEqual(lastCall(backend, 'set_esign_pin').args, { p_pin: PIN, p_current_pin: null, p_ack_duty: true })
  await enterPin(page, PIN)
  await page.locator('[data-sign-submit]').click()
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached', timeout: 10_000 })
  await slotRow(page, 'requester').getByText('ลงนามแล้วโดย').waitFor()
  return 'ตั้งรหัสในกล่องลงนามแล้วลงนามต่อได้เลย'
}

async function checkBlocked(page, auth, context) {
  const suspended = makeBackend({ me: 'requester', suspended: true })
  await openOnlineTrip(page, auth, context, suspended)
  await openSignDialog(page, 'requester')
  assert.ok((await page.locator('[data-sign-blocked]').innerText()).includes('ถูกระงับ'))
  assert.equal(await page.locator('[data-sign-pin]').count(), 0)
  assert.equal(await page.locator('[data-sign-submit]').isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.locator('[data-sign-dialog]').waitFor({ state: 'detached' })

  const locked = makeBackend({ me: 'requester', pinSet: true, lockedUntil: new Date(Date.now() + 10 * 60_000).toISOString() })
  await installBackend(context, locked)
  await reopenOnlineTrip(page)
  await openSignDialog(page, 'requester')
  assert.ok((await page.locator('[data-sign-blocked]').innerText()).includes('ล็อก'))
  assert.equal(await page.locator('[data-sign-pin]').isDisabled(), true)
  assert.equal(await page.locator('[data-sign-submit]').isDisabled(), true)
  assert.equal(sentCalls(locked, 'esign_sign_fleet_trip_stamped').length, 0, 'ถูกล็อกต้องไม่ยิงลงนาม')
  return 'ระงับ/ล็อก ลงนามไม่ได้ ไม่ยิง RPC'
}

async function checkRevoke(page, auth, context) {
  // หัวหน้ากองถอนได้เฉพาะช่องของตัวเอง · ช่องผู้ขอ (ของคนอื่น) ไม่มีปุ่ม
  const backend = makeBackend({ me: 'head', signed: { requester: { by: 'requester', withImage: true }, dept_head: { by: 'head', withImage: false } } })
  await openOnlineTrip(page, auth, context, backend)
  assert.equal(await slotRow(page, 'requester').locator('[data-revoke-slot]').count(), 0, 'ถอนช่องของคนอื่นไม่ได้')
  assert.equal(await page.locator('[data-revoke-all]').count(), 0, 'หัวหน้ากองไม่มีสิทธิ์ถอนทั้งหมด')
  assert.equal(await slotRow(page, 'dept_head').locator('[data-revoke-slot]').count(), 1)
  await tapSize(slotRow(page, 'dept_head').locator('[data-revoke-slot]'), 'ปุ่มถอนลายเซ็น')
  await slotRow(page, 'dept_head').locator('[data-revoke-slot]').click()
  const impact = await page.locator('[data-revoke-impact]').innerText()
  assert.ok(impact.includes(SLOT_LABEL.dept_head) && !impact.includes(SLOT_LABEL.authority) && !impact.includes('ช่องหลังในสาย'), `ผลของการถอนไม่ตรง: ${impact}`)
  assert.equal(await page.locator('[data-confirm-revoke]').isDisabled(), true, 'ยังไม่ใส่เหตุผลต้องกดยืนยันไม่ได้')
  await page.locator('[data-revoke-reason]').fill('ก')
  assert.equal(await page.locator('[data-confirm-revoke]').isDisabled(), true, 'เหตุผลสั้นกว่า 3 ตัวอักษรต้องกดไม่ได้')
  await page.locator('[data-revoke-reason]').fill('เนื้อหาไม่ถูกต้อง')
  await page.locator('[data-confirm-revoke]').click()
  await page.locator('[data-revoke-form]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.deepEqual(lastCall(backend, 'esign_revoke_fleet_trip').args, { p_trip_id: ONLINE_TRIP_ID, p_reason: 'เนื้อหาไม่ถูกต้อง', p_slot: 'dept_head' })
  await slotRow(page, 'dept_head').getByText('ถึงคิวของคุณ').waitFor({ timeout: 10_000 }) // ถอนแล้วถึงคิวหัวหน้ากองลงนามใหม่ (หน้าจอโหลดสถานะใหม่)
  await page.getByText('ถอนลายเซ็นแล้ว 1 ช่อง').first().waitFor()

  // ผู้ขอถอนทั้งหมดเพื่อแก้คำขอ
  backend.me = 'requester'
  await reopenOnlineTrip(page)
  assert.equal(await page.locator('[data-revoke-all]').count(), 1)
  await page.locator('[data-revoke-all]').click()
  assert.ok((await page.locator('[data-revoke-impact]').innerText()).includes(SLOT_LABEL.requester))
  await page.locator('[data-revoke-reason]').fill('แก้วันเดินทางให้ตรงหนังสือเชิญ')
  await page.locator('[data-confirm-revoke]').click()
  await page.locator('[data-revoke-form]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.deepEqual(lastCall(backend, 'esign_revoke_fleet_trip').args, { p_trip_id: ONLINE_TRIP_ID, p_reason: 'แก้วันเดินทางให้ตรงหนังสือเชิญ', p_slot: null })
  await page.locator('[data-trip-esign-locked]').waitFor({ state: 'detached', timeout: 10_000 })
  assert.ok((await panel(page).innerText()).includes('ลงนามแล้ว 0/3 ช่อง'))

  // ผู้ดูแลรถถอนช่องต้นสาย → บอกก่อนว่าช่องหลังถูกถอนตามไปด้วย
  const manager = makeBackend({ me: 'manager', signed: { requester: { by: 'requester', withImage: false }, dept_head: { by: 'head', withImage: false }, authority: { by: 'mayor', withImage: false } } })
  await installBackend(context, manager)
  await reopenOnlineTrip(page)
  assert.equal(await page.locator('[data-revoke-slot]').count(), 3, 'ผู้ดูแลรถถอนได้ทุกช่อง')
  await slotRow(page, 'requester').locator('[data-revoke-slot]').click()
  const chain = await page.locator('[data-revoke-impact]').innerText()
  for (const slot of ['requester', 'dept_head', 'authority']) assert.ok(chain.includes(SLOT_LABEL[slot]), `ผลของการถอนไม่มี ${slot}: ${chain}`)
  assert.ok(chain.includes('ช่องหลังในสาย'), chain)
  assert.equal(sentCalls(manager, 'esign_revoke_fleet_trip').length, 0, 'ก่อนกดยืนยันต้องไม่ถอน')
  return 'ถอนเฉพาะช่องที่ DB ให้ถอน · เหตุผล ≥ 3 ตัวอักษร · บอกช่องที่ถอนตาม · ถอนหมดแล้วทริปแก้ได้อีก'
}

async function checkTriggerErrors(page, auth, context) {
  const backend = makeBackend({ me: 'manager', signed: { requester: { by: 'requester', withImage: false } } })
  await installBackend(context, backend)
  dialogs.length = 0
  await openFleetTrips(page, auth)
  // ปุ่มลบในแถวของทริปออนไลน์ → error ของ trigger ต้องกลายเป็นข้อความไทยที่บอกทางออก ไม่ใช่ข้อความดิบของ DB
  const row = page.locator('tr:visible', { hasText: ONLINE_DEST }).first()
  await row.waitFor({ timeout: 10_000 })
  const remove = row.getByRole('button', { name: 'ลบ' })
  assert.ok(await remove.count(), 'ไม่พบปุ่มลบในแถวของทริปทดสอบ (ต้องล็อกอินเป็นผู้ดูแลระบบยานพาหนะ)')
  await remove.first().click()
  await page.waitForFunction(() => true)
  await page.waitForTimeout(1_500)
  const alertText = dialogs.filter(item => item.type === 'alert').map(item => item.message).join('\n')
  assert.ok(alertText.includes('ลบไม่สำเร็จ'), `ไม่พบข้อความลบไม่สำเร็จ: ${JSON.stringify(dialogs)}`)
  assert.ok(alertText.includes('ยกเลิก') && alertText.includes('หลักฐาน'), `ต้องบอกให้ใช้ "ยกเลิกคำขอ" แทนการลบ: ${alertText}`)
  assert.ok(!alertText.includes('ข้อความดิบของฐานข้อมูล'), 'ต้องไม่โชว์ข้อความดิบของ DB')
  assert.equal((backend.tripWrites ?? []).filter(item => item.startsWith('DELETE')).length, 1)
  return 'ลบทริปที่มีลายเซ็น → ข้อความไทย + ทางออก'
}

async function checkLayout(page, auth, context, width, height) {
  const backend = makeBackend({ me: 'requester', library: [imageItem(1, true), imageItem(2, false)], signed: {} })
  await page.setViewportSize({ width, height })
  await openOnlineTrip(page, auth, context, backend)
  await noOverflow(page, `${width}px แผงลงนาม`)
  if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `panel-${width}.png`) })
  await tapSize(page.locator('[data-sign-slot-button]'), `${width}px ปุ่มลงนาม`)
  await page.locator('[data-sign-slot-button]').click()
  await page.locator('[data-sign-dialog]').waitFor()
  await page.locator('[data-sign-pin]').waitFor()
  await noOverflow(page, `${width}px กล่องลงนาม`)
  for (const selector of ['[data-sign-submit]', '[data-sign-close]', '[data-sign-image-option]', '[data-sign-add-image]', '[data-sign-attach]']) {
    const target = page.locator(selector).first()
    if (selector === '[data-sign-attach]') { assert.ok((await target.locator('xpath=..').boundingBox()).height >= MIN_TAP - 0.5, 'แถวติ๊กแนบเตี้ยกว่า 44px'); continue }
    await tapSize(target, `${width}px ${selector}`)
  }
  const box = await page.locator('[data-sign-dialog]').evaluate(element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight } })
  assert.ok(box.left >= 0 && box.right <= box.w + 1 && box.top >= -1 && box.bottom <= box.h + 1, `กล่องลงนามล้นจอ ${JSON.stringify(box)}`)
  // ปุ่มลงนามต้องมองเห็นได้โดยไม่ต้องเลื่อนทั้งหน้า (ท้ายกล่องปักอยู่)
  const submit = await page.locator('[data-sign-submit]').boundingBox()
  assert.ok(submit.y + submit.height <= box.h + 1, 'ปุ่มลงนามหลุดจอ')
  // ไม่ถูกอะไรบัง (แถบเมนูล่างของมือถือเคยทับท้ายกล่องที่ซ้อนอยู่ในกล่องรายละเอียด) — จุดกลางปุ่มต้องเป็นของปุ่มเอง
  const covered = await page.locator('[data-sign-submit]').evaluate(button => {
    const r = button.getBoundingClientRect()
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return top && !button.contains(top) ? (top.outerHTML || '').slice(0, 120) : null
  })
  assert.equal(covered, null, `ปุ่มลงนามถูกบังด้วย ${covered}`)
  if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `sign-dialog-${width}.png`) })
  return `${width}px ไม่ล้น · ปุ่ม ≥ 44px · กล่องอยู่ในจอ`
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
      if (process.env.ES_SHOTS) console.log('   stack:', String(error.stack).split('\n').filter(line => line.includes('esign-trip-panel')).slice(0, 4).join(' <- '))
      if (process.env.ES_SHOTS && shotPage) await shotPage.screenshot({ path: path.join(process.env.ES_SHOTS, `fail-${total}.png`) }).catch(() => {})
      console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${label} — ${String(error.message).split('\n').slice(0, 3).join(' | ')}`)
    }
  }
  await withProfile(PROFILE, async (page, auth, context) => {
    shotPage = page
    page.on('dialog', dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); dialog.accept().catch(() => {}) })
    await run('แผงขึ้นเฉพาะทริปออนไลน์', () => checkOnlyOnlineTrips(page, auth, context))
    await run('ผู้ที่ไม่เกี่ยวข้องไม่เห็นแผง', () => checkStranger(page, auth, context))
    await run('ลงนามครบสาย', () => checkSignFlow(page, auth, context))
    await run('ไม่มีภาพ → เซ็นสดในกล่องลงนาม', () => checkNoImageDrawFlow(page, auth, context))
    await run('ยังไม่ตั้งรหัส → ตั้งในกล่อง', () => checkSetPinInDialog(page, auth, context))
    await run('ระงับ/ล็อก', () => checkBlocked(page, auth, context))
    await run('ถอนลายเซ็น', () => checkRevoke(page, auth, context))
    await run('error ของ trigger ตอนลบ', () => checkTriggerErrors(page, auth, context))
    await run('เค้าโครง PC 1280', () => checkLayout(page, auth, context, 1280, 900))
    await run('เค้าโครงมือถือ 390', () => checkLayout(page, auth, context, 390, 844))
    await run('เค้าโครงมือถือ 360', () => checkLayout(page, auth, context, 360, 740))
  })
  console.log(`\n${total - failed}/${total} ผ่าน`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${String(error.message).split('\n')[0]}`)
  process.exit(2)
})
