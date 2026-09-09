// ใบยืมพัสดุ/ครุภัณฑ์ (บย.) — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// คู่กับ asset-borrow-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริง: จบใน 1 หน้าไหม ล้นขอบกระดาษไหม
// ตารางแตกไหม ช่องลงนามหลุดหน้าไหม
//
// ทำไมต้องมี: ต้นฉบับอัดเนื้อหาเต็มหน้าอยู่แล้ว (ย่อหน้า 7 บรรทัด + ตาราง 7 แถว +
// ช่องลงนาม 7 จุด) ชื่อไทยยาวๆ กับวัตถุประสงค์ยาวๆ ดันใบตกหน้า 2 ได้จริง
// และ "เอกสารราชการ 1 ใบ = 1 แผ่น" เป็นสิ่งที่เจ้าหน้าที่คาดหวัง
//
// เทสนี้ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล — เรนเดอร์ HTML ตรงๆ แล้ววัดจาก DOM/PDF จริง
// รันด้วย: npm run test:asset-borrow

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildAssetBorrowHtml } from '../src/lib/assetBorrowPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง — ชื่อไทยเต็มยศ ตำแหน่งยาว ที่อยู่เต็ม และวัตถุประสงค์
// ที่ผู้ยืมพิมพ์เองจนเกือบเต็มเพดาน 500 ตัวอักษรของฐานข้อมูล
const LONG_FORM = {
  applicant: {
    title: 'นางสาว', first: 'ประกายมาศ', last: 'ศรีวิชัยเลิศสกุล',
    position: 'ผู้ช่วยเจ้าพนักงานธุรการ ฝ่ายอำนวยการ',
    addr_no: '199/25', addr_moo: '12',
    addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
  },
}

const LONG_PURPOSE = 'ใช้ในโครงการจัดงานประเพณีลอยกระทงประจำปีของหมู่บ้าน '
  + 'ณ บริเวณลานอเนกประสงค์ริมแม่น้ำยม หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่'

/** เนื้อหาแบบที่เจอบ่อยที่สุด — วัตถุประสงค์สั้นๆ หนึ่งประโยค ตำแหน่งผู้ยืมสั้น */
function typicalHeader() {
  return {
    borrower_position: 'ผู้ใหญ่บ้าน หมู่ที่ 12',
    purpose: 'ใช้ในงานประเพณีลอยกระทงประจำปีของหมู่บ้าน',
    borrow_start_date: '2026-11-14',
    return_due_date: '2026-11-17',
    form_no: '128/2569',
  }
}

function longHeader(overrides = {}) {
  return {
    borrower_position: LONG_FORM.applicant.position,
    purpose: LONG_PURPOSE,
    borrow_start_date: '2026-11-14',
    return_due_date: '2026-11-17',
    form_no: '128/2569',
    ...overrides,
  }
}

/**
 * รายการแบบที่เจอจริงในทะเบียนพัสดุ อปท. — ชื่อของอยู่ในบรรทัดเดียว หมายเหตุเว้นว่างไว้
 * ให้เขียนมือ (ช่องหมายเหตุกว้างแค่ 11% ของหน้า ตามแบบพิมพ์ต้นฉบับ)
 */
function items(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    asset_code_snapshot: `ทค.-๗๐๑-๖๕-๐๐${index + 1}`,
    asset_name_snapshot: 'เต็นท์ผ้าใบ 4x8 เมตร พร้อมโครงเหล็ก',
    unit_snapshot: 'หลัง',
    requested_qty: 12, approved_qty: 12, issued_qty: 0,
    returned_qty: 0, damaged_qty: 0, lost_qty: 0,
    item_note: '',
  }))
}

/** เคสหนักสุด: ชื่อของยาวจนตัด 2 บรรทัด และมีหมายเหตุทุกแถว */
function longItems(count) {
  return items(count).map(item => ({
    ...item,
    asset_name_snapshot: 'เต็นท์ผ้าใบทรงโค้ง ขนาด 4x8 เมตร พร้อมโครงเหล็กชุบกัลวาไนซ์',
    item_note: 'ผู้ยืมมารับเอง',
  }))
}

