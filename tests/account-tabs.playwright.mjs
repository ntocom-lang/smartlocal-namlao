// ใช้ App/Router/contexts จริง แต่ API, บัญชีและ Push API เป็น fixture ทั้งหมด ไม่อ่าน Chrome profile ไม่เขียน DB จริง
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium, firefox, webkit } from 'playwright'
import { createServer } from 'vite'

process.env.SKIP_SYNC_CHECK = '1'
const output = process.env.AT_OUTPUT || path.join(tmpdir(), 'smartlocal-account-tabs-20261028')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: process.cwd(), cacheDir: path.join(tmpdir(), 'smartlocal-account-tabs-vite', path.basename(process.cwd()), process.env.AT_ENGINE || 'chrome'),
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-only'), 'import.meta.env.VITE_TENANT_SLUG': JSON.stringify('demo'), 'import.meta.env.VITE_VAPID_PUBLIC_KEY': 'globalThis.__fixturePushKey' },
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const engine = process.env.AT_ENGINE || 'chrome'
const browserType = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ headless: true, ...(['chrome', 'msedge'].includes(engine) ? { channel: engine } : {}) })
const results = []
const uid = '00000000-0000-4000-8000-000000000001'
const mid = '00000000-0000-4000-8000-000000000002'

async function fixture(role = 'staff', options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true })
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', user_metadata: { full_name: 'TEST เจ้าหน้าที่ทดสอบแท็บ' }, app_metadata: { provider: 'email', providers: ['email'] }, identities: [] }
  const profile = { id: uid, municipality_id: mid, role, full_name: user.user_metadata.full_name, phone: '0800000000', avatar_url: null }
  const now = new Date().toISOString()
  const complaints = [{ id: '00000000-0000-4000-8000-000000000003', status: role === 'citizen' ? 'received' : role === 'technician' ? 'received' : 'new', category: 'road', created_at: now, updated_at: now }]
  const state = { calls: [], writes: [], pushSaved: !!options.subscribed, pushSaveFail: false, pushReadFail: false, pushSaveDelay: 0, pushReadCount: 0 }
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(({ options, session }) => {
    if (session) localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
    window.__fixturePushKey = options.configured === false ? '' : 'B' + 'A'.repeat(86)
    window.__pushPermission = options.permission || 'default'
    window.__pushCalls = { permission: 0, subscribe: 0, unsubscribe: 0 }
    let existing = !!options.subscribed
    class FixtureNotification {
      static get permission() { return window.__pushPermission }
      static async requestPermission() { window.__pushCalls.permission++; window.__pushPermission = options.requestPermission || 'granted'; return window.__pushPermission }
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: FixtureNotification })
    if (options.unsupported) delete window.PushManager
    else Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} })
    const subscription = { endpoint: 'https://push.example.invalid/test-only', getKey: () => new Uint8Array(8).buffer, unsubscribe: async () => { existing = false; window.__pushCalls.unsubscribe++; return true } }
    const registration = { active: options.noRegistration ? null : {}, pushManager: {
      getSubscription: async () => existing ? subscription : null,
      subscribe: async () => { existing = true; window.__pushCalls.subscribe++; return subscription },
    } }
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: async () => options.noRegistration ? undefined : registration })
  }, { options, session: role ? (() => {
    const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
    const exp = Math.floor(Date.now() / 1000) + 3600
    return { user, access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: uid, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: uid }) + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_at: exp, expires_in: 3600 }
  })() : null })
  await context.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url())
    if (url.hostname.endsWith('.supabase.co')) {
      const headers = { 'access-control-allow-origin': req.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-allow-credentials': 'true' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      state.calls.push(url.pathname)
      const rpc = url.pathname.split('/rpc/')[1]
      const isReadRpc = ['esign_my_signatures', 'esign_my_signature_history', 'esign_my_signer_overview', 'list_complaints_for_staff', 'list_my_sessions'].includes(rpc)
      const write = !['GET', 'HEAD'].includes(req.method()) && !isReadRpc
      if (write) state.writes.push({ path: url.pathname, method: req.method() })
      let data = []
      let status = 200
      if (url.pathname.includes('/auth/v1/user')) data = user
      else if (url.pathname.includes('/rest/v1/municipalities')) data = { id: mid, slug: 'demo', name: options.longName ? 'องค์การบริหารส่วนตำบลทดสอบระบบบัญชีผู้ใช้และบริการประชาชน' : 'TEST หน่วยงานทดสอบ', org_type: 'เทศบาลตำบล', ui_style: options.uiStyle || 'eco_friendly', theme_color: '#0f766e', enabled_modules: options.enabledModules || null, logo_url: options.noLogo ? null : '/test-agency-logo.svg' }
      else if (url.pathname.includes('/rest/v1/profiles')) {
        if (write) Object.assign(profile, req.postDataJSON())
        data = req.headers().accept?.includes('object+json') ? profile : [profile]
      } else if (url.pathname.includes('/rest/v1/push_subscriptions')) {
        if (!write) state.pushReadCount++
        if (write && state.pushSaveDelay) await new Promise(resolve => setTimeout(resolve, state.pushSaveDelay))
        if ((write && state.pushSaveFail) || (!write && state.pushReadFail)) { status = 403; data = { message: 'TEST denied', code: '42501' } }
        else if (write) { state.pushSaved = req.method() !== 'DELETE'; data = null }
        else data = state.pushSaved ? { id: uid } : null
      } else if (rpc === 'list_complaints_for_staff' || url.pathname === '/rest/v1/complaints') data = complaints
      else if (rpc === 'esign_my_signatures' || rpc === 'esign_my_signature_history') data = { ok: true, items: [] }
      else if (rpc === 'esign_my_signer_overview') data = { ok: true, pin_set: false, image_count: 0, signature_count: 0 }
      else if (req.headers().accept?.includes('object+json')) data = null
      return route.fulfill({ status, headers: { ...headers, 'content-range': '0-0/0' }, contentType: 'application/json', body: JSON.stringify(data) })
    }
    if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: url.pathname === '/test-agency-logo.svg'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><circle cx="36" cy="36" r="35" fill="#e0f2fe"/><path d="M15 27 36 15 57 27H15Zm5 5h5v18h-5zm13 0h6v18h-6zm14 0h5v18h-5zM15 53h42v5H15z" fill="#075985"/><text x="36" y="66" text-anchor="middle" fill="#075985" font-family="Arial" font-size="8">TEST</text></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    if (url.origin !== base) return route.abort()
    assert(['GET', 'HEAD'].includes(req.method()), 'non-GET outside fixture')
    return route.continue()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  return { context, page, state, errors }
}

