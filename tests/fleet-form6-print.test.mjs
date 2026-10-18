// แบบ 6 รายละเอียดการซ่อมบำรุง (ระเบียบ มท. ยานพาหนะ อปท. พ.ศ. ๒๕๖๙ ข้อ ๒๑)
// ตรวจเนื้อหา (ไม่ต้องเปิดเบราว์เซอร์) + เลย์เอาต์ตอนพิมพ์จริง (เปิด Chrome วัดจาก DOM)
// รันด้วย: npm run test:fleet:form6 — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import {
  buildFleetForm6Html, FORM6_ROWS_PER_PAGE, form6DateText, form6ItemText, form6NoteText,
  form6Total, paginateForm6, splitBahtSatang,
} from '../src/lib/fleetForm6Print.js'

// ── เงินแยกบาท/สตางค์ ต้องคิดเป็นสตางค์ก่อน (1999.95 * 100 ปัดลงตรงๆ ได้ 94) ─────
assert.deepEqual(splitBahtSatang(1999.95), { baht: '1,999', satang: '95' })
assert.deepEqual(splitBahtSatang(2000), { baht: '2,000', satang: '00' })
assert.deepEqual(splitBahtSatang('350.5'), { baht: '350', satang: '50' })
assert.equal(splitBahtSatang(null), null)
assert.equal(splitBahtSatang(''), null)
assert.equal(form6Total([{ cost: 0.1 }, { cost: 0.2 }, { cost: null }]), 0.3)

// ── วันที่ date-only ห้ามเลื่อนวันตามเขตเวลา ────────────────────────────────────
assert.equal(form6DateText('2026-09-01'), '1/9/69')
assert.equal(form6DateText(''), '')

// ── ข้อความในช่อง ───────────────────────────────────────────────────────────────
assert.equal(form6ItemText({ description: ' เปลี่ยนยาง 4 เส้น ', maintenance_type: 'tire' }), 'เปลี่ยนยาง 4 เส้น')
assert.equal(form6ItemText({ description: '', maintenance_type: 'oil_change' }), 'เปลี่ยนถ่ายน้ำมัน')
// แบบท้ายระเบียบไม่มีช่องวันที่ซ่อม → วันที่ซ่อมอยู่ในหมายเหตุ
assert.equal(form6NoteText({ service_date: '2026-09-03' }), 'ซ่อม 3/9/69')

// ── แบ่งหน้า: เรียงตามวันซ่อม เลขลำดับต่อข้ามหน้า แถวรวมอยู่แถวสุดท้ายของหน้าสุดท้าย ──
const many = Array.from({ length: FORM6_ROWS_PER_PAGE + 2 }, (_, i) => ({
  id: String(i), service_date: `2026-09-${String(28 - i).padStart(2, '0')}`, cost: 100, description: `รายการ ${i}`,
}))
const pages = paginateForm6(many)
assert.equal(pages.length, 2)
assert.equal(pages[0][0].record.service_date, `2026-09-${String(28 - (many.length - 1)).padStart(2, '0')}`,
  'ต้องเรียงจากวันซ่อมเก่าไปใหม่')
assert.equal(pages[1][0].no, FORM6_ROWS_PER_PAGE + 1, 'เลขลำดับต้องนับต่อข้ามหน้า')
assert.ok(pages[1][FORM6_ROWS_PER_PAGE - 1].total)
// หน้าเต็มพอดี = แถวรวมต้องไปเปิดหน้าใหม่ ห้ามทับรายการ
const full = paginateForm6(many.slice(0, FORM6_ROWS_PER_PAGE))
assert.equal(full.length, 2)
assert.ok(full[0].every(row => row.record))