async function render(browser, options) {
  // ⚠️ viewport ต้องเท่าความกว้างพื้นที่พิมพ์จริง (160mm = 604.7px ที่ 96dpi) ไม่งั้นการวัด
  // จาก DOM จะได้ค่าที่ข้อความตัดบรรทัดคนละแบบกับตอนพิมพ์ — เคยวัดที่ 1280px แล้วได้
  // เนื้อหาสูง 265mm ("ผ่าน") ทั้งที่พิมพ์จริงสูง 322mm และตกไปหน้า 2
  const page = await browser.newPage({ viewport: { width: 605, height: 1044 } })
  const html = buildAssetBorrowHtml({
    header: longHeader(), form: LONG_FORM, tenant: TENANT,
    departmentName: 'สำนักปลัด',
    clerk: { name: 'นางสมหญิง รักษ์ราชการดี', title: 'ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' },
    mayor: { name: 'นายสมศักดิ์ ตั้งใจพัฒนา', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
    ...options,
  })
  await page.setContent(html, { waitUntil: 'load' })
  // ต้องรอฟอนต์โหลดเสร็จก่อนวัด ไม่งั้นวัดความสูงด้วยฟอนต์สำรองแล้วได้ผลผิด
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

// ⚠️ เลิกนับหน้าจาก PDF แล้ว — regex /Type /Page อ่านไม่เจอเมื่อ Chromium บีบอัด object stream
// จึงคืน 1 หน้าให้กับเอกสารที่ยาว 316mm (เกินพื้นที่ 276mm ไปเกือบครึ่งหน้า) = ผลบวกลวง
// วัดความสูงเนื้อหาจาก DOM แทน ซึ่งตรวจสอบซ้ำได้และบอกได้ด้วยว่าเกินไปกี่มิลลิเมตร
//
// พื้นที่พิมพ์ A4 แนวตั้ง = 297 - ขอบบน 12 - ขอบล่าง 9 = 276mm
const PRINT_HEIGHT_MM = 276
// เผื่อ 11mm ให้เครื่องที่ไม่มี THSarabunPSK แล้วตกไปใช้ Sarabun ซึ่ง metric ไม่เท่ากันเป๊ะ
const ONE_PAGE_BUDGET_MM = 265

function contentHeightMm(page) {
  return page.evaluate(() =>
    document.querySelector('.sheet').getBoundingClientRect().height / 3.779527)
}

const checks = [
  {
    name: 'seven-items-one-page',
    reason: '1 กอง / 7 รายการ ที่เนื้อหาปกติ ต้องพิมพ์จบ A4 หน้าเดียวเหมือนแบบพิมพ์ต้นฉบับ',
    async run(browser) {
      const page = await render(browser, { header: typicalHeader(), items: items(7) })
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= ONE_PAGE_BUDGET_MM,
          `เนื้อหาสูง ${mm.toFixed(1)}mm เกินงบ ${ONE_PAGE_BUDGET_MM}mm `
          + `(พื้นที่พิมพ์ ${PRINT_HEIGHT_MM}mm) — ทบทวนความสูงแถวตารางหรือระยะช่องลงนาม`)
      } finally { await page.close() }
    },
  },
  {
    // ⚠️ ข้อนี้ยอมให้ล้นไปหน้า 2 โดยตั้งใจ ไม่ใช่ข้อบกพร่องที่ยังไม่ได้แก้:
    // พื้นที่พิมพ์กว้าง 160mm ใส่รหัสครุภัณฑ์ (38mm) + ชื่อของยาว (72mm) + จำนวน + หมายเหตุ
    // ในบรรทัดเดียวไม่ได้ แถวจึงตัด 2 บรรทัดตามเนื้อหาจริง ซึ่งถูกต้องกว่าการย่อฟอนต์
    // จนเจ้าหน้าที่อ่านไม่ออก แบบพิมพ์ต้นฉบับเองก็ออกแบบมาสำหรับรายการสั้นๆ ที่เขียนด้วยมือ
    name: 'long-content-two-pages-max',
    reason: 'ชื่อของยาวจนตัด 2 บรรทัดทุกแถว + หมายเหตุทุกแถว ต้องยังไม่บานเกิน 2 หน้า',
    async run(browser) {
      const page = await render(browser, { items: longItems(7) })
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= PRINT_HEIGHT_MM * 2,
          `เนื้อหาสูง ${mm.toFixed(1)}mm เกิน 2 หน้า (${PRINT_HEIGHT_MM * 2}mm)`)
      } finally { await page.close() }
    },
  },
  {
    name: 'no-horizontal-overflow',
    reason: 'พื้นที่พิมพ์กว้าง 16 ซม. ตารางหรือช่องลงนามล้นขอบขวาไม่ได้',
    async run(browser) {
      const page = await render(browser, { items: items(7) })
      try {
        const overflow = await page.evaluate(() => {
          const sheet = document.querySelector('.sheet')
          const width = sheet.getBoundingClientRect().width
          return [...sheet.querySelectorAll('table, .two-col, .note-damage')]
            .map(el => el.getBoundingClientRect().width - width)
            .filter(diff => diff > 1)
        })
        assert.deepEqual(overflow, [], `มีบล็อกล้นขอบขวา ${overflow.map(n => n.toFixed(1)).join(', ')}px`)
      } finally { await page.close() }
    },
  },
  {
    name: 'signature-blocks-not-split',
    reason: 'ช่องลงนามถูกหั่นครึ่งคนละหน้าแล้วเซ็นไม่ได้ ต้องกัน break-inside ไว้',
    async run(browser) {
      const page = await render(browser, { items: items(8) })
      try {
        const split = await page.evaluate(() =>
          [...document.querySelectorAll('.sign-block, .two-col')]
            .filter(el => getComputedStyle(el).breakInside !== 'avoid').length)
        assert.equal(split, 0, 'มีบล็อกลงนามที่ไม่ได้กัน break-inside')
      } finally { await page.close() }
    },
  },
  {
    name: 'twenty-items-within-three-pages',
    reason: 'เพดาน 20 รายการของระบบต้องยังพิมพ์อ่านได้ ไม่ย่อฟอนต์ และไม่บานเกิน 3 หน้า',
    async run(browser) {
      const page = await render(browser, { items: items(20) })
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= PRINT_HEIGHT_MM * 3,
          `20 รายการสูง ${mm.toFixed(1)}mm เกิน 3 หน้า (${PRINT_HEIGHT_MM * 3}mm)`)
        // ห้ามย่อฟอนต์จนอ่านไม่ออก — ทุกช่องต้องยังเป็น 14pt ตามมาตรฐาน
        const fontPx = await page.evaluate(() =>
          parseFloat(getComputedStyle(document.querySelector('.sheet')).fontSize))
        assert.ok(fontPx > 17, `ฟอนต์เหลือ ${fontPx}px เล็กกว่า 14pt`)
      } finally { await page.close() }
    },
  },
  {
    name: 'table-header-repeats',
    reason: 'ตารางที่ไหลข้ามหน้าต้องมีหัวตารางซ้ำทุกหน้า ไม่งั้นหน้า 2 อ่านไม่ออกว่าคอลัมน์ไหนคืออะไร',
    async run(browser) {
      const page = await render(browser, { items: items(20) })
      try {
        const display = await page.evaluate(() =>
          getComputedStyle(document.querySelector('thead')).display)
        assert.equal(display, 'table-header-group')
      } finally { await page.close() }
    },
  },
  {
    name: 'damage-note-still-one-extra-page-max',
    reason: 'กล่องหมายเหตุของชำรุด/สูญหายต้องไม่ดันใบ 7 รายการให้เกิน 2 หน้า',
    async run(browser) {
      const damaged = items(7).map((item, index) => (index === 0
        ? {
            ...item,
            issued_qty: 12, returned_qty: 10, damaged_qty: 1, lost_qty: 1,
            settlement_note: 'ผู้ยืมชดใช้เป็นเงิน 3,500 บาท ตามใบเสร็จรับเงินเลขที่ 0012/2569',
          }
        : item))
      const page = await render(browser, { header: typicalHeader(), items: damaged })
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= PRINT_HEIGHT_MM * 2,
          `กล่องหมายเหตุดันใบสูง ${mm.toFixed(1)}mm เกิน 2 หน้า`)
      } finally { await page.close() }
    },
  },
]

// channel: 'chrome' ใช้ Chrome ที่ลงในเครื่องอยู่แล้ว — ไม่ต้องโหลด chromium ของ Playwright
// เพิ่ม (เครื่อง อปท./เครื่องพัฒนาบางเครื่องไม่ได้รัน `npx playwright install`)
const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0
try {
  for (const check of checks) {
    try { await check.run(browser); console.log(`  ✓ ${check.name}`) } catch (error) {
      failed += 1
      console.log(`  ✗ ${check.name} — ${check.reason}\n    ${error.message}`)
    }
  }
} finally {
  await browser.close()
}
console.log(failed === 0 ? `\n✅ ผ่านทั้ง ${checks.length} ข้อ` : `\n❌ ไม่ผ่าน ${failed}/${checks.length} ข้อ`)
process.exit(failed === 0 ? 0 : 1)
