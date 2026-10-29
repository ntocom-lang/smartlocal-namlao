// Local UI checks with synthetic sessions/data. No credentials or external requests.
// Run: node tests/dev-journal-layout.playwright.mjs
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(tmpdir(), 'dev-journal-ui-20261029')
const mockId = '\0dev-journal-mock'
const entryId = path.join(root, '__dev-journal-entry.jsx').replaceAll('\\', '/')
const mock = `
import { DEV_USER_ID } from '/src/lib/portalAccess.js'
const denied = new URLSearchParams(location.search).has('denied')
const session = { user: { id: denied ? 'local-unauthorized-user' : DEV_USER_ID } }
const tenant = { id: 'local-test', name: 'เทศบาลตำบลทดสอบชื่อหน่วยงานยาวสำหรับหน้าผู้พัฒนา', settings: {} }
const entries = Array.from({ length: 28 }, (_, i) => ({
  id: 'test-' + i, module: 'ข้อมูลระบบ', topic: '[TEST] หัวข้อที่ ' + (i + 1) + ' ชื่อยาวสำหรับตรวจเมนูซ้ายและมือถือ',
  category: 'story', title: '[TEST] บันทึกตัวอย่าง ' + (i + 1), body: 'รายละเอียดจำลองในเครื่อง',
  status: 'open', created_at: '2026-10-29T00:00:00Z',
}))
export const useAuth = () => ({ session, role: 'superadmin', displayName: '[TEST] ผู้พัฒนาระบบ', avatarUrl: null })
export const useTenant = () => ({ tenant, isModuleEnabled: () => true })
export const useNotifications = () => ({ unreadCount: 3 })
export const applyTheme = () => {}
export const getSessionResilient = async () => ({ data: { session } })
export const signOutSafely = async () => { throw Error('Must not sign out in layout checks') }
export const supabaseUrl = 'http://local-fixture.invalid'
export const supabaseAnonKey = 'local-fixture-only'
function query(table) {
  return new Proxy({}, { get(_, key) {
    if (key === 'then') return (resolve, reject) => Promise.resolve({ data: table === 'dev_journal' ? entries : [], error: null }).then(resolve, reject)
    if (['insert', 'update', 'delete', 'upsert'].includes(key)) return () => { throw Error('Unexpected database mutation') }
    return () => query(table)
  } })
}
export const supabase = { from: query }
`
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import DevJournal from '/src/pages/DevJournal.jsx'
import '/src/index.css'
createRoot(document.getElementById('root')).render(<BrowserRouter>
  <main data-scroll style={{ height: '100dvh', overflowY: 'auto' }}><Routes>
    <Route path='/dev-journal' element={<DevJournal />} />
    <Route path='/admin/login' element={<p>Unauthorized fixture</p>} />
  </Routes></main>
</BrowserRouter>)
`
const server = await createServer({
  root, configFile: false, logLevel: 'error',
  cacheDir: path.join(tmpdir(), 'smartlocal-dev-journal-vite'),
  plugins: [{
    name: 'dev-journal-local-fixture', enforce: 'pre',
    resolveId(id) {
      if (/\/(?:AuthContext|TenantContext|NotificationsContext|supabase)(?:\.jsx?)?$/.test(id.replaceAll('\\', '/'))) return mockId
      if (id === '/__dev-journal-entry.jsx' || id === entryId) return entryId
    },
    load(id) { if (id === mockId) return mock; if (id === entryId) return entry },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/dev-journal') || req.url?.startsWith('/admin/login')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(await vite.transformIndexHtml('/dev-journal', '<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__dev-journal-entry.jsx"></script></body></html>'))
        } else next()
      })
    },
  }, react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 0, hmr: false },
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
const errors = []
const remoteRequests = []
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
      remoteRequests.push(url.href)
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  page.on('pageerror', err => errors.push(err.message))
  await mkdir(output, { recursive: true })
  for (const width of [320, 390, 767, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${base}/dev-journal`)
    await page.getByRole('heading', { name: 'ศูนย์ควบคุมงานพัฒนาระบบ' }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: page overflow`)
    const switcher = page.locator('nav[aria-label="สลับมุมมองระบบ"]:visible')
    assert.equal(await switcher.locator('a').count(), 4)
    assert.equal(await switcher.locator('[aria-current="page"]').innerText(), 'ผู้พัฒนา')
    for (const link of await switcher.locator('a').all()) {
      const box = await link.boundingBox()
      assert(box.x >= 0 && box.x + box.width <= width, `${width}: clipped portal link`)
    }
    const account = page.locator('[data-account-menu-button]:visible')
    await account.click()
    const accountBox = await page.locator('[data-account-menu]').boundingBox()
    assert(accountBox.x >= 0 && accountBox.x + accountBox.width <= width, `${width}: clipped account menu`)
    await page.keyboard.press('Escape')
    if (width < 768) {
      const shortcuts = page.getByRole('navigation', { name: 'ทางลัดผู้พัฒนาระบบ' })
      assert.equal(await shortcuts.locator('button').count(), 4)
      for (const button of await shortcuts.locator('button').all()) {
        const box = await button.boundingBox()
        assert(box.width >= 44 && box.height >= 44 && box.x + box.width <= width)
      }
      await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click()
      const drawer = page.getByRole('dialog', { name: 'เมนูผู้พัฒนาระบบ' })
      await drawer.waitFor({ state: 'visible' })
      assert.equal(await drawer.getByRole('button', { name: /\[TEST\] หัวข้อที่/ }).count(), 28)
      if (width === 320) await page.screenshot({ path: path.join(output, '320-menu.png') })
      await drawer.getByRole('button', { name: /\[TEST\] หัวข้อที่ 28 / }).click()
      await drawer.waitFor({ state: 'hidden' })
      await page.getByRole('heading', { name: '[TEST] บันทึกตัวอย่าง 28' }).waitFor()
      await shortcuts.getByRole('button', { name: 'ทั้งหมด', exact: true }).click()
      await shortcuts.getByRole('button', { name: 'เพิ่มบันทึก', exact: true }).click()
      await page.getByText('บันทึกองค์ความรู้และประเด็นทางเทคนิคให้ค้นคืนได้ง่าย', { exact: true }).waitFor()
      await page.goto(`${base}/dev-journal`)
      await page.getByRole('heading', { name: 'ศูนย์ควบคุมงานพัฒนาระบบ' }).waitFor()
    } else {
      const positions = await page.evaluate(async () => {
        const scroller = document.querySelector('[data-scroll]')
        scroller.scrollTop = 700
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        const h = document.querySelector('[data-dev-header]').getBoundingClientRect()
        const a = document.querySelector('[data-dev-aside]').getBoundingClientRect()
        const s = scroller.getBoundingClientRect()
        return { scroll: scroller.scrollTop, headerTop: h.top, headerBottom: h.bottom, asideTop: a.top, asideBottom: a.bottom, asideWidth: a.width, scrollerBottom: s.bottom }
      })
      assert(positions.scroll > 100, `${width}: fixture did not scroll`)
      assert(Math.abs(positions.headerTop) <= 1 && Math.abs(positions.asideTop - positions.headerBottom) <= 1, `${width}: sticky chrome ${JSON.stringify(positions)}`)
      assert(Math.abs(positions.asideWidth - 240) <= 1 && Math.abs(positions.asideBottom - positions.scrollerBottom) <= 1)
      const topic = page.locator('[data-dev-aside]').getByRole('button', { name: /\[TEST\] หัวข้อที่ 28 / })
      await topic.click()
      await page.getByRole('heading', { name: '[TEST] บันทึกตัวอย่าง 28' }).waitFor()
      assert.equal(await topic.getAttribute('aria-current'), 'page')
      await page.locator('[data-dev-aside]').getByRole('button', { name: /^ทั้งหมด/ }).click()
      await page.evaluate(() => {
        document.querySelector('[data-scroll]').scrollTop = 0
        document.querySelector('[data-dev-aside] nav').scrollTop = 0
      })
    }
    if (width === 320 || width === 768) {
      const manage = width < 768
        ? page.getByRole('navigation', { name: 'ทางลัดผู้พัฒนาระบบ' }).getByRole('button', { name: 'จัดการโมดูล', exact: true })
        : page.locator('[data-dev-aside]').getByRole('button', { name: 'จัดการโมดูล', exact: true })
      await manage.click()
      const panel = await page.locator('[data-dev-manager]').boundingBox()
      const header = await page.locator('[data-dev-header]').boundingBox()
      assert(Math.abs(panel.x - (width < 768 ? 0 : 240)) <= 1)
      assert(Math.abs(panel.y - (width < 768 ? 0 : header.height)) <= 1)
      await page.getByRole('button', { name: 'กลับหน้าผู้พัฒนาระบบ', exact: true }).click()
      assert.equal(await page.locator('[data-dev-manager]').count(), 0)
    }
    await page.screenshot({ path: path.join(output, `${width}.png`) })
    console.log(`PASS ${width}px: navigation, account, ${width < 768 ? 'drawer + actions' : 'sticky sidebar + filters'}`)
  }
  await page.goto(`${base}/dev-journal?denied=1`)
  await page.getByText('Unauthorized fixture').waitFor()
  assert.equal(await page.locator('[data-dev-header]').count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(remoteRequests, [])
  console.log(`PASS unauthorized access; 0 external requests, 0 page errors. Screenshots: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
