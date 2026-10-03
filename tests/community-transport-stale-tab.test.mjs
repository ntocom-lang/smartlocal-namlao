// Local-only activation evidence: actual main.jsx reload handler + src/sw.js
// (Workbox bundled locally), and the actual pre-community/current print builders.
// A passing test documents BOTH reload success and unsafe no-SW/offline cases.
// It does not certify universal stale-tab safety or a physical phone.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve('.')
const baseline = process.env.COMMUNITY_STALE_BASELINE || '0ad22d2e'
const outDir = process.env.COMMUNITY_ACTIVATION_EVIDENCE
const old = file => execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 2000000 })
const currentMain = await readFile('src/main.jsx', 'utf8')
const oldMain = old('src/main.jsx')
function reloadHandler(main) {
  const start = main.indexOf("if ('serviceWorker' in navigator)")
  const end = main.indexOf('createRoot(', start)
  assert(start >= 0 && end > start, 'Review main.jsx changes before reusing this fixture')
  return main.slice(start, end).replace(/\r\n/g, '\n')
}
assert.equal(reloadHandler(oldMain), reloadHandler(currentMain), 'Old and new reload policies differ: review both')
const swSource = await readFile('src/sw.js', 'utf8')
const printSource = [old('src/lib/patientTransportPrint.js'), await readFile('src/lib/patientTransportPrint.js', 'utf8')]
const js = new Map()
for (let i = 1; i <= 2; i++) {
  const print = await build({ stdin: { contents: printSource[i - 1], resolveDir: path.join(root, 'src/lib'), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
  js.set(`/fixture-v${i}.js`, print.outputFiles[0].text)
  const worker = await build({ stdin: { contents: swSource, resolveDir: path.join(root, 'src'), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'self.__WB_MANIFEST': JSON.stringify([{ url: `/assets/fixture-release-v${i}.js`, revision: null }]) } })
  js.set(`/sw-v${i}.js`, worker.outputFiles[0].text)
  js.set(`/assets/fixture-release-v${i}.js`, `/* synthetic release ${i} */`)
}
const fixture = { tenant: { name: '[TEST] อบต.ทดสอบ', org_type: 'อบต.', address: '[TEST] ที่ทำการ' },
  booking: { id: 'synthetic-community', service_type: 'community', group_label: '[TEST] กลุ่มชุมชน', party_size: 3,
    patient_name: null, relation: null, status: 'confirmed', trip_id: 'synthetic-trip', requester_name: '[TEST] ผู้ติดต่อ',
    phone: '0800000001', pickup: '[TEST] จุดรับ', route_label: '[TEST] ศูนย์ชุมชน', appointment_at: '2026-10-10T10:00:00+07:00',
    entry_channel: 'staff', companions: 0, mobility: 'walk', return_mode: 'one_way', return_at: null },
  trip: { id: 'synthetic-trip', state: 'confirmed', plan: { service_type: 'community' } }, partner: { name: '[TEST] กองทุน' } }
let release = 1
let workerUnavailable = false
const report = { baseline, tests: [], universalSafety: false, realTenantWrites: 0, externalRequests: 0 }
function record(name, details = {}) { report.tests.push({ name, passed: true, ...details }); console.log(`PASS ${name}`) }
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost').pathname
  response.setHeader('Cache-Control', 'no-store')
  if (url === '/sw.js' && workerUnavailable) { response.statusCode = 503; response.end('Synthetic update endpoint unavailable'); return }
  if (url === '/sw.js' || js.has(url)) {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    response.end(js.get(url === '/sw.js' ? `/sw-v${release}.js` : url))
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><meta charset="utf-8"><body data-release="${release}"><h1>[TEST] release ${release}</h1><button id="print">เตรียมเอกสารชุมชน</button><div id="result"></div>
      <script>navigator.serviceWorker?.addEventListener('controllerchange',()=>sessionStorage.setItem('changes',String(Number(sessionStorage.getItem('changes')||0)+1)));
      ${reloadHandler(release === 1 ? oldMain : currentMain)}
      navigator.serviceWorker?.register('/sw.js').catch(()=>{});</script>
      <script type="module">import { buildBookingRequestFormHtml } from '/fixture-v${release}.js';
      window.fixtureReady=true;document.querySelector('#print').onclick=()=>{try{const html=buildBookingRequestFormHtml(${JSON.stringify(fixture)});document.querySelector('#result').textContent=html.includes('ใบคำขอรถรับ-ส่งผู้ป่วย')?'UNSAFE_PATIENT_DOCUMENT':'OTHER_DOCUMENT'}catch(e){document.querySelector('#result').textContent=e.message}};</script>`)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
async function context(options = {}) {
  const ctx = await browser.newContext(options)
  await ctx.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue()
    report.externalRequests++; return route.abort()
  })
  return ctx
}
async function ready(page, n) {
  await page.waitForFunction(n => document.body.dataset.release === String(n) && window.fixtureReady, n, { timeout: 30000 })
}
async function oldPrinter(page) { await page.locator('#print').click(); await page.getByText('UNSAFE_PATIENT_DOCUMENT', { exact: true }).waitFor() }
try {
  const controlled = await context()
  try {
    const tabs = [await controlled.newPage(), await controlled.newPage()]
    for (const page of tabs) {
      await page.goto(base); await ready(page, 1)
      await page.waitForFunction(() => !!navigator.serviceWorker.controller)
      await ready(page, 1)
      await oldPrinter(page)
    }
    const before = await Promise.all(tabs.map(p => p.evaluate(() => Number(sessionStorage.getItem('changes') || 0))))
    release = 2
    await tabs[0].evaluate(async () => (await navigator.serviceWorker.ready).update())
    for (let i = 0; i < tabs.length; i++) {
      await ready(tabs[i], 2)
      assert((await tabs[i].evaluate(() => Number(sessionStorage.getItem('changes') || 0))) > before[i])
      await tabs[i].locator('#print').click()
      await tabs[i].getByText('คำขอชุมชนต้องใช้เอกสารชุมชน กรุณาโหลดหน้าทำงานรุ่นล่าสุด', { exact: true }).waitFor()
    }
    record('Two online SW-controlled old tabs reload after worker activation; new print builder rejects patient template for community')
  } finally { await controlled.close() }

  release = 1
  const noSW = await context({ serviceWorkers: 'block' })
  try {
    const page = await noSW.newPage(); await page.goto(base); await ready(page, 1)
    release = 2
    await page.evaluate(async () => { await fetch('/sw.js', { cache: 'no-store' }); window.dispatchEvent(new Event('focus')) })
    assert.equal(await page.locator('body').getAttribute('data-release'), '1')
    await oldPrinter(page)
    record('No-SW old tab stays old after deployment/focus and can build a patient document for community', { unsafe: true })
    if (outDir) { await mkdir(outDir, { recursive: true }); await page.screenshot({ path: path.join(outDir, 'stale-no-sw.png'), fullPage: true }) }
    await page.reload(); await ready(page, 2)
    await page.locator('#print').click()
    await page.getByText('คำขอชุมชนต้องใช้เอกสารชุมชน กรุณาโหลดหน้าทำงานรุ่นล่าสุด', { exact: true }).waitFor()
    record('Explicit online reload recovers the no-SW tab')
  } finally { await noSW.close() }

  release = 1
  const offline = await context()
  try {
    const page = await offline.newPage(); await page.goto(base); await ready(page, 1)
    await page.waitForFunction(() => !!navigator.serviceWorker.controller); await ready(page, 1)
    // Chrome worker network can bypass Playwright's page-level offline emulation.
    // Also make the local update endpoint unavailable; no production network used.
    await offline.setOffline(true); workerUnavailable = true; release = 2
    const failedUpdate = await page.evaluate(async () => { try { await (await navigator.serviceWorker.ready).update(); return false } catch { return true } })
    assert.equal(failedUpdate, true)
    await oldPrinter(page)
    record('SW-controlled old tab with unavailable worker update still has the old print builder', { unsafe: true })
    workerUnavailable = false; await offline.setOffline(false)
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
    await ready(page, 2)
    record('Reconnection plus worker update recovers the offline tab')
  } finally { await offline.close() }
  assert.equal(report.externalRequests, 0, 'Fixture attempted external access')
  record('All fixtures synthetic/local; no Supabase or production connection')
  report.passed = true
} catch (error) { report.passed = false; report.error = error.message; throw error }
finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
  if (outDir) { await mkdir(outDir, { recursive: true }); await writeFile(path.join(outDir, 'stale-tab.json'), JSON.stringify(report, null, 2) + '\n') }
}
