// ตัวนับการเข้าชมเว็บไซต์ (ท้ายเว็บ + /reports/visitors) — ตรวจ 3 ชั้น
//   1) กติกาฝั่งหน้าเว็บ src/lib/siteOpenStats.js: ตัดวันเวลาไทย · ตัดสิ่งที่ไม่ใช่คน · ตัดหน้าหลังบ้าน · เครื่องไม่ซ้ำต่อวัน
//   2) รูปข้อมูลกราฟรายเดือน/รายปีงบ (เดือนที่ไม่มีข้อมูลต้องเป็น 0 ไม่ใช่หายไป)
//   3) ชื่อ RPC ฝั่งหน้าเว็บตรงกับ migration + จุดเรียกใน AppShell + ป้าย "ครั้ง" ไม่กลายเป็น "คน"
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BACKOFFICE_EXCLUDED_SINCE,
  BACKOFFICE_PATHS,
  MENU_PAGE_KEYS,
  OTHER_PAGE,
  PAGE_CATALOG,
  UNCOUNTED_ROUTES,
  addSeenPageKey,
  bangkokDay,
  fiscalMonthSeries,
  fiscalYearSeries,
  isCountableEnvironment,
  isCountablePath,
  isFirstPageToday,
  isFirstTodayVisitor,
  pageKeyForPath,
  pageRanking,
} from '../src/lib/siteOpenStats.js'
import { FISCAL_MONTHS_TH, fiscalYearBounds } from '../src/lib/fiscalYear.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async (rel) => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

const HOST = 'namlao.rk-networks.com'
const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  lineInApp: 'Mozilla/5.0 (Linux; Android 13; V2207) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36 Line/14.13.1',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  // ชื่อรุ่นมีคำว่า BOT — ต้องนับ ไม่งั้น /bot/i ลอยๆ จะตัดคนจริงทิ้ง
  cubot: 'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.137 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36',
  lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
}

test('ตัดวันตามเวลาไทย ไม่ขึ้นกับ timezone ของเครื่อง', () => {
  // 23:59:59 น. เวลาไทย = 16:59:59Z ยังเป็นวันเดิม · 00:00 น. เวลาไทย = 17:00Z ขึ้นวันใหม่
  assert.equal(bangkokDay(new Date('2026-09-29T16:59:59Z')), '2026-09-29')
  assert.equal(bangkokDay(new Date('2026-09-29T17:00:00Z')), '2026-09-30')
  // ข้ามปีงบ (30 ก.ย. → 1 ต.ค.) และข้ามปีปฏิทิน
  assert.equal(bangkokDay(new Date('2026-09-30T17:00:00Z')), '2026-10-01')
  assert.equal(bangkokDay(new Date('2026-12-31T17:30:00Z')), '2027-01-01')
})

test('นับคนจริงทุกเบราว์เซอร์ที่พบบ่อย รวมเครื่องที่ชื่อรุ่นมีคำว่า BOT', () => {
  for (const key of ['chromeAndroid', 'iphone', 'lineInApp', 'samsung', 'cubot']) {
    assert.equal(isCountableEnvironment({ hostname: HOST, userAgent: UA[key] }), true, `${key} ต้องนับ`)
  }
})

test('ไม่นับบอต เบราว์เซอร์ที่สคริปต์คุม และเครื่องพัฒนา', () => {
  for (const key of ['googlebot', 'bingbot', 'applebot', 'headless', 'lighthouse']) {
    assert.equal(isCountableEnvironment({ hostname: HOST, userAgent: UA[key] }), false, `${key} ต้องไม่นับ`)
  }
  assert.equal(isCountableEnvironment({ hostname: HOST, userAgent: UA.iphone, webdriver: true }), false, 'E2E (webdriver)')
  assert.equal(isCountableEnvironment({ hostname: HOST, userAgent: UA.iphone, isDev: true }), false, 'npm run dev')
  for (const hostname of ['localhost', '127.0.0.1', '192.168.1.44', '[::1]', 'app.localhost', '']) {
    assert.equal(isCountableEnvironment({ hostname, userAgent: UA.iphone }), false, `hostname "${hostname}" ต่อ DB จริงแต่ไม่ใช่ผู้เข้าชม`)
  }
})

