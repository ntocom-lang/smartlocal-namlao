// ปุ่มส่งทดสอบถึงเครื่อง + รายการเครื่องที่เปิดรับ (ข้อ 2 ตั้งค่าแจ้งเตือน) — ทดสอบบนเบราว์เซอร์จริง
// รันด้วย: node tests/push-test-devices.playwright.mjs   (PTD_ENGINE=chromium ถ้าเครื่องไม่มี Chrome)
//
// ใช้ App/Router/contexts จริง แต่ API บัญชี Push API และ Edge Function เป็น fixture ทั้งหมด — ไม่เขียน DB จริง ไม่ส่ง push จริง

import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const output = process.env.PTD_OUTPUT || path.join(tmpdir(), 'smartlocal-push-test-devices')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: process.cwd(),
  cacheDir: path.join(tmpdir(), 'smartlocal-push-test-devices-vite', path.basename(process.cwd())),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'),
    'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'),
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': 'globalThis.__fixturePushKey',
  },
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const engine = process.env.PTD_ENGINE || 'chrome'
const browser = await chromium.launch({ headless: true, ...(engine === 'chrome' ? { channel: 'chrome' } : {}) })
const uid = '00000000-0000-4000-8000-000000000201'
const mid = '00000000-0000-4000-8000-000000000202'
const THIS_ENDPOINT = 'https://push.example.invalid/this-device'

