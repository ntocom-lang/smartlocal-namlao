// Local browser regression: real headers/portals, synthetic accounts, no database or external requests.
// Run: node tests/account-menu-layout.playwright.mjs
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium, firefox, webkit } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const engineName = process.env.AM_ENGINE || 'chrome'
assert(['chrome', 'msedge', 'firefox', 'webkit'].includes(engineName))
const output = path.join(root, 'screenshots', 'account-menu', ...(engineName === 'chrome' ? [] : [engineName]))
const themes = ['EcoFriendly', 'CivicFriendly', 'WaveFluid', 'SmartModern', 'CleanMinimal', 'ServiceHub', 'Kledkaew']
const portals = ['StaffDashboard', 'AdminDashboard', 'TechnicianDashboard', 'DataCenterDashboard']
const sizes = process.env.AM_QUICK === '1' ? [[390, 844], [1366, 900]] : [[320, 568], [360, 800], [390, 844], [430, 932], [768, 1024], [844, 390], [1024, 768], [1366, 900], [1920, 1080]]
const mockId = '\0account-menu-mock'
const entryId = path.join(root, '__account-menu-entry.jsx').replaceAll('\\', '/')
const mock = `
const config = new URLSearchParams(window.location.search)
const role = config.get('role') || 'staff'
const displayName = config.has('long') ? 'นางสาวทดสอบชื่อและนามสกุลยาวสำหรับตรวจเมนูบัญชีบนจอแคบ' : 'นางสาวทดสอบ ระบบท้องถิ่น'
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid', user_metadata: {} }
const session = role === 'anonymous' ? null : { user, access_token: 'local-fixture-only' }
const profile = { ...user, full_name: displayName, role, avatar_url: null, municipality_id: '00000000-0000-4000-8000-000000000002' }
const tenant = { id: profile.municipality_id, name: 'เทศบาลตำบลทดสอบ', slug: 'demo', ui_style: 'eco-friendly', org_type: 'เทศบาลตำบล', theme_color: '#0f766e', modules: {}, department_name: 'สำนักปลัด', settings: {}, data_center_settings: {}, header_image_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3C/svg%3E' }
const auth = { session, role, displayName, avatarUrl: config.has('brokenAvatar') ? '/broken-avatar.png' : null, profileLoading: false, profileError: false, refreshProfile: async () => {} }
const tenantValue = { tenant, loading: false, isModuleEnabled: () => true, terminology: {}, refreshTenant: async () => {} }
const notifications = { unreadCount: 86, items: [], loading: false, audience: role === 'citizen' ? 'citizen' : 'staff', markRead() {}, markAllRead() {}, refresh() {} }
export const useAuth = () => auth
export const useTenant = () => tenantValue
export const useNotifications = () => notifications
export const applyTheme = () => {}
export const getSessionResilient = async () => ({ data: { session }, error: null })
export const readStoredSession = () => session
export const signOutSafely = async () => { window.__signOutCalls = (window.__signOutCalls || 0) + 1 }
export const supabaseUrl = 'http://local-fixture.invalid'
export const supabaseAnonKey = 'local-fixture-only'
export const initialAuthParams = {}
function query(table, single = false) {
  return new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve) => resolve({ data: single ? (table === 'profiles' ? profile : null) : [], error: null, count: 0 })
    return () => query(table, key === 'single' || key === 'maybeSingle' || single)
  } })
}
const channel = { on() { return channel }, subscribe() { return channel }, unsubscribe() {} }
export const supabase = {
  from: table => query(table), rpc: () => Promise.resolve({ data: [], error: null }),
  channel: () => channel, removeChannel() {},
  auth: { getSession: getSessionResilient, getUser: async () => ({ data: { user }, error: null }), getUserIdentities: async () => ({ data: { identities: [] }, error: null }) },
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
}
`
const entry = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import Badge from '/src/components/layout/UserProfileBadge.jsx'
import '/src/index.css'
const query = new URLSearchParams(window.location.search)
const target = query.get('target') || 'generic'
let Component = null
if (${JSON.stringify(themes)}.includes(target)) Component = (await import('/src/components/citizen/templates/' + target + '/Header.jsx')).default
if (${JSON.stringify(portals)}.includes(target) || target === 'ProfilePage') Component = (await import('/src/pages/' + target + '.jsx')).default
function Fixture() {
  const location = useLocation()
  const [settings, setSettings] = useState(false)
  return <>
    {Component ? <Component /> : <header style={{ overflow: 'hidden', height: 64, padding: 8, background: '#0f766e', display: 'flex', justifyContent: query.has('left') ? 'flex-start' : 'flex-end' }}>
      <button data-before>ก่อนหน้า</button>
      <Badge compact={query.has('compact')} onSystemSettings={query.has('callback') ? () => setSettings(true) : undefined} />
      <button data-after>ถัดไป</button>
    </header>}
    <main style={{ minHeight: 1200, padding: 24, background: '#eef2f7' }}>
      <h1>พื้นที่ทดสอบเมนูบัญชี</h1><button data-outside>พื้นที่ด้านนอก</button>
      <p data-location>{location.pathname + location.hash}</p><p data-route-state>{location.state?.page || ''}</p>
      {settings && <p data-settings-open>ตั้งค่าระบบ</p>}
    </main>
  </>
}
createRoot(document.getElementById('root')).render(<BrowserRouter><Fixture /></BrowserRouter>)
`
const server = await createServer({
  root, configFile: false, logLevel: 'error',
  // Generated dependency bundles must stay outside the tree scanned by eslint.
  cacheDir: path.join(tmpdir(), 'smartlocal-account-menu-vite', path.basename(root), engineName),
  plugins: [{
    name: 'local-account-fixture', enforce: 'pre',
    resolveId(id) {
      if (/\/(?:AuthContext|TenantContext|NotificationsContext|supabase)(?:\.jsx?)?$/.test(id.replaceAll('\\', '/'))) return mockId
      if (id === '/__account-menu-entry.jsx' || id === entryId) return entryId
    },
    load(id) { if (id === mockId) return mock; if (id === entryId) return entry },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/__account-menu-test')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(await vite.transformIndexHtml('/__account-menu-test', '<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="--color-primary:#0f766e;--color-primary-dark:#115e59"><div id="root"></div><script type="module" src="/__account-menu-entry.jsx"></script></body></html>'))
        } else next()
      })
    },
  }, react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browserType = engineName === 'firefox' ? firefox : engineName === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ ...(['chrome', 'msedge'].includes(engineName) ? { channel: engineName } : {}), headless: true })
const context = await browser.newContext({ hasTouch: true })
const failures = []
const results = []
let remoteRequests = 0
const blockedUrls = []
await mkdir(output, { recursive: true })
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) { remoteRequests++; blockedUrls.push(url.href); await route.abort(); return }
  if (url.pathname === '/broken-avatar.png') { await route.fulfill({ status: 404, body: '' }); return }
  await route.continue()
})
const page = await context.newPage()
page.on('pageerror', error => failures.push(error.message))
const button = () => page.locator('[data-account-menu-button]:visible')
const menu = () => page.locator('[data-account-menu]')
async function load(target = 'generic', role = 'staff', extras = '') {
  failures.length = 0
  await page.goto(`${base}/__account-menu-test?target=${target}&role=${role}${extras}`)
  if (target === 'ProfilePage') await page.locator('#security').waitFor({ timeout: 20000 })
  else await button().waitFor({ timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
}
async function assertGeometry(where) {
  const b = await button().boundingBox()
  const m = await menu().boundingBox()
  const viewport = page.viewportSize()
  assert(b.width >= 44 && b.height >= 44, `${where}: trigger below 44px`)
  assert(b.x >= -1 && b.x + b.width <= viewport.width + 1, `${where}: trigger outside screen`)
  assert(m.x >= 7 && m.y >= 7 && m.x + m.width <= viewport.width - 7 && m.y + m.height <= viewport.height - 7, `${where}: menu outside screen ${JSON.stringify(m)}`)
  for (const item of await menu().locator('[role=menuitem]').all()) {
    await item.scrollIntoViewIfNeeded()
    const box = await item.boundingBox()
    assert(box.height >= 44, `${where}: row below 44px`)
    assert(await item.evaluate(el => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    }), `${where}: row covered or clipped`)
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${where}: horizontal overflow`)
}
try {
  for (const target of [...themes, ...portals]) {
    const role = target === 'TechnicianDashboard' ? 'technician' : target === 'AdminDashboard' ? 'admin' : 'staff'
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height })
      await load(target, role)
      assert.equal(await button().count(), 1, `${target}/${width}: duplicate account triggers`)
      const before = page.url()
      await button().tap()
      await menu().waitFor()
      assert.equal(page.url(), before, 'opening account must not navigate')
      await assertGeometry(`${target}/${width}`)
      assert.deepEqual(failures, [], `${target}/${width}: page errors`)
      if ([390, 1366].includes(width)) await page.screenshot({ path: path.join(output, `${target}-${width}.png`) })
      await page.keyboard.press('Escape')
      assert.equal(await menu().count(), 0)
      assert(await button().evaluate(el => el === document.activeElement))
      results.push({ target, width, height, passed: true })
    }
    console.log(`PASS ${target}: ${sizes.length} viewports`)
  }
  for (const role of ['citizen', 'staff', 'officer', 'technician', 'viewer', 'council', 'admin', 'superadmin']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await load('generic', role)
    await button().click()
    assert.equal(await menu().locator('[data-account-signature]').count(), role === 'citizen' ? 0 : 1, role)
    assert.equal(await menu().locator('[data-account-settings]').count(), ['admin', 'superadmin'].includes(role) ? 1 : 0, role)
    await page.keyboard.press('End')
    assert(await page.locator('[data-account-logout]').evaluate(el => el === document.activeElement))
    await page.keyboard.press('ArrowDown')
    assert(await page.locator('[data-account-profile]').evaluate(el => el === document.activeElement))
    await page.keyboard.press('ArrowUp')
    assert(await page.locator('[data-account-logout]').evaluate(el => el === document.activeElement))
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')
    assert.equal(await menu().count(), 0)
    assert(await page.locator('[data-after]').evaluate(el => el === document.activeElement))
    await button().focus()
    await page.keyboard.press('ArrowUp')
    assert(await page.locator('[data-account-logout]').evaluate(el => el === document.activeElement))
    await page.keyboard.press('Shift+Tab')
    assert(await page.locator('[data-before]').evaluate(el => el === document.activeElement))
    await button().click()
    await page.locator('[data-outside]').click()
    assert.equal(await menu().count(), 0)
  }
  for (const [attr, url] of [['profile', '/profile'], ['signature', '/staff/my-signatures'], ['notifications', '/notifications'], ['security', '/profile#security'], ['settings', '/admin']]) {
    await load('generic', 'admin')
    await button().click()
    await page.locator(`[data-account-${attr}]`).click()
    await page.waitForURL(u => u.pathname + u.hash === url)
    await page.waitForFunction(expected => document.querySelector('[data-location]')?.textContent === expected, url)
    assert.equal(await page.locator('[data-location]').textContent(), url)
    assert.equal(await menu().count(), 0)
    if (attr === 'settings') assert.equal(await page.locator('[data-route-state]').textContent(), 'system-settings')
  }
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 })
    await load('AdminDashboard', 'admin')
    await button().click()
    await page.locator('[data-account-settings]').click()
    await page.getByRole('heading', { name: 'ชื่อและคำอธิบายระบบ', exact: true }).waitFor()
    assert.equal(await menu().count(), 0)
    assert.deepEqual(failures, [])
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await load('generic', 'admin', '&callback')
  await button().click()
  await page.locator('[data-account-settings]').click()
  await page.locator('[data-settings-open]').waitFor()
  await button().click()
  await page.locator('[data-account-logout]').click()
  assert.equal(await page.evaluate(() => window.__signOutCalls), 1)
  await load('generic', 'staff', '&long&brokenAvatar&compact&left')
  await button().click()
  await assertGeometry('long name + broken avatar + left edge')
  await page.waitForFunction(() => !document.querySelector('[data-account-menu] img'))
  assert.equal(await menu().locator('img').count(), 0)
  // Genuine profile page: the hash must land on its security section after async profile load.
  await load('ProfilePage', 'staff')
  await page.evaluate(() => { history.pushState(null, '', '#security'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForFunction(() => document.activeElement?.id === 'security')
  assert((await page.locator('#security').boundingBox()).y >= 0)
  assert.deepEqual(failures, [])
  await page.goto(`${base}/__account-menu-test?role=anonymous`)
  await page.locator('[data-outside]').waitFor()
  assert.equal(await button().count(), 0)
  for (const target of themes) {
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`${base}/__account-menu-test?target=${target}&role=anonymous`)
      await page.locator('a[href="/auth"]:visible').first().waitFor()
      assert.equal(await button().count(), 0, `${target}: anonymous account trigger`)
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 })
  await load('EcoFriendly')
  await button().click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => !document.querySelector('[data-account-menu]'))
  await button().tap()
  await assertGeometry('resize from PC to mobile')
  assert.equal(remoteRequests, 0, `fixture attempted an external request: ${JSON.stringify(blockedUrls)}`)
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ engine: engineName, version: browser.version(), results, extraChecks: ['role permissions', 'keyboard', 'outside dismiss', 'navigation', 'settings callback', 'logout', 'broken avatar', 'long name', 'security hash', 'anonymous', 'breakpoint resize'], remoteRequests }, null, 2))
  console.log(`PASS ${results.length} layout cases + role/keyboard/navigation checks; no external requests`)
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, failures, blockedUrls, headings: await page.locator('h1,h2').allTextContents() }, null, 2))
  throw error
} finally {
  await context.close()
  await browser.close()
  await server.close()
}