async function go(page, route, active) {
  await page.goto(base + route)
  await page.locator(`[data-account-tab="${active}"][aria-current="page"]`).waitFor({ timeout: 30000 })
  if (active === 'signatures') await page.locator('[data-signature-empty]').waitFor()
  else if (active === 'notifications') await page.waitForFunction(() => !document.querySelector('[data-push-status]')?.textContent.includes('กำลังตรวจสอบ'))
}
async function geometry(page, label) {
  await page.evaluate(() => document.fonts.ready)
  const geo = await page.locator('[data-account-tabs]').evaluate(n => ({ width: innerWidth, scroll: n.scrollWidth, client: n.clientWidth,
    tabs: [...n.querySelectorAll('a')].map(a => { const r = a.getBoundingClientRect(); const s = a.querySelector('span'); const range = document.createRange(); range.selectNodeContents(s); const t = range.getBoundingClientRect(); return { text: s.textContent, x: r.x, y: r.y, right: r.right, w: r.width, h: r.height, textRight: t.right, textLeft: t.left } }),
    overflow: [...document.querySelectorAll('[data-account-page],main')].some(x => x.scrollWidth > x.clientWidth + 1) }))
  assert(geo.scroll <= geo.client + 1 && !geo.overflow, label + ' overflow ' + JSON.stringify(geo))
  const sidebar = page.locator('[data-account-sidebar]')
  assert.equal(await sidebar.isVisible(), geo.width >= 768, label + ' sidebar breakpoint')
  assert.equal(await page.locator('[data-account-nav-toggle]').isVisible(), geo.width < 768, label + ' drawer trigger breakpoint')
  assert.equal(await page.locator('[data-account-site-header] header').count(), 1, label + ' duplicated site header')
  assert(await page.locator('[data-account-site-header] img[src="/test-agency-logo.svg"]').count() > 0, label + ' missing tenant logo')
  for (const t of geo.tabs) assert(t.w >= 44 && t.h >= 44 && t.x >= 0 && t.right <= geo.width + 1 && t.textLeft >= t.x && t.textRight <= t.right + 1, label + ' clipped tab ' + JSON.stringify(t))
  if (geo.width < 640 && geo.tabs.length === 4) assert(geo.tabs[2].y > geo.tabs[0].y, label + ' mobile must use two rows')
  results.push({ label, width: geo.width, tabs: geo.tabs.length })
}
async function test(name, run) {
  const f = await fixture('staff')
  try { await run(f); assert.deepEqual(f.errors, [], name); results.push({ name, passed: true }); console.log('PASS ' + name) }
  catch (error) { await f.page.screenshot({ path: path.join(output, engine + '-failure.png'), fullPage: false }); throw error }
  finally { await f.context.close() }
}

