// หน้า "ลายเซ็นของฉัน" แยกที่ /staff/my-signatures และลิงก์เก่า /profile#signature — ทดสอบในเบราว์เซอร์จริง
//
// ใช้ "ฐานข้อมูลจำลอง" (ดักเฉพาะ RPC ลายเซ็น 8 ตัวที่ /rest/v1/rpc/…) จึงรันได้ก่อนที่ migration จะ apply บนฐานจริง
// และไม่เขียนข้อมูลอะไรของสนามซ้อม — ส่วนล็อกอิน/โปรไฟล์ใช้ของจริงตามปกติ ความถูกต้องของฟังก์ชันฝั่ง DB ดูที่
// tests/esign-db.test.mjs (PGlite) · ไม่กด "ออกจากระบบ" (signOut ออกทุกอุปกรณ์)
//
// ตรวจ:
//   - หน้าเฉพาะโหลดทันที · หน้าโปรไฟล์ไม่โหลดคลัง · ลิงก์เก่า redirect · route ป้องกันสิทธิ์
//   - เซ็นสด: PNG ที่ส่งไปเป็น PNG จริง โปร่งใส ตัดขอบแน่น ≤ 640×320 ≤ 50,000 ไบต์ สีหมึกตรงที่เลือก · ย้อน/ล้าง
//   - อัปโหลด PNG/JPG: ลบพื้นขาว/เทาเป็นโปร่งใส · ไฟล์ผิดชนิด/ภาพว่างถูกปฏิเสธด้วยข้อความไทย (ไม่ยิง RPC)
//   - คลัง: ค่าเริ่มต้น · ลบสองขั้นพร้อมข้อความ "เก็บไว้เป็นหลักฐาน" · ครบ 5 แบบเพิ่มไม่ได้
//   - รหัสลงนาม: ตั้งครั้งแรกต้องติ๊กรับทราบ · ยืนยันไม่ตรงบอกทันที · รหัสเดิมผิดบอกจำนวนครั้งที่เหลือ
//   - ระงับการลงนาม สองขั้น · ประวัติ · ผู้ใช้ที่ไม่ใช่เจ้าหน้าที่ไม่เห็นส่วนนี้
//   - เค้าโครง PC 1280 / มือถือ 390: ไม่มีเลื่อนแนวนอน · ปุ่มกดได้ ≥ 44px · กล่องเพิ่มลายเซ็นไม่ล้นจอ
//
//   ES_TEST_BASE_URL=http://demo.localhost:5176 node tests/esign-profile.playwright.mjs
//   ES_ONLY=รหัส,ประวัติ  รันเฉพาะชุดที่ชื่อมีคำนี้ · ES_SHOTS=<โฟลเดอร์>  ถ่ายภาพหน้าจอตอนชุดไหนล้ม
//   ES_PROFILE=TEST-officer (ค่าเริ่มต้น) · ES_CITIZEN_PROFILE=TEST-citizen · ES_PROFILE_ROOT=<.chrome-test-profiles>
//   ES_FIXTURE_AUTH=1 node tests/esign-profile.playwright.mjs  ใช้บัญชีจำลองทั้งหมด ไม่เชื่อม backend จริง
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const PROFILE_ROOT = process.env.ES_PROFILE_ROOT || path.join(process.cwd(), '.chrome-test-profiles')
let BASE = (process.env.ES_TEST_BASE_URL || 'http://demo.localhost:5174').replace(/\/$/, '')
const STAFF_PROFILE = process.env.ES_PROFILE || 'TEST-officer'
const CITIZEN_PROFILE = process.env.ES_CITIZEN_PROFILE || 'TEST-citizen'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'demo.localhost', 'localhost', '127.0.0.1'])
// ES_FIXTURE_AUTH=1 ใช้บัญชีจำลองทั้งหมดและ dev server ชั่วคราว ไม่อ่าน Chrome profile หรือส่ง request ออกนอกเครื่อง
const FIXTURE_AUTH = process.env.ES_FIXTURE_AUTH === '1'
const SIGNATURE_PATH = '/staff/my-signatures'
const fixtureRoles = new WeakMap()
let fixtureServer = null
if (FIXTURE_AUTH && !process.env.ES_TEST_BASE_URL) {
  const { createServer } = await import('vite')
  process.env.SKIP_SYNC_CHECK = '1'
  fixtureServer = await createServer({
    root: process.cwd(), cacheDir: path.join(tmpdir(), 'smartlocal-signature-page-vite', path.basename(process.cwd())),
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'), 'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo') },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  })
  await fixtureServer.listen()
  BASE = `http://127.0.0.1:${fixtureServer.httpServer.address().port}`
}
async function installFixtureRoutes(context, role) {
  const uid = '00000000-0000-4000-8000-000000000001'
  const municipalityId = '00000000-0000-4000-8000-000000000002'
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST เจ้าหน้าที่ทดสอบลายเซ็น' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: municipalityId, role, full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const tenant = { id: municipalityId, slug: 'demo', name: 'TEST หน่วยงานทดสอบ', org_type: 'เทศบาลตำบล', ui_style: 'eco-friendly', theme_color: '#0f766e', enabled_modules: null }
  await context.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const cors = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
      let data = []
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = tenant
      else if (url.pathname.includes('/rest/v1/profiles')) data = req.headers().accept?.includes('object+json') ? profile : [profile]
      else if (req.headers().accept?.includes('object+json')) data = null
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, 'content-range': '0-0/0' }, body: JSON.stringify(data) }); return
    }
    if (req.resourceType() === 'image') { await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }); return }
    if (url.origin !== new URL(BASE).origin) { await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/json', body: url.pathname.endsWith('.css') ? '' : '{}' }); return }
    if (!['GET', 'HEAD'].includes(req.method())) throw new Error('Fixture blocked a non-GET request outside mock backend')
    await route.continue()
  })
}
async function prepareFixture(context, name) {
  const role = name === 'ANONYMOUS' ? null : ['superadmin', 'admin', 'officer', 'technician', 'staff', 'viewer', 'council', 'citizen'].find(r => name.toLowerCase().endsWith(r)) || 'officer'
  fixtureRoles.set(context, role)
  if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close())
  if (role) {
    const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const exp = Math.floor(Date.now() / 1000) + 3600
    const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: {}, identities: [] }
    const accessToken = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: user.id }) + '.local-fixture-only'
    await context.addInitScript(session => localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session)), { access_token: accessToken, refresh_token: 'local-fixture-only', token_type: 'bearer', expires_at: exp, expires_in: 3600, user })
  }
  await installFixtureRoutes(context, role)
}