async function fixture({ subscribed = true, selfTestStatus = 200, viewport = { width: 1366, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 600 })
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST เครื่องที่เปิดรับ' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: mid, role: 'staff', full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const state = {
    devices: [
      { id: '00000000-0000-4000-8000-000000000301', endpoint: THIS_ENDPOINT, device_label: 'Chrome · Windows', created_at: '2026-10-29T01:00:00Z' },
      { id: '00000000-0000-4000-8000-000000000302', endpoint: 'https://push.example.invalid/old-phone', device_label: null, created_at: '2026-10-01T01:00:00Z' },
    ],
    listReads: 0, deletes: [], selfTests: [], selfTestStatus,
  }
  if (!subscribed) state.devices = state.devices.slice(1)
  await context.routeWebSocket(/.*/, (ws) => ws.close())

  const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const session = { user, access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uid, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: uid })}.fixture`, refresh_token: 'fixture', token_type: 'bearer', expires_at: exp, expires_in: 3600 }
  await context.addInitScript(({ session, endpoint }) => {
    localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
    window.__fixturePushKey = 'B' + 'A'.repeat(86)
    class FixtureNotification {
      static get permission() { return 'granted' }
      static async requestPermission() { return 'granted' }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: FixtureNotification })
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} })
    const subscription = { endpoint, getKey: () => new Uint8Array(8).buffer, unsubscribe: async () => true }
    const registration = { active: {}, pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } }
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: async () => registration })
  }, { session, endpoint: THIS_ENDPOINT })

  await context.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      let data = []
      let status = 200
      const single = req.headers().accept?.includes('object+json')
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = { id: mid, slug: 'demo', name: 'TEST หน่วยงานทดสอบเครื่อง', org_type: 'เทศบาลตำบล', ui_style: 'eco_friendly', theme_color: '#0f766e', enabled_modules: null, logo_url: null }
      else if (url.pathname.includes('/rest/v1/profiles')) data = single ? profile : [profile]
      else if (url.pathname === '/rest/v1/push_subscriptions') {
        if (req.method() === 'DELETE') {
          const filterId = url.searchParams.get('id')?.replace(/^eq\./, '')
          const filterEndpoint = url.searchParams.get('endpoint')?.replace(/^eq\./, '')
          state.deletes.push({ id: filterId ?? null, endpoint: filterEndpoint ?? null, user: url.searchParams.get('user_id') })
          state.devices = state.devices.filter((d) => d.id !== filterId && d.endpoint !== filterEndpoint)
          data = null
        } else if ((url.searchParams.get('select') ?? '').includes('device_label')) {
          // รายการเครื่อง (กดดูเท่านั้น)
          state.listReads += 1
          data = state.devices
        } else {
          // ตรวจสถานะเครื่องนี้ตอนเปิดหน้า (select=id ... endpoint=eq.<เครื่องนี้>) — maybeSingle ขอเป็นอาร์เรย์
          const endpoint = url.searchParams.get('endpoint')?.replace(/^eq\./, '')
          const rows = state.devices.filter((d) => d.endpoint === endpoint).map((d) => ({ id: d.id }))
          data = single ? (rows[0] ?? null) : rows
        }
      } else if (url.pathname === '/functions/v1/send-push') {
        state.selfTests.push(req.postDataJSON())
        status = state.selfTestStatus
        data = status === 200 ? { sent: 1, failed: 0 } : { error: status === 429 ? 'too many tests' : 'device not registered' }
      } else if (single) data = null
      return route.fulfill({ status, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    assert(['GET', 'HEAD'].includes(req.method()), 'non-GET outside fixture')
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (dialog) => dialog.accept())
  return { context, page, state, errors }
}

async function openSettings(page) {
  await page.goto(`${base}/profile/notifications`)
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-push-status]')?.textContent ?? ''
    return text && !text.includes('กำลังตรวจสอบ')
  }, null, { timeout: 30000 })
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
  await test('ส่งทดสอบถึงเครื่องนี้ ส่งเฉพาะ endpoint ของเครื่องนี้', {}, async ({ page, state }) => {
    await openSettings(page)
    assert.match(await page.locator('[data-push-status]').textContent(), /เปิดรับบนเครื่องนี้แล้ว/)
    await page.locator('[data-push-self-test]').click()
    await page.locator('[data-push-self-test-result]').waitFor()
    assert.match(await page.locator('[data-push-self-test-result]').textContent(), /^ส่งแล้ว/)
    assert.deepEqual(state.selfTests, [{ kind: 'self_test', endpoint: THIS_ENDPOINT }], 'ส่งแค่ชนิด + endpoint ของเครื่องนี้')
    assert.equal(state.listReads, 0, 'เปิดหน้าแล้วต้องยังไม่โหลดรายการเครื่อง')
  })

  await test('ถูกจำกัดครั้ง บอกให้รอ', { selfTestStatus: 429 }, async ({ page }) => {
    await openSettings(page)
    await page.locator('[data-push-self-test]').click()
    await page.locator('[data-push-self-test-result]').waitFor()
    assert.match(await page.locator('[data-push-self-test-result]').textContent(), /ไม่เกิน 3 ครั้งใน 10 นาที/)
  })

  await test('รายการเครื่อง: บอกเครื่องนี้ นำเครื่องเก่าออกได้', {}, async ({ page, state }) => {
    await openSettings(page)
    await page.getByRole('button', { name: /เครื่องที่เปิดรับไว้/ }).click()
    await page.locator('[data-push-device]').nth(1).waitFor()
    const rows = page.locator('[data-push-device]')
    assert.equal(await rows.count(), 2)
    assert.match(await rows.nth(0).textContent(), /Chrome · Windows.*เครื่องนี้/)
    assert.match(await rows.nth(1).textContent(), /อุปกรณ์ไม่ทราบชื่อ/)
    assert.equal(await rows.nth(1).locator('[data-push-device-current]').count(), 0)
    await rows.nth(1).getByRole('button', { name: 'นำออก' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-push-device]').length === 1)
    assert.deepEqual(state.deletes, [{ id: '00000000-0000-4000-8000-000000000302', endpoint: null, user: `eq.${uid}` }], 'ลบด้วย id + เจ้าของ')
    assert.match(await page.locator('[data-push-status]').textContent(), /เปิดรับบนเครื่องนี้แล้ว/, 'ลบเครื่องอื่นต้องไม่กระทบเครื่องนี้')
  })

  await test('นำเครื่องนี้ออก สถานะเปลี่ยนเป็นยังไม่ได้เปิดรับ', {}, async ({ page, state }) => {
    await openSettings(page)
    await page.getByRole('button', { name: /เครื่องที่เปิดรับไว้/ }).click()
    await page.locator('[data-push-device-current]').waitFor()
    await page.locator('[data-push-device]').filter({ has: page.locator('[data-push-device-current]') }).getByRole('button', { name: 'นำออก' }).click()
    await page.waitForFunction(() => document.querySelector('[data-push-status]')?.textContent.includes('ยังไม่ได้เปิดรับบนเครื่องนี้'))
    assert.equal(state.deletes.length, 1)
    assert.equal(await page.locator('[data-push-self-test]').count(), 0, 'ไม่ได้เปิดรับแล้วต้องไม่มีปุ่มส่งทดสอบ')
  })

  await test('ยังไม่ได้เปิดรับ ไม่มีปุ่มส่งทดสอบ', { subscribed: false }, async ({ page }) => {
    await openSettings(page)
    assert.match(await page.locator('[data-push-status]').textContent(), /ยังไม่ได้เปิดรับบนเครื่องนี้/)
    assert.equal(await page.locator('[data-push-self-test]').count(), 0)
  })

  await test('มือถือ: รายการเครื่องไม่ล้นจอ ปุ่มกดง่าย', { viewport: { width: 390, height: 844 } }, async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: /เครื่องที่เปิดรับไว้/ }).click()
    await page.locator('[data-push-device]').nth(1).waitFor()
    await page.locator('[data-push-devices]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'mobile-devices.png') })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'หน้าต้องไม่เลื่อนแนวนอน')
    for (const name of ['นำออก']) {
      const box = await page.locator('[data-push-device]').first().getByRole('button', { name }).boundingBox()
      assert.ok(box.height >= 44, `${name} ต้องสูงอย่างน้อย 44px`)
    }
    const test = await page.locator('[data-push-self-test]').boundingBox()
    assert.ok(test.height >= 44 && test.x + test.width <= 390)
  })
} finally {
  await browser.close()
  await server.close()
}
console.log(`✓ push-test-devices (browser): ผ่าน ${results.length} กรณี`)
