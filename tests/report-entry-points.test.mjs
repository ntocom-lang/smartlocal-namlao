// ทางเข้าหน้า "รายงานเรื่องร้องเรียน/สรุปรายเดือน" (/reports/complaints) — เจ้าหน้าที่ใช้แชร์ลงกลุ่มทุกเดือน
// และทางเข้าหน้ารวมรายงาน (/reports) ของประชาชน — ทางเดียวไปสถิติการเข้าชมเว็บไซต์ เพราะกล่องท้ายเว็บเห็นแค่ผู้บริหาร (#562)
//   ชั้นแรก: อ่านซอร์สเทียบกัน (ชื่อเมนูตรงกันทุกที่ · ตัดตามโมดูล · ลำดับการ์ดภาพ · การต่อสาย wrapper ฝั่งเจ้าหน้าที่)
//   ชั้นสอง: เรนเดอร์การ์ดฝั่งเจ้าหน้าที่จริงใน Chrome — ลิงก์ต้องพาไปเดือนล่าสุดที่จบครบตามเวลาไทย
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { bundleEntry } from './lib/infographicBrowser.mjs'
import { MANAGED_MODULE_KEYS, moduleForPath } from '../src/lib/staffModules.js'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const ROUTE = '/reports/complaints'

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const sidebar = await read('src/components/layout/CitizenSidebar.jsx')
const more = await read('src/pages/MorePage.jsx')
const kledkaewMore = await read('src/components/citizen/templates/Kledkaew/More.jsx')
const stats = await read('src/pages/ComplaintStats.jsx')
const hub = await read('src/pages/ReportsHub.jsx')
const staffDashboard = await read('src/pages/StaffDashboard.jsx')
const navData = await read('src/components/citizen/templates/navData.js')
const BOTTOM_NAV_THEMES = ['CivicFriendly', 'CleanMinimal', 'EcoFriendly', 'Kledkaew', 'ServiceHub', 'SmartModern', 'WaveFluid']

// บรรทัดเมนูที่ชี้ไปหน้ารวมรายงาน /reports พอดี (ไม่ใช่หน้าลูก /reports/*)
const HUB = '/reports'
const hubMenuLine = source => source.split('\n').find(text => text.includes(`'${HUB}'`) && text.includes('label:'))

await test('ทางเข้าเดียวของรายงานสาธารณะ: ปุ่ม "รายงาน" เมนูล่างทุกธีม + "รายงาน" ในเมนูข้างจอ PC · เมนูทั้งหมด · Kledkaew', async () => {
  const bottom = hubMenuLine(navData)
  assert.ok(bottom && /label:\s*'รายงาน'/.test(bottom), 'ปุ่ม "รายงาน" ของเมนูล่างต้องพาไป /reports')
  assert.ok(!navData.includes(`'${ROUTE}'`), 'เมนูล่างต้องไม่กลับไปชี้หน้าคำร้องตรงๆ (สถิติการเข้าชมจะไม่มีทางเข้าบนมือถือ)')

  const lines = [sidebar, more, kledkaewMore].map(hubMenuLine)
  assert.ok(lines.every(Boolean), 'ต้องเจอรายการ /reports ครบทั้ง 3 ไฟล์')
  const labels = lines.map(line => /label:\s*'([^']+)'/.exec(line)[1])
  assert.deepEqual([...new Set(labels)], ['รายงาน'], `ชื่อไม่ตรงกัน: ${JSON.stringify(labels)}`)
  // เมนูข้างเทียบแบบ startsWith — เหลือรายการเดียวแล้ว อยู่หน้าลูกก็ต้องติดไฟต่อ
  assert.ok(!lines[0].includes('exact: true'), 'เมนูข้างจอ PC ต้องติดไฟต่อในหน้าลูกของรายงาน')

  // ไฮไลต์ปุ่ม "รายงาน" ต้องติดต่อในหน้าลูก (/reports/visitors, /reports/complaints) ทุกธีม
  for (const theme of BOTTOM_NAV_THEMES) {
    const source = await read(`src/components/citizen/templates/${theme}/BottomNav.jsx`)
    assert.ok(source.includes('location.pathname.startsWith(item.href)'), `${theme}: เมนูล่างต้องเทียบเส้นทางแบบ startsWith`)
  }

  assert.equal(moduleForPath(HUB), 'report')
  assert.equal(moduleForPath('/reports/visitors'), 'report')
})

