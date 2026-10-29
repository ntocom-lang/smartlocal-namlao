// ป๊อปอัป/เสียง/สั่น/ตัวเลขบนไอคอนแอป เมื่อมีรายการใหม่เข้ากระดิ่ง — ทดสอบบนเบราว์เซอร์จริง
// รันด้วย: node tests/notification-device-prefs.playwright.mjs   (NDP_ENGINE=chromium ถ้าเครื่องไม่มี Chrome)
//
// ใช้ App/Router/contexts จริง แต่ API บัญชี และ realtime เป็น fixture ทั้งหมด — ไม่อ่าน Chrome profile ไม่เขียน DB จริง
// realtime: จำลองเซิร์ฟเวอร์ Phoenix (vsn 2.0.0 ข้อความ [join_ref, ref, topic, event, payload]) แล้วส่ง
// postgres_changes เข้าไปเหมือนมีคำร้องใหม่ — หน้าเว็บต้องดึงรายการรอบใหม่แล้วเด้งตามค่าที่ตั้งไว้

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const output = process.env.NDP_OUTPUT || path.join(tmpdir(), 'smartlocal-notification-device-prefs')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: process.cwd(),
  cacheDir: path.join(tmpdir(), 'smartlocal-notification-device-prefs-vite', path.basename(process.cwd())),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'),
    'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'),
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(''),
  },
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const engine = process.env.NDP_ENGINE || 'chrome'
const browser = await chromium.launch({ headless: true, ...(engine === 'chrome' ? { channel: 'chrome' } : {}) })
const uid = '00000000-0000-4000-8000-000000000101'
const mid = '00000000-0000-4000-8000-000000000102'
const prefsKey = `smartlocal_notif_device_prefs_v1_${uid}`
let complaintSeq = 40

function complaint(status, extra = {}) {
  complaintSeq += 1
  const now = new Date().toISOString()
  return {
    id: `00000000-0000-4000-8000-${String(900000000000 + complaintSeq)}`,
    complaint_number: complaintSeq, category: 'corruption', status,
    municipality_id: mid, user_id: uid, department: null, created_at: now, updated_at: now, ...extra,
  }
}

