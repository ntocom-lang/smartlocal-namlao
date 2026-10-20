// แบบ 1 / แบบ 2 ทะเบียนยานพาหนะ (ระเบียบ มท. ยานพาหนะ อปท. พ.ศ. ๒๕๖๙ ข้อ ๗)
// ตรวจเนื้อหา (ไม่ต้องเปิดเบราว์เซอร์) + เลย์เอาต์ตอนพิมพ์จริง (เปิด Chrome วัดจาก DOM)
// รันด้วย: npm run test:fleet:register — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  buildFleetRegisterHtml, groupRegisterVehicles, registerDateText, registerDepartmentText,
  registerModelLines, registerNoteLines, registerPriceText,
} from '../src/lib/fleetRegisterPrint.js'

// ── ค่าในช่อง ──────────────────────────────────────────────────────────────────
// date-only ห้ามเลื่อนวันตามเขตเวลา · ปี พ.ศ. เต็ม
assert.equal(registerDateText('2023-05-01'), '1/5/2566')
assert.equal(registerDateText(null), '')
assert.equal(registerPriceText(1234567.8), '1,234,567.80')
assert.equal(registerPriceText(0), '0.00')
assert.equal(registerPriceText(''), '')
assert.deepEqual(registerModelLines({ brand: 'Toyota', model: ' Revo  สีดำเทา', manufacture_year: 2566, engine_cc: 2393 }),
  ['Toyota Revo สีดำเทา', 'ปี 2566', '2,393 ซีซี'])
assert.deepEqual(registerModelLines({ brand: '', model: '', fuel_type: 'electric' }), ['ไฟฟ้า'])
assert.deepEqual(registerModelLines({}), [])
// รถใช้ร่วมทุกกองไม่มีกองในระบบ → พิมพ์ตามข้อมูลจริง (เจ้าของระบบเลือก 2026-10-18)
assert.equal(registerDepartmentText({ is_pool: true, departments: null }), 'ใช้ร่วมทุกกอง')
assert.equal(registerDepartmentText({ is_pool: false, departments: { name: 'กองช่าง' } }), 'กองช่าง')
assert.deepEqual(registerNoteLines({ asset_code: '001-66-003' }), ['ครุภัณฑ์ 001-66-003'])
assert.deepEqual(registerNoteLines({ status: 'retired', disposed_date: null }), ['ปลดประจำการ'])
assert.deepEqual(registerNoteLines({ status: 'retired', disposed_date: '2026-01-01' }), [])

// ── แยกประเภทตามระเบียบ ไม่ใช่ตาม is_pool · เรียงตามวันได้มา คันที่ไม่มีวันได้มาไว้ท้าย ──
const groups = groupRegisterVehicles([
  { id: 'a', name: 'ข', regulation_category: 'central', is_pool: false, acquired_date: null },
  { id: 'b', name: 'ก', regulation_category: 'central', is_pool: true, acquired_date: '2020-01-01' },
  { id: 'c', name: 'รถนายก', regulation_category: 'position', is_pool: true, acquired_date: '2019-01-01' },
  { id: 'd', name: 'ไม่ระบุประเภท', is_pool: true, acquired_date: '2010-01-01' },
])
assert.deepEqual(groups.position.map(v => v.id), ['c'])
assert.deepEqual(groups.central.map(v => v.id), ['d', 'b', 'a'])

// ── HTML: หัวตารางตามแบบท้ายระเบียบ + escape + ทั้งสองแบบ + แถว "ไม่มี" ────────────
const html = buildFleetRegisterHtml({
  vehicles: [{
    id: 'x', name: '<b>รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน</b>', license_plate: 'กธ 3393 แพร่', brand: 'Toyota',
    model: 'Revo', manufacture_year: 2566, engine_cc: 2393, is_pool: true, purchase_price: 1234567.89,
    acquired_date: '2023-05-01', asset_code: '001-66-003', status: 'active', regulation_category: 'central',
  }],
  orgName: 'เทศบาลตำบลสาธิต',
  asOf: '2026-10-18',
})
for (const text of ['แบบ 1', 'ประเภทรถยนต์ประจำตำแหน่ง', 'ทะเบียนรถยนต์ของ', 'ชื่อของรถยนต์', 'ไม่มีรถยนต์ประจำตำแหน่ง',
  'แบบ 2', 'ประเภทยานพาหนะส่วนกลาง', 'ทะเบียนยานพาหนะของ', 'ชื่อของยานพาหนะ', 'เทศบาลตำบลสาธิต',
  'กธ 3393 แพร่', '2,393 ซีซี', '1,234,567.89', '1/5/2566', 'ใช้ร่วมทุกกอง', 'ครุภัณฑ์ <span class="nowrap">001-66-003</span>',
  'ข้อมูล ณ วันที่ 18/10/2569', 'A4 landscape']) {
  assert.ok(html.includes(text), `ทะเบียนต้องมี "${text}"`)
}
assert.ok(html.includes('&lt;b&gt;รถยนต์นั่ง') && !html.includes('<b>รถยนต์นั่ง'), 'ข้อความจากผู้ใช้ต้อง escape')
assert.ok(html.indexOf('แบบ 1') < html.indexOf('แบบ 2'), 'แบบ 1 ต้องมาก่อนแบบ 2')
for (const thead of html.split('<thead>').slice(1).map(part => part.slice(0, part.indexOf('</thead>')))) {
  const order = ['ลำดับที่', 'ชื่อของ', 'แบบ/รุ่นปี/', 'ขนาด (ซีซี)', 'หมายเลข', 'ทะเบียน', 'สังกัด', 'หน่วยงานใด',
    'ราคา', 'วันได้มา', 'วันจำหน่าย', 'หมายเหตุ'].map(text => thead.indexOf(text))
  assert.ok(order.every(index => index >= 0), 'หัวตารางไม่ครบตามแบบท้ายระเบียบ')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ลำดับคอลัมน์ต้องตรงแบบท้ายระเบียบ')
}
// ใบเดียวต้องเลือกพิมพ์แบบเดียวได้
const onlyCentral = buildFleetRegisterHtml({ vehicles: [], forms: ['central'] })
assert.ok(onlyCentral.includes('แบบ 2') && !onlyCentral.includes('แบบ 1<'), 'เลือกพิมพ์เฉพาะแบบ 2 ไม่ได้')

