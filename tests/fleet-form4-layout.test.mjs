// แบบ 4 บันทึกการใช้รถ — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// แยกจาก fleet-form4-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์ (เร็วกว่ามาก)
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริงเท่านั้น: ข้อความขาด/ล้นหน้า
//
// ที่มา: ของเดิม (ก่อน 2026-09-06) ใช้สคริปต์ auto-fit ย่อขนาดฟอนต์รายช่องจนถึง 7pt
// แล้วตัด 2 บรรทัดจบด้วย "…" ถ้ายังไม่พอ — ผลคือชื่อ-นามสกุลจริงในข้อมูลจริงถูกตัดหาย
// (เช่น "นาย ชัยวัฒน์ บัว...") เพราะคอลัมน์แคบไปสำหรับชื่อยาว แม้ย่อ font สุดแล้วก็ยังไม่พอ
// แก้โดยเลิกย่อ font รายช่อง ใช้ขนาดเดียวกันทั้งตาราง (10.5pt) ให้ชื่อ-นามสกุลขึ้นบรรทัดใหม่
// แทนได้ไม่จำกัดจำนวนบรรทัด (ต้องแสดงครบเสมอ) ส่วนสถานที่ไป/หมายเหตุที่เป็นข้อความอิสระ
// ยาวไม่จำกัดได้จริง (เคยเจอปลายทางหลายหมู่บ้านคั่นด้วยจุลภาค) ยังกันไว้ที่ 2 บรรทัด+ellipsis
// เพื่อไม่ให้ 1 แถวที่ยาวผิดปกติดันทั้งหน้าล้น — ดู .cell--clamp ใน fleetForm4Print.js
//
// เทสนี้ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล — เรนเดอร์ HTML ตรงๆ แล้ววัดจาก DOM/PDF จริง
// รันด้วย: npm run test:fleet:form4 (รันคู่กับไฟล์ตรวจเนื้อหา)

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import {
  buildFleetForm4Html,
  FORM4_ROWS_PER_PAGE,
} from '../src/lib/fleetForm4Print.js'

const VEHICLE = { name: 'รถกระเช้าไฟฟ้า', license_plate: '81-7417 แพร่' }
const PERIOD = 'ประจำเดือน กันยายน พ.ศ. 2569'

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง: ปลายทางหลายหมู่บ้านคั่นด้วยจุลภาค ชื่อ-สกุลไทยเต็ม
// และหมายเหตุระดับประโยค ถ้าเทสนี้ผ่าน แปลว่าเคสงานจริงไม่มีชื่อ/ข้อความขาดหาย
const LONG_DESTINATION = 'บ้านห้วยทรายขาว,บ้านห้วยกาน,บ้านแม่ยางเปี้ยว,บ้านนาตุ้ม,บ้านปงท่าข้าม'
const LONG_NAME = 'นาย เกียรติศักดิ์ สะปุระเสริฐวงศ์'
const LONG_NOTE = 'ตรวจสอบไฟฟ้าสาธารณะชำรุดหลายจุดในเขตพื้นที่ตำบล'

function makeTrips(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    started_at: '2026-09-01T07:59:00Z',
    returned_at: '2026-09-01T09:30:00Z',
    destination: index % 3 === 0 ? LONG_DESTINATION : 'บ้านห้วยทรายขาว,บ้านห้วยกาน',
    odometer_start: 100554 + index,
    odometer_end: 100566 + index,
    distance_km: 12,
    requester: { full_name: LONG_NAME },
    driver: { full_name: LONG_NAME },
    notes: index % 4 === 0 ? LONG_NOTE : '',
  }))
}

