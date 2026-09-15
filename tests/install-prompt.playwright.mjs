// node tests/install-prompt.playwright.mjs
// ใช้ UI/Hook จริงและจำลองสัญญาณเบราว์เซอร์ ไม่ใช่หลักฐานติดตั้งบนมือถือจริง
// fixture ไม่มี App/Supabase จึงไม่อ่านหรือเขียนข้อมูลประชาชน
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = fileURLToPath(new URL('../scratch/pwa-install/', import.meta.url))
await mkdir(artifacts, { recursive: true })
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="--color-primary:#1d4ed8;--color-primary-dark:#1e40af;--color-primary-rgb:29,78,216">
<div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import InstallPrompt, {AndroidGuide} from '/src/components/InstallPrompt.jsx';
import {useInstallPrompt} from '/src/hooks/useInstallPrompt.js';
import '/src/index.css';
function Menu() {
 const {install} = useInstallPrompt(); const [guide, setGuide] = React.useState(false);
 return React.createElement(React.Fragment, null,
  React.createElement('button', {onClick: async () => {if(await install() === 'guide') setGuide(true)}}, 'เมนูติดตั้ง'),
  guide && React.createElement(AndroidGuide, {onClose: () => setGuide(false)}));
}
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
 React.createElement(InstallPrompt), React.createElement(Menu)));
