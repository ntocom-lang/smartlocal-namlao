// แบบ 4 บันทึกการใช้รถ — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// แยกจาก fleet-form4-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์ (เร็วกว่ามาก)
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริงเท่านั้น: ข้อความขาด/ล้นหน้า
//
// ที่มา: คอลัมน์ สถานที่ไป กับ พนักงานขับรถ เคยตั้ง white-space:nowrap + overflow:hidden
// คู่กับ table-layout:fixed ข้อความที่ยาวเกินความกว้างคอลัมน์จึงถูกตัดหายเงียบๆ กลางคำ
// บนเอกสารที่เอาไปให้ผู้มีอำนาจเซ็น โดยไม่มีอะไรบอกว่าโดนตัด (วัดได้: สถานที่ไปต้องใช้
// 294px แต่มีให้ 161px) ตอนนี้แก้ด้วยสคริปต์ auto-fit 3 ขั้นใน fleetForm4Print.js
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
// และหมายเหตุระดับประโยค ถ้าเทสนี้ผ่าน แปลว่าเคสงานจริงไม่มีข้อความขาด
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

async function renderForm4(browser, trips) {
  const page = await browser.newPage()
  const html = buildFleetForm4Html({ vehicle: VEHICLE, trips, periodLabel: PERIOD })
  await page.setContent(html, { waitUntil: 'load' })
  // auto-fit วัดความกว้างจริงของฟอนต์ ต้องรอฟอนต์โหลดเสร็จก่อน ไม่งั้นวัดด้วยฟอนต์สำรอง
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

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

const checks = [
  {
    name: 'no-clipped-text',
    reason: 'ทุกช่องข้อความพิมพ์ครบ ไม่มีตัวอักษรถูกตัดหาย',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE - 1))
      try {
        const clippedCells = await overflowingCells(page, 'td.left .cell')
        assert.deepEqual(clippedCells, [],
          `ช่องข้อความถูกตัดกลางคำ: ${clippedCells.join(' | ')}`)

        // ช่องตัวเลข/วันที่ยังเป็นบรรทัดเดียวตายตัว ไม่มี auto-fit ถ้าล้นคือคอลัมน์แคบไป
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
    reason: 'ข้อความสั้นยังเป็นบรรทัดเดียวเท่าต้นฉบับกระดาษ ไม่ตัดบรรทัดทิ้งโดยไม่จำเป็น',
    async run(browser) {
      const trips = makeTrips(3).map(trip => ({
        ...trip, destination: 'บ้านห้วยทรายขาว', notes: '', requester: { full_name: 'นาย ทดสอบ ระบบ' },
        driver: { full_name: 'นาย ทดสอบ ระบบ' },
      }))
      const page = await renderForm4(browser, trips)
      try {
        const wrapped = await page.evaluate(() =>
          document.querySelectorAll('td.left .cell.wrapped').length)
        assert.equal(wrapped, 0,
          'ข้อความสั้นถูกบังคับตัด 2 บรรทัด ทั้งที่บรรทัดเดียวก็พอ — เอกสารจะไม่เหมือนต้นฉบับ')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'fits-one-page',
    reason: 'หนึ่งเดือนที่ยังไม่เต็มหน้า ต้องพิมพ์จบใน 1 แผ่น',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE - 1))
      try {
        // preferCSSPageSize ให้ใช้ @page ของเอกสารเอง (A4 แนวนอน margin 7/9mm)
        // ถ้าไม่ใส่ Playwright จะใช้ margin 0 แล้ววัดพื้นที่ผิดจากตอนพิมพ์จริง
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1,
          'ตารางล้นออกไปหน้าที่ 2 — ความสูงแถวหรือหัวเอกสารโตเกินพื้นที่พิมพ์')

        // เหลือขอบล่างไว้กันฟอนต์ต่างเครื่อง (เครื่อง อปท. ใช้ TH Sarabun New ที่ metric ไม่เท่ากัน)
        const sheetMm = await page.evaluate(() => {
          const sheet = document.querySelector('.sheet')
          return sheet.getBoundingClientRect().height / 3.779527
        })
        assert.ok(sheetMm <= 192,
          `เนื้อหาสูง ${sheetMm.toFixed(1)}mm เหลือขอบน้อยเกินไป (พื้นที่พิมพ์ 196mm) เสี่ยงตกหน้า 2 บนเครื่องอื่น`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'extreme-text-shows-ellipsis',
    reason: 'ข้อความยาวเกินช่องจริงๆ ต้องจบด้วย "…" ให้เห็น ไม่ตัดหายเงียบ',
    async run(browser) {
      // เหตุผลบันทึกย้อนหลังยาวได้ถึง 500 ตัวอักษรตาม constraint ของ DB
      // ยาวขนาดนี้ไม่มีทางลงช่องหมายเหตุบนกระดาษได้ แต่ต้องรู้ว่ายังมีข้อความต่อ
      const trips = makeTrips(3).map((trip, index) => index === 0
        ? { ...trip, notes: '', backdated_reason: 'เหตุฉุกเฉินนอกเวลาราชการ '.repeat(20) }
        : trip)
      const page = await renderForm4(browser, trips)
      try {
        const state = await page.evaluate(() => {
          const cell = [...document.querySelectorAll('td.left .cell')]
            .find(el => (el.textContent || '').includes('เหตุฉุกเฉินนอกเวลาราชการ'))
          if (!cell) return null
          return {
            wrapped: cell.classList.contains('wrapped'),
            clamp: getComputedStyle(cell).webkitLineClamp,
            overflowHidden: getComputedStyle(cell).overflow === 'hidden',
          }
        })
        assert.ok(state, 'ไม่พบช่องหมายเหตุที่มีเหตุผลบันทึกย้อนหลัง')
        assert.ok(state.wrapped, 'ข้อความยาวมากแต่ไม่ถูกสลับไปโหมดตัด 2 บรรทัด')
        assert.equal(state.clamp, '2',
          'ไม่ได้ตั้ง -webkit-line-clamp ข้อความที่เกินจะถูกตัดหายโดยไม่มี "…" บอก')
        assert.ok(state.overflowHidden, 'ข้อความล้นออกนอกตาราง ทับเส้นกรอบ')
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