try {
  for (const uiStyle of ['eco_friendly', 'clean_minimal', 'wave_fluid', 'civic_friendly', 'smart_modern', 'kledkaew', 'service_hub']) {
    const f = await fixture('staff', { uiStyle })
    try {
      await go(f.page, '/profile', 'account')
      for (const width of [390, 1366]) {
        await f.page.setViewportSize({ width, height: 900 })
        await geometry(f.page, uiStyle)
        assert(await f.page.locator('[data-account-site-header] img[src="/test-agency-logo.svg"]').first().evaluate(img => img.complete && img.naturalWidth > 0))
        await f.page.screenshot({ path: path.join(output, `${engine}-${uiStyle}-${width}.png`), fullPage: false })
      }
      assert.deepEqual(f.errors, [])
    } finally { await f.context.close() }
  }
  await test('4 account tabs, responsive layouts, lazy reads and history', async ({ page, state }) => {
    for (const [route, active] of [['/profile', 'account'], ['/profile?tab=security', 'security'], ['/profile/notifications', 'notifications'], ['/staff/my-signatures', 'signatures']]) {
      await go(page, route, active)
      for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [1366, 900], [640, 360]]) {
        await page.setViewportSize({ width, height }); await geometry(page, active)
        if ([390, 1366].includes(width)) await page.screenshot({ path: path.join(output, `${engine}-${active}-${width}.png`), fullPage: false })
      }
    }
    state.calls.length = 0
    await go(page, '/profile', 'account')
    await page.locator('[data-account-tab="security"]').click()
    await page.locator('#security').waitFor()
    await page.locator('[data-account-tab="notifications"]').click()
    await page.locator('[data-notification-settings]').waitFor()
    assert(!state.calls.some(p => p.includes('/esign_')), 'inactive tabs must not read signatures')
    assert(!state.calls.includes('/rest/v1/rpc/list_my_sessions'), 'sessions must load only on expansion')
    assert(!state.writes.some(w => /notification_reads|notification_cleared/.test(w.path)), 'settings must not mark any item read')
    assert.match(await page.locator('[data-account-tab="notifications"]').innerText(), /1/)
    await page.goBack(); await page.locator('#security').waitFor()
    await page.goBack(); await page.locator('[data-profile-panel="account"]').waitFor()
    await go(page, '/profile#security', 'security'); await page.waitForFunction(() => document.activeElement?.id === 'security')
    await go(page, '/profile?tab=notifications', 'notifications'); assert(new URL(page.url()).pathname === '/profile/notifications')
    await go(page, '/profile?tab=signatures', 'signatures')
    await go(page, '/profile#signature', 'signatures')
  })
  await test('unsaved account/password/PIN guard and saved profile', async ({ page, state }) => {
    await go(page, '/profile', 'account')
    await page.getByRole('button', { name: 'แก้ไขชื่อ-สกุล', exact: true }).click()
    await page.getByPlaceholder('ชื่อ', { exact: true }).fill('ทดสอบแก้ชื่อ')
    page.once('dialog', d => d.dismiss())
    await page.locator('[data-account-tab="security"]').click()
    assert.equal(new URL(page.url()).search, '')
    assert.equal(await page.getByPlaceholder('ชื่อ', { exact: true }).inputValue(), 'ทดสอบแก้ชื่อ')
    page.once('dialog', d => d.dismiss())
    await page.locator('[data-account-site-header]').getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click()
    assert.equal(new URL(page.url()).pathname, '/profile', 'shared header bell must not discard unsaved edits')
    await page.locator('[data-account-nav-toggle]').click()
    const drawer = page.getByRole('dialog', { name: 'เมนูหลัก', exact: true })
    await drawer.waitFor()
    page.once('dialog', d => d.dismiss())
    await drawer.locator('[data-drawer-item="/complaint"]').click()
    assert.equal(new URL(page.url()).pathname, '/profile', 'drawer must retain an unsaved profile when leaving is cancelled')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-account-nav-toggle'))
    await page.getByRole('button', { name: 'ปิดช่องแก้ไขชื่อ-สกุล', exact: true }).click()
    assert(await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).isVisible(), 'collapsed editor must retain unsaved-change state')
    page.once('dialog', d => d.accept())
    await page.locator('[data-account-tab="security"]').click()
    await page.locator('#security').waitFor()
    await page.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน', exact: true }).click()
    await page.getByPlaceholder('ยืนยันรหัสผ่านใหม่').fill('local-test-unsaved')
    page.once('dialog', d => d.dismiss())
    await page.locator('[data-account-tab="account"]').click()
    assert.equal(await page.getByPlaceholder('ยืนยันรหัสผ่านใหม่').inputValue(), 'local-test-unsaved')
    assert(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))))
    page.once('dialog', d => d.accept())
    await page.locator('[data-account-tab="account"]').click()
    await page.locator('[data-profile-panel="account"]').waitFor()
    await page.getByRole('button', { name: 'แก้ไขชื่อ-สกุล', exact: true }).click()
    await page.getByPlaceholder('ชื่อ', { exact: true }).fill('ทดสอบบันทึก')
    await page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click()
    await page.locator('[data-profile-panel]').getByText(/ทดสอบบันทึก/).first().waitFor()
    assert(state.writes.some(w => w.path === '/rest/v1/profiles'))
    await page.locator('[data-account-tab="signatures"]').click()
    await page.locator('#esign-pin-next').waitFor()
    const pin = page.locator('#esign-pin-next')
    await pin.fill('246810')
    page.once('dialog', d => d.dismiss())
    await page.locator('[data-account-tab="account"]').click()
    assert(new URL(page.url()).pathname === '/staff/my-signatures')
    await pin.fill('')
  })
  {
    const f = await fixture('staff', { longName: true, enabledModules: ['events'] })
    try {
      await go(f.page, '/profile/notifications', 'notifications')
      for (const width of [320, 767, 768, 1024, 1920]) {
        await f.page.setViewportSize({ width, height: 900 })
        await geometry(f.page, 'long agency name')
      }
      assert.equal(await f.page.locator('[data-account-sidebar] a[href="/complaint"]').count(), 0, 'disabled complaint module must stay hidden')
      await f.page.setViewportSize({ width: 390, height: 844 })
      await f.page.locator('[data-account-nav-toggle]').click()
      const drawer = f.page.getByRole('dialog', { name: 'เมนูหลัก', exact: true })
      await drawer.waitFor()
      assert.equal(await drawer.locator('[data-drawer-item="/complaint"]').count(), 0)
      const calendar = drawer.locator('[data-drawer-item="/events"]')
      await calendar.scrollIntoViewIfNeeded()
      assert(await calendar.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 }))
      await calendar.click()
      await f.page.waitForURL(u => u.pathname === '/events')
      assert.equal(f.state.writes.length, 0)
      assert.deepEqual(f.errors, [])
      results.push({ name: 'mobile drawer navigation, module visibility and long agency name', passed: true })
    } finally { await f.context.close() }
  }
  {
    const f = await fixture('citizen', { noLogo: true })
    try {
      await go(f.page, '/profile', 'account')
      assert.equal(await f.page.locator('[data-account-site-header] img[src="/test-agency-logo.svg"]').count(), 0)
      assert((await f.page.locator('[data-account-site-header]').innerText()).includes('TEST หน่วยงานทดสอบ'))
      assert.deepEqual(f.errors, [])
      results.push({ name: 'agency without logo keeps the existing header fallback', passed: true })
    } finally { await f.context.close() }
  }
  await test('push opt-in, opt-out, API failure and retry', async ({ page, state }) => {
    await go(page, '/profile/notifications', 'notifications')
    assert.deepEqual(await page.evaluate(() => window.__pushCalls), { permission: 0, subscribe: 0, unsubscribe: 0 })
    state.pushSaveFail = true
    await page.getByRole('button', { name: 'เปิดรับบนเครื่องนี้', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert(!state.pushSaved)
    assert.equal(await page.evaluate(() => window.__pushCalls.unsubscribe), 1, 'rollback new browser subscription after DB error')
    state.pushSaveFail = false
    await page.getByRole('button', { name: 'ตรวจสอบอีกครั้ง', exact: true }).click()
    state.pushSaveDelay = 1400
    await page.getByRole('button', { name: 'เปิดรับบนเครื่องนี้', exact: true }).click()
    await page.waitForFunction(() => window.__pushCalls.subscribe === 2)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.locator('[data-account-tab="account"]').click()
    assert.equal(new URL(page.url()).pathname, '/profile/notifications', 'do not leave during push write')
    await page.getByText('เปิดรับบนเครื่องนี้แล้ว', { exact: true }).waitFor()
    assert.equal(state.pushReadCount, 0, 'focus must not start a stale read during subscription write')
    state.pushSaveDelay = 0
    assert(state.pushSaved)
    state.pushSaveFail = true
    await page.getByRole('button', { name: 'ปิดรับบนเครื่องนี้', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert(state.pushSaved, 'failed unsubscribe must not report disabled')
    state.pushSaveFail = false
    await page.getByRole('button', { name: 'ตรวจสอบอีกครั้ง', exact: true }).click()
    await page.getByText('เปิดรับบนเครื่องนี้แล้ว', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'ปิดรับบนเครื่องนี้', exact: true }).click()
    await page.getByText('ยังไม่ได้เปิดรับบนเครื่องนี้', { exact: true }).waitFor()
    assert(!state.pushSaved)
    assert.equal(await page.evaluate(() => window.__pushCalls.unsubscribe), 1, 'account opt-out must not invalidate browser subscription used by another account')
    assert(!state.writes.some(w => /notification_reads|notification_cleared/.test(w.path)))
  })
  {
    const f = await fixture('staff', { subscribed: true, permission: 'granted' })
    try {
      f.state.pushReadFail = true
      await go(f.page, '/profile/notifications', 'notifications')
      await f.page.getByRole('alert').waitFor()
      assert.equal(await f.page.getByRole('button', { name: 'เปิดรับบนเครื่องนี้', exact: true }).isDisabled(), true)
      f.state.pushReadFail = false
      await f.page.getByRole('button', { name: 'ตรวจสอบอีกครั้ง', exact: true }).click()
      await f.page.getByText('เปิดรับบนเครื่องนี้แล้ว', { exact: true }).waitFor()
      assert.equal(f.state.writes.length, 0)
      assert.deepEqual(f.errors, [])
      results.push({ name: 'push read failure preserves unknown status, retry restores existing subscription', passed: true })
    } finally { await f.context.close() }
  }
  for (const options of [{ configured: false }, { unsupported: true }, { permission: 'denied' }, { requestPermission: 'denied' }, { noRegistration: true }]) {
    const f = await fixture('staff', options)
    try {
      await go(f.page, '/profile/notifications', 'notifications')
      if (options.requestPermission || options.noRegistration) { await f.page.getByRole('button', { name: 'เปิดรับบนเครื่องนี้', exact: true }).click(); await f.page.getByRole('alert').waitFor() }
      else assert.equal(await f.page.getByRole('button', { name: 'เปิดรับบนเครื่องนี้', exact: true }).count(), 0)
      if (options.permission === 'denied') {
        await f.page.evaluate(() => { window.__pushPermission = 'granted' })
        await f.page.getByRole('button', { name: 'ตรวจสอบอีกครั้ง', exact: true }).click()
        await f.page.getByRole('button', { name: 'เปิดรับบนเครื่องนี้', exact: true }).waitFor()
      }
      assert.equal(f.state.writes.length, 0)
      assert.deepEqual(f.errors, [])
      results.push({ name: 'push capability ' + JSON.stringify(options), passed: true })
    } finally { await f.context.close() }
  }
  for (const role of ['superadmin', 'admin', 'officer', 'technician', 'staff', 'viewer', 'council', 'citizen', null]) {
    const f = await fixture(role)
    try {
      await f.page.goto(base + '/profile')
      if (!role) { await f.page.waitForURL(u => u.pathname === '/auth'); assert.equal(await f.page.locator('[data-account-tabs]').count(), 0) }
      else {
        await f.page.locator('[data-account-tabs]').waitFor()
        assert.equal(await f.page.locator('[data-account-tab="signatures"]').count(), role === 'citizen' ? 0 : 1)
        await f.page.setViewportSize({ width: 320, height: 844 }); await geometry(f.page, role)
        await go(f.page, '/profile/notifications', 'notifications')
      }
      if (role === 'citizen' || !role) {
        await f.page.goto(base + '/staff/my-signatures')
        await f.page.waitForURL(u => !u.pathname.startsWith('/staff'))
        assert(!f.state.calls.some(p => p.includes('/esign_')))
      }
      assert.deepEqual(f.errors, [])
      results.push({ name: 'role ' + (role || 'anonymous'), passed: true })
    } finally { await f.context.close() }
  }
  await writeFile(path.join(output, engine + '-results.json'), JSON.stringify({ engine, realBackendWrites: 0, results }, null, 2))
  console.log(`PASS ${results.length} checks; real backend writes=0; ${output}`)
} finally { await browser.close(); await server.close() }