const MIN_TAP = 44
const RPC_NAMES = ['esign_my_signer_overview', 'esign_my_signatures', 'esign_my_signature_add', 'esign_my_signature_set_default',
  'esign_my_signature_delete', 'esign_my_signature_history', 'set_esign_pin', 'esign_suspend_me']

if (!ALLOWED_HOSTS.has(new URL(BASE).hostname)) throw new BlockedError(`ปฏิเสธการยิงไปที่ ${new URL(BASE).hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)

// ── PNG เครื่องมือ (สร้างภาพทดสอบ + อ่านภาพที่หน้าจอส่งออก) ──────────────────────────────────
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
function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'ไม่ใช่ PNG')
  let offset = 8, header = null
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  assert.ok(header, 'ไม่มี IHDR')
  assert.deepEqual([header.depth, header.color, header.interlace], [8, 6, 0], 'ต้องเป็น RGBA 8 บิต ไม่สลับบรรทัด')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = header.width * 4
  const out = Buffer.alloc(header.height * stride)
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i]
      const left = i >= 4 ? out[y * stride + i - 4] : 0
      const up = y > 0 ? out[(y - 1) * stride + i] : 0
      const upLeft = y > 0 && i >= 4 ? out[(y - 1) * stride + i - 4] : 0
      let add = 0
      if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft)
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      out[y * stride + i] = (value + add) & 255
    }
  }
  return { ...header, pixels: out }
}
const pixelAt = (png, x, y) => [...png.pixels.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)]
function inkBounds(png) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (png.pixels[(y * png.width + x) * 4 + 3] >= 12) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY }
}
const seedPng = seed => encodePng(40, 16, (x, y) => [(x * 7 + seed * 31) & 255, (y * 13 + seed * 17) & 255, seed & 255, 255])

// ── ฐานข้อมูลจำลองของ 8 RPC ──────────────────────────────────────────────────────────────────
function makeBackend({ pinSet = false, suspended = false, library = [], history = [], usedIds = [] } = {}) {
  const state = { pinSet, suspended, library: [...library], history: [...history], usedIds: new Set(usedIds), calls: [], nextId: 1, failAll: null }
  const overview = () => ({
    ok: true, pin_set: state.pinSet, pin_set_at: state.pinSet ? '2026-10-20T03:00:00Z' : null, duty_acked: state.pinSet, suspended: state.suspended,
    suspended_at: state.suspended ? '2026-10-23T03:00:00Z' : null, locked_until: null, failed_count: 0, image_count: state.library.length,
    signature_count: state.history.filter(h => !h.revoked).length, signature_count_month: state.history.filter(h => !h.revoked).length,
  })
  const handlers = {
    esign_my_signer_overview: () => overview(),
    esign_my_signatures: () => ({ ok: true, max: 5, items: state.library }),
    esign_my_signature_history: () => ({ ok: true, items: state.history }),
    esign_my_signature_add: args => {
      const png = Buffer.from(args.p_png_base64, 'base64')
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return { ok: false, code: 'invalid_image' }
      if (state.library.length >= 5) return { ok: false, code: 'too_many_images', max: 5 }
      const id = `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`
      const isDefault = state.library.length === 0 || args.p_make_default
      if (isDefault) state.library = state.library.map(item => ({ ...item, is_default: false }))
      state.library.push({ id, label: args.p_label, is_default: isDefault, created_at: '2026-10-23T03:00:00Z', width: 100, height: 40, png_base64: args.p_png_base64 })
      return { ok: true, id, already: false, is_default: isDefault }
    },
    esign_my_signature_set_default: args => {
      if (!state.library.some(item => item.id === args.p_id)) return { ok: false, code: 'image_not_found' }
      state.library = state.library.map(item => ({ ...item, is_default: item.id === args.p_id }))
      return { ok: true }
    },
    esign_my_signature_delete: args => {
      if (!state.library.some(item => item.id === args.p_id)) return { ok: false, code: 'image_not_found' }
      const kept = state.usedIds.has(args.p_id)
      state.library = state.library.filter(item => item.id !== args.p_id)
      if (state.library.length && !state.library.some(item => item.is_default)) state.library[0].is_default = true
      return { ok: true, kept_as_evidence: kept }
    },
    set_esign_pin: args => {
      if (!/^[0-9]{6}$/.test(args.p_pin)) return { ok: false, code: 'invalid_pin' }
      if (args.p_pin === '111111') return { ok: false, code: 'weak_pin' }
      if (state.pinSet) {
        // เหมือน set_esign_pin จริง: รหัสเดิมผิดนับเข้าตัวล็อก แต่ไม่ส่ง remaining กลับ (ตรวจกับฐานข้อมูลจริง 2026-10-23)
        if (args.p_current_pin !== '246810') return { ok: false, code: 'bad_pin' }
      } else if (!args.p_ack_duty) return { ok: false, code: 'duty_ack_required' }
      state.pinSet = true
      return { ok: true }
    },
    esign_suspend_me: () => { state.suspended = true; return { ok: true } },
  }
  state.handle = (name, args) => {
    state.calls.push({ name, args })
    if (state.failAll) return state.failAll // ทุกครั้ง ไม่ใช่ครั้งเดียว — dev server ใช้ StrictMode เรียก effect ซ้ำสองรอบ
    return handlers[name](args)
  }
  return state
}

async function installBackend(context, backend) {
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  if (fixtureRoles.has(context)) await installFixtureRoutes(context, fixtureRoles.get(context))
  const pattern = new RegExp(`/rest/v1/rpc/(${RPC_NAMES.join('|')})(\\?|$)`)
  await context.route(pattern, async route => {
    const request = route.request()
    const origin = request.headers().origin || '*'
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    const name = pattern.exec(request.url())[1]
    const body = backend.handle(name, request.postDataJSON() ?? {})
    if (backend.delayMs) await new Promise(resolve => setTimeout(resolve, backend.delayMs))
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
  })
}

// ── เบราว์เซอร์/เซสชัน ───────────────────────────────────────────────────────────────────────
async function transferDemoSession(page) {
  if (!/^https?:\/\/(demo\.localhost|localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await safeEvaluate(page, () => Object.entries(localStorage).filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'), undefined, [])
  if (!entries.find(([key]) => key.endsWith('-auth-token'))) throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  await page.addInitScript(pairs => { for (const [key, value] of pairs) { try { localStorage.setItem(key, value) } catch { /* ไม่มีโควตา */ } } }, entries)
}

async function withProfile(name, fn) {
  if (FIXTURE_AUTH || name === 'ANONYMOUS') {
    const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    try {
      if (FIXTURE_AUTH) await prepareFixture(context, name)
      const page = await context.newPage()
      const auth = trackProfileResolution(page)
      return await fn(page, auth, context)
    } finally { await context.close(); await browser.close() }
  }
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

async function openSignatures(page, auth) {
  await page.goto('about:blank')
  await page.goto(`${BASE}${SIGNATURE_PATH}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(page, auth)
  if (new URL(page.url()).pathname !== SIGNATURE_PATH) throw new BlockedError(`ถูกพาออกจากหน้าลายเซ็นไปที่ ${new URL(page.url()).pathname}`)
  // กล่อง "เพิ่มเบอร์มือถือ" เด้งทับหลังโหลดหน้า ~5 วิ — รอบแรกต้องรอให้เด้งแล้วกดข้าม (จำใน sessionStorage ไม่เขียน DB) ไม่งั้นบังปุ่มที่จะกดต่อ
  // รอบหลังจำการข้ามไว้แล้ว ไม่ต้องรอ
  if (!FIXTURE_AUTH) await page.getByRole('button', { name: 'ข้ามไปก่อน' }).first().click({ timeout: phoneModalSkipped ? 800 : 9_000 }).catch(() => {})
  phoneModalSkipped = true
  await page.locator('[data-my-signatures-page]').waitFor({ timeout: 30_000 })
}

