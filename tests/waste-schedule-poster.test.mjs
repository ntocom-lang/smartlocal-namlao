// ใบติดบอร์ด "ตารางวันเก็บขยะ" — ตรวจเนื้อหา + ตรวจว่าเคสหนักจบในกระดาษ A4 แผ่นเดียว
// รันด้วย: npm run test:waste-schedule
//
// ทำไมต้องวัดจบ 1 แผ่น: ใบนี้ติดบอร์ดหมู่บ้าน ถ้าล้นไปหน้า 2 ส่วน QR (ท้ายใบ) จะหลุดไปอยู่อีกแผ่น
// ซึ่งเป็นส่วนเดียวที่พาประชาชนไปดูการงด/เลื่อนวันที่อัปเดตเอง
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { buildWasteSchedulePosterHtml } from '../src/lib/wasteSchedulePosterPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลสาธิต' }
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII='

const general = (moo, weekdays, extra = {}) => ({
  waste_type: 'general', moo_nos: moo, rule: 'weekly', interval_weeks: 1, weekdays, nth: null,
  time_from: '07:00', time_to: '10:00', holiday_policy: 'next_working_day', starts_on: '2026-01-01', ...extra,
})

// ── เนื้อหา ──
{
  const html = buildWasteSchedulePosterHtml({
    tenant: TENANT,
    schedules: [
      general([1, 2], [1, 4]),
      { ...general([], [3]), waste_type: 'hazardous', rule: 'monthly', nth: 2, holiday_policy: 'skip', note: '<script>x</script>' },
    ],
    pageUrl: 'https://demo.rk-networks.com/waste',
    qrDataUrl: QR,
    today: '2026-09-14',
  })
  assert.match(html, /ทุกวันจันทร์ และพฤหัสบดี/)
  assert.match(html, /วันพุธที่ 2 ของทุกเดือน/)
  assert.match(html, /หมู่ 1, 2/)
  // นโยบายวันหยุดของแต่ละประเภทเหมือนกันทุกรอบ → พิมพ์ครั้งเดียวใต้หัวข้อ
  assert.match(html, /ตรงวันหยุดราชการ เลื่อนไปวันทำการถัดไป/)
  assert.match(html, /ตรงวันหยุดราชการ งดเก็บ/)
  assert.match(html, /อะไรคือขยะอันตราย/)
  assert.match(html, /demo\.rk-networks\.com\/waste/)
  assert.match(html, /ผ่านระบบ E-Service องค์การบริหารส่วนตำบลสาธิต/)
  // หมายเหตุมาจากเจ้าหน้าที่ ต้องถูก escape
  assert.ok(!html.includes('<script>x</script>'))
  assert.match(html, /&lt;script&gt;/)
  // ใบนี้ห้ามพิมพ์ "ประกาศ" เป็นหัวเรื่อง — ไม่ใช่ประกาศทางการตามระเบียบงานสารบรรณ
  assert.ok(!/<h1>[^<]*ประกาศ/.test(html))
  // ฟอนต์มาตรฐานจาก govDocStyle
  assert.match(html, /THSarabunPSK/)
  assert.match(html, /font-size-adjust: 0\.45/)
}

// ไม่มีขยะอันตราย → ไม่พิมพ์กล่องคำแนะนำ
{
  const html = buildWasteSchedulePosterHtml({ tenant: TENANT, schedules: [general([], [2])], pageUrl: '' })
  assert.ok(!html.includes('อะไรคือขยะอันตราย'))
  assert.ok(!html.includes('class="qr"'))
}

// ── เลย์เอาต์: เคสหนัก 7 รอบทั่วไป (หมู่ละวัน ชื่อบ้านยาว) + 2 รอบอันตราย ต้องจบ 1 แผ่น ──
{
  // นโยบายวันหยุดคนละแบบในประเภทเดียวกัน = เคสที่ต้องพิมพ์นโยบายซ้ำทุกแถว (สูงสุด)
  const schedules = [
    general([1, 2], [1], { note: 'นำถุงขยะวางหน้าบ้านก่อนเวลา 07.00 น. และมัดปากถุงให้แน่น' }),
    general([3, 4], [2]),
    general([5, 6], [3]),
    general([7, 8], [4]),
    general([9, 10], [5]),
    general([11, 12], [6], { interval_weeks: 2 }),
    general([13, 14], [1, 4], { holiday_policy: 'collect' }),
    { ...general([1, 2, 3, 4, 5, 6, 7], [3]), waste_type: 'hazardous', rule: 'monthly', nth: 2, holiday_policy: 'skip' },
    { ...general([8, 9, 10, 11, 12, 13, 14], [5]), waste_type: 'hazardous', rule: 'monthly', nth: -1, holiday_policy: 'skip' },
  ]
  const html = buildWasteSchedulePosterHtml({
    tenant: TENANT, schedules, pageUrl: 'https://demo.rk-networks.com/waste', qrDataUrl: QR, today: '2026-09-14',
  })

  // ใช้ Chrome ที่ติดตั้งในเครื่อง แบบเดียวกับเทสต์เลย์เอาต์ใบอื่น — ไม่ต้องดาวน์โหลดเบราว์เซอร์ของ playwright
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    assert.equal(pages, 1, `ใบติดบอร์ดล้นเป็น ${pages} หน้า`)
  } finally {
    await browser.close()
  }
}

console.log('waste-schedule-poster: ผ่านทั้งหมด')