await test('เมนูไม่กลับไปวางรายงานย่อยข้างหน้ารวม (เมนูข้างจอ PC · เมนูทั้งหมด · Kledkaew) — สารบัญกับบทเดียวกันอยู่ชั้นเดียวกันทำคนงง', () => {
  for (const source of [sidebar, more, kledkaewMore, navData]) {
    assert.ok(!source.includes(`'${ROUTE}'`), `เมนูต้องไม่ชี้ ${ROUTE} ตรงๆ`)
    assert.ok(!source.includes("'/doc-stats'"), 'เมนูต้องไม่ชี้ /doc-stats ตรงๆ')
    assert.ok(!source.includes("'/reports/visitors'"), 'เมนูต้องไม่ชี้ /reports/visitors ตรงๆ')
  }
})

await test('เมนูรายงานฝั่งเจ้าหน้าที่/แอดมินตั้งชื่อตามของข้างใน: "รายงานคำร้อง" ไม่ใช่ "รายงาน" เฉยๆ', async () => {
  const admin = await read('src/pages/AdminDashboard.jsx')
  for (const [name, source] of [['เจ้าหน้าที่', staffDashboard], ['แอดมิน', admin]]) {
    const line = source.split('\n').find(text => /key: 'report',\s*label:/.test(text))
    assert.ok(line, `${name}: ไม่เจอเมนู report`)
    assert.equal(/label:\s*'([^']+)'/.exec(line)[1], 'รายงานคำร้อง', name)
  }
})

await test('หน้า /reports ซ่อนการ์ดของโมดูลที่ อปท. ปิด: ทุกการ์ดผูกกับโมดูลตามเส้นทาง และแสดงผ่านตัวกรอง', () => {
  assert.equal(moduleForPath(ROUTE), 'complaints')
  assert.equal(moduleForPath('/doc-stats'), 'report')
  assert.equal(moduleForPath('/data-center/public'), 'data-center')
  assert.equal(moduleForPath('/reports/visitors'), 'report')
  assert.ok(hub.includes('REPORTS.filter(r => isModuleEnabled(moduleForPath(r.href)))'))
  assert.ok(hub.includes('{reports.map(r => ('), 'ต้องวาดจากรายการที่กรองแล้ว ไม่ใช่ REPORTS ตรงๆ')
})

await test('การ์ดภาพ: ปุ่มดาวน์โหลด/แชร์อยู่เหนือรูป (ภาพสูงจนปุ่มใต้รูปตกนอกจอแรก)', async () => {
  const card = await read('src/components/reports/ComplaintMonthlyInfographic.jsx')
  const downloadAt = card.indexOf('ดาวน์โหลดภาพ (PNG)')
  const shareAt = card.indexOf('แชร์ภาพ')
  const imageAt = card.indexOf('<img')
  assert.ok(downloadAt > 0 && shareAt > 0 && imageAt > 0)
  assert.ok(downloadAt < imageAt && shareAt < imageAt, 'ปุ่มต้องมาก่อน <img>')
})

await test('ถ้อยคำ ITA ไม่ถูกแตะ: หัวหน้าหน้าและชื่อการ์ดในหน้ารวมรายงานยังมีคำว่า e-Service ตามแบบวัด', () => {
  assert.ok(stats.includes('รายงานสถิติข้อมูลการขอรับบริการผ่านช่องทางออนไลน์ (e-Service)'))
  const hubLabel = /label:\s*'([^']*e-Service[^']*ร้องเรียน[^']*)'/.exec(hub)
  assert.ok(hubLabel, 'การ์ดร้องเรียนใน ReportsHub ต้องคงคำว่า e-Service')
})

await test('เมนูข้างจอ PC ตัดตามโมดูล: หน้าคำร้องผูกกับโมดูล complaints ที่ตั้งค่าได้ และเมนูข้างกรองด้วย moduleForPath', () => {
  assert.equal(moduleForPath(ROUTE), 'complaints')
  assert.ok(MANAGED_MODULE_KEYS.includes('complaints'), 'complaints ต้องเป็นโมดูลที่ตั้งค่าได้ ไม่งั้นปิดโมดูลแล้วเมนูไม่หาย')
  assert.ok(sidebar.includes('moduleForPath(item.href)') && sidebar.includes('isModuleEnabled(key)'))
})