let phoneModalSkipped = false
const section = page => page.locator('[data-my-esign]')
const noOverflow = async (page, where) => {
  const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
  assert.ok(m.scrollW <= m.clientW + 1, `${where}: เลื่อนแนวนอน (${m.scrollW} > ${m.clientW})`)
}
const tapSize = async (locator, where) => {
  const box = await locator.boundingBox()
  assert.ok(box, `${where}: ไม่พบปุ่ม`)
  assert.ok(box.height >= MIN_TAP - 0.5 && box.width >= MIN_TAP - 0.5, `${where}: ปุ่มเล็กกว่า ${MIN_TAP}px (${Math.round(box.width)}×${Math.round(box.height)})`)
}
async function openSection(page) {
  await page.locator('[data-esign-status]').waitFor({ timeout: 15_000 })
}
async function drawStrokes(page, strokes) {
  const box = await page.locator('[data-signature-pad]').boundingBox()
  for (const stroke of strokes) {
    await page.mouse.move(box.x + stroke[0][0] * box.width, box.y + stroke[0][1] * box.height)
    await page.mouse.down()
    for (const [x, y] of stroke.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 6 })
    await page.mouse.up()
  }
}
const SCRIBBLE = [[[0.15, 0.55], [0.3, 0.3], [0.45, 0.7], [0.6, 0.35], [0.8, 0.6]], [[0.2, 0.8], [0.5, 0.78], [0.85, 0.82]]]
const lastCall = (backend, name) => backend.calls.filter(call => call.name === name).at(-1)

// ── ตรวจ ──────────────────────────────────────────────────────────────────────────────────────
async function checkDedicatedAndLegacy(page, auth, context) {
  const backend = makeBackend({ pinSet: true })
  await installBackend(context, backend)
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' })
  await waitForSettled(page, auth)
  await page.locator('[data-profile-signatures]').waitFor()
  assert.equal(await section(page).count(), 0, 'โปรไฟล์ต้องเหลือเฉพาะทางลัด')
  assert.equal(backend.calls.length, 0, 'หน้าโปรไฟล์ต้องไม่โหลดข้อมูลลายเซ็น')
  await page.locator('[data-profile-signatures]').click()
  await page.waitForURL(url => url.pathname === SIGNATURE_PATH)
  await openSection(page)
  assert.equal(await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).getAttribute('href'), '/profile')
  assert.equal(await page.locator('[data-my-esign-toggle]').count(), 0, 'หน้าเฉพาะต้องเปิดส่วนจัดการทันที')
  assert.deepEqual([...new Set(backend.calls.map(c => c.name))].sort(), ['esign_my_signature_history', 'esign_my_signatures', 'esign_my_signer_overview'])
  await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/profile')
  await waitForSettled(page, auth)
  await page.locator('[data-account-menu-button]:visible').click()
  await page.locator('[data-account-signature]').click()
  await page.waitForURL(url => url.pathname === SIGNATURE_PATH)
  await openSection(page)
  backend.delayMs = 1800
  await page.goto('about:blank')
  await page.goto(`${BASE}/profile#signature`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(url => url.pathname === SIGNATURE_PATH)
  await section(page).waitFor()
  assert.equal(await page.locator('[data-esign-status]').count(), 0, 'ระหว่างโหลดต้องไม่แสดงสถานะ PIN ที่เดาเอง')
  const pending = await section(page).innerText()
  assert(!pending.includes('ยังไม่ได้ตั้งรหัสลงนาม') && !pending.includes('ยังไม่มีลายเซ็นภาพ'))
  await openSection(page)
  backend.delayMs = 0
  assert.equal(await page.locator('[data-signature-empty]').count(), 1)
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-profile-signatures]').waitFor()
  await page.evaluate(() => { window.location.hash = '#signature' })
  await page.waitForURL(url => url.pathname === SIGNATURE_PATH)
  await openSection(page)
  return 'หน้าเฉพาะโหลดทันที · โปรไฟล์ไม่อ่านคลัง · ลิงก์เก่า redirect โดยไม่เปลี่ยนสิทธิ์'
}