test('ไม่นับหน้าหลังบ้าน แต่หน้าที่ประชาชนใช้ร่วมกับเจ้าหน้าที่ยังนับ', () => {
  for (const p of [
    '/admin', '/admin/login', '/staff', '/staff/', '/staff/patient-transport', '/technician', '/fleet',
    '/data-center/staff', '/events/manage', '/dev-journal', '/device-login',
    '/Staff', '/ADMIN', // react-router จับ route แบบไม่สนตัวพิมพ์ — ตัวพิมพ์ใหญ่ก็เปิดหน้าเจ้าหน้าที่ได้
  ]) {
    assert.equal(isCountablePath(p), false, `${p} เป็นหน้าหลังบ้าน ต้องไม่นับ`)
  }
  for (const p of [
    '/', '', undefined, '/auth', '/profile', '/notifications', '/complaint', '/my-complaints', '/events',
    '/reports', '/reports/visitors', '/data-center', '/data-center/public', '/tourism/abc',
    '/staffing', '/administration', '/fleet-info', // ชื่อขึ้นต้นเหมือนกันแต่ไม่ใช่หน้าหลังบ้าน
  ]) {
    assert.equal(isCountablePath(p), true, `${p} ต้องนับ`)
  }
})

test('รายชื่อหน้าหลังบ้านตรงกับ route จริงใน App.jsx และวันเปลี่ยนนิยามอยู่ในรูปแบบวันที่', async () => {
  const app = await read('src/App.jsx')
  // เปลี่ยนชื่อ route แล้วลืมแก้ BACKOFFICE_PATHS = หน้านั้นกลับมาถูกนับเงียบๆ
  for (const p of BACKOFFICE_PATHS) {
    assert.ok(app.includes(`path="${p}"`), `${p} ต้องเป็น route จริงใน App.jsx`)
  }
  assert.match(BACKOFFICE_EXCLUDED_SINCE, /^\d{4}-\d{2}-\d{2}$/, 'เทียบกับ since (YYYY-MM-DD) แบบสตริงในหน้ารายงาน')
})

test('เครื่องไม่ซ้ำต่อวัน: นับครั้งแรกของวันเท่านั้น และไม่นับถ้าอ่าน storage ไม่ได้', () => {
  const today = '2026-09-30'
  assert.equal(isFirstTodayVisitor({ storageOk: true, storedDay: null, claimedDay: null, today }), true, 'เครื่องใหม่')
  assert.equal(isFirstTodayVisitor({ storageOk: true, storedDay: '2026-09-29', claimedDay: null, today }), true, 'มาเมื่อวาน วันนี้มาใหม่')
  assert.equal(isFirstTodayVisitor({ storageOk: true, storedDay: today, claimedDay: null, today }), false, 'นับวันนี้ไปแล้ว')
  assert.equal(isFirstTodayVisitor({ storageOk: true, storedDay: null, claimedDay: today, today }), false, 'กำลังรอ RPC ของหน้าก่อนหน้า')
  assert.equal(isFirstTodayVisitor({ storageOk: false, storedDay: null, claimedDay: null, today }), false, 'storage ถูกบล็อก')
})

test('รายเดือนตามปีงบ: ครบ 12 เดือน ต.ค.→ก.ย. เดือนว่างเป็น 0', () => {
  const series = fiscalMonthSeries(
    [{ month_start: '2025-10-01', opens: 120 }, { month_start: '2026-09-01', opens: '45' }],
    fiscalYearBounds(2569),
    FISCAL_MONTHS_TH,
  )
  assert.equal(series.length, 12)
  assert.deepEqual(series[0], { key: '2025-10', label: 'ต.ค.', opens: 120 })
  assert.deepEqual(series[11], { key: '2026-09', label: 'ก.ย.', opens: 45 }, 'ค่าจาก bigint ของ PostgREST มาเป็นสตริงได้')
  assert.equal(series.slice(1, 11).every(m => m.opens === 0), true)
})