// ── ปุ่มแยกรายแบบ (เจ้าของระบบสั่ง 2569-10-20): แบบ 1 กับแบบ 2 คนละปุ่ม คนละใบ ─────────────
const sheetsOf = html => [...html.matchAll(/<section class="sheet" data-form="([a-z]+)"/g)].map(match => match[1])
assert.deepEqual(sheetsOf(buildFleetRegisterHtml({ vehicles: [], forms: ['position'] })), ['position'],
  'ปุ่มแบบ 1 ต้องได้แผ่นแบบ 1 อย่างเดียว')
assert.deepEqual(sheetsOf(onlyCentral), ['central'], 'ปุ่มแบบ 2 ต้องได้แผ่นแบบ 2 อย่างเดียว')
assert.deepEqual(sheetsOf(buildFleetRegisterHtml({ vehicles: [] })), ['position', 'central'],
  'ไม่ระบุแบบ = ได้ทั้งคู่ตามลำดับ (ใช้ซ้ำที่อื่นได้)')
// แบบ 1 เฉพาะรถประจำตำแหน่ง · แบบ 2 เฉพาะส่วนกลาง — ปุ่มแยกแล้วรถต้องไม่ข้ามฝั่ง
const mixed = [
  { id: 'p', name: 'รถนายก', license_plate: 'นย 1', regulation_category: 'position', asset_kind: 'vehicle' },
  { id: 'c', name: 'รถส่วนกลาง', license_plate: 'กก 2', regulation_category: 'central', asset_kind: 'vehicle' },
]
const form1Only = buildFleetRegisterHtml({ vehicles: mixed, forms: ['position'] })
assert.ok(form1Only.includes('รถนายก') && !form1Only.includes('รถส่วนกลาง'), 'แบบ 1 ต้องมีเฉพาะรถประจำตำแหน่ง')
const form2Only = buildFleetRegisterHtml({ vehicles: mixed, forms: ['central'] })
assert.ok(form2Only.includes('รถส่วนกลาง') && !form2Only.includes('รถนายก'), 'แบบ 2 ต้องมีเฉพาะรถส่วนกลาง')

// ── หน้าจอต้องส่งข้อมูลครบทุกช่องที่ใบพิมพ์ใช้ ─────────────────────────────────────
const report = readFileSync('src/components/fleet/FleetReport.jsx', 'utf8')
for (const column of ['regulation_category', 'engine_cc', 'purchase_price', 'acquired_date', 'disposed_date',
  'manufacture_year', 'brand', 'model', 'is_pool', 'status', 'departments(name)']) {
  assert.ok(report.includes(column), `FleetReport ต้องดึง ${column} ไปพิมพ์ทะเบียน`)
}
// ปุ่มต้องแยกสองปุ่ม ส่งแบบที่ต้องการเข้า forms จริง และไม่เหลือปุ่มรวม "แบบ 1 / แบบ 2" ให้กดพิมพ์ทั้งคู่
assert.ok(report.includes("printRegister('position')") && report.includes("printRegister('central')"),
  'ต้องมีปุ่มแยกแบบ 1 และแบบ 2')