async function checkDrawFlow(page, auth, context) {
  const backend = makeBackend({ pinSet: true })
  await installBackend(context, backend)
  await openSignatures(page, auth)
  await openSection(page)
  const add = page.locator('[data-add-signature]')
  await tapSize(add, 'ปุ่มเพิ่มลายเซ็น')
  await add.click()
  const dialog = page.locator('[data-add-signature-dialog]')
  await dialog.waitFor()
  const fit = await dialog.evaluate(element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, left: r.left, right: r.right, w: innerWidth } })
  assert.ok(fit.top >= 0 && fit.bottom <= fit.h + 1 && fit.left >= 0 && fit.right <= fit.w + 1, `กล่องล้นจอ ${JSON.stringify(fit)}`)
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[data-add-signature-dialog]')), 'โฟกัสต้องเข้าไปในกล่อง')
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), true, 'ยังไม่เซ็นต้องกดบันทึกไม่ได้')
  for (const button of await dialog.locator('button').all()) {
    const box = await button.boundingBox()
    const name = (await button.getAttribute('aria-label')) || (await button.innerText()).trim() || 'ปุ่ม'
    assert.ok(box && box.height >= MIN_TAP - 0.5, `ปุ่ม "${name}" ในกล่องเตี้ยกว่า ${MIN_TAP}px (${Math.round(box?.height ?? 0)})`)
    if (await button.getAttribute('aria-label')) assert.ok(box.width >= MIN_TAP - 0.5, `ปุ่มไอคอน "${name}" แคบกว่า ${MIN_TAP}px (${Math.round(box.width)})`)
  }

  // Esc ปิดและคืนโฟกัสปุ่มที่เปิด
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-add-signature')), 'ปิดด้วย Esc แล้วโฟกัสต้องกลับปุ่มเพิ่มลายเซ็น')
  await add.click()
  await dialog.waitFor()

  // ย้อน/ล้าง
  await drawStrokes(page, SCRIBBLE)
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), false)
  await dialog.locator('button:has-text("ย้อน")').click()
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), false, 'ย้อนเส้นล่าสุดแล้วยังเหลืออีกเส้น')
  await dialog.locator('button:has-text("ย้อน")').click()
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), true, 'ย้อนหมดแล้วต้องกดบันทึกไม่ได้')
  await drawStrokes(page, SCRIBBLE)
  await dialog.locator('button:has-text("ล้าง")').click()
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), true, 'ล้างแล้วต้องกดบันทึกไม่ได้')

  // เซ็นจริงด้วยสีดำ ปากกาหนา แล้วบันทึก
  await dialog.locator('button[aria-label="ดำ"]').click()
  await dialog.locator('button:has-text("หนา")').click()
  await dialog.locator('#signature-label').fill('ลายเซ็นทดสอบ')
  await drawStrokes(page, SCRIBBLE)
  await page.locator('[data-save-signature]').click()
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  const call = lastCall(backend, 'esign_my_signature_add')
  assert.ok(call, 'ไม่มีการเรียก esign_my_signature_add')
  assert.equal(call.args.p_label, 'ลายเซ็นทดสอบ')
  assert.equal(call.args.p_make_default, true, 'แบบแรกต้องส่งเป็นค่าเริ่มต้น')
  assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(call.args.p_png_base64), 'base64 ต้องสะอาด (ไม่มี prefix/ขึ้นบรรทัดใหม่)')
  const bytes = Buffer.from(call.args.p_png_base64, 'base64')
  assert.ok(bytes.length <= 50000, `PNG ใหญ่เกินเพดานฐานข้อมูล (${bytes.length})`)
  const png = decodePng(bytes)
  assert.ok(png.width <= 640 && png.height <= 320, `ขนาดเกิน ${png.width}×${png.height}`)
  assert.deepEqual(pixelAt(png, 0, 0).slice(3), [0], 'มุมภาพต้องโปร่งใส')
  assert.deepEqual(pixelAt(png, png.width - 1, png.height - 1).slice(3), [0])
  const box = inkBounds(png)
  assert.ok(box, 'ภาพว่าง')
  const margin = Math.max(box.minX, box.minY, png.width - 1 - box.maxX, png.height - 1 - box.maxY)
  assert.ok(margin <= Math.round(Math.max(png.width, png.height) * 0.08) + 6, `ตัดขอบไม่แน่น (ขอบว่างสูงสุด ${margin}px ในภาพ ${png.width}×${png.height})`)
  // สีหมึกตรงที่เลือก (ดำ #111827) — ดูพิกเซลทึบเต็มทั้งหมด
  const opaque = []
  for (let i = 0; i < png.pixels.length; i += 4) if (png.pixels[i + 3] === 255) opaque.push([png.pixels[i], png.pixels[i + 1], png.pixels[i + 2]])
  assert.ok(opaque.length > 50, 'ไม่มีพิกเซลหมึกทึบ')
  assert.ok(opaque.every(([r, g, b]) => Math.abs(r - 0x11) <= 3 && Math.abs(g - 0x18) <= 3 && Math.abs(b - 0x27) <= 3), 'สีหมึกไม่ตรงสีที่เลือก')
  await page.locator('[data-signature-card]').first().waitFor()
  assert.equal(await page.locator('[data-signature-card]').count(), 1)
  assert.ok(await page.locator('[data-signature-card]').first().innerText().then(text => text.includes('ค่าเริ่มต้น')), 'แบบแรกต้องมีป้ายค่าเริ่มต้น')
  return `PNG ${png.width}×${png.height} ${bytes.length} ไบต์ โปร่งใส ตัดขอบแน่น สีตรง`
}

