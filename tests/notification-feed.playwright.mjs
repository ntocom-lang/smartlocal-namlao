// กระดิ่งรวม "งานของฉัน" หลายหมวด (ข้อ 3 ตั้งค่าแจ้งเตือน) — ทดสอบบนเบราว์เซอร์จริง
// รันด้วย: node tests/notification-feed.playwright.mjs   (NFD_ENGINE=chromium ถ้าเครื่องไม่มี Chrome)
//
// ใช้ App/Router/contexts จริง แต่ API บัญชี realtime และ RPC my_notification_feed เป็น fixture ทั้งหมด — ไม่แตะ DB จริง
// realtime จำลองแบบเดียวกับ tests/notification-device-prefs.playwright.mjs (Phoenix vsn 2.0.0)

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const output = process.env.NFD_OUTPUT || path.join(tmpdir(), 'smartlocal-notification-feed')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: process.cwd(),
  cacheDir: path.join(tmpdir(), 'smartlocal-notification-feed-vite', path.basename(process.cwd())),
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
const engine = process.env.NFD_ENGINE || 'chrome'
const browser = await chromium.launch({ headless: true, ...(engine === 'chrome' ? { channel: 'chrome' } : {}) })
const uid = '00000000-0000-4000-8000-000000000401'
const mid = '00000000-0000-4000-8000-000000000402'
const prefsKey = `smartlocal_notif_device_prefs_v1_${uid}`

const feedItem = {
  esign: { category: 'esign', key: 'esign:00000000-0000-4000-8000-000000000501:dept_head', ref: 't', status: 'sign', detail: 'ผอ.กอง', at: '2026-10-30T01:00:00Z' },
  eservice: (n) => ({ category: 'eservice', key: `eservice:00000000-0000-4000-8000-0000000006${String(n).padStart(2, '0')}:pending`, ref: 'r', status: 'pending', detail: 'water_supply_request', at: new Date().toISOString() }),
}

async function fixture({ role = 'staff', feed = { ok: true, categories: ['esign', 'eservice'], items: [feedItem.esign, feedItem.eservice(1)] }, feedMissing = false, clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST กระดิ่งรวม' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: mid, role, full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const now = new Date().toISOString()
  const state = {
    feed, feedCalls: 0, channels: [], reads: [],
    complaints: [{ id: '00000000-0000-4000-8000-000000000701', complaint_number: 7, category: 'road', status: role === 'citizen' ? 'received' : 'new', municipality_id: mid, user_id: uid, created_at: now, updated_at: now }],
  }
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
      if (event === 'phx_join') {
        const changes = (payload?.config?.postgres_changes ?? []).map((change, i) => ({ ...change, id: 8000 + state.channels.length * 10 + i }))
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
  await context.addInitScript(({ session }) => {
    localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
    window.__sound = 0
    class FakeAudioContext {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
      resume() { return Promise.resolve() }
      createOscillator() { return { frequency: {}, connect() {}, start() { window.__sound += 1 }, stop() {} } }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} } }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
  }, { session })
  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const rpc = url.pathname.split('/rpc/')[1]
      const single = req.headers().accept?.includes('object+json')
      let data = []
      let status = 200
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = { id: mid, slug: 'demo', name: 'TEST หน่วยงานกระดิ่งรวม', org_type: 'เทศบาลตำบล', ui_style: 'eco_friendly', theme_color: '#0f766e', enabled_modules: null, logo_url: null }
      else if (url.pathname.includes('/rest/v1/profiles')) data = single ? profile : [profile]
      else if (rpc === 'my_notification_feed') {
        state.feedCalls += 1
        if (feedMissing) { status = 404; data = { code: 'PGRST202', message: 'Could not find the function public.my_notification_feed(p_municipality_id) in the schema cache' } }
        else data = state.feed
      } else if (rpc === 'list_complaints_for_staff' || url.pathname === '/rest/v1/complaints') data = state.complaints
      else if (url.pathname === '/rest/v1/notification_reads' && req.method() === 'POST') { state.reads.push(...req.postDataJSON().map((r) => r.item_key)); data = null }
      else if (single) data = null
      return route.fulfill({ status, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    assert(['GET', 'HEAD'].includes(req.method()), 'non-GET outside fixture')
    return route.continue()
  })
  const page = await context.newPage()
  if (clock) await page.clock.install()
  const errors = []
  const consoleErrors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  async function emitComplaintChange() {
    const channel = state.channels.find((c) => c.changes.some((change) => change.table === 'complaints'))
    assert.ok(channel, 'ต้องเข้าช่อง realtime ของคำร้องก่อน')
    channel.ws.send(JSON.stringify([channel.joinRef, null, channel.topic, 'postgres_changes', {
      ids: channel.changes.map((change) => change.id),
      data: { type: 'UPDATE', schema: 'public', table: 'complaints', commit_timestamp: new Date().toISOString(), record: { id: state.complaints[0].id }, old_record: {}, columns: [], errors: null },
    }]))
  }
  return { context, page, state, errors, consoleErrors, emitComplaintChange }
}