// ── HTML: หัวตารางตามแบบท้ายระเบียบ + ไม่เดาวันตรวจรับ + escape ────────────────────
const html = buildFleetForm6Html({
  vehicle: { name: 'รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน', license_plate: 'กธ 3393 แพร่' },
  records: [{ id: 'a', service_date: '2026-09-03', description: '<b>เปลี่ยนยาง</b>', cost: 1999.95,
    vendor: 'อู่ช่างแดง', odometer: 55367, maintenance_type: 'tire' }],
  periodLabel: 'ประจำเดือน กันยายน พ.ศ. 2569',
  orgName: 'เทศบาลตำบลสาธิต',
})
for (const text of ['แบบ 6', 'รายละเอียดการซ่อมบำรุง', 'หมายเลขทะเบียน', 'รายการซ่อม', 'จำนวนเงิน',
  'สถานที่ซ่อม', 'ตรวจรับ', 'หมายเหตุ', 'กธ 3393 แพร่', '55,367', '1,999', 'ซ่อม 3/9/69']) {
  assert.ok(html.includes(text), `แบบ 6 ต้องมี "${text}"`)
}
assert.ok(html.includes('&lt;b&gt;เปลี่ยนยาง&lt;/b&gt;') && !html.includes('<b>เปลี่ยนยาง'), 'ข้อความจากผู้ใช้ต้อง escape')
// ตรวจเฉพาะใน <thead> — คำเดียวกันโผล่ในคอมเมนต์ CSS ได้
const thead = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
const headerOrder = ['ลำดับ', 'เลขระยะทาง', 'รายการซ่อม', 'จำนวนเงิน', 'สถานที่ซ่อม', 'ตรวจรับ', 'หมายเหตุ']
  .map(text => thead.indexOf(text))
assert.ok(headerOrder.every(index => index >= 0), 'หัวตารางไม่ครบตามแบบท้ายระเบียบ')
assert.deepEqual([...headerOrder].sort((a, b) => a - b), headerOrder, 'ลำดับคอลัมน์ต้องตรงแบบท้ายระเบียบ')

// ── เลย์เอาต์ตอนพิมพ์จริง ─────────────────────────────────────────────────────────
// กรณีหนักสุด: รายการซ่อมยาวสุดในข้อมูลจริง (~68 ตัวอักษร) ทุกแถว เต็มหน้า
// ทุกแผ่นต้องจบเหนือขอบล่าง (297 − 9 มม.) และหัวตารางต้องไม่ล้นเส้น
const MM = 96 / 25.4
const LONG = 'เปลี่ยนผ้าเบรกหน้า-หลัง เปลี่ยนน้ำมันเบรก และตรวจเช็คระบบช่วงล่างทั้งคัน ตามระยะ'
const worst = Array.from({ length: FORM6_ROWS_PER_PAGE }, (_, i) => ({
  id: String(i), service_date: '2026-09-01', description: LONG, cost: 12345.5,
  vendor: 'บริษัท โตโยต้าแพร่', odometer: 155000 + i, maintenance_type: 'repair',
}))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: Math.round(210 * MM), height: Math.round(297 * MM) } })
  await page.setContent(buildFleetForm6Html({
    vehicle: { name: 'รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน', license_plate: 'กธ 3393 แพร่' },
    records: worst, periodLabel: 'ประจำเดือน กันยายน พ.ศ. 2569', orgName: 'เทศบาลตำบลสาธิต',
  }), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  const measured = await page.evaluate(() => {
    const mm = 96 / 25.4
    return {
      bottoms: [...document.querySelectorAll('.sheet')].map(sheet => {
        const top = sheet.getBoundingClientRect().top
        return (sheet.querySelector('.eservice-origin').getBoundingClientRect().bottom - top) / mm
      }),
      overflowingHeaders: [...document.querySelectorAll('th')]
        .filter(th => th.scrollWidth > th.clientWidth + 1)
        .map(th => th.textContent.trim()),
    }
  })
  for (const bottom of measured.bottoms) {
    assert.ok(bottom <= 288, `แบบ 6 ล้นพื้นที่พิมพ์: ${bottom.toFixed(1)} มม. > 288 มม.`)
  }
  assert.deepEqual(measured.overflowingHeaders, [], 'หัวตารางล้นเส้นตาราง')
  console.log(`fleet form 6 print assertions passed (${FORM6_ROWS_PER_PAGE} แถวยาวสุด: ${measured.bottoms.map(b => b.toFixed(1)).join(', ')} มม. / 288)`)
} finally {
  await browser.close()
}