async function jpegBytesInPage(page) {
  // ภาพลายเซ็นบนกระดาษเทา (ถ่ายในที่สลัว) เป็น JPEG จริง — สร้างด้วย canvas ในหน้าเอง
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 800; canvas.height = 400
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#c9c9c4'; ctx.fillRect(0, 0, 800, 400)
    ctx.strokeStyle = '#1b2a6b'; ctx.lineWidth = 7; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(120, 260); ctx.bezierCurveTo(240, 40, 330, 380, 470, 150); ctx.bezierCurveTo(540, 60, 640, 300, 700, 200); ctx.stroke()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    const buffer = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of buffer) binary += String.fromCharCode(byte)
    return btoa(binary)
  })
  return Buffer.from(base64, 'base64')
}

async function checkUploadFlow(page, auth, context) {
  const backend = makeBackend({ pinSet: true })
  await installBackend(context, backend)
  await openSignatures(page, auth)
  await openSection(page)
  await page.locator('[data-add-signature]').click()
  const dialog = page.locator('[data-add-signature-dialog]')
  await dialog.waitFor()
  await page.locator('[data-tab-upload]').click()
  const input = page.locator('[data-signature-file]')
  const before = backend.calls.length

  // ไฟล์ผิดชนิด/ภาพขาวล้วน/ไฟล์ที่ไม่ใช่ภาพจริง → ข้อความไทย ไม่ยิง RPC
  await input.setInputFiles({ name: 'sign.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') })
  assert.ok((await page.locator('[data-signature-error]').innerText()).includes('PNG หรือ JPG'))
  await input.setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: encodePng(200, 80, () => [255, 255, 255, 255]) })
  await page.locator('[data-signature-error]').filter({ hasText: 'ไม่พบลายเซ็นในภาพ' }).waitFor()
  await input.setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image at all') })
  await page.locator('[data-signature-error]').filter({ hasText: 'เปิดไฟล์ภาพนี้ไม่ได้' }).waitFor()
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), true)
  assert.equal(backend.calls.length, before, 'ไฟล์ที่ถูกปฏิเสธต้องไม่ยิง RPC')

  // PNG พื้นขาว + เส้นน้ำเงิน → พื้นโปร่งใส เส้นยังอยู่
  const stroke = encodePng(300, 120, (x, y) => (Math.abs(y - (60 + Math.sin(x / 25) * 30)) < 3 && x > 20 && x < 280 ? [20, 40, 140, 255] : [255, 255, 255, 255]))
  await input.setInputFiles({ name: 'sign.png', mimeType: 'image/png', buffer: stroke })
  await page.locator('[data-upload-preview]').waitFor()
  await page.locator('#signature-label').fill('จากไฟล์ PNG')
  await page.locator('[data-save-signature]').click()
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  let png = decodePng(Buffer.from(lastCall(backend, 'esign_my_signature_add').args.p_png_base64, 'base64'))
  assert.deepEqual(pixelAt(png, 0, 0).slice(3), [0], 'PNG: พื้นขาวต้องโปร่งใส')
  assert.ok(inkBounds(png), 'PNG: เส้นหายหมด')
  assert.ok(png.width <= 640 && png.height <= 320)

  // JPEG บนกระดาษเทา → พื้นเทาต้องโปร่งใส ไม่เหลือหมอก
  await page.locator('[data-add-signature]').click()
  await dialog.waitFor()
  await page.locator('[data-tab-upload]').click()
  await page.locator('[data-signature-file]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await jpegBytesInPage(page) })
  await page.locator('[data-upload-preview]').waitFor({ timeout: 15_000 })
  await page.locator('[data-save-signature]').click()
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  png = decodePng(Buffer.from(lastCall(backend, 'esign_my_signature_add').args.p_png_base64, 'base64'))
  assert.ok(png.pixels.length / 4 > 100)
  let hazy = 0, total = 0
  for (let i = 0; i < png.pixels.length; i += 4) { total++; if (png.pixels[i + 3] > 12 && png.pixels[i] > 150) hazy++ }
  assert.ok(hazy / total < 0.01, `JPEG: พื้นเทายังเหลือหมอก ${(hazy / total * 100).toFixed(1)}%`)
  assert.ok(inkBounds(png), 'JPEG: เส้นหายหมด')
  await page.locator('[data-signature-card]').nth(1).waitFor({ timeout: 10_000 })
  assert.equal(await page.locator('[data-signature-card]').count(), 2)
  return 'ปฏิเสธ svg/ภาพว่าง/ไฟล์เสีย · PNG และ JPEG เทาลบพื้นได้'
}

