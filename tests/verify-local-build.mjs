// ตรวจ build ในเครื่องกับ session จริงของสนามซ้อม โดยไม่ต้อง deploy
//
// ปัญหาที่เครื่องมือนี้แก้: การแก้ UI ที่ขึ้นกับสิทธิ์ของผู้ใช้ (role/fleet_role) พิสูจน์ด้วย unit test
// ไม่ได้ และ dev server ในเครื่องก็ล็อกอินไม่ได้ถ้าไม่มีรหัสผ่าน ทางเดียวที่เหลือคือ deploy ขึ้น
// production ก่อนแล้วค่อยรู้ว่าแก้ถูกไหม ซึ่งกลับด้านกับลำดับที่ควรเป็น
//
// วิธี: เปิด Chrome Profile ที่มี session ของสนามซ้อมอยู่แล้ว อยู่บน origin เดิมทุกประการ
// (session/localStorage จึงใช้ได้) แต่ intercept ทุก request ของ origin นั้นแล้วตอบจาก dist/
// ที่เพิ่ง build — Supabase อยู่คนละ origin จึงยิงของจริง = อ่านข้อมูลสนามซ้อม ไม่เขียนอะไรเลย
//
// ข้อควรรู้
//   - ต้อง `npm run build` ก่อนเสมอ ไม่งั้นได้ผลของ bundle เก่า
//   - สคริปต์ unregister service worker + ล้าง Cache Storage ของโปรไฟล์นั้น มิฉะนั้น PWA ที่ติดตั้ง
//     ไว้จะเสิร์ฟ bundle เก่าโดยไม่ผ่าน route() เลย (ไม่แตะ localStorage จึงไม่หลุด session)
//     ครั้งถัดไปที่เปิดเว็บจริง service worker จะลงทะเบียนใหม่เอง
//   - dist ไม่มี index.html เพราะ postbuild.js เปลี่ยนชื่อเป็น _template.html ให้ worker ฉีด og tag
//     document request จึง map มาที่ไฟล์นั้น
//
// ตัวอย่าง
//   node tests/verify-local-build.mjs --profile staff --route /staff --absent "ยานพาหนะ/น้ำมัน"
//   node tests/verify-local-build.mjs --profile fleet-staff --route /staff --present "ยานพาหนะ/น้ำมัน"

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const HOST = 'demo.rk-networks.com'
const ORIGIN = `https://${HOST}`
const DIST = path.join(process.cwd(), 'dist')
const PROFILE_ROOT = path.join(process.cwd(), '.chrome-test-profiles')
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

function parseArgs(argv) {
  const args = { profile: null, route: '/staff', present: [], absent: [], headed: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--profile') args.profile = argv[++i]
    else if (flag === '--route') args.route = argv[++i]
    else if (flag === '--present') args.present.push(argv[++i])
    else if (flag === '--absent') args.absent.push(argv[++i])
    else if (flag === '--headed') args.headed = true
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!args.profile) throw new Error('ต้องระบุ --profile <ชื่อโปรไฟล์ใน .chrome-test-profiles โดยไม่มี TEST->')
  if (!args.route.startsWith('/')) throw new Error('--route ต้องขึ้นต้นด้วย /')
  return args
}

const args = parseArgs(process.argv.slice(2))
const context = await chromium.launchPersistentContext(path.join(PROFILE_ROOT, `TEST-${args.profile}`), {
  channel: 'chrome',
  headless: !args.headed,
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
})

try {
  const page = context.pages()[0] || await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    const cacheKeys = await caches.keys()
    await Promise.all(cacheKeys.map((key) => caches.delete(key)))
  })

  const served = []
  await page.route((url) => url.hostname === HOST, async (route) => {
    const { pathname } = new URL(route.request().url())
    const rel = path.extname(pathname) ? pathname.slice(1) : '_template.html'
    try {
      const body = await readFile(path.join(DIST, rel))
      served.push(rel)
      return route.fulfill({ body, contentType: MIME[path.extname(rel)] ?? 'application/octet-stream' })
    } catch {
      // ไม่มีใน dist (เช่น asset ของ build เก่าที่ browser ยังอ้างถึง) ปล่อยไปที่เซิร์ฟเวอร์จริง
      return route.continue()
    }
  })

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  await page.waitForTimeout(6_000)
  await page.evaluate((route) => {
    window.history.pushState({}, '', route)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, args.route)
  await page.waitForTimeout(8_000)

  const text = await page.evaluate(() => document.body?.innerText ?? '')
  const failures = [
    ...args.present.filter((needle) => !text.includes(needle)).map((needle) => `ต้องเจอแต่ไม่เจอ: "${needle}"`),
    ...args.absent.filter((needle) => text.includes(needle)).map((needle) => `ต้องไม่เจอแต่เจอ: "${needle}"`),
  ]
  // ถ้า bundle ที่รันไม่ใช่ของในเครื่อง ผลลัพธ์ทั้งหมดไม่มีความหมาย ต้องดังก่อนอย่างอื่น
  if (served.filter((file) => file.endsWith('.js')).length === 0) {
    failures.unshift('ไม่มี asset จาก dist/ ถูกใช้เลย — build ก่อนรัน หรือ service worker ยังค้างอยู่')
  }

  const status = failures.length === 0 ? 'PASS' : 'FAIL'
  process.stdout.write(`${status} profile=${args.profile} route=${args.route} localAssets=${served.length}\n`)
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`)
  process.exitCode = failures.length === 0 ? 0 : 1
} finally {
  await context.close()
}
