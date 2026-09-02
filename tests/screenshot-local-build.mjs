// ถ่ายภาพหน้าจอจาก build ในเครื่อง ก่อน deploy — ทั้งจอ PC และมือถือในรอบเดียว
//
// ปัญหาที่เครื่องมือนี้แก้: บั๊กเรื่อง layout (ข้อความล้น คอลัมน์ถูกบีบ ปุ่มเบียดจนอ่านไม่ออก)
// พิสูจน์ด้วย unit test ไม่ได้ และ build ผ่านก็ไม่ได้แปลว่าหน้าจอใช้งานได้จริง
// ที่ผ่านมาจึงรู้ตอน deploy ขึ้นไปแล้วเท่านั้น — 2026-09-02 หน้าจัดการเบอร์โทรบนมือถือ
// เหลือที่ให้ชื่อราว 10 ตัวอักษรต่อบรรทัด ไม่มีด่านไหนจับได้เลย
//
// วิธี: ยืมกลไกจาก verify-local-build.mjs — เปิด Chrome profile ที่มี session ของสนามซ้อม
// อยู่บน origin เดิมทุกประการ (session/localStorage ใช้ได้) แต่ intercept ทุก request ของ
// origin นั้นแล้วตอบจาก dist/ ที่เพิ่ง build
//
// ข้อมูล: ปกติอ่านของจริงจาก Supabase (อ่านอย่างเดียว) ถ้าต้องการทดสอบเคสสุดขั้ว
// เช่นชื่อยาวผิดปกติ ให้ส่ง --mock ไฟล์ JSON เข้ามาแทน — ห้ามใส่ข้อมูลจริงของประชาชน
// ลงไฟล์ mock ที่ commit ขึ้น repo (PDPA) ใช้ชื่อและเบอร์สมมติเท่านั้น
//
// ข้อควรรู้
//   - ต้อง `npm run build` ก่อนเสมอ ไม่งั้นได้ภาพของ bundle เก่า (สคริปต์เตือนให้ถ้าไม่มี asset จาก dist)
//   - สคริปต์ unregister service worker + ล้าง Cache Storage ของโปรไฟล์นั้น (ไม่แตะ localStorage
//     จึงไม่หลุด session) ครั้งถัดไปที่เปิดเว็บจริง service worker จะลงทะเบียนใหม่เอง
//   - เขียน DB ไม่ได้โดยตั้งใจ: เมื่อใช้ --mock จะบล็อกทุก request ที่ไม่ใช่ GET ของตารางนั้น
//
//   - รันจาก Git Bash ต้องนำหน้าด้วย MSYS_NO_PATHCONV=1 ไม่งั้น /admin จะถูกแปลงเป็น
//     path ของ Windows (C:/Program Files/Git/admin) แล้วสคริปต์จะฟ้องว่า --route ผิดรูป
//     รันจาก PowerShell หรือ cmd ไม่ต้องใส่
//
// ตัวอย่าง
//   npm run test:shot -- --route /directory --name directory
//   npm run test:shot -- --profile admin --route /admin --name contacts \
//     --click "nav button:has-text('เบอร์โทรสำคัญ')" \
//     --click "div.bg-gray-100 button:has-text('เบอร์โทรสำคัญ')" \
//     --mock tests/mocks/contacts-long.json --full
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const DEFAULT_HOST = 'demo.rk-networks.com'
const DIST = path.join(process.cwd(), 'dist')
const PROFILE_ROOT = path.join(process.cwd(), '.chrome-test-profiles')
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}
const VIEWPORTS = {
  pc: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

function parseArgs(argv) {
  const args = {
    profile: 'admin', route: '/', name: 'shot', clicks: [], mock: null,
    out: 'screenshots', viewport: 'both', full: false, host: DEFAULT_HOST, wait: 2500,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--profile') args.profile = argv[++i]
    else if (flag === '--route') args.route = argv[++i]
    else if (flag === '--name') args.name = argv[++i]
    else if (flag === '--click') args.clicks.push(argv[++i])
    else if (flag === '--mock') args.mock = argv[++i]
    else if (flag === '--out') args.out = argv[++i]
    else if (flag === '--viewport') args.viewport = argv[++i]
    else if (flag === '--host') args.host = argv[++i]
    else if (flag === '--wait') args.wait = Number(argv[++i])
    else if (flag === '--full') args.full = true
    else throw new Error(`Unknown argument: ${flag}`)
  }
  if (!args.route.startsWith('/')) throw new Error('--route ต้องขึ้นต้นด้วย /')
  if (!VIEWPORTS[args.viewport] && args.viewport !== 'both') {
    throw new Error(`--viewport ต้องเป็น pc, mobile หรือ both (ได้ "${args.viewport}")`)
  }
  if (!Number.isFinite(args.wait) || args.wait < 0) throw new Error('--wait ต้องเป็นตัวเลขมิลลิวินาที')
  return args
}

const args = parseArgs(process.argv.slice(2))
const ORIGIN = `https://${args.host}`
const outDir = path.resolve(process.cwd(), args.out)
await mkdir(outDir, { recursive: true })

// mock: { "<ชื่อตาราง>": [ {...แถว}, ... ] } — ตอบเฉพาะ GET ของตารางที่ระบุ
let mocks = {}
if (args.mock) {
  mocks = JSON.parse(await readFile(path.resolve(process.cwd(), args.mock), 'utf8'))
}

const context = await chromium.launchPersistentContext(path.join(PROFILE_ROOT, `TEST-${args.profile}`), {
  channel: 'chrome',
  headless: true,
  viewport: VIEWPORTS.pc,
  serviceWorkers: 'block',
})

const shots = []
try {
  const page = context.pages()[0] || await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  })

  const served = []
  await page.route((url) => url.hostname === args.host, async (route) => {
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

  for (const [table, rows] of Object.entries(mocks)) {
    if (table.startsWith('_')) continue // คีย์ _readme ฯลฯ เป็นหมายเหตุในไฟล์ ไม่ใช่ชื่อตาราง
    await page.route((url) => url.pathname.includes(`/rest/v1/${table}`), async (route) => {
      // กันเขียนของจริงระหว่างถ่ายภาพ — ตารางที่ถูก mock อ่านได้อย่างเดียว
      if (route.request().method() !== 'GET') return route.abort()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': ORIGIN },
        body: JSON.stringify(rows),
      })
    })
  }

  await page.goto(`${ORIGIN}${args.route}`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  await page.waitForTimeout(9_000)

  for (const selector of args.clicks) {
    await page.locator(selector).first().click({ timeout: 15_000 })
    await page.waitForTimeout(args.wait)
  }

  const targets = args.viewport === 'both' ? ['pc', 'mobile'] : [args.viewport]
  for (const key of targets) {
    await page.setViewportSize(VIEWPORTS[key])
    await page.waitForTimeout(1_500)
    const file = path.join(outDir, `${args.name}-${key}.png`)
    await page.screenshot({ path: file, fullPage: args.full })
    shots.push(file)
  }

  // ถ้า bundle ที่รันไม่ใช่ของในเครื่อง ภาพที่ได้ไม่มีความหมาย ต้องดังก่อนอย่างอื่น
  if (served.filter((file) => file.endsWith('.js')).length === 0) {
    process.stdout.write('FAIL ไม่มี asset จาก dist/ ถูกใช้เลย — รัน npm run build ก่อน หรือ service worker ยังค้างอยู่\n')
    process.exitCode = 1
  } else {
    process.stdout.write(`OK profile=${args.profile} route=${args.route} localAssets=${served.length}\n`)
  }
  for (const file of shots) process.stdout.write(`  ${file}\n`)
} finally {
  await context.close()
}