async function checkLibrary(page, auth, context) {
  const seeds = [1, 2, 3, 4, 5].map(n => ({ id: `00000000-0000-4000-8000-00000000010${n}`, label: `แบบที่ ${n}`, is_default: n === 1, created_at: '2026-10-2' + n + 'T03:00:00Z', width: 40, height: 16, png_base64: seedPng(n).toString('base64') }))
  const backend = makeBackend({ pinSet: true, library: seeds, usedIds: [seeds[1].id] })
  await installBackend(context, backend)
  await openSignatures(page, auth)
  await openSection(page)
  assert.equal(await page.locator('[data-signature-card]').count(), 5)
  assert.equal(await page.locator('[data-add-signature]').isDisabled(), true, 'ครบ 5 แบบต้องเพิ่มไม่ได้')
  assert.ok((await section(page).innerText()).includes('ครบ 5 แบบแล้ว'))
  const defaults = await page.locator('[data-signature-card]').getByText('ค่าเริ่มต้น', { exact: true }).count()
  assert.equal(defaults, 1, 'ต้องมีค่าเริ่มต้นแบบเดียว')
  const broken = await page.locator('[data-signature-card] img').evaluateAll(images => images.filter(img => !img.complete || img.naturalWidth === 0).length)
  assert.equal(broken, 0, 'รูปในคลังไม่แสดง')

  // ตั้งค่าเริ่มต้น
  await page.locator('[data-signature-card]', { hasText: 'แบบที่ 3' }).getByRole('button', { name: 'ตั้งเป็นค่าเริ่มต้น' }).click()
  await page.locator('[data-signature-card]', { hasText: 'แบบที่ 3' }).getByText('ค่าเริ่มต้น', { exact: true }).waitFor()
  assert.equal(lastCall(backend, 'esign_my_signature_set_default').args.p_id, seeds[2].id)

  // ลบสองขั้น: ขั้นแรกยังไม่ลบ + มีข้อความหลักฐาน · ยกเลิกได้
  const second = page.locator('[data-signature-card]', { hasText: 'แบบที่ 2' })
  await second.locator('[data-delete-signature]').click()
  assert.ok((await second.innerText()).includes('เก็บไว้เป็นหลักฐาน'), 'ต้องบอกก่อนลงมือว่าใบที่ลงนามไปแล้วยังเห็นภาพเดิม')
  assert.equal(backend.calls.filter(call => call.name === 'esign_my_signature_delete').length, 0, 'กดลบครั้งแรกต้องยังไม่ลบ')
  await second.getByRole('button', { name: 'ยกเลิก' }).click()
  assert.equal(await page.locator('[data-signature-card]').count(), 5)
  await second.locator('[data-delete-signature]').click()
  await second.locator('[data-confirm-delete]').click()
  await page.locator('[data-signature-card]').nth(4).waitFor({ state: 'detached', timeout: 10_000 })
  assert.equal(await page.locator('[data-signature-card]').count(), 4)
  assert.ok((await section(page).innerText()).includes('ยังแสดงภาพเดิม'), 'ภาพที่เคยใช้ลงนามแล้วต้องแจ้งว่าเก็บไว้เป็นหลักฐาน')
  assert.equal(await page.locator('[data-add-signature]').isDisabled(), false, 'ลบแล้วต้องเพิ่มได้อีก')
  return 'ค่าเริ่มต้น · ลบสองขั้น · ข้อความหลักฐาน · เพดาน 5'
}

async function checkPinAndSuspend(page, auth, context) {
  const backend = makeBackend({ pinSet: false })
  await installBackend(context, backend)
  await openSignatures(page, auth)
  await openSection(page)
  const save = page.locator('[data-save-pin]')
  await tapSize(save, 'ปุ่มตั้งรหัส')
  assert.equal(await page.locator('#esign-pin-current').count(), 0, 'ตั้งครั้งแรกไม่มีช่องรหัสเดิม')
  assert.equal(await save.isDisabled(), true)
  await page.locator('#esign-pin-next').fill('24a681')
  assert.equal(await page.locator('#esign-pin-next').inputValue(), '24681', 'ตัวอักษรที่ไม่ใช่ตัวเลขต้องถูกตัดออก')
  await page.locator('#esign-pin-next').fill('246810')
  await page.locator('#esign-pin-confirm').fill('246811')
  await page.locator('[data-pin-mismatch]').waitFor()
  await page.locator('#esign-duty-ack').check()
  assert.equal(await save.isDisabled(), true, 'ยืนยันไม่ตรงต้องกดไม่ได้')
  await page.locator('#esign-pin-confirm').fill('246810')
  assert.equal(await page.locator('[data-pin-mismatch]').count(), 0)
  await page.locator('#esign-duty-ack').uncheck()
  assert.equal(await save.isDisabled(), true, 'ไม่ติ๊กรับทราบหน้าที่ต้องกดไม่ได้')
  await page.locator('#esign-duty-ack').check()
  assert.equal(await save.isDisabled(), false)

  // รหัสเดาง่ายจาก DB → ข้อความไทยของ DB
  await page.locator('#esign-pin-next').fill('111111')
  await page.locator('#esign-pin-confirm').fill('111111')
  await save.click()
  await page.getByRole('alert').filter({ hasText: 'รหัสเดาง่ายเกินไป' }).waitFor()
  await page.locator('#esign-pin-next').fill('246810')
  await page.locator('#esign-pin-confirm').fill('246810')
  await save.click()
  await page.getByRole('status').filter({ hasText: 'ตั้งรหัสลงนามแล้ว' }).waitFor()
  const call = backend.calls.filter(item => item.name === 'set_esign_pin').at(-1)
  assert.deepEqual(call.args, { p_pin: '246810', p_current_pin: null, p_ack_duty: true })
  await page.locator('#esign-pin-current').waitFor()
  assert.equal(await page.locator('#esign-duty-ack').count(), 0, 'ตั้งแล้วไม่ต้องรับทราบซ้ำ')

  // เปลี่ยนรหัส: รหัสเดิมผิด → ต้องเตือนเรื่องล็อก (DB ฟังก์ชันนี้ไม่ส่งจำนวนที่เหลือ จึงเตือนแบบไม่มีตัวเลข)
  await page.locator('#esign-pin-current').fill('000001')
  await page.locator('#esign-pin-next').fill('135790')
  await page.locator('#esign-pin-confirm').fill('135790')
  await save.click()
  const wrongAlert = page.getByRole('alert').filter({ hasText: 'รหัสลงนามไม่ถูกต้อง' })
  await wrongAlert.waitFor()
  assert.ok((await wrongAlert.innerText()).includes('ผิดสะสมครบ 5 ครั้ง ระบบจะล็อกการลงนาม 15 นาที'), 'รหัสเดิมผิดต้องเตือนเรื่องล็อก แม้ DB ไม่ส่ง remaining')
  await page.locator('#esign-pin-current').fill('246810')
  await save.click()
  await page.getByRole('status').filter({ hasText: 'เปลี่ยนรหัสลงนามแล้ว' }).waitFor()
  assert.deepEqual(backend.calls.filter(item => item.name === 'set_esign_pin').at(-1).args, { p_pin: '135790', p_current_pin: '246810', p_ack_duty: false })

  // ระงับสองขั้น
  const suspend = page.locator('[data-suspend-me]')
  await tapSize(suspend, 'ปุ่มระงับ')
  await suspend.click()
  assert.equal(backend.calls.filter(item => item.name === 'esign_suspend_me').length, 0, 'กดครั้งแรกต้องยังไม่ระงับ')
  await tapSize(page.locator('[data-confirm-suspend]'), 'ปุ่มยืนยันระงับ')
  await page.locator('#esign-suspend-reason').fill('โทรศัพท์หาย')
  await page.locator('[data-confirm-suspend]').click()
  await page.locator('[data-suspended-note]').waitFor()
  assert.equal(lastCall(backend, 'esign_suspend_me').args.p_reason, 'โทรศัพท์หาย')
  assert.ok((await page.locator('[data-esign-status]').innerText()).includes('ระงับการลงนามอยู่'))
  assert.equal(await page.locator('[data-suspend-me]').count(), 0, 'ระงับแล้วต้องไม่มีปุ่มระงับซ้ำ')
  return 'ตั้ง/เปลี่ยนรหัส · ตรวจฝั่งหน้าจอ · ข้อความของ DB · ระงับสองขั้น'
}

