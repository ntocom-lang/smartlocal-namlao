// ตัวนับการเข้าชมเว็บไซต์ (ท้ายเว็บ + /reports/visitors) — ตรวจ 3 ชั้น
//   1) กติกาฝั่งหน้าเว็บ src/lib/siteOpenStats.js: ตัดวันเวลาไทย · ตัดสิ่งที่ไม่ใช่คน · เครื่องไม่ซ้ำต่อวัน
//   2) รูปข้อมูลกราฟรายเดือน/รายปีงบ (เดือนที่ไม่มีข้อมูลต้องเป็น 0 ไม่ใช่หายไป)
//   3) ชื่อ RPC ฝั่งหน้าเว็บตรงกับ migration + จุดเรียกใน AppShell + ป้าย "ครั้ง" ไม่กลายเป็น "คน"
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bangkokDay,
  fiscalMonthSeries,
  fiscalYearSeries,
  isCountableEnvironment,
  isFirstTodayVisitor,
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
  const sql = await read('supabase/migrations/20260930100100_site_open_daily_rpc.sql')
  const client = [
    await read('src/lib/siteOpenCounter.js'),
    await read('src/pages/VisitorStats.jsx'),
  ].join('\n')
  const called = [...client.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1])
  assert.deepEqual([...new Set(called)].sort(),
    ['get_site_open_daily', 'get_site_open_monthly', 'get_site_open_summary', 'record_site_open'])
  for (const fn of called) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `${fn} ต้องมีใน migration`)
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO anon, authenticated;`), `${fn} ต้อง grant ให้ anon`)
  }
  // ชื่อ RPC อยู่ใน URL — คำพวกนี้ตัวบล็อกโฆษณาดักบ่อย โดนบล็อก = นับขาดเงียบๆ
  for (const fn of called) assert.doesNotMatch(fn, /track|visit|analytic|pageview|beacon/, fn)
})

test('AppShell นับใหม่ทุกครั้งที่เปลี่ยนหน้า และป้ายท้ายเว็บเป็น "ครั้ง" ไม่ใช่ "คน"', async () => {
  const app = await read('src/App.jsx')
  assert.match(app, /useEffect\(\(\) => scheduleSiteOpen\(tenantId\), \[tenantId, location\.pathname\]\)/,
    'ถ้าถอด location.pathname ออกจาก deps จะนับแค่ตอนโหลดหน้าแรก ยอดหายเงียบๆ')
  // ตัดคอมเมนต์ออกก่อน — คอมเมนต์ในไฟล์นั้นอธิบายไว้ว่าห้ามใช้คำว่า "ผู้เข้าชม … คน"
  const counter = (await read('src/components/layout/SiteVisitCounter.jsx'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '')
  assert.match(counter, /การเข้าชมเว็บไซต์ \(ครั้ง\)/)
  assert.doesNotMatch(counter, /ผู้เข้าชม|คน</, 'ยอดนี้นับซ้ำคนเดิมได้ ห้ามเรียกเป็นจำนวนคน')
})