await test('โหมดรายเดือน: การ์ดภาพ (ปุ่มดาวน์โหลด/แชร์) อยู่เหนือข้อความสรุป และมีการ์ดเดียว', () => {
  const infographicAt = stats.indexOf('<ComplaintMonthlyInfographic')
  const summaryAt = stats.indexOf('สรุปประจำ{periodMain}')
  assert.ok(infographicAt > 0 && summaryAt > 0)
  assert.ok(infographicAt < summaryAt, 'การ์ดภาพต้องมาก่อนข้อความสรุป')
  assert.equal(stats.split('<ComplaintMonthlyInfographic').length - 1, 1, 'ต้องไม่วาดการ์ดภาพซ้ำ')
})

await test('หน้า "รายงาน" ของเจ้าหน้าที่: การ์ดทางลัดอยู่ทั้งตอนโหลดและตอนแสดงผล และแสดงเฉพาะ อปท. ที่เปิดโมดูลคำร้อง', () => {
  const start = staffDashboard.indexOf('function StaffReportWrapper')
  const end = staffDashboard.indexOf('// ─── Main', start)
  assert.ok(start > 0 && end > start)
  const wrapper = staffDashboard.slice(start, end)
  assert.ok(staffDashboard.includes("import MonthlyComplaintShareCard from '../components/staff/MonthlyComplaintShareCard'"))
  assert.ok(wrapper.includes("isModuleEnabled('complaints') ? <MonthlyComplaintShareCard /> : null"))
  assert.equal(wrapper.split('{shareCard}').length - 1, 2, 'ต้องอยู่ทั้งในสถานะกำลังโหลดและสถานะแสดงรายงาน')
})

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const bundle = await bundleEntry(fileURLToPath(new URL('./lib/entryPointsEntry.js', import.meta.url)), 'EntryBundle')
  // โซนเวลาเครื่องเป็นต่างประเทศ: ถ้าอ่านเดือนจากเวลาเครื่องแทนเวลาไทย เคสข้ามเดือน/ข้ามปีด้านล่างจะพัง
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' })
  const page = await context.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: bundle })
  const render = nowIso => page.evaluate(iso => window.EntryBundle.renderCard(iso), nowIso)
  const hrefOf = html => /href="([^"]+)"/.exec(html)?.[1]

  await test('การ์ดเจ้าหน้าที่พาไปเดือนล่าสุดที่จบครบ พร้อมบอกชื่อเดือน (19 ต.ค. 2569 → กันยายน 2569)', async () => {
    const html = await render('2026-10-19T05:00:00Z')
    assert.equal(hrefOf(html), `${ROUTE}?m=2569-09`)
    assert.ok(html.includes('กันยายน 2569'))
    assert.ok(html.includes('LINE') && html.includes('Facebook'))
  })

  await test('ใช้เวลาไทย ไม่ใช่เวลาเครื่อง: 1 ต.ค. 01:00 เวลาไทย (ยังเป็น 30 ก.ย. ที่ลอสแอนเจลิส) → กันยายน ไม่ใช่สิงหาคม', async () => {
    const html = await render('2026-09-30T18:00:00Z')
    assert.equal(hrefOf(html), `${ROUTE}?m=2569-09`)
  })

  await test('ข้ามปี: 5 ม.ค. 2570 → ธันวาคม 2569', async () => {
    const html = await render('2027-01-05T05:00:00Z')
    assert.equal(hrefOf(html), `${ROUTE}?m=2569-12`)
    assert.ok(html.includes('ธันวาคม 2569'))
  })

  await test('ลิงก์ที่การ์ดสร้างผ่านตัวอ่านพารามิเตอร์ของหน้ารายงาน (ไม่ตกกลับไปโหมดปีงบเงียบๆ)', async () => {
    const parsed = await page.evaluate(() => {
      const html = window.EntryBundle.renderCard('2026-10-19T05:00:00Z')
      const key = /m=([0-9-]+)/.exec(html)[1]
      const period = window.EntryBundle.parseMonthParam(key, new Date('2026-10-19T05:00:00Z'))
      return period && period.key
    })
    assert.equal(parsed, '2569-09')
  })

  await test('การ์ดเป็นลิงก์ล้วน: ไม่มีช่องกรอก ปุ่ม หรือ checkbox (ห้ามเพิ่มงานเจ้าหน้าที่)', async () => {
    const html = await render('2026-10-19T05:00:00Z')
    assert.ok(!/<(input|button|select|textarea)/.test(html))
    assert.equal(html.split('<a ').length - 1, 1)
  })

  await context.close()
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)