async function checkHistory(page, auth, context) {
  const history = [
    { signature_id: 'a1', doc_type: 'fleet_trip_request', doc_id: 'x', slot: 'requester', slot_label: 'ผู้ขออนุญาต', decision: 'sign', signed_at: '2026-10-23T03:00:00Z', revoked: false, revoked_at: null, with_image: true },
    { signature_id: 'a2', doc_type: 'fleet_trip_request', doc_id: 'y', slot: 'authority', slot_label: 'ผู้มีอำนาจสั่งใช้ยานพาหนะ', decision: 'approve', signed_at: '2026-10-22T03:00:00Z', revoked: true, revoked_at: '2026-10-22T04:00:00Z', with_image: false },
  ]
  const backend = makeBackend({ pinSet: true, history })
  await installBackend(context, backend)
  await openSignatures(page, auth)
  await openSection(page)
  const text = await page.locator('[data-history-list]').innerText()
  for (const expected of ['ลงนาม: ผู้ขออนุญาต', 'อนุมัติ: ผู้มีอำนาจสั่งใช้ยานพาหนะ', 'แนบภาพ', 'ถอนแล้ว']) assert.ok(text.includes(expected), `ประวัติไม่มี "${expected}"`)
  assert.ok(!/สำนักงานจังหวัด|ปลายทาง:/.test(text), 'ประวัติต้องไม่มีปลายทางของคำขอ')
  // ข้อผิดพลาดจาก DB แสดงเป็นข้อความไทย ไม่ใช่รหัสดิบ
  backend.failAll = { ok: false, code: 'forbidden' }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForSettled(page, auth)
  await page.locator('[data-my-esign]').waitFor()
  await page.getByRole('alert').filter({ hasText: 'ไม่มีสิทธิ์ทำรายการนี้' }).waitFor({ timeout: 15_000 })
  backend.failAll = null
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click()
  await openSection(page)
  assert.equal(await page.getByRole('alert').count(), 0)
  return 'ประวัติ 2 รายการ · ข้อผิดพลาดเป็นข้อความไทย · ลองโหลดใหม่ได้'
}

async function checkLayout(page, auth, context, width, height) {
  const seeds = [1, 2].map(n => ({ id: `00000000-0000-4000-8000-00000000020${n}`, label: `แบบที่ ${n}`, is_default: n === 1, created_at: '2026-10-2' + n + 'T03:00:00Z', width: 40, height: 16, png_base64: seedPng(n).toString('base64') }))
  const backend = makeBackend({ pinSet: false, library: seeds })
  await installBackend(context, backend)
  await page.setViewportSize({ width, height })
  await openSignatures(page, auth)
  await openSection(page)
  await noOverflow(page, `${width}px หน้าลายเซ็น`)
  assert(await page.locator('[data-my-signatures-page]').evaluate(el => el.scrollWidth <= el.clientWidth), 'เนื้อหาหน้าลายเซ็นถูกตัดแนวนอน')
  await tapSize(page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }), 'ปุ่มกลับหน้าก่อนหน้า')
  assert.equal(await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).getAttribute('href'), '/staff', 'เปิดตรงต้องมีปลายทางกลับที่ใช้ได้')
  if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `page-${width}.png`) })
  // AppShell เลื่อนใน main การถ่าย element ยาวนอก scrollport จะได้ส่วนล่างว่าง ให้เก็บภาพ viewport จริง
  if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `section-${width}.png`) })
  for (const selector of ['[data-add-signature]', '[data-save-pin]', '[data-suspend-me]', '[data-delete-signature]']) await tapSize(page.locator(selector).first(), `${width}px ${selector}`)
  const imgs = await page.locator('[data-signature-card] img').evaluateAll(list => list.map(img => img.getBoundingClientRect().width))
  assert.ok(imgs.every(w => w > 20), 'ภาพในการ์ดเล็กเกินไป')
  await page.locator('[data-add-signature]').click()
  await page.locator('[data-add-signature-dialog]').waitFor()
  await noOverflow(page, `${width}px กล่องเพิ่มลายเซ็น`)
  const geo = await page.evaluate(() => {
    const d = document.querySelector('[data-add-signature-dialog]').getBoundingClientRect()
    const c = document.querySelector('[data-signature-pad]').getBoundingClientRect()
    return { dTop: d.top, dBottom: d.bottom, dLeft: d.left, dRight: d.right, w: innerWidth, h: innerHeight, padW: c.width, padH: c.height }
  })
  assert.ok(geo.dLeft >= 0 && geo.dRight <= geo.w + 1 && geo.dTop >= -1 && geo.dBottom <= geo.h + 1, `กล่องล้นจอ ${JSON.stringify(geo)}`)
  assert.ok(Math.abs(geo.padW / geo.padH - 2) < 0.05, `แผ่นเซ็นต้องสัดส่วน 2:1 (${geo.padW}×${geo.padH})`)
  assert.ok(geo.padW >= Math.min(300, width - 60), `แผ่นเซ็นแคบเกินไป ${Math.round(geo.padW)}px`)
  // หมุนจอ/ย่อขยายหลังเซ็นแล้วเส้นต้องไม่หาย (เก็บเป็นพิกัดสัดส่วน)
  await drawStrokes(page, SCRIBBLE)
  if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `dialog-${width}.png`) })
  await page.setViewportSize({ width: width === 390 ? 844 : 900, height: width === 390 ? 390 : 700 })
  await page.waitForTimeout(400)
  assert.equal(await page.locator('[data-save-signature]').isDisabled(), false, 'ปรับขนาดจอแล้วลายเซ็นต้องไม่หาย')
  const painted = await page.locator('[data-signature-pad]').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 3; i < data.length; i += 4) if (data[i] > 20) return true
    return false
  })
  assert.ok(painted, 'ปรับขนาดแล้ววาดซ้ำไม่ออก')
  return `${width}px ไม่ล้น · ปุ่ม ≥ 44px · แผ่นเซ็น 2:1 · หมุนจอแล้วเส้นไม่หาย`
}