// หน้าต่างต้องกว้างเท่ากระดาษจริง (A4 แนวนอน 297mm) ไม่ใช่ดีฟอลต์ 1280px ของ Playwright
//
// ที่มา: เดิมเทสนี้ใช้ 1280px = 338mm ซึ่งกว้างกว่าพื้นที่พิมพ์จริง 257mm อยู่ 81mm ตารางจึง
// ตัดคำน้อยกว่าของจริงและเตี้ยกว่าของจริง เกณฑ์ที่ตั้งไว้จึงผูกกับการวัดที่ไม่ตรงกับกระดาษ —
// เคสข้อมูลยาวสุดวัดในเทสได้ 167mm "ผ่าน" ทั้งที่บนกระดาษจริงสูง 187.9mm ล้นพื้นที่ 170mm
// อยู่ 17.9mm แล้วถูกตัดหายไปเงียบๆ ไม่มีด่านไหนจับได้เลย
//
// .sheet มี padding เท่าขอบกระดาษ (ดู govPageCss({ hideBrowserHeader })) ตารางจึงได้ความกว้าง
// 297 − 2 − 2 ซม. = 257mm ตรงกับของจริง
const MM_TO_PX = 96 / 25.4
const VIEWPORT = { width: Math.round(297 * MM_TO_PX), height: Math.round(210 * MM_TO_PX) }

// พื้นที่พิมพ์แนวตั้งของ A4 แนวนอน หลังหักขอบบน 3 ซม. ล่าง 1 ซม. — เนื้อหาทุกหน้าต้องอยู่ในนี้
const PRINT_AREA_MM = 170

async function renderForm4(browser, trips) {
  const page = await browser.newPage({ viewport: VIEWPORT })
  const html = buildFleetForm4Html({ vehicle: VEHICLE, trips, periodLabel: PERIOD })
  await page.setContent(html, { waitUntil: 'load' })
  // ต้องรอฟอนต์โหลดเสร็จก่อนวัด ไม่งั้นวัดความกว้าง/ความสูงด้วยฟอนต์สำรองแล้วได้ผลผิด
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

// scrollWidth/scrollHeight > client* = เนื้อหาล้นกรอบแล้วถูก overflow:hidden กินไป
function overflowingCells(page, selector) {
  return page.evaluate(sel => [...document.querySelectorAll(sel)]
    .filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    .map(el => (el.textContent || '').trim())
    .slice(0, 5), selector)
}

// ".sheet" มี max-height + overflow:hidden ตอนพิมพ์ — getBoundingClientRect().height ของมัน
// เพดานอยู่ที่ 170mm เสมอไม่ว่าเนื้อหาจริงจะสูงแค่ไหน ใช้วัดหาการล้นไม่ได้ (จะรายงาน "พอดี"
// ทุกครั้งแม้ตัดเนื้อหาทิ้งไปจริง) ต้องวัดจาก <table> ที่ไม่ถูกครอบความสูงแทน
//
// ⚠️ ต้องเริ่มวัดจาก "ขอบในของกล่อง" (บวก padding-top) ไม่ใช่ขอบนอก — ตั้งแต่ย้ายขอบกระดาษ
// จาก margin ของ @page มาเป็น padding ของ .sheet (เพื่อไม่ให้เบราว์เซอร์เหลือที่วาดหัว/
// ท้ายกระดาษของตัวเอง ดู govPageCss({ hideBrowserHeader })) ขอบนอกกล่องอยู่เหนือเนื้อหา
// ขึ้นไปเท่าขอบบนของกระดาษ วัดจากตรงนั้นจะได้ค่าบวกเกินมาโดยที่เอกสารไม่ได้เปลี่ยนอะไรเลย
// วัดถึง "ท้ายสุดของเนื้อหาในหน้า" ไม่ใช่แค่ท้ายตาราง — ใต้ตารางยังมีบรรทัดกำกับที่มาอีก
// ~7.5mm ซึ่งต้องอยู่ในพื้นที่พิมพ์ด้วย ถ้าวัดแค่ถึงท้ายตารางจะรายงานว่าพอดีทั้งที่บรรทัดนั้น
// ล้นออกไปแล้ว
function sheetContentHeightMm(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sheet')].map(sheet => {
    const contentTop = sheet.getBoundingClientRect().top
      + parseFloat(getComputedStyle(sheet).paddingTop)
    const last = sheet.children[sheet.children.length - 1]
    return (last.getBoundingClientRect().bottom - contentTop) / 3.779527 // px -> mm ที่ 96dpi
  }))
}

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