</script></body></html>`
const fixturePlugin = { name: 'install-fixture', configureServer(server) {
  server.middlewares.use('/demo/', async (req, res, next) => {
    if (req.url !== '/' && !req.url.startsWith('/?')) return next()
    res.setHeader('Content-Type', 'text/html')
    res.end(await server.transformIndexHtml('/demo/', fixture))
  })
} }
const server = await createServer({ root, cacheDir: artifacts + 'vite-cache', configFile: false, plugins: [fixturePlugin, react(), tailwindcss()],
  optimizeDeps: { include: ['react', 'react-dom/client'] },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let count = 0
const errors = []
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`) }
const chromeUA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'
async function setup(ua = chromeUA, options = {}) {
  const context = await browser.newContext({ userAgent: ua, viewport: { width: 360, height: 640 }, serviceWorkers: 'block' })
  await context.addInitScript(({ standalone, oldMedia }) => {
    window.installCalls = 0
    const original = window.matchMedia.bind(window)
    window.matchMedia = query => {
      const result = original(query)
      if (standalone && query.includes('display-mode')) Object.defineProperty(result, 'matches', { value: true })
      if (oldMedia) result.addEventListener = undefined
      return result
    }
    window.sendInstallEvent = (outcome = 'accepted', pending = false, fail = false) => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      event.prompt = () => {
        window.installCalls++
        window.hadUserActivation = navigator.userActivation.isActive
        if (fail) throw new Error('test: prompt rejected')
        return Promise.resolve()
      }
      event.userChoice = pending ? new Promise(resolve => { window.finishInstall = () => resolve({ outcome }) }) : Promise.resolve({ outcome })
      window.dispatchEvent(event)
    }
  }, options)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}/demo/?code=private-test&state=private-test#access_token=private-test`)
  await page.getByRole('button', { name: 'เมนูติดตั้ง', exact: true }).waitFor()
  return { page, context }
}
const floating = page => page.getByRole('button', { name: 'ติดตั้งแอป', exact: true })
try {
  await check('ready: direct prompt with user activation, double tap uses event once', async () => {
    const {page, context} = await setup()
    await page.evaluate(() => window.sendInstallEvent('accepted', true))
    await floating(page).click()
    await page.getByRole('button', {name: 'เมนูติดตั้ง', exact: true}).click()
    assert.equal(await page.evaluate(() => window.installCalls), 1)
    assert.equal(await page.evaluate(() => window.hadUserActivation), true)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.evaluate(() => { window.finishInstall(); window.dispatchEvent(new Event('appinstalled')) })
    await page.waitForFunction(() => !document.querySelector('button.fixed'))
    await context.close()
  })
  await check('Android has no install button before readiness; late event installs directly; dismissal hides it', async () => {
    const {page, context} = await setup()
    assert.equal(await floating(page).count(), 0)
    // จำลอง callback ที่ยังค้างจากเมนูอื่นก่อนพร้อม ต้องไม่เปิดคู่มือ
    await page.getByRole('button', {name:'เมนูติดตั้ง',exact:true}).click()
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.count(), 0)
    await page.screenshot({path: artifacts + 'android-waiting.png'})
    await page.evaluate(() => window.sendInstallEvent('dismissed'))
    await floating(page).waitFor()
    await page.screenshot({path: artifacts + 'android-ready.png'})
    await floating(page).click()
    await dialog.waitFor({state:'detached'})
    assert.equal(await page.evaluate(() => window.installCalls), 1)
    await floating(page).waitFor({state:'detached'})
    await page.getByRole('button', {name:'เมนูติดตั้ง',exact:true}).click()
    assert.equal(await dialog.count(), 0)
    await context.close()
  })
  await check('menu uses same live guide; failures explained and fresh event retries', async () => {
    const {page, context} = await setup()
    await page.evaluate(() => window.sendInstallEvent('accepted', false, true))
    await page.getByRole('button', {name:'เมนูติดตั้ง',exact:true}).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('เปิดหน้าติดตั้งไม่สำเร็จ', {exact:false}).waitFor()
    await page.evaluate(() => window.sendInstallEvent())
    await dialog.getByRole('button', {name:'ติดตั้งแอป',exact:true}).click()
    await dialog.waitFor({state:'detached'})
    assert.equal(await page.evaluate(() => window.installCalls), 2)
    await context.close()
  })
  await check('OEM ready prompt takes priority over handoff', async () => {
    const {page, context} = await setup(chromeUA + ' SamsungBrowser/25.0')
    await page.evaluate(() => window.sendInstallEvent())
    await floating(page).click()
    assert.equal(await page.evaluate(() => window.installCalls), 1)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await context.close()
  })
  await check('OEM prompt failure: explicit Chrome intent, safe tenant URL, copy fallback and narrow layout', async () => {
    const {page, context} = await setup(chromeUA + ' VivoBrowser/10.5')
    await page.setViewportSize({width:320,height:568})
    const session = await context.newCDPSession(page)
    await session.send('Page.enable')
    let target = ''
    session.on('Page.frameRequestedNavigation', event => { if (event.url.startsWith('intent:')) target = event.url })
    assert.equal(await floating(page).count(), 0)
    await page.evaluate(() => window.sendInstallEvent('accepted', false, true))
    await floating(page).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', {name:'เปิดใน Chrome'}).click()
    await dialog.getByRole('textbox').waitFor()
    assert.equal(await dialog.getByRole('textbox').inputValue(), `http://127.0.0.1:${port}/demo/`)
    assert.ok(target.includes('package=com.android.chrome'), target)
    assert.ok(!/private-test|browser_fallback_url/.test(target))
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async value => {window.copied = value}}}))
    await dialog.getByRole('button', {name:'คัดลอกลิงก์'}).click()
    await dialog.getByText('คัดลอกแล้ว เปิด Chrome แล้ววางลิงก์ได้เลย').waitFor()
    assert.equal(await page.evaluate(() => window.copied), `http://127.0.0.1:${port}/demo/`)
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async () => {throw new Error('denied')}}}))
    await dialog.getByRole('button', {name:'คัดลอกลิงก์'}).click()
    await dialog.getByText('คัดลอกอัตโนมัติไม่ได้', {exact:false}).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const sizes = await dialog.getByRole('button').evaluateAll(items => items.map(item => item.getBoundingClientRect().height))
    assert.ok(sizes.every(height => height >= 44), JSON.stringify(sizes))
    await page.screenshot({path: artifacts + 'android-oem-fallback-320.png'})
    await dialog.getByRole('button', {name:'ปิด',exact:true}).focus()
    await page.keyboard.press('Tab')
    assert.equal(await dialog.getByRole('button', {name:'เปิดใน Chrome'}).evaluate(element => document.activeElement === element), true)
    await page.keyboard.press('Escape')
    await dialog.waitFor({state:'detached'})
    assert.equal(await floating(page).evaluate(element => document.activeElement === element), true)
    await context.close()
  })
  await check('iOS guide and legacy media query API', async () => {
    const {page, context} = await setup('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1', {oldMedia:true})
    await page.getByRole('button', {name:'ดูวิธีติดตั้งแอป'}).click()
    await page.getByRole('dialog').getByText('กดปุ่ม แชร์ ใน Safari').waitFor()
    assert.equal(await page.evaluate(() => window.installCalls), 0)
    await page.screenshot({path: artifacts + 'ios-guide.png'})
    await context.close()
  })
  await check('standalone hides install; appinstalled hides already-open menu guide', async () => {
    const first = await setup(chromeUA, {standalone:true})
    assert.equal(await floating(first.page).count(), 0)
    await first.context.close()
    const {page,context} = await setup()
    await page.evaluate(() => window.sendInstallEvent('accepted', false, true))
    await page.getByRole('button', {name:'เมนูติดตั้ง',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await page.getByRole('dialog').waitFor({state:'detached'})
    assert.equal(await floating(page).count(), 0)
    await context.close()
  })
  assert.deepEqual(errors, [])
  console.log(`PASS ${count} scenarios; screenshots: ${artifacts}`)
} finally {
  await browser.close()
  await server.close()
}