async function checkCitizen() {
  return withProfile(CITIZEN_PROFILE, async (page, auth, context) => {
    const backend = makeBackend({})
    await installBackend(context, backend)
    await page.goto(`${BASE}${SIGNATURE_PATH}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForSettled(page, auth)
    await page.waitForURL(url => url.pathname === '/')
    assert.notEqual(new URL(page.url()).pathname, SIGNATURE_PATH, 'ประชาชนต้องถูกกันที่ route')
    assert.equal(await page.locator('[data-my-esign]').count(), 0, 'ประชาชนต้องไม่เห็นส่วนลายเซ็นของฉัน')
    assert.equal(backend.calls.length, 0, 'ประชาชนต้องไม่ยิง RPC ลายเซ็น')
    return 'ประชาชนไม่เห็นส่วนนี้และไม่ยิง RPC'
  })
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
      if (process.env.ES_SHOTS) console.log('   stack:', String(error.stack).split('\n').filter(line => line.includes('esign-profile')).slice(0, 4).join(' <- '))
      if (process.env.ES_SHOTS && shotPage) console.log('   debug:', JSON.stringify(await shotPage.evaluate(() => ({ url: location.href, w: innerWidth, h: innerHeight, esign: document.querySelectorAll('[data-my-esign]').length, vis: (() => { const el = document.querySelector('[data-my-esign]'); if (!el) return null; const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return { w: r.width, h: r.height, vis: st.visibility, disp: st.display, op: st.opacity } })() })).catch(e => String(e))))
      if (process.env.ES_SHOTS && shotPage) await shotPage.screenshot({ path: path.join(process.env.ES_SHOTS, `fail-${total}.png`), fullPage: true }).catch(() => {})
      console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  ${label} — ${String(error.message).split('\n').slice(0, 3).join(' | ')}`)
    }
  }
  await withProfile(STAFF_PROFILE, async (page, auth, context) => {
    shotPage = page
    await run('หน้าเฉพาะ/ลิงก์เก่า/โปรไฟล์ไม่โหลด RPC', () => checkDedicatedAndLegacy(page, auth, context))
    await run('เซ็นสด → PNG ที่ส่งไปฐานข้อมูล', () => checkDrawFlow(page, auth, context))
    await run('อัปโหลด PNG/JPG', () => checkUploadFlow(page, auth, context))
    await run('คลังลายเซ็น', () => checkLibrary(page, auth, context))
    await run('รหัสลงนาม + ระงับ', () => checkPinAndSuspend(page, auth, context))
    await run('ประวัติ + ข้อผิดพลาด', () => checkHistory(page, auth, context))
    await run('เค้าโครง PC 1280', () => checkLayout(page, auth, context, 1280, 900))
    await run('เค้าโครงมือถือ 390', () => checkLayout(page, auth, context, 390, 844))
    await run('เค้าโครงมือถือ 360', () => checkLayout(page, auth, context, 360, 740))
    await run('เค้าโครงมือถือ 320', () => checkLayout(page, auth, context, 320, 568))
  })
  await run('ประชาชนไม่เห็นส่วนลายเซ็น', checkCitizen)
  await run('ผู้ไม่ล็อกอินเข้าไม่ได้', async () => withProfile('ANONYMOUS', async (page, auth, context) => {
    const backend = makeBackend()
    await installBackend(context, backend)
    await page.goto(`${BASE}${SIGNATURE_PATH}`, { waitUntil: 'domcontentloaded' })
    await waitForSettled(page, auth)
    assert.equal(new URL(page.url()).pathname, '/auth')
    assert.equal(await section(page).count(), 0)
    assert.equal(backend.calls.length, 0)
  }))
  if (FIXTURE_AUTH) await run('สิทธิ์เจ้าหน้าที่ทั้ง 7 บทบาท', async () => {
    for (const role of ['staff', 'officer', 'admin', 'superadmin', 'viewer', 'council', 'technician']) {
      await withProfile(`TEST-${role}`, async (page, auth, context) => {
        const backend = makeBackend({ pinSet: true })
        await installBackend(context, backend)
        await openSignatures(page, auth)
        await openSection(page)
        assert.equal(new URL(page.url()).pathname, SIGNATURE_PATH)
        assert.equal(await page.locator('[data-my-signatures-page]').count(), 1)
        if (role === 'admin' || role === 'technician') {
          const previous = role === 'admin' ? '/admin' : '/technician'
          await page.goto(`${BASE}${previous}`, { waitUntil: 'domcontentloaded' })
          await waitForSettled(page, auth)
          await page.locator('[data-account-menu-button]:visible').last().click()
          await page.locator('[data-account-signature]').click()
          await page.waitForURL(url => url.pathname === SIGNATURE_PATH)
          await openSection(page)
          assert.equal(await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).getAttribute('href'), previous)
        }
      })
    }
  })
  console.log(`\n${total - failed}/${total} ผ่าน`)
  process.exitCode = failed ? 1 : 0
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${String(error.message).split('\n')[0]}`)
  process.exitCode = 2
}).finally(async () => { await fixtureServer?.close() })