const checks = [
  {
    name: 'no-name-ever-clipped',
    reason: 'ชื่อ-นามสกุล (ผู้ใช้รถ/พนักงานขับรถ) ต้องแสดงครบเสมอ ห้ามตัด/ย่อจนขาดหาย',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE - 1))
      try {
        // ชื่อไม่ใช้ .cell--clamp เลย (ดู dataRow ใน fleetForm4Print.js) จึงต้องไม่ล้นเด็ดขาด
        const clippedNames = await overflowingCells(page, 'td.left .cell:not(.cell--clamp)')
        assert.deepEqual(clippedNames, [],
          `ชื่อ/ข้อความที่ไม่ควรถูกตัดกลับถูกตัด: ${clippedNames.join(' | ')}`)

        // ช่องตัวเลข/วันที่ยังเป็นบรรทัดเดียวตายตัว ถ้าล้นคือคอลัมน์แคบไป (ไม่ควรเกิดกับข้อมูลจริง)
        const clippedPlain = await overflowingCells(page, 'td:not(.left)')
        assert.deepEqual(clippedPlain, [],
          `ช่องตัวเลข/วันที่ถูกตัด: ${clippedPlain.join(' | ')}`)

        const clippedHead = await overflowingCells(page, 'th')
        assert.deepEqual(clippedHead, [],
          `หัวตารางถูกตัด: ${clippedHead.join(' | ')}`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'single-line-preferred',
    reason: 'ข้อความสั้นยังเป็นบรรทัดเดียวเท่าต้นฉบับกระดาษ ไม่ขึ้นบรรทัดใหม่โดยไม่จำเป็น',
    async run(browser) {
      const trips = makeTrips(3).map(trip => ({
        ...trip, destination: 'บ้านห้วยทรายขาว', notes: '', requester: { full_name: 'นาย ทดสอบ ระบบ' },
        driver: { full_name: 'นาย ทดสอบ ระบบ' },
      }))
      const page = await renderForm4(browser, trips)
      try {
        // Range.getClientRects() ของเนื้อหาข้อความล้วน: 1 บรรทัด = 1 rect, ขึ้นบรรทัดใหม่ = มากกว่า 1
        const lineCounts = await page.evaluate(() => [...document.querySelectorAll('td.left .cell')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return range.getClientRects().length
          }))
        assert.ok(lineCounts.every(n => n <= 1),
          `ข้อความสั้นถูกขึ้นบรรทัดใหม่ทั้งที่บรรทัดเดียวก็พอ (จำนวนบรรทัดต่อช่อง: ${lineCounts.join(', ')})`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'every-page-fits-print-area',
    reason: 'ทุกหน้าต้องอยู่ในพื้นที่พิมพ์ 170mm แม้ชื่อ/ปลายทาง/หมายเหตุยาวสุดตามที่คาดว่าจะเจอจริง',
    async run(browser) {
      // เดิมข้อนี้บังคับว่า "ต้องจบ 1 แผ่น" ซึ่งเป็นเกณฑ์ที่ผิด — จำนวนแถวต่อหน้าคำนวณจาก
      // ความสูงของข้อมูลจริงแล้ว (ดู paginateForm4Trips) เดือนที่ชื่อยาวจนตัด 2 บรรทัดทุกแถว
      // "ต้อง" ใช้มากกว่า 1 แผ่น ไม่งั้นข้อมูลหาย สิ่งที่ต้องยืนยันคือทุกหน้าอยู่ในพื้นที่พิมพ์
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE - 1))
      try {
        const heights = await sheetContentHeightMm(page)
        for (const mm of heights) {
          assert.ok(mm <= PRINT_AREA_MM,
            `เนื้อหาสูง ${mm.toFixed(1)}mm ล้นพื้นที่พิมพ์ ${PRINT_AREA_MM}mm — ทบทวนค่าประมาณใน estimateForm4RowHeightMm`)
        }
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'short-data-still-one-page',
    reason: 'เดือนที่ข้อมูลความยาวปกติต้องยังจบใน 1 แผ่นเหมือนเดิม ไม่ใช่ถูกดันเป็น 2 แผ่นเพราะคำนวณเผื่อมากเกินไป',
    async run(browser) {
      // กันการแก้เกินตัว: ถ้า estimateForm4RowHeightMm เผื่อสูงเกินจริง เดือนธรรมดาจะเปลืองกระดาษ
      // เพิ่มโดยไม่จำเป็น เคสนี้ใช้ชื่อ/ปลายทางความยาวที่เจอจริงทั่วไป
      const trips = makeTrips(FORM4_ROWS_PER_PAGE).map(trip => ({
        ...trip,
        destination: 'บ้านห้วยกาน',
        notes: '',
        requester: { full_name: 'นายสมชาย ใจดี' },
        driver: { full_name: 'นายสมชาย ใจดี' },
      }))
      const page = await renderForm4(browser, trips)
      try {
        // preferCSSPageSize ให้ใช้ @page ของเอกสารเอง (A4 แนวนอน)
        // ถ้าไม่ใส่ Playwright จะใช้ margin 0 แล้ววัดพื้นที่ผิดจากตอนพิมพ์จริง
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.ok(pdfPageCount(pdf) <= 2,
          `ข้อมูลความยาวปกติ ${FORM4_ROWS_PER_PAGE} เที่ยวใช้ถึง ${pdfPageCount(pdf)} แผ่น — ค่าประมาณความสูงเผื่อมากเกินไป`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'overflow-spillover-page-fits',
    reason: 'เดือนที่ข้อมูลเต็มพอดี 1 หน้า แถวรวมยอดจะเด้งไปหน้าถัดไปเดี่ยวๆ (ดู paginateForm4Trips) — หน้านั้นเกือบเป็นแถวว่างล้วน ต้องไม่ล้นเพราะแถวว่างถูกดันสูงเพื่อเติมเต็มหน้า',
    async run(browser) {
      // ที่มา: 2026-09-05 ตั้ง tr.blank-filler ให้สูงกว่าปกติเพื่อให้ตารางเต็มหน้าเวลาข้อมูลน้อย
      // (ดูคอมเมนต์ tr.blank-filler td ใน fleetForm4Print.js) ตอนแรกตั้ง 11mm โดยลืมคิดพื้นที่
      // ของ thead (หัวตาราง 2 แถวที่มีป้ายกำกับยาวถึง 4 บรรทัด กิน ~19mm) รวมเข้าไปในงบ
      // ผลคือหน้าที่มีแต่แถวว่าง 13 แถว + แถวรวม 1 แถว ล้นไป 195mm จาก 189mm (ยุคขอบเข้าแฟ้มด้านซ้าย) แก้เป็น 9.8mm
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE))
      try {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.ok(pdfPageCount(pdf) >= 2,
          'ข้อมูลเต็มพอดี 1 หน้าต้องมีหน้าถัดไปสำหรับแถวรวมยอดเสมอ (ไม่งั้นแถวรวมหายไปพร้อมกับหน้าแรก)')

        const heights = await sheetContentHeightMm(page)
        for (const mm of heights) {
          assert.ok(mm <= PRINT_AREA_MM,
            `เนื้อหาสูง ${mm.toFixed(1)}mm ล้นพื้นที่พิมพ์ ${PRINT_AREA_MM}mm — ปรับ tr.blank-filler td height ลง`)
        }
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'long-free-text-visibly-clamped-not-silently-lost',
    reason: 'สถานที่ไป/หมายเหตุที่ยาวเกินกันไว้ต้องจบด้วย "…" ให้เห็น ไม่ตัดหายเงียบแบบไม่มีสัญญาณ',
    async run(browser) {
      const trips = makeTrips(3).map((trip, index) => index === 0
        ? { ...trip, notes: 'เหตุฉุกเฉินนอกเวลาราชการ '.repeat(20), destination: 'จุดทดสอบ' }
        : trip)
      const page = await renderForm4(browser, trips)
      try {
        const state = await page.evaluate(() => {
          const cell = [...document.querySelectorAll('td.left .cell--clamp')]
            .find(el => (el.textContent || '').includes('เหตุฉุกเฉินนอกเวลาราชการ'))
          if (!cell) return null
          const cs = getComputedStyle(cell)
          return {
            webkitLineClamp: cs.webkitLineClamp,
            overflowHidden: cs.overflow === 'hidden',
            clipped: cell.scrollHeight > cell.clientHeight + 1,
          }
        })
        assert.ok(state, 'ไม่พบช่องหมายเหตุที่มีข้อความยาวทดสอบ')
        assert.ok(state.clipped, 'ทดสอบนี้ต้องการข้อความที่ยาวเกินจริง แต่กลับแสดงครบพอดี — ปรับความยาวข้อความทดสอบ')
        assert.equal(state.webkitLineClamp, '2',
          'ไม่ได้ตั้ง -webkit-line-clamp ข้อความที่เกินจะถูกตัดหายโดยไม่มี "…" บอก')
        assert.ok(state.overflowHidden, 'ข้อความล้นออกนอกตาราง ทับเส้นกรอบ แทนที่จะถูก clamp ไว้ในกรอบ')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'backdated-reason-not-printed',
    reason: 'เหตุผลบันทึกย้อนหลังต้องไม่ปรากฏในหมายเหตุของแบบ 4 อีกต่อไป',
    async run(browser) {
      const trips = makeTrips(2).map(trip => ({ ...trip, notes: '', backdated_reason: 'เหตุผลทดสอบเฉพาะกิจ' }))
      const page = await renderForm4(browser, trips)
      try {
        const text = await page.evaluate(() => document.body.innerText)
        assert.ok(!text.includes('เหตุผลทดสอบเฉพาะกิจ'),
          'เหตุผลบันทึกย้อนหลังหลุดไปแสดงในแบบ 4 ทั้งที่ควรอยู่แค่ในระบบ')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'total-row-always-present',
    reason: 'แถวรวมระยะทางทั้งสิ้นต้องมีเสมอ แม้แถวข้อมูลจะเต็มหน้าพอดี',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE))
      try {
        const text = await page.evaluate(() => document.body.innerText)
        assert.ok(text.includes('รวมระยะทางทั้งสิ้น'),
          'ข้อมูลเต็มหน้าพอดีแล้วแถวรวมยอดหายไป')
        const totalRows = await page.evaluate(() => document.querySelectorAll('tr.total').length)
        assert.equal(totalRows, 1, `พบแถวรวมยอด ${totalRows} แถว ต้องมีแถวเดียว`)
      } finally {
        await page.close()
      }
    },
  },
]

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    for (const check of checks) {
      try {
        await check.run(browser)
        results.push(`PASS ${check.name}: ${check.reason}`)
      } catch (error) {
        results.push(`FAIL ${check.name}: ${error?.message ?? error}`)
      }
    }
  } finally {
    await browser.close()
  }
  const failed = results.filter(line => line.startsWith('FAIL')).length
  process.stdout.write(`แบบ 4 — ตรวจเอกสารที่พิมพ์\n${results.join('\n')}\n`)
  process.stdout.write(`SUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
  if (failed) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})