test('รายปีงบ: ตั้งแต่ปีแรกที่มีข้อมูลถึงปีงบปัจจุบัน ปีที่ไม่มีข้อมูลเป็น 0', () => {
  const rows = [
    { month_start: '2025-09-01', opens: 10 },  // ปีงบ 2568
    { month_start: '2025-10-01', opens: 20 },  // ปีงบ 2569
    { month_start: '2026-02-01', opens: 5 },   // ปีงบ 2569
  ]
  assert.deepEqual(fiscalYearSeries(rows, 2571).map(p => [p.label, p.opens]),
    [['2568', 10], ['2569', 25], ['2570', 0], ['2571', 0]])
  assert.deepEqual(fiscalYearSeries([], 2570).map(p => [p.label, p.opens]), [['2570', 0]], 'ยังไม่มีข้อมูล')
})

test('ชื่อ RPC ฝั่งหน้าเว็บตรงกับ migration และทุกตัวให้ anon เรียกได้', async () => {
  const sql = [
    await read('supabase/migrations/20260930100100_site_open_daily_rpc.sql'),
    await read('supabase/migrations/20261028100100_site_page_daily_rpc.sql'),
  ].join('\n')
  const client = [
    await read('src/lib/siteOpenCounter.js'),
    await read('src/pages/VisitorStats.jsx'),
  ].join('\n')
  const called = [...client.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1])
  assert.deepEqual([...new Set(called)].sort(),
    ['get_site_open_daily', 'get_site_open_monthly', 'get_site_open_summary', 'get_site_page_ranking', 'record_site_open'])
  for (const fn of called) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `${fn} ต้องมีใน migration`)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon, authenticated;`), `${fn} ต้อง grant ให้ anon`)
  }
  // ชื่อ RPC อยู่ใน URL — คำพวกนี้ตัวบล็อกโฆษณาดักบ่อย โดนบล็อก = นับขาดเงียบๆ
  for (const fn of called) assert.doesNotMatch(fn, /track|visit|analytic|pageview|beacon/, fn)
})

test('AppShell นับใหม่ทุกครั้งที่เปลี่ยนหน้า และป้ายท้ายเว็บเป็น "ครั้ง" ไม่ใช่ "คน"', async () => {
  const app = await read('src/App.jsx')
  assert.match(app, /useEffect\(\(\) => scheduleSiteOpen\(tenantId, location\.pathname\), \[tenantId, location\.pathname\]\)/,
    'ถ้าถอด location.pathname ออกจาก deps จะนับแค่ตอนโหลดหน้าแรก ยอดหายเงียบๆ · ถ้าไม่ส่ง pathname หน้าหลังบ้านจะถูกนับ')
  const counterLib = await read('src/lib/siteOpenCounter.js')
  assert.match(counterLib, /!isCountablePath\(pathname\)/, 'scheduleSiteOpen ต้องตรวจหน้าหลังบ้านก่อนตั้งตัวจับเวลา')
  // ตัดคอมเมนต์ออกก่อน — คอมเมนต์ในไฟล์นั้นอธิบายไว้ว่าห้ามใช้คำว่า "ผู้เข้าชม … คน"
  const counter = (await read('src/components/layout/SiteVisitCounter.jsx'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '')
  assert.match(counter, /การเข้าชมเว็บไซต์ \(ครั้ง\)/)
  assert.doesNotMatch(counter, /ผู้เข้าชม|คน</, 'ยอดนี้นับซ้ำคนเดิมได้ ห้ามเรียกเป็นจำนวนคน')
})

// ─── สถิติรายหน้า ─────────────────────────────────────────────────────────────────────────
// ต้องตรงกับ CHECK ในตาราง + เงื่อนไขในฟังก์ชัน (20261028100000 / 20261028100100) — แก้ที่ใดที่หนึ่งต้องแก้ทั้งสาม
const SERVER_PAGE_KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/

test('ชื่อกลุ่มหน้า: pathname → ชื่อ ไม่หลุดตัวแปรใน URL และไม่สนตัวพิมพ์/เครื่องหมาย / ท้าย', () => {
  assert.equal(pageKeyForPath('/'), 'home')
  assert.equal(pageKeyForPath('/complaint'), 'complaint')
  assert.equal(pageKeyForPath('/complaint/'), 'complaint')
  assert.equal(pageKeyForPath('/Water-Situation'), 'water-situation')
  assert.equal(pageKeyForPath('/reports'), 'reports')
  assert.equal(pageKeyForPath('/reports/visitors'), 'reports-visitors')
  assert.equal(pageKeyForPath('/tourism'), 'tourism')
  assert.equal(pageKeyForPath('/tourism/0b9a3c1e-aaaa-bbbb-cccc-123456789abc'), 'tourism-detail')
  assert.equal(pageKeyForPath('/data-center/public'), 'data-center-public')
  assert.equal(pageKeyForPath('/no-such-page'), OTHER_PAGE.key)
  assert.equal(pageKeyForPath('/complaint/extra/segments'), OTHER_PAGE.key)
  assert.equal(pageKeyForPath(''), 'home')
  assert.equal(pageKeyForPath(undefined), 'home')
  // โทเคนติดตามเรื่อง/รหัสตรวจสอบลายเซ็นห้ามอยู่ในชื่อที่ส่งขึ้นไป
  const secrets = ['Zx9-SECRET-token_123', 'ABCD1234EFGH']
  assert.equal(pageKeyForPath(`/t/${secrets[0]}`), 'track')
  assert.equal(pageKeyForPath(`/v/${secrets[1]}`), 'verify')
  for (const secret of secrets) {
    for (const p of [`/t/${secret}`, `/v/${secret}`, `/survey/${secret}`, `/tourism/${secret}`, `/${secret}`]) {
      assert.ok(!pageKeyForPath(p).toLowerCase().includes(secret.toLowerCase()), `${p} ส่งตัวแปรใน URL ขึ้นไป`)
    }
  }
})

test('ตารางชื่อหน้า: ชื่อไม่ซ้ำ ตรงรูปแบบที่ server รับ น้อยกว่าเพดานชื่อต่อวันของ server', async () => {
  const keys = PAGE_CATALOG.map(p => p.key)
  assert.equal(new Set(keys).size, keys.length, 'ชื่อซ้ำ')
  assert.equal(new Set(PAGE_CATALOG.map(p => p.path)).size, PAGE_CATALOG.length, 'path ซ้ำ')
  for (const page of [...PAGE_CATALOG, OTHER_PAGE]) {
    assert.match(page.key, SERVER_PAGE_KEY, `${page.key} ผิดรูปแบบที่ server รับ — จะถูกนับเป็น other`)
    assert.ok(page.label.trim(), `${page.key} ไม่มีชื่อภาษาไทย`)
    assert.ok(['service', 'info', 'mine', 'transit'].includes(page.kind), `${page.key} kind ไม่รู้จัก`)
  }
  assert.ok(PAGE_CATALOG.every(p => p.path.startsWith('/')))
  // เพดาน 60 ชื่อ/อปท./วัน ใน server ต้องมีที่เหลือ ไม่งั้นหน้าจริงของเราเองจะถูกรวมเป็น other
  const sql = await read('supabase/migrations/20261028100100_site_page_daily_rpc.sql')
  const cap = Number(/>= (\d+) THEN\s+v_page := 'other'/.exec(sql)?.[1])
  assert.ok(cap >= PAGE_CATALOG.length + 10, `เพดาน ${cap} ชื่อ/วัน เหลือที่ไม่พอสำหรับ ${PAGE_CATALOG.length} หน้า`)
})

test('ทุก route ใน App.jsx มีชื่อหน้า หรือเป็นหน้าหลังบ้าน/ทางผ่าน redirect — เพิ่ม route แล้วลืมจะไม่หายเงียบๆ', async () => {
  const app = await read('src/App.jsx')
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1])
  assert.ok(routes.length > 30, 'อ่าน route จาก App.jsx ไม่ได้')
  const catalogPaths = new Set(PAGE_CATALOG.map(p => p.path))
  for (const route of routes) {
    const known = catalogPaths.has(route) || UNCOUNTED_ROUTES.includes(route) || !isCountablePath(route)
    assert.ok(known, `${route} ยังไม่มีชื่อหน้าใน PAGE_CATALOG (siteOpenStats.js) — จะไปรวมอยู่ใน other`)
  }
  // ย้อนกลับ: ชื่อในตารางต้องเป็น route จริง ไม่ค้างหน้าที่ลบไปแล้ว
  for (const p of PAGE_CATALOG) assert.ok(routes.includes(p.path), `${p.path} ไม่มีใน App.jsx แล้ว`)
  // ทุกหน้าที่นับต้องถูกจับคู่ด้วย pathname ตัวอย่างของมันเอง
  for (const p of PAGE_CATALOG) {
    const sample = p.path.replace(/:[a-z]+/gi, 'sample-value')
    assert.equal(pageKeyForPath(sample), p.key, `${p.path} จับคู่ผิด`)
  }
})

test('ตัวรองรายหน้า: นับครั้งแรกของหน้าในวันเท่านั้น ไม่นับถ้าอ่าน storage ไม่ได้ และข้ามวันเริ่มใหม่', () => {
  const base = { storageOk: true, storedDay: '2026-10-28', storedKeys: ['home', 'waste'], claimedDay: null, claimedKeys: [], today: '2026-10-28' }
  assert.equal(isFirstPageToday({ ...base, pageKey: 'complaint' }), true)
  assert.equal(isFirstPageToday({ ...base, pageKey: 'waste' }), false, 'เปิดหน้านี้ไปแล้วของวัน')
  assert.equal(isFirstPageToday({ ...base, pageKey: 'waste', today: '2026-10-29' }), true, 'ข้ามวันแล้วนับใหม่')
  assert.equal(isFirstPageToday({ ...base, pageKey: 'complaint', claimedDay: '2026-10-28', claimedKeys: ['complaint'] }), false,
    'แท็บนี้จองไว้แล้วระหว่างรอ RPC — กันเปลี่ยนหน้ารัวๆ แล้วนับซ้ำ')
  assert.equal(isFirstPageToday({ ...base, pageKey: 'complaint', storageOk: false }), false)
  assert.equal(isFirstPageToday({ ...base, pageKey: 'complaint', storedKeys: undefined, storedDay: null }), true)

  assert.deepEqual(addSeenPageKey('2026-10-28', ['home'], '2026-10-28', 'waste'), ['home', 'waste'])
  assert.deepEqual(addSeenPageKey('2026-10-28', ['home'], '2026-10-28', 'home'), ['home'], 'ไม่เติมซ้ำ')
  assert.deepEqual(addSeenPageKey('2026-10-27', ['home', 'waste'], '2026-10-28', 'news'), ['news'], 'ข้ามวันเริ่มรายการใหม่')
  const many = Array.from({ length: 100 }, (_, i) => `k${i}`)
  assert.equal(addSeenPageKey('d', many, 'd', 'x').length, 80, 'ค่าใน localStorage ต้องไม่โตไม่สิ้นสุด')
})

test('อันดับเมนู: รวมชื่อที่ไม่รู้จักเป็น other · ครบทุกเมนูรวมที่ 0 ครั้ง · เมนูนำทางแยกจากแท่ง · เรียงมากไปน้อย · สัดส่วนรวม 1', () => {
  const rows = [
    { page_key: 'home', opens: '500', visitors: '120' },
    { page_key: 'complaint', opens: '90', visitors: '40' },
    { page_key: 'waste', opens: '120', visitors: '60' },
    { page_key: 'junk-from-direct-call', opens: '3', visitors: '3' },
    { page_key: 'other', opens: '7', visitors: '2' },
    { page_key: 'more', opens: '80', visitors: '30' },
  ]
  const ranking = pageRanking(rows)
  assert.equal(ranking.total, 800)
  assert.deepEqual(ranking.rows.map(r => r.key), ['home', 'waste', 'complaint', 'more', 'other'])
  assert.equal(ranking.rows.find(r => r.key === 'other').opens, 10, 'ชื่อมั่วต้องรวมเข้า other')
  assert.equal(ranking.rows.find(r => r.key === 'other').visitors, 5)
  assert.ok(Math.abs(ranking.rows.reduce((sum, r) => sum + r.share, 0) - 1) < 1e-9)

  // เมนูในแถบข้าง (ไม่นับหน้านำทาง) ต้องมาครบทุกเมนู — รวมที่ไม่มีใครเปิดเลยซึ่งอยู่ท้ายสุดเป็น 0
  const menuCount = MENU_PAGE_KEYS.filter(k => PAGE_CATALOG.find(p => p.key === k).kind !== 'transit').length
  assert.equal(ranking.menus.length, menuCount)
  assert.deepEqual(ranking.menus.slice(0, 2).map(r => r.key), ['waste', 'complaint'])
  assert.ok(ranking.menus.slice(2).every(r => r.opens === 0 && r.visitors === 0 && r.share === 0))
  assert.ok(ranking.menus.every(r => r.kind !== 'transit' && r.key !== OTHER_PAGE.key), 'หน้านำทางและ other ห้ามปนในแท่งเมนู')
  // เมนูนำทางแยกไว้ครบ 3 ตัว (หน้าแรก เมนูทั้งหมด รายงานทั้งหมด) เรียงตามยอด
  assert.deepEqual(ranking.nav.map(r => r.key), ['home', 'more', 'reports'])
  assert.deepEqual(ranking.nav.map(r => r.opens), [500, 80, 0])
  // หน้าที่ไม่ใช่เมนูแต่มีข้อมูล (เช่น 'other') อยู่ในตารางเต็ม ไม่อยู่ในแท่งเมนู
  assert.ok(ranking.rows.some(r => r.key === 'other'))

  // ไม่มีข้อมูล = ไม่ error ไม่หารศูนย์ และยังเห็นทุกเมนูเป็น 0
  for (const empty of [pageRanking([]), pageRanking(null)]) {
    assert.equal(empty.total, 0)
    assert.deepEqual(empty.rows, [])
    assert.equal(empty.menus.length, menuCount)
    assert.ok(empty.menus.every(r => r.opens === 0 && r.share === 0))
  }
})

test('เมนูแถบข้าง: MENU_PAGE_KEYS และชื่อตรงกับ CitizenSidebar.jsx ทุกรายการ (เปลี่ยนเมนูแล้วลืมแก้ที่นี่ รายงานจะแสดงเมนูผิด)', async () => {
  const sidebar = await read('src/components/layout/CitizenSidebar.jsx')
  const items = [...sidebar.matchAll(/\{\s*label:\s*'([^']+)',\s*href:\s*'([^']+)'/g)].map(m => ({ label: m[1], href: m[2] }))
  assert.ok(items.length >= 15, 'อ่านรายการเมนูจาก CitizenSidebar.jsx ไม่ได้')
  const byPath = new Map(PAGE_CATALOG.map(p => [p.path, p]))
  for (const item of items) {
    const page = byPath.get(item.href)
    assert.ok(page, `${item.href} (เมนู "${item.label}") ยังไม่มีใน PAGE_CATALOG`)
    assert.equal(page.label, item.label, `ชื่อเมนู ${item.href} ในรายงานต้องตรงกับแถบข้าง`)
  }
  assert.deepEqual(
    [...MENU_PAGE_KEYS].sort(),
    items.map(item => byPath.get(item.href).key).sort(),
    'MENU_PAGE_KEYS ต้องเป็นชุดเดียวกับเมนูในแถบข้างพอดี',
  )
})

test('migration สถิติรายหน้า: คงฟังก์ชันรุ่นเดิมไว้ ไม่ใส่ DEFAULT กันเรียกกำกวม ปิดสิทธิ์ตาราง และพารามิเตอร์ตรงกับที่หน้าเว็บส่ง', async () => {
  const table = await read('supabase/migrations/20261028100000_site_page_daily_table.sql')
  const sql = await read('supabase/migrations/20261028100100_site_page_daily_rpc.sql')
  const code = text => text.replace(/--.*$/gm, '')

  // รูปแบบชื่อหน้าใน CHECK ของตาราง และเงื่อนไขในฟังก์ชัน ต้องตรงกับที่ฝั่งเว็บใช้
  assert.ok(code(table).includes(`page_key ~ '${SERVER_PAGE_KEY.source}'`), 'CHECK ของตารางไม่ตรงรูปแบบฝั่งเว็บ')
  assert.ok(code(sql).includes(`_page_key ~ '${SERVER_PAGE_KEY.source}'`), 'เงื่อนไขในฟังก์ชันไม่ตรงรูปแบบฝั่งเว็บ')

  // รุ่น 2 พารามิเตอร์ (แอปเวอร์ชันเก่า) ต้องยังมี และรุ่น 4 พารามิเตอร์ต้องไม่มี DEFAULT
  assert.match(code(sql), /CREATE OR REPLACE FUNCTION public\.record_site_open\(_municipality_id uuid, _first_today boolean\)/)
  const four = /CREATE OR REPLACE FUNCTION public\.record_site_open\(([^)]*)\)/.exec(
    code(sql).replace(/\(_municipality_id uuid, _first_today boolean\)/, ''))?.[1] ?? ''
  assert.doesNotMatch(four, /DEFAULT/i, 'DEFAULT + overload ทำให้ PostgREST เรียกกำกวมแล้วพังทั้งสองรุ่น')
  const migrationParams = [...four.matchAll(/(_[a-z_]+)\s+(?:uuid|boolean|text)/g)].map(m => m[1])
  assert.deepEqual(migrationParams, ['_municipality_id', '_first_today', '_page_key', '_first_page_today'])

  // หน้าเว็บส่งพารามิเตอร์ชื่อตรงกับรุ่น 4 พารามิเตอร์ (ชื่อผิด = PostgREST ตอบ 404 แล้วการนับหายทั้งหมด)
  const counter = await read('src/lib/siteOpenCounter.js')
  const sent = [...(/rpc\('record_site_open', \{([^}]*)\}/.exec(counter)?.[1] ?? '').matchAll(/(_[a-z_]+):/g)].map(m => m[1])
  assert.deepEqual(sent, migrationParams)
  assert.match(counter, /_page_key: pageKey/, 'ต้องส่งชื่อกลุ่มหน้า ไม่ส่ง pathname')
  assert.doesNotMatch(counter, /_page_key:\s*pathname/)

  // ตารางไม่มีใครแตะตรงได้ (RLS ไม่กัน TRUNCATE จึงต้อง REVOKE ด้วย) + ฟังก์ชัน SECURITY DEFINER ตั้ง search_path
  assert.match(code(sql), /REVOKE ALL ON public\.site_page_daily FROM anon, authenticated, PUBLIC;/)
  assert.match(code(sql), /ALTER TABLE public\.site_page_daily ENABLE ROW LEVEL SECURITY;/)
  assert.doesNotMatch(code(sql), /CREATE POLICY/)
  for (const fn of ['record_site_open\\(uuid, boolean, text, boolean\\)', 'record_site_open\\(uuid, boolean\\)', 'get_site_page_ranking\\(uuid, date, date\\)']) {
    assert.match(code(sql), new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM PUBLIC, anon, authenticated;`), `${fn} ต้อง REVOKE ก่อน`)
    assert.match(code(sql), new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn} TO anon, authenticated;`), `${fn} ต้อง GRANT ให้ anon`)
  }
  assert.equal((code(sql).match(/SECURITY DEFINER/g) ?? []).length, (code(sql).match(/SET search_path = public/g) ?? []).length,
    'ทุกฟังก์ชัน SECURITY DEFINER ต้องตั้ง search_path')
  // อ่านอันดับได้ไม่เกิน 200 แถว ต่ำกว่าเพดาน 1,000 แถวของ PostgREST
  assert.match(code(sql), /LIMIT 200/)
})