async function fixture({ role = 'staff', viewport = { width: 1366, height: 900 }, touch = false, vibrate = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' })
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST แจ้งเตือนรายเครื่อง' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: mid, role, full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const state = { complaints: [complaint(role === 'citizen' ? 'received' : 'new')], channels: [], writes: [] }

  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
      if (event === 'phx_join') {
        const changes = (payload?.config?.postgres_changes ?? []).map((change, i) => ({ ...change, id: 7000 + state.channels.length * 10 + i }))
        state.channels.push({ ws, topic, joinRef, changes })
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: changes } }]))
      } else if (ref != null) {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
  })

  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const session = { user, access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uid, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: uid })}.fixture`, refresh_token: 'fixture', token_type: 'bearer', expires_at: exp, expires_in: 3600 }
  await context.addInitScript(({ session, vibrate }) => {
    localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
    // นับเสียง/สั่น/ตัวเลขบนไอคอน ที่หน้าเว็บสั่งจริง
    window.__sound = 0
    window.__vibrations = []
    window.__badges = []
    class FakeAudioContext {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
      resume() { return Promise.resolve() }
      createOscillator() { return { frequency: {}, connect() {}, start() { window.__sound += 1 }, stop() {} } }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: async (n) => { window.__badges.push(n) } })
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: async () => { window.__badges.push(0) } })
    if (vibrate) Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern) => { window.__vibrations.push(pattern); return true } })
    else if ('vibrate' in navigator) Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined })
  }, { session, vibrate })

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const rpc = url.pathname.split('/rpc/')[1]
      if (!['GET', 'HEAD'].includes(req.method()) && rpc !== 'list_complaints_for_staff') state.writes.push(url.pathname)
      let data = []
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = { id: mid, slug: 'demo', name: 'TEST หน่วยงานทดสอบแจ้งเตือน', org_type: 'เทศบาลตำบล', ui_style: 'eco_friendly', theme_color: '#0f766e', enabled_modules: null, logo_url: null }
      else if (url.pathname.includes('/rest/v1/profiles')) data = req.headers().accept?.includes('object+json') ? profile : [profile]
      else if (rpc === 'list_complaints_for_staff') data = state.complaints
      else if (url.pathname === '/rest/v1/complaints') data = state.complaints
      else if (req.headers().accept?.includes('object+json')) data = null
      return route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    assert(['GET', 'HEAD'].includes(req.method()), 'non-GET outside fixture')
    return route.continue()
  })

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  // ส่ง postgres_changes เหมือนเซิร์ฟเวอร์ realtime แจ้งว่าคำร้องเปลี่ยน → หน้าเว็บดึงรายการรอบใหม่
  async function emitChange(type = 'INSERT') {
    await page.waitForFunction(() => true)
    const channel = state.channels.find((c) => c.changes.some((change) => change.table === 'complaints'))
    assert.ok(channel, 'หน้าเว็บต้องเข้าช่อง realtime ของคำร้องก่อน')
    channel.ws.send(JSON.stringify([channel.joinRef, null, channel.topic, 'postgres_changes', {
      ids: channel.changes.map((change) => change.id),
      data: { type, schema: 'public', table: 'complaints', commit_timestamp: new Date().toISOString(), record: { id: state.complaints[0].id }, old_record: {}, columns: [], errors: null },
    }]))
  }
  return { context, page, state, errors, emitChange }
}

const toasts = (page) => page.locator('[data-notification-toast]')
const switchOf = (page, id) => page.locator(`[data-device-pref="${id}"]`)
async function openSettings(page) {
  await page.goto(`${base}/profile/notifications`)
  await page.locator('[data-device-alert-settings]').waitFor({ timeout: 30000 })
}
async function waitForRealtime(f) {
  for (let i = 0; i < 100 && !f.state.channels.some((c) => c.changes.some((change) => change.table === 'complaints')); i++) await f.page.waitForTimeout(100)
  assert.ok(f.state.channels.length > 0, 'ไม่ได้เข้าช่อง realtime')
}
const results = []
async function test(name, options, run) {
  const f = await fixture(options)
  try {
    await run(f)
    assert.deepEqual(f.errors, [], `${name}: page errors`)
    results.push(name)
    console.log(`PASS ${name}`)
  } catch (error) {
    await f.page.screenshot({ path: path.join(output, `${name.replace(/[^\w-]+/g, '_')}.png`) }).catch(() => {})
    throw error
  } finally {
    await f.context.close()
  }
}

try {
  await test('ค่าเริ่มต้น เปิดหน้าแล้วไม่เด้งของค้าง ตัวเลขบนไอคอนตรงกระดิ่ง', {}, async ({ page }) => {
    await openSettings(page)
    assert.equal(await switchOf(page, 'popup').getAttribute('aria-checked'), 'true')
    assert.equal(await switchOf(page, 'sound').getAttribute('aria-checked'), 'false', 'เสียงต้องปิดเป็นค่าเริ่มต้น')
    assert.equal(await switchOf(page, 'vibrate').count(), 0, 'คอมไม่มีสวิตช์สั่น')
    await page.waitForFunction(() => window.__badges.includes(1))
    await page.waitForTimeout(600)
    assert.equal(await toasts(page).count(), 0, 'คำร้องที่ค้างอยู่ก่อนเปิดหน้าต้องไม่เด้ง')
    assert.equal(await page.evaluate(() => window.__sound), 0)
  })

  await test('ตั้งเสียงแล้วจำรายบัญชีบนเครื่อง ทดลองป๊อปอัป/ฟังเสียงได้', {}, async ({ page }) => {
    await openSettings(page)
    await switchOf(page, 'sound').click()
    await page.waitForFunction(() => window.__sound === 2)
    assert.match(await page.locator('[data-device-pref-status]').textContent(), /เล่นเสียงตัวอย่างแล้ว/)
    assert.deepEqual(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), prefsKey)), { popup: true, sound: true, vibrate: false })
    await page.reload()
    await page.locator('[data-device-alert-settings]').waitFor()
    assert.equal(await switchOf(page, 'sound').getAttribute('aria-checked'), 'true', 'โหลดหน้าใหม่ต้องจำค่าเดิม')
    // reload แล้วตัวนับในหน้าเริ่มใหม่ (init script รันซ้ำ)
    await page.getByRole('button', { name: 'ทดลองฟังเสียง' }).click()
    await page.waitForFunction(() => window.__sound === 2)
    await page.getByRole('button', { name: 'ทดลองป๊อปอัป' }).click()
    await toasts(page).first().waitFor()
    assert.match(await toasts(page).first().textContent(), /ตัวอย่างการแจ้งเตือน/)
    assert.equal(await toasts(page).first().getByRole('button', { name: 'เปิดดู' }).count(), 0, 'ตัวอย่างไม่มีปุ่มเปิดดู')
    await toasts(page).first().getByRole('button', { name: 'ปิดการแจ้งเตือนนี้' }).click()
    await toasts(page).first().waitFor({ state: 'detached' })
  })

  await test('คำร้องใหม่เข้ามาสดๆ เด้งป๊อปอัป+เสียง ไม่มีชื่อหมวด กดเปิดดูไปหน้างาน', {}, async (f) => {
    const { page, state } = f
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ popup: true, sound: true, vibrate: false })), prefsKey)
    await openSettings(page)
    await waitForRealtime(f)
    await page.waitForFunction(() => window.__badges.includes(1))
    const fresh = complaint('new')
    state.complaints = [fresh, ...state.complaints]
    await f.emitChange('INSERT')
    await toasts(page).first().waitFor({ timeout: 10000 })
    const text = await toasts(page).first().textContent()
    assert.match(text, /มีคำร้องใหม่รอรับเรื่อง/)
    assert.match(text, new RegExp(`คำร้องเลขที่ \\d{4}${String(fresh.complaint_number).padStart(3, '0')}`))
    assert.doesNotMatch(text, /ทุจริต|corruption/, 'ป๊อปอัปห้ามมีชื่อหมวด')
    await page.waitForFunction(() => window.__sound === 2)
    await page.waitForFunction(() => window.__badges.at(-1) === 2)
    assert.equal(await toasts(page).count(), 1, 'เด้งเฉพาะเรื่องที่เพิ่งเข้ามา')
    await page.screenshot({ path: path.join(output, 'pc-settings-toast.png'), fullPage: true })
    // อัปเดตเรื่องเดิมโดยสถานะไม่เปลี่ยน = ไม่เด้งซ้ำ
    await f.emitChange('UPDATE')
    await page.waitForTimeout(800)
    assert.equal(await toasts(page).count(), 1)
    assert.equal(await page.evaluate(() => window.__sound), 2)
    await toasts(page).first().getByRole('button', { name: 'เปิดดู' }).click()
    await page.waitForURL((u) => new URL(u).pathname === '/staff', { timeout: 10000 })
    assert.ok(state.writes.some((p) => p.includes('/rest/v1/notification_reads')), 'กดเปิดดูต้องบันทึกว่าอ่านแล้ว')
    f.errors.length = 0 // หน้างานโหลดด้วย fixture ว่าง — ตรวจแค่ว่าพาไปถูกที่
  })

  await test('ปิดป๊อปอัปแล้วไม่เด้งกล่อง แต่เสียงยังดังตามที่ตั้ง', {}, async (f) => {
    const { page, state } = f
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ popup: false, sound: true, vibrate: false })), prefsKey)
    await openSettings(page)
    await waitForRealtime(f)
    state.complaints = [complaint('new'), ...state.complaints]
    await f.emitChange('INSERT')
    await page.waitForFunction(() => window.__sound === 2, null, { timeout: 10000 })
    assert.equal(await toasts(page).count(), 0)
  })

  await test('มือถือ Android สั่นตามที่ตั้ง ป๊อปอัปอยู่บนจอไม่ล้นขอบ', { viewport: { width: 390, height: 844 }, touch: true, vibrate: true }, async (f) => {
    const { page, state } = f
    await openSettings(page)
    await switchOf(page, 'vibrate').waitFor()
    assert.equal(await switchOf(page, 'vibrate').getAttribute('aria-checked'), 'false', 'สั่นต้องปิดเป็นค่าเริ่มต้น')
    await switchOf(page, 'vibrate').click()
    await waitForRealtime(f)
    state.complaints = [complaint('new'), ...state.complaints]
    await f.emitChange('INSERT')
    await toasts(page).first().waitFor({ timeout: 10000 })
    assert.deepEqual(await page.evaluate(() => window.__vibrations), [[30, 60, 30]])
    assert.equal(await page.evaluate(() => window.__sound), 0, 'เสียงปิดอยู่ต้องไม่ดัง')
    await page.screenshot({ path: path.join(output, 'mobile-toast.png') })
    const box = await toasts(page).first().boundingBox()
    assert.ok(box.y < 120 && box.x >= 0 && box.x + box.width <= 390, `ป๊อปอัปต้องอยู่บนจอไม่ล้นขอบ ${JSON.stringify(box)}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false, 'หน้าต้องไม่เลื่อนแนวนอน')
    const close = await toasts(page).first().getByRole('button', { name: 'ปิดการแจ้งเตือนนี้' }).boundingBox()
    assert.ok(close.width >= 44 && close.height >= 44, 'ปุ่มปิดต้องกดง่ายบนมือถือ')
  })

  await test('iPhone ไม่มีสวิตช์สั่น และบอกเหตุผล', { viewport: { width: 390, height: 844 }, touch: true, vibrate: false }, async ({ page }) => {
    await openSettings(page)
    assert.equal(await switchOf(page, 'vibrate').count(), 0)
    assert.match(await page.locator('[data-device-alert-settings]').textContent(), /ไม่รองรับการสั่นจากเว็บ/)
  })

  await test('ประชาชน: เจ้าหน้าที่เปลี่ยนสถานะคำร้อง → เด้งข้อความฝั่งประชาชน', { role: 'citizen' }, async (f) => {
    const { page, state } = f
    await openSettings(page)
    await waitForRealtime(f)
    state.complaints = [{ ...state.complaints[0], status: 'in_progress', updated_at: new Date().toISOString() }]
    await f.emitChange('UPDATE')
    await toasts(page).first().waitFor({ timeout: 10000 })
    assert.match(await toasts(page).first().textContent(), /เจ้าหน้าที่อยู่ระหว่างดำเนินการ/)
  })
} finally {
  await browser.close()
  await server.close()
}
console.log(`✓ notification-device-prefs (browser): ผ่าน ${results.length} กรณี`)