assert.ok(/buildFleetRegisterHtml\(\{[^}]*forms:\s*\[form\]/s.test(report), 'ปุ่มต้องส่ง forms: [form] ไม่ใช่พิมพ์ทั้งสองแบบ')
assert.equal(report.includes('แบบ 1 / แบบ 2 (ทุกคัน)'), false, 'ปุ่มรวมแบบ 1 / แบบ 2 ต้องถูกแทนที่ด้วยปุ่มแยก')
assert.ok(report.includes('REGISTER_FORMS[form]'), 'ต้องกันค่า form ที่ไม่รู้จัก ไม่ให้พิมพ์ใบเปล่า')
const vehiclesForm = readFileSync('src/components/fleet/FleetVehicles.jsx', 'utf8')
for (const column of ['regulation_category', 'engine_cc', 'purchase_price', 'acquired_date', 'disposed_date', 'manufacture_year']) {
  assert.ok(new RegExp(`value=\\{form\\.${column}\\}`).test(vehiclesForm), `ฟอร์มรถต้องมีช่องกรอก ${column}`)
}

// ── เลย์เอาต์ตอนพิมพ์จริง (A4 แนวนอน 14pt) ───────────────────────────────────────
// ค่ายาวสุดที่เป็นไปได้ต่อช่อง: วันที่ 2 หลักทั้งวัน/เดือน ราคาหลักล้าน ชื่อ/ทะเบียนยาวจากข้อมูลจริง
const MM = 96 / 25.4
const worst = Array.from({ length: 12 }, (_, i) => ({
  id: String(i), name: 'รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน', license_plate: 'กลพ 7870 แพร่', brand: 'Mitsubishi',
  model: 'Triton Double Cab', manufacture_year: 2566, engine_cc: 2442, is_pool: true, purchase_price: 1234567.89,
  acquired_date: '2023-12-30', disposed_date: i % 3 === 0 ? '2026-12-31' : null, asset_code: '001-52-0001',
  status: i % 3 === 0 ? 'retired' : 'active', regulation_category: 'central',
}))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: Math.round(297 * MM), height: Math.round(210 * MM) } })
  await page.setContent(buildFleetRegisterHtml({ vehicles: worst, orgName: 'องค์การบริหารส่วนตำบลน้ำเลา', asOf: '2026-12-31' }),
    { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  const measured = await page.evaluate(() => {
    const mm = 96 / 25.4
    // นับบรรทัดจากกล่องตัวอักษรจริง (Range) ไม่ใช่กล่อง element
    const lineCount = cell => {
      const range = document.createRange()
      range.selectNodeContents(cell)
      const tops = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)))
      return tops.size
    }
    const rows = [...document.querySelectorAll('section[data-form="central"] tbody tr')]
    const col = index => rows.map(row => row.children[index])
    return {
      tableWidth: document.querySelector('section[data-form="central"] table').getBoundingClientRect().width / mm,
      overflowingHeaders: [...document.querySelectorAll('th')]
        .filter(th => th.scrollWidth > th.clientWidth + 1).map(th => th.textContent.trim()),
      headerLines: Math.max(...[...document.querySelectorAll('section[data-form="central"] th')].map(lineCount)),
      dateLines: Math.max(...col(6).concat(col(7)).filter(td => td.textContent.trim()).map(lineCount)),
      priceLines: Math.max(...col(5).map(lineCount)),
      plateLines: Math.max(...col(3).map(lineCount)),
      deptLines: Math.max(...col(4).map(lineCount)),
      // เลขครุภัณฑ์ nowrap แล้วต้องไม่ล้นเส้นขวาของช่องหมายเหตุ
      codeOverflow: col(8).filter(td => [...td.querySelectorAll('.nowrap')]
        .some(span => span.getBoundingClientRect().right > td.getBoundingClientRect().right - 1)).length,
      rowHeight: Math.max(...rows.map(row => row.getBoundingClientRect().height)) / mm,
    }
  })
  assert.ok(measured.tableWidth <= 257.5, `ตารางกว้างเกินพื้นที่พิมพ์: ${measured.tableWidth.toFixed(1)} มม.`)
  assert.deepEqual(measured.overflowingHeaders, [], 'หัวตารางล้นเส้นตาราง')
  assert.ok(measured.headerLines <= 2, `หัวตารางสูงเกิน 2 บรรทัด (${measured.headerLines})`)
  assert.equal(measured.dateLines, 1, 'วันที่ต้องจบบรรทัดเดียว')
  assert.equal(measured.priceLines, 1, 'ราคาหลักล้านต้องจบบรรทัดเดียว')
  assert.equal(measured.plateLines, 1, 'ทะเบียนต้องจบบรรทัดเดียว')
  assert.equal(measured.deptLines, 1, '"ใช้ร่วมทุกกอง" ต้องจบบรรทัดเดียว')
  assert.equal(measured.codeOverflow, 0, 'เลขครุภัณฑ์ล้นช่องหมายเหตุ')
  console.log(`fleet register (แบบ 1/2) assertions passed (ตาราง ${measured.tableWidth.toFixed(1)} มม., แถวสูงสุด ${measured.rowHeight.toFixed(1)} มม.)`)
} finally {
  await browser.close()
}