const toasts = (page) => page.locator('[data-notification-toast]')
async function waitFor(fn, label, timeout = 10000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error(`รอไม่ถึง: ${label}`)
    await new Promise((r) => setTimeout(r, 100))
  }
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
    await f.page.screenshot({ path: path.join(output, `${name.replace(/[^\w-]+/g, '_')}.png`), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await f.context.close()
  }
}

try {
  await test('กระดิ่งแสดงงานหมวดอื่น + หน้าตั้งค่าโชว์เฉพาะหมวดที่ได้รับ', {}, async ({ page, state }) => {
    await page.goto(`${base}/notifications`)
    await page.locator('[data-feed-item="esign"]').waitFor({ timeout: 30000 })
    assert.match(await page.locator('[data-feed-item="esign"]').textContent(), /รอลงนามของคุณ.*ใบขอใช้รถ · ผอ\.กอง.*รอลงนามของฉัน/)
    assert.match(await page.locator('[data-feed-item="eservice"]').textContent(), /คำขอใหม่รอรับเรื่อง.*ขออนุญาตใช้น้ำประปา/)
    assert.equal(await page.locator('[data-feed-item]').count(), 2)
    await page.screenshot({ path: path.join(output, 'bell-feed.png'), fullPage: true })
    await page.locator('[data-feed-item="eservice"]').click()
    await page.waitForURL((u) => new URL(u).pathname === '/staff')
    await waitFor(() => state.reads.includes(feedItem.eservice(1).key), 'บันทึกว่าอ่านแล้วด้วย key ของฟีด')
    await page.goto(`${base}/profile/notifications`)
    await page.locator('[data-category-mute]').waitFor({ timeout: 30000 })
    const keys = await page.locator('[data-category-mute-key]').evaluateAll((els) => els.map((e) => e.dataset.categoryMuteKey))
    assert.deepEqual(keys, ['complaint', 'esign', 'eservice'], 'ไม่โชว์หมวดกิจกรรม/รถผู้ป่วยที่บัญชีนี้ไม่ได้รับ')
  })

  await test('งานใหม่เข้ามาตอนคำร้องเปลี่ยน → ป๊อปอัปไม่มีรายละเอียดส่วนตัว', {}, async (f) => {
    const { page, state } = f
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ popup: true, sound: true, vibrate: false, muted: [] })), prefsKey)
    await page.goto(`${base}/profile/notifications`)
    await waitFor(() => state.feedCalls >= 1 && state.channels.length > 0, 'ดึงฟีดรอบแรก + เข้าช่อง realtime')
    await page.waitForTimeout(500)
    assert.equal(await toasts(page).count(), 0, 'งานค้างเดิมต้องไม่เด้ง')
    state.feed = { ...state.feed, items: [...state.feed.items, feedItem.eservice(2)] }
    await f.emitComplaintChange()
    await toasts(page).first().waitFor({ timeout: 10000 })
    assert.match(await toasts(page).first().textContent(), /คำขอใหม่รอรับเรื่อง.*ขออนุญาตใช้น้ำประปา/)
    await page.waitForFunction(() => window.__sound === 2)
    assert.equal(await toasts(page).count(), 1, 'เด้งเฉพาะงานที่เพิ่งเข้ามา')
  })

  await test('หมวดที่ปิดเด้ง: ไม่ป๊อปอัป ไม่มีเสียง แต่ยังอยู่ในกระดิ่ง', {}, async (f) => {
    const { page, state } = f
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ popup: true, sound: true, vibrate: false, muted: ['eservice'] })), prefsKey)
    await page.goto(`${base}/profile/notifications`)
    await page.locator('[data-category-mute-key="eservice"]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-category-mute-key="eservice"]').getAttribute('aria-checked'), 'false')
    await waitFor(() => state.channels.length > 0, 'เข้าช่อง realtime')
    state.feed = { ...state.feed, items: [...state.feed.items, feedItem.eservice(3)] }
    await f.emitComplaintChange()
    await waitFor(() => state.feedCalls >= 2, 'ดึงฟีดรอบใหม่')
    await page.waitForTimeout(800)
    assert.equal(await toasts(page).count(), 0)
    assert.equal(await page.evaluate(() => window.__sound), 0)
    await page.goto(`${base}/notifications`)
    await page.locator('[data-feed-item="eservice"]').nth(1).waitFor({ timeout: 30000 })
    // เปิดหมวดกลับจากหน้าตั้งค่า → บันทึกในเครื่อง
    await page.goto(`${base}/profile/notifications`)
    await page.locator('[data-category-mute-key="eservice"]').click()
    assert.deepEqual(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), prefsKey)).muted, [])
  })

  await test('รอบดึงทุก 2 นาที: งานใหม่เด้งแม้คำร้องไม่เปลี่ยน', { clock: true }, async (f) => {
    const { page, state } = f
    await page.goto(`${base}/profile/notifications`)
    await waitFor(() => state.feedCalls >= 1, 'ดึงฟีดรอบแรก', 30000)
    state.feed = { ...state.feed, items: [...state.feed.items, feedItem.eservice(4)] }
    await page.clock.runFor(2 * 60 * 1000 + 1000)
    await waitFor(() => state.feedCalls >= 2, 'ดึงฟีดรอบ 2 นาที')
    await toasts(page).first().waitFor({ timeout: 10000 })
  })

  await test('ฐานข้อมูลยังไม่มีฟังก์ชัน: เงียบ ไม่มี error กระดิ่งคำร้องยังทำงาน', { feedMissing: true }, async ({ page, state, consoleErrors }) => {
    await page.goto(`${base}/notifications`)
    await waitFor(() => state.feedCalls >= 1, 'เรียกฟีด', 30000)
    await page.waitForTimeout(500)
    assert.equal(await page.locator('[data-feed-item]').count(), 0)
    assert.deepEqual(consoleErrors.filter((t) => /my_notification_feed|งานของฉัน/.test(t)), [], 'ห้าม log error ตอนยังไม่ได้ apply migration')
    await page.goto(`${base}/profile/notifications`)
    await page.locator('[data-device-alert-settings]').waitFor({ timeout: 30000 })
    assert.equal(await page.locator('[data-category-mute]').count(), 0, 'มีหมวดเดียว (คำร้อง) ไม่ต้องมีชุดสวิตช์รายหมวด')
  })

  await test('ประชาชนไม่เรียกฟีด', { role: 'citizen' }, async ({ page, state }) => {
    await page.goto(`${base}/profile/notifications`)
    await page.locator('[data-device-alert-settings]').waitFor({ timeout: 30000 })
    await page.waitForTimeout(800)
    assert.equal(state.feedCalls, 0)
    assert.equal(await page.locator('[data-category-mute]').count(), 0)
  })
} finally {
  await browser.close()
  await server.close()
}
console.log(`✓ notification-feed (browser): ผ่าน ${results.length} กรณี`)
